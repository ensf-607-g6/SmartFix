"""Dashboard Query API: read-only router over the views (FR-13, FR-14, FR-15).
It never changes state; reviews and reassignments go to their owning modules (NFR-4)."""
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query

from ..auth import STAFF, CurrentUser, require
from ..context import AppContext, get_ctx
from ..queries import issue_detail, rows

router = APIRouter(tags=["dashboard"])
staff = require(*STAFF)


@router.get("/dashboard/map")
async def live_map(status: list[str] | None = Query(None), problem_type: list[str] | None = Query(None),
                   severity: list[int] | None = Query(None), escalated_only: bool = False,
                   _: CurrentUser = Depends(staff), ctx: AppContext = Depends(get_ctx)):
    return rows(await ctx.db.fetch(
        """SELECT m.issue_id, m.problem_type, pt.display_name AS problem_type_name, m.status::text AS status,
                  m.severity, round(m.priority_score, 1) AS priority_score, m.lat, m.lng,
                  m.work_order_id, m.crew_id, c.name AS crew_name, m.deadline_at,
                  i.address_text, i.duplicate_count, i.is_escalated, i.created_at, i.reopen_count
           FROM v_operator_map m
           JOIN issues i ON i.issue_id = m.issue_id
           JOIN problem_types pt ON pt.code = m.problem_type
           LEFT JOIN crews c ON c.crew_id = m.crew_id
           WHERE ($1::text[] IS NULL OR m.status::text = ANY($1))
             AND ($2::text[] IS NULL OR m.problem_type = ANY($2))
             AND ($3::int[] IS NULL OR m.severity = ANY($3))
             AND (NOT $4 OR i.is_escalated)
           ORDER BY m.priority_score DESC""", status, problem_type, severity, escalated_only))


@router.get("/dashboard/summary")
async def summary(_: CurrentUser = Depends(staff), ctx: AppContext = Depends(get_ctx)):
    counts = dict(await ctx.db.fetch(
        "SELECT status::text, count(*) FROM issues GROUP BY status"))
    latency = await ctx.db.fetchrow(
        """SELECT count(*) AS runs,
                  round(avg(latency_ms)) AS avg_ms,
                  percentile_cont(0.95) WITHIN GROUP (ORDER BY latency_ms) AS p95_ms,
                  round(100.0 * avg((latency_ms <= 15000)::int), 1) AS pct_under_15s
           FROM validations WHERE model_name <> 'unavailable'""")
    return {
        "by_status": counts,
        "open": sum(v for k, v in counts.items() if k not in ("closed", "rejected", "merged")),
        "pending_reviews": await ctx.db.fetchval("SELECT count(*) FROM review_queue WHERE decision = 'pending'"),
        "escalated": await ctx.db.fetchval(
            "SELECT count(*) FROM issues WHERE is_escalated AND status NOT IN ('closed','rejected','merged')"),
        "awaiting_crew": await ctx.db.fetchval(
            """SELECT count(*) FROM issues i WHERE status = 'prioritized' AND NOT EXISTS (
                   SELECT 1 FROM work_orders w WHERE w.issue_id = i.issue_id AND w.status IN ('assigned','in_progress'))"""),
        "dead_letters": await ctx.db.fetchval("SELECT count(*) FROM dead_letter_events WHERE resolved_at IS NULL"),
        "validation_latency": dict(latency),
    }


@router.get("/review")
async def review_list(_: CurrentUser = Depends(staff), ctx: AppContext = Depends(get_ctx)):
    return rows(await ctx.db.fetch(
        """SELECT rq.review_id, rq.reason::text AS reason, rq.created_at, r.report_id, r.issue_id, r.photo_id,
                  r.description, u.full_name AS reporter_name, pt.code AS chosen_type,
                  pt.display_name AS chosen_type_name, i.address_text,
                  ST_Y(r.location::geometry) AS lat, ST_X(r.location::geometry) AS lng,
                  v.severity AS ai_severity, v.confidence AS ai_confidence, v.is_infrastructure AS ai_is_infrastructure,
                  v.model_name AS ai_model, dt.code AS ai_type, dt.display_name AS ai_type_name,
                  v.raw_output->>'summary' AS ai_summary
           FROM review_queue rq
           JOIN reports r ON r.report_id = rq.report_id
           JOIN users u ON u.user_id = r.reporter_id
           JOIN issues i ON i.issue_id = r.issue_id
           JOIN problem_types pt ON pt.problem_type_id = r.problem_type_id
           LEFT JOIN LATERAL (SELECT * FROM validations WHERE report_id = r.report_id
                              ORDER BY created_at DESC LIMIT 1) v ON TRUE
           LEFT JOIN problem_types dt ON dt.problem_type_id = v.detected_type_id
           WHERE rq.decision = 'pending' ORDER BY rq.created_at"""))


