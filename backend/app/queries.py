"""Read-only queries shared by the resident, crew and operator views."""
from uuid import UUID

from .db import Database


def rows(records) -> list[dict]:
    return [dict(r) for r in records]


async def issue_detail(db: Database, issue_id: UUID) -> dict | None:
    issue = await db.fetchrow(
        """SELECT i.issue_id, i.status::text AS status, i.severity, i.duplicate_count, i.priority_base,
                  i.is_escalated, i.reopen_count, i.address_text, i.created_at, i.closed_at, i.updated_at,
                  i.merged_into_id, pt.code AS problem_type, pt.display_name AS problem_type_name,
                  a.name AS area_name, i.area_id,
                  ST_Y(i.location::geometry) AS lat, ST_X(i.location::geometry) AS lng,
                  q.priority_score
           FROM issues i
           JOIN problem_types pt ON pt.problem_type_id = i.problem_type_id
           LEFT JOIN service_areas a ON a.area_id = i.area_id
           LEFT JOIN v_issue_queue q ON q.issue_id = i.issue_id
           WHERE i.issue_id = $1""", issue_id)
    if not issue:
        return None
    reports = await db.fetch(
        """SELECT r.report_id, r.reporter_id, u.full_name AS reporter_name, r.status::text AS status,
                  r.description, r.submitted_at, r.photo_id, pt.display_name AS chosen_type,
                  ST_Y(r.location::geometry) AS lat, ST_X(r.location::geometry) AS lng,
                  v.severity AS ai_severity, v.confidence AS ai_confidence, v.is_infrastructure AS ai_is_infrastructure,
                  v.model_name AS ai_model, v.latency_ms AS ai_latency_ms, dt.display_name AS ai_detected_type,
                  v.raw_output->>'summary' AS ai_summary
           FROM reports r
           JOIN users u ON u.user_id = r.reporter_id
           JOIN problem_types pt ON pt.problem_type_id = r.problem_type_id
           LEFT JOIN LATERAL (SELECT * FROM validations WHERE report_id = r.report_id
                              ORDER BY created_at DESC LIMIT 1) v ON TRUE
           LEFT JOIN problem_types dt ON dt.problem_type_id = v.detected_type_id
           WHERE r.issue_id = $1 ORDER BY r.submitted_at""", issue_id)
    work_orders = await db.fetch(
        """SELECT w.work_order_id, w.status::text AS status, w.crew_id, c.name AS crew_name, w.deadline_at,
                  w.created_at, w.started_at, w.completed_at, w.escalated_at, w.after_photo_id, w.crew_notes,
                  rv.verdict::text AS verdict, rv.confidence AS verdict_confidence, rv.model_name AS verdict_model,
                  rc.confirmation_id, rc.status::text AS confirmation_status, rc.auto_close_at,
                  rc.responded_at, rc.dispute_reason
           FROM work_orders w
           JOIN crews c ON c.crew_id = w.crew_id
           LEFT JOIN repair_verifications rv ON rv.work_order_id = w.work_order_id
           LEFT JOIN resident_confirmations rc ON rc.work_order_id = w.work_order_id
           WHERE w.issue_id = $1 ORDER BY w.created_at DESC""", issue_id)
    history = await db.fetch(
        """SELECT from_status::text AS from_status, to_status::text AS to_status, module::text AS module, changed_at
           FROM issue_status_history WHERE issue_id = $1 ORDER BY changed_at, history_id""", issue_id)
    priority = await db.fetch(
        """SELECT severity_part, duplicate_part, total_base, reason, calculated_at
           FROM priority_history WHERE issue_id = $1 ORDER BY calculated_at DESC LIMIT 10""", issue_id)
    return {**dict(issue), "reports": rows(reports), "work_orders": rows(work_orders),
            "status_history": rows(history), "priority_history": rows(priority)}


async def issue_facts(conn, issue_id: UUID) -> dict:
    """Small summary used to write notification messages."""
    row = await conn.fetchrow(
        """SELECT pt.display_name AS type_name, i.severity, i.address_text, i.status::text AS status
           FROM issues i JOIN problem_types pt ON pt.problem_type_id = i.problem_type_id
           WHERE i.issue_id = $1""", issue_id)
    return dict(row) if row else {}
