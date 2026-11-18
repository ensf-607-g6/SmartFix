"""Reports module (producer, no queue): resident endpoints (FR-1, FR-9, FR-10)
and the 7-day auto-close check."""
import logging
from datetime import datetime
from typing import Literal
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from pydantic import BaseModel, Field

from ..auth import CurrentUser, current_user, require
from ..context import AppContext, get_ctx
from ..events.models import IssueClosed, IssueReported, RepairDisputed
from ..queries import issue_detail, rows
from ..storage import InvalidImage

log = logging.getLogger("smartfix.reports")
router = APIRouter(tags=["reports"])
MODULE = "reports"


@router.get("/problem-types")
async def problem_types(ctx: AppContext = Depends(get_ctx)):
    return rows(await ctx.db.fetch(
        "SELECT problem_type_id, code, display_name FROM problem_types WHERE is_active ORDER BY problem_type_id"))


class ReportAccepted(BaseModel):
    report_id: UUID
    issue_id: UUID
    status: str = "submitted"


@router.post("/reports", status_code=status.HTTP_202_ACCEPTED, response_model=ReportAccepted)
async def submit_report(
    photo: UploadFile = File(...),
    lat: float = Form(..., ge=-90, le=90),
    lng: float = Form(..., ge=-180, le=180),
    problem_type: str = Form(...),
    description: str | None = Form(None, max_length=1000),
    address: str | None = Form(None, max_length=300),
    user: CurrentUser = Depends(require("resident")),
    ctx: AppContext = Depends(get_ctx),
):
    """FR-1. Saves the report and publishes IssueReported; the resident does not wait for the AI."""
    type_id = await ctx.db.fetchval(
        "SELECT problem_type_id FROM problem_types WHERE code = $1 AND is_active", problem_type)
    if type_id is None:
        raise HTTPException(422, "Unknown problem category")
    try:
        path, sha, mime = ctx.storage.save(await photo.read(), "report")
    except InvalidImage as exc:
        raise HTTPException(422, str(exc))

    async with ctx.db.transaction(MODULE) as tx:
        photo_id = await tx.fetchval(
            """INSERT INTO photos (kind, storage_path, mime_type, sha256, uploaded_by)
               VALUES ('report', $1, $2, $3, $4) RETURNING photo_id""", path, mime, sha, user.user_id)
        point = "ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography"
        area_id = await tx.fetchval(
            f"""SELECT area_id FROM service_areas WHERE ST_Covers(boundary, {point})
                ORDER BY ST_Area(boundary) LIMIT 1""", lng, lat)
        issue_id = await tx.fetchval(
            f"""INSERT INTO issues (problem_type_id, location, address_text, area_id)
                VALUES ($3, {point}, $4, $5) RETURNING issue_id""",
            lng, lat, type_id, (address or "").strip() or None, area_id)
        report_id = await tx.fetchval(
            f"""INSERT INTO reports (issue_id, reporter_id, problem_type_id, photo_id, location, description)
                VALUES ($3, $4, $5, $6, {point}, $7) RETURNING report_id""",
            lng, lat, issue_id, user.user_id, type_id, photo_id, (description or "").strip() or None)
        event = IssueReported(issue_id=issue_id, report_id=report_id, producer=MODULE, actor_id=user.user_id,
                              correlation_id=uuid4(), photo_id=photo_id, lat=lat, lng=lng,
                              problem_type=problem_type)
        await ctx.store.save(event, tx)
    await ctx.bus.publish(event)
    return ReportAccepted(report_id=report_id, issue_id=issue_id)


@router.get("/reports/mine")
async def my_reports(user: CurrentUser = Depends(require("resident")), ctx: AppContext = Depends(get_ctx)):
    """NFR-6: a resident only ever sees their own reports."""
    return rows(await ctx.db.fetch(
        """SELECT r.report_id, r.issue_id, r.status::text AS report_status, r.description, r.submitted_at,
                  r.photo_id, ST_Y(r.location::geometry) AS lat, ST_X(r.location::geometry) AS lng,
                  pt.code AS problem_type, pt.display_name AS problem_type_name,
                  i.status::text AS issue_status, i.severity, i.duplicate_count, i.address_text,
                  i.is_escalated, i.updated_at,
                  rc.confirmation_id, rc.status::text AS confirmation_status, rc.auto_close_at
           FROM reports r
           JOIN issues i ON i.issue_id = r.issue_id
           JOIN problem_types pt ON pt.problem_type_id = i.problem_type_id
           LEFT JOIN LATERAL (SELECT confirmation_id, status, auto_close_at FROM resident_confirmations
                              WHERE issue_id = i.issue_id AND resident_id = $1
                              ORDER BY requested_at DESC LIMIT 1) rc ON TRUE
           WHERE r.reporter_id = $1
           ORDER BY r.submitted_at DESC""", user.user_id))


