"""Work Orders module: crew matching and deadlines (FR-6), the crew portal (FR-7)
and operator reassignment (FR-13)."""
import logging
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel, Field

from ..auth import STAFF, CurrentUser, require
from ..context import AppContext, get_ctx
from ..db import Transaction
from ..events.consumer import EventConsumer
from ..events.models import (DomainEvent, IssuePrioritized, RepairCompleted, RepairDisputed,
                             WorkOrderCreated, WorkOrderStatusChanged)
from ..queries import issue_detail, rows
from ..storage import InvalidImage

log = logging.getLogger("smartfix.work_orders")
MODULE = "work_orders"
ACTIVE = ("assigned", "in_progress")


async def match_crew(tx: Transaction, problem_type_id: int, area_id: int | None) -> int | None:
    """Specialty + service area + spare capacity, least loaded first (pick_crew). If no crew
    covers the area, any crew with the specialty and capacity takes it."""
    crew_id = await tx.fetchval("SELECT pick_crew($1, $2)", problem_type_id, area_id) if area_id else None
    if crew_id is None:
        crew_id = await tx.fetchval(
            """SELECT c.crew_id FROM crews c
               JOIN crew_specialties cs ON cs.crew_id = c.crew_id AND cs.problem_type_id = $1
               LEFT JOIN LATERAL (SELECT count(*) AS active FROM work_orders w
                                  WHERE w.crew_id = c.crew_id AND w.status IN ('assigned', 'in_progress')) l ON TRUE
               WHERE c.is_active AND l.active < c.max_active_orders
               ORDER BY l.active::numeric / c.max_active_orders, c.crew_id LIMIT 1""", problem_type_id)
    return crew_id


async def dispatch(tx: Transaction, issue_id: UUID, cause: DomainEvent, crew_id: int | None = None,
                   assigned_by: UUID | None = None) -> list[DomainEvent]:
    issue = await tx.fetchrow(
        "SELECT status::text AS status, severity, problem_type_id, area_id FROM issues WHERE issue_id = $1 FOR UPDATE",
        issue_id)
    if not issue or issue["status"] != "prioritized":
        return []
    if await tx.fetchval("SELECT 1 FROM work_orders WHERE issue_id = $1 AND status IN ('assigned', 'in_progress')",
                         issue_id):
        return []        # a duplicate only moved it in the queue; never send a second crew
    crew_id = crew_id or await match_crew(tx, issue["problem_type_id"], issue["area_id"])
    if crew_id is None:
        log.info("no crew available for issue %s yet", issue_id)
        return []
    wo = await tx.fetchrow(
        """INSERT INTO work_orders (issue_id, crew_id, deadline_at)
           VALUES ($1, $2, work_order_deadline($3)) RETURNING work_order_id, deadline_at""",
        issue_id, crew_id, issue["severity"] or 3)
    await tx.execute(
        "INSERT INTO work_order_assignments (work_order_id, crew_id, assigned_by, reason) VALUES ($1, $2, $3, $4)",
        wo["work_order_id"], crew_id, assigned_by, "manual_dispatch" if assigned_by else "auto_match")
    await tx.execute("UPDATE issues SET status = 'assigned' WHERE issue_id = $1", issue_id)
    return [cause.follow(WorkOrderCreated, MODULE, issue_id=issue_id, report_id=None, actor_id=assigned_by,
                         work_order_id=wo["work_order_id"], crew_id=crew_id, deadline_at=wo["deadline_at"])]


class WorkOrdersModule(EventConsumer):
    name = MODULE
    subscriptions = [IssuePrioritized, RepairDisputed]

    async def handle(self, event, tx):
        if isinstance(event, IssuePrioritized):
            return await dispatch(tx, event.issue_id, event)
        # RepairDisputed: the completed order stays completed. Priority reopens the issue and
        # the IssuePrioritized that follows creates the new work order (SD-3).
        return []


async def assign_waiting(ctx: AppContext) -> int:
    """Retry prioritized issues that had no free crew when they were first dispatched."""
    waiting = await ctx.db.fetch(
        """SELECT i.issue_id FROM issues i
           WHERE i.status = 'prioritized' AND i.updated_at < now() - interval '30 seconds'
             AND NOT EXISTS (SELECT 1 FROM work_orders w WHERE w.issue_id = i.issue_id
                             AND w.status IN ('assigned', 'in_progress'))""")
    created = 0
    for row in waiting:
        async with ctx.db.transaction(MODULE) as tx:
            cause = await _latest_event(tx, row["issue_id"], "IssuePrioritized")
            if not cause:
                continue
            events = await dispatch(tx, row["issue_id"], cause)
            for e in events:
                await ctx.store.save(e, tx)
        for e in events:
            await ctx.bus.publish(e)
        created += len(events)
    return created


async def _latest_event(tx: Transaction, issue_id: UUID, name: str) -> DomainEvent | None:
    from ..events.models import EVENT_TYPES
    row = await tx.fetchrow(
        """SELECT event_id, correlation_id, issue_id, payload FROM events
           WHERE issue_id = $1 AND event_name = $2 ORDER BY occurred_at DESC LIMIT 1""", issue_id, name)
    if not row:
        return None
    return EVENT_TYPES[name](event_id=row["event_id"], correlation_id=row["correlation_id"],
                             issue_id=row["issue_id"], producer=MODULE, **row["payload"])