@router.get("/issues/{issue_id}")
async def get_issue(issue_id: UUID, _: CurrentUser = Depends(staff), ctx: AppContext = Depends(get_ctx)):
    detail = await issue_detail(ctx.db, issue_id)
    if not detail:
        raise HTTPException(404, "Issue not found")
    return detail


@router.get("/issues/{issue_id}/timeline")
async def timeline(issue_id: UUID, _: CurrentUser = Depends(staff), ctx: AppContext = Depends(get_ctx)):
    # Events of the issue's merged duplicates belong to its story too.
    return rows(await ctx.db.fetch(
        """SELECT t.issue_id, t.at, t.kind, t.label, t.source, t.detail
           FROM v_issue_timeline t
           WHERE t.issue_id = $1 OR t.issue_id IN (SELECT issue_id FROM issues WHERE merged_into_id = $1)
           ORDER BY t.at, t.kind DESC""", issue_id))


@router.get("/stats")
async def stats(_: CurrentUser = Depends(staff), ctx: AppContext = Depends(get_ctx)):
    return {
        "repair_stats": rows(await ctx.db.fetch(
            """SELECT s.*, pt.display_name FROM v_repair_stats s
               JOIN problem_types pt ON pt.code = s.problem_type ORDER BY s.repairs DESC""")),
        "hotspots": rows(await ctx.db.fetch("SELECT * FROM v_area_hotspots ORDER BY issues_30d DESC")),
        "by_type": rows(await ctx.db.fetch(
            """SELECT pt.code, pt.display_name,
                      count(i.issue_id) FILTER (WHERE i.status NOT IN ('closed','rejected','merged')) AS open,
                      count(i.issue_id) FILTER (WHERE i.status = 'closed') AS closed
               FROM problem_types pt LEFT JOIN issues i ON i.problem_type_id = pt.problem_type_id
               GROUP BY pt.problem_type_id ORDER BY pt.problem_type_id""")),
        "verdicts": dict(await ctx.db.fetch(
            "SELECT verdict::text, count(*) FROM repair_verifications GROUP BY verdict")),
        "confirmations": dict(await ctx.db.fetch(
            "SELECT status::text, count(*) FROM resident_confirmations GROUP BY status")),
        "events_24h": rows(await ctx.db.fetch(
            """SELECT event_name, count(*) AS n FROM events WHERE occurred_at > now() - interval '24 hours'
               GROUP BY event_name ORDER BY n DESC""")),
    }


@router.get("/crews")
async def crews(_: CurrentUser = Depends(staff), ctx: AppContext = Depends(get_ctx)):
    return rows(await ctx.db.fetch(
        """SELECT c.crew_id, c.name, c.max_active_orders, c.is_active, u.full_name AS supervisor_name,
                  (SELECT count(*) FROM work_orders w WHERE w.crew_id = c.crew_id
                   AND w.status IN ('assigned','in_progress')) AS active_orders,
                  ARRAY(SELECT pt.code FROM crew_specialties cs JOIN problem_types pt
                        ON pt.problem_type_id = cs.problem_type_id WHERE cs.crew_id = c.crew_id) AS specialties,
                  ARRAY(SELECT a.name FROM crew_service_areas ca JOIN service_areas a
                        ON a.area_id = ca.area_id WHERE ca.crew_id = c.crew_id) AS areas
           FROM crews c LEFT JOIN users u ON u.user_id = c.supervisor_id ORDER BY c.name"""))


@router.get("/service-areas")
async def service_areas(_: CurrentUser = Depends(staff), ctx: AppContext = Depends(get_ctx)):
    return rows(await ctx.db.fetch(
        """SELECT a.area_id, a.name, ST_AsGeoJSON(a.boundary)::json AS geometry,
                  COALESCE(h.issues_30d, 0) AS issues_30d, COALESCE(h.repeat_reports_30d, 0) AS repeat_reports_30d,
                  COALESCE(h.still_open, 0) AS still_open
           FROM service_areas a LEFT JOIN v_area_hotspots h ON h.area_id = a.area_id ORDER BY a.name"""))


@router.get("/dead-letters")
async def dead_letters(_: CurrentUser = Depends(staff), ctx: AppContext = Depends(get_ctx)):
    return rows(await ctx.db.fetch(
        """SELECT d.dead_letter_id, d.event_id, e.event_name, d.consumer::text AS consumer, d.attempts,
                  d.error_message, d.failed_at, d.resolved_at
           FROM dead_letter_events d LEFT JOIN events e ON e.event_id = d.event_id
           ORDER BY d.failed_at DESC LIMIT 100"""))