@router.get("/reports/{report_id}")
async def report_detail(report_id: UUID, user: CurrentUser = Depends(require("resident")),
                        ctx: AppContext = Depends(get_ctx)):
    own = await ctx.db.fetchrow(
        "SELECT issue_id, status::text AS status FROM reports WHERE report_id = $1 AND reporter_id = $2",
        report_id, user.user_id)
    if not own:
        raise HTTPException(404, "Report not found")
    detail = await issue_detail(ctx.db, own["issue_id"])
    mine = next((r for r in detail["reports"] if r["report_id"] == report_id), None)
    # Other residents' reports on the same issue stay private; only the count is shown.
    detail["reports"] = [mine] if mine else []
    detail["priority_history"] = []
    for wo in detail["work_orders"]:
        if wo.get("confirmation_id") and not await ctx.db.fetchval(
                "SELECT 1 FROM resident_confirmations WHERE confirmation_id = $1 AND resident_id = $2",
                wo["confirmation_id"], user.user_id):
            wo["confirmation_id"] = None
    return {"report_id": report_id, "report_status": own["status"], **detail}


class ConfirmationAnswer(BaseModel):
    action: Literal["confirm", "dispute"]
    reason: str | None = Field(None, max_length=1000)


@router.post("/confirmations/{confirmation_id}")
async def answer_confirmation(confirmation_id: UUID, body: ConfirmationAnswer,
                              user: CurrentUser = Depends(require("resident")),
                              ctx: AppContext = Depends(get_ctx)):
    """FR-9 / FR-10: the resident confirms the fix or disputes it."""
    if body.action == "dispute" and not (body.reason or "").strip():
        raise HTTPException(422, "Please tell us what is still wrong")
    async with ctx.db.transaction(MODULE) as tx:
        c = await tx.fetchrow(
            """SELECT rc.*, i.status::text AS issue_status FROM resident_confirmations rc
               JOIN issues i ON i.issue_id = rc.issue_id
               WHERE rc.confirmation_id = $1 AND rc.resident_id = $2 FOR UPDATE OF rc""",
            confirmation_id, user.user_id)
        if not c:
            raise HTTPException(404, "Confirmation not found")
        if c["status"] != "pending" or c["issue_status"] != "completed":
            raise HTTPException(409, "This repair has already been answered")
        cause = await tx.fetchrow(
            """SELECT event_id, correlation_id FROM events
               WHERE event_name = 'RepairCompleted' AND payload->>'work_order_id' = $1::text
               ORDER BY occurred_at DESC LIMIT 1""", str(c["work_order_id"]))
        common = dict(issue_id=c["issue_id"], producer=MODULE, actor_id=user.user_id,
                      correlation_id=cause["correlation_id"] if cause else await ctx.store.correlation_for(c["issue_id"], tx),
                      causation_id=cause["event_id"] if cause else None, work_order_id=c["work_order_id"])
        if body.action == "confirm":
            await tx.execute(
                "UPDATE resident_confirmations SET status = 'confirmed', responded_at = now() WHERE confirmation_id = $1",
                confirmation_id)
            await tx.execute("UPDATE issues SET status = 'closed' WHERE issue_id = $1", c["issue_id"])
            event = IssueClosed(closed_by="confirmed", **common)
        else:
            reason = body.reason.strip()
            await tx.execute(
                """UPDATE resident_confirmations SET status = 'disputed', responded_at = now(), dispute_reason = $2
                   WHERE confirmation_id = $1""", confirmation_id, reason)
            await tx.execute(
                "UPDATE issues SET status = 'reopened', reopen_count = reopen_count + 1 WHERE issue_id = $1",
                c["issue_id"])
            event = RepairDisputed(dispute_reason=reason, **common)
        await ctx.store.save(event, tx)
    await ctx.bus.publish(event)
    return {"status": "closed" if body.action == "confirm" else "reopened"}


async def auto_close_unconfirmed(ctx: AppContext, now: datetime | None = None) -> int:
    """FR-10: close completed issues whose resident has not answered within 7 days."""
    due = await ctx.db.fetch(
        """SELECT confirmation_id FROM resident_confirmations
           WHERE status = 'pending' AND auto_close_at <= COALESCE($1, now())""", now)
    closed = 0
    for row in due:
        event = None
        async with ctx.db.transaction(MODULE) as tx:
            c = await tx.fetchrow(
                """SELECT rc.*, i.status::text AS issue_status FROM resident_confirmations rc
                   JOIN issues i ON i.issue_id = rc.issue_id
                   WHERE rc.confirmation_id = $1 AND rc.status = 'pending' FOR UPDATE OF rc SKIP LOCKED""",
                row["confirmation_id"])
            if not c:
                continue
            await tx.execute("UPDATE resident_confirmations SET status = 'auto_closed' WHERE confirmation_id = $1",
                             c["confirmation_id"])
            if c["issue_status"] == "completed":
                await tx.execute("UPDATE issues SET status = 'closed' WHERE issue_id = $1", c["issue_id"])
                event = IssueClosed(issue_id=c["issue_id"], producer=MODULE, work_order_id=c["work_order_id"],
                                    closed_by="auto_closed",
                                    correlation_id=await ctx.store.correlation_for(c["issue_id"], tx))
                await ctx.store.save(event, tx)
        if event:
            await ctx.bus.publish(event)
            closed += 1
    if closed:
        log.info("auto-closed %d issues", closed)
    return closed