# ---------------------------------------------------------------- crew portal (FR-7)
router = APIRouter(tags=["work orders"])

WORK_ORDER_SELECT = """
    SELECT w.work_order_id, w.issue_id, w.status::text AS status, w.deadline_at, w.created_at, w.started_at,
           w.completed_at, w.escalated_at, w.after_photo_id, w.crew_notes, w.crew_id, c.name AS crew_name,
           i.status::text AS issue_status, i.severity, i.is_escalated, i.address_text, i.duplicate_count,
           pt.code AS problem_type, pt.display_name AS problem_type_name,
           ST_Y(i.location::geometry) AS lat, ST_X(i.location::geometry) AS lng,
           (SELECT r.photo_id FROM reports r WHERE r.issue_id = i.issue_id ORDER BY r.submitted_at LIMIT 1) AS before_photo_id,
           (SELECT r.description FROM reports r WHERE r.issue_id = i.issue_id ORDER BY r.submitted_at LIMIT 1) AS description
    FROM work_orders w
    JOIN crews c ON c.crew_id = w.crew_id
    JOIN issues i ON i.issue_id = w.issue_id
    JOIN problem_types pt ON pt.problem_type_id = i.problem_type_id"""


def _crew_of(user: CurrentUser) -> int:
    if user.crew_id is None:
        raise HTTPException(403, "You are not a member of a crew")
    return user.crew_id


@router.get("/crew/work-orders")
async def crew_work_orders(scope: Literal["active", "done"] = "active",
                           user: CurrentUser = Depends(require("crew")), ctx: AppContext = Depends(get_ctx)):
    """NFR-6: a crew member only sees their own crew's work orders."""
    statuses = list(ACTIVE) if scope == "active" else ["completed", "cancelled"]
    order = "i.is_escalated DESC, w.deadline_at" if scope == "active" else "w.completed_at DESC NULLS LAST"
    return rows(await ctx.db.fetch(
        f"{WORK_ORDER_SELECT} WHERE w.crew_id = $1 AND w.status = ANY($2::work_order_status[]) ORDER BY {order} LIMIT 100",
        _crew_of(user), statuses))


@router.get("/crew/work-orders/{work_order_id}")
async def crew_work_order(work_order_id: UUID, user: CurrentUser = Depends(require("crew")),
                          ctx: AppContext = Depends(get_ctx)):
    row = await ctx.db.fetchrow(f"{WORK_ORDER_SELECT} WHERE w.work_order_id = $1 AND w.crew_id = $2",
                                work_order_id, _crew_of(user))
    if not row:
        raise HTTPException(404, "Work order not found")
    return dict(row)


class StatusUpdate(BaseModel):
    status: Literal["in_progress"]


async def _locked_order(tx: Transaction, work_order_id: UUID, crew_id: int):
    wo = await tx.fetchrow(
        """SELECT w.*, w.status::text AS wo_status, i.status::text AS issue_status
           FROM work_orders w JOIN issues i ON i.issue_id = w.issue_id
           WHERE w.work_order_id = $1 AND w.crew_id = $2 FOR UPDATE OF w""", work_order_id, crew_id)
    if not wo:
        raise HTTPException(404, "Work order not found")
    return wo


@router.patch("/crew/work-orders/{work_order_id}")
async def start_work(work_order_id: UUID, body: StatusUpdate, user: CurrentUser = Depends(require("crew")),
                     ctx: AppContext = Depends(get_ctx)):
    async with ctx.db.transaction(MODULE) as tx:
        wo = await _locked_order(tx, work_order_id, _crew_of(user))
        if wo["wo_status"] != "assigned":
            raise HTTPException(409, "Work has already started on this order")
        await tx.execute("UPDATE work_orders SET status = 'in_progress', started_at = now() WHERE work_order_id = $1",
                         work_order_id)
        if wo["issue_status"] in ("assigned", "escalated"):
            await tx.execute("UPDATE issues SET status = 'in_progress' WHERE issue_id = $1", wo["issue_id"])
        event = WorkOrderStatusChanged(issue_id=wo["issue_id"], producer="crew_portal", actor_id=user.user_id,
                                       correlation_id=await ctx.store.correlation_for(wo["issue_id"], tx),
                                       work_order_id=work_order_id, old_status="assigned",
                                       new_status="in_progress", crew_id=wo["crew_id"])
        await ctx.store.save(event, tx)
    await ctx.bus.publish(event)
    return {"status": "in_progress"}


@router.post("/crew/work-orders/{work_order_id}/complete")
async def complete_repair(work_order_id: UUID, after_photo: UploadFile = File(...),
                          notes: str | None = Form(None, max_length=1000),
                          user: CurrentUser = Depends(require("crew")), ctx: AppContext = Depends(get_ctx)):
    crew_id = _crew_of(user)
    try:
        path, sha, mime = ctx.storage.save(await after_photo.read(), "after")
    except InvalidImage as exc:
        raise HTTPException(422, str(exc))
    async with ctx.db.transaction(MODULE) as tx:
        wo = await _locked_order(tx, work_order_id, crew_id)
        if wo["wo_status"] != "in_progress":
            raise HTTPException(409, "Start the work before marking it complete")
        photo_id = await tx.fetchval(
            """INSERT INTO photos (kind, storage_path, mime_type, sha256, uploaded_by)
               VALUES ('after', $1, $2, $3, $4) RETURNING photo_id""", path, mime, sha, user.user_id)
        await tx.execute(
            """UPDATE work_orders SET status = 'completed', completed_at = now(), after_photo_id = $2, crew_notes = $3
               WHERE work_order_id = $1""", work_order_id, photo_id, (notes or "").strip() or None)
        if wo["issue_status"] in ("in_progress", "escalated"):
            await tx.execute("UPDATE issues SET status = 'completed' WHERE issue_id = $1", wo["issue_id"])
        event = RepairCompleted(issue_id=wo["issue_id"], producer="crew_portal", actor_id=user.user_id,
                                correlation_id=await ctx.store.correlation_for(wo["issue_id"], tx),
                                work_order_id=work_order_id, after_photo_id=photo_id)
        await ctx.store.save(event, tx)
    await ctx.bus.publish(event)
    return {"status": "completed"}


# ---------------------------------------------------------------- operator reassignment (FR-13)
class Reassign(BaseModel):
    crew_id: int
    reason: str | None = Field(None, max_length=300)


@router.post("/work-orders/{work_order_id}/reassign")
async def reassign(work_order_id: UUID, body: Reassign, user: CurrentUser = Depends(require(*STAFF)),
                   ctx: AppContext = Depends(get_ctx)):
    async with ctx.db.transaction(MODULE) as tx:
        wo = await tx.fetchrow(
            """SELECT w.*, w.status::text AS wo_status, i.status::text AS issue_status, i.severity
               FROM work_orders w JOIN issues i ON i.issue_id = w.issue_id
               WHERE w.work_order_id = $1 FOR UPDATE OF w""", work_order_id)
        if not wo or wo["wo_status"] not in ACTIVE:
            raise HTTPException(404, "No active work order with this ID")
        if wo["crew_id"] == body.crew_id:
            raise HTTPException(409, "The work order is already with this crew")
        if not await tx.fetchval("SELECT 1 FROM crews WHERE crew_id = $1 AND is_active", body.crew_id):
            raise HTTPException(422, "Unknown or inactive crew")
        if wo["wo_status"] == "in_progress" and wo["issue_status"] != "escalated":
            raise HTTPException(409, "Work has started; it can only be moved after its deadline is missed")
        # The new crew gets a fresh deadline and the order goes back to 'assigned'.
        await tx.execute(
            """UPDATE work_orders SET crew_id = $2, status = 'assigned', started_at = NULL, escalated_at = NULL,
                      deadline_at = work_order_deadline($3) WHERE work_order_id = $1""",
            work_order_id, body.crew_id, wo["severity"] or 3)
        await tx.execute(
            "INSERT INTO work_order_assignments (work_order_id, crew_id, assigned_by, reason) VALUES ($1, $2, $3, $4)",
            work_order_id, body.crew_id, user.user_id, f"manual_reassign: {body.reason}" if body.reason else "manual_reassign")
        if wo["issue_status"] == "escalated":
            await tx.execute("UPDATE issues SET status = 'assigned' WHERE issue_id = $1", wo["issue_id"])
        event = WorkOrderStatusChanged(issue_id=wo["issue_id"], producer=MODULE, actor_id=user.user_id,
                                       correlation_id=await ctx.store.correlation_for(wo["issue_id"], tx),
                                       work_order_id=work_order_id, old_status=wo["wo_status"],
                                       new_status="assigned", crew_id=body.crew_id, reason="reassigned")
        await ctx.store.save(event, tx)
    await ctx.bus.publish(event)
    return await issue_detail(ctx.db, wo["issue_id"])


class Dispatch(BaseModel):
    crew_id: int


@router.post("/issues/{issue_id}/dispatch")
async def manual_dispatch(issue_id: UUID, body: Dispatch, user: CurrentUser = Depends(require(*STAFF)),
                          ctx: AppContext = Depends(get_ctx)):
    """For a prioritized issue that no crew could take automatically."""
    async with ctx.db.transaction(MODULE) as tx:
        if not await tx.fetchval("SELECT 1 FROM crews WHERE crew_id = $1 AND is_active", body.crew_id):
            raise HTTPException(422, "Unknown or inactive crew")
        cause = await _latest_event(tx, issue_id, "IssuePrioritized")
        if not cause:
            raise HTTPException(409, "This issue has not been prioritized yet")
        events = await dispatch(tx, issue_id, cause, crew_id=body.crew_id, assigned_by=user.user_id)
        if not events:
            raise HTTPException(409, "This issue already has a crew or is not waiting for one")
        for e in events:
            await ctx.store.save(e, tx)
    for e in events:
        await ctx.bus.publish(e)
    return await issue_detail(ctx.db, issue_id)
