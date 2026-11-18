"""Notifications module (FR-12): turns events into short plain-language messages,
written by the local model, saved once per user per event and pushed over WebSocket.
Also opens the resident's 7-day confirmation window when a repair completes (FR-8, FR-10)."""
import asyncio
import logging
from datetime import datetime
from uuid import UUID

from fastapi import APIRouter, Depends

from ..auth import CurrentUser, current_user
from ..context import AppContext, get_ctx
from ..db import Transaction
from ..events.consumer import EventConsumer
from ..events.models import (DeadlineMissed, DomainEvent, IssueClosed, IssueDuplicateDetected, IssueNeedsReview,
                             IssueValidated, RepairCompleted, ReportRejected, WorkOrderCreated,
                             WorkOrderStatusChanged)
from ..queries import issue_facts, rows

log = logging.getLogger("smartfix.notifications")
MODULE = "notifications"
MESSAGE_TIMEOUT_S = 20

REWRITE_PROMPT = """Rewrite this city repair-service update for a {audience} as one or two short,
friendly, plain-language sentences. Keep every fact exactly (numbers, places, times, names).
Do not add facts, greetings, sign-offs, emojis or quotation marks.

Update: {facts}"""

AUDIENCE = {"resident": "resident who reported a problem", "crew": "repair crew member",
            "supervisor": "crew supervisor"}


def _when(dt: datetime) -> str:
    return dt.astimezone().strftime("%b %d at %I:%M %p").replace(" 0", " ")


def _what(f: dict) -> str:
    where = f" at {f['address_text']}" if f.get("address_text") else ""
    return f"{(f.get('type_name') or 'infrastructure').lower()} report{where}"


class NotificationsModule(EventConsumer):
    name = MODULE
    prefetch = 4
    subscriptions = [IssueValidated, IssueDuplicateDetected, IssueNeedsReview, ReportRejected, WorkOrderCreated,
                     WorkOrderStatusChanged, RepairCompleted, DeadlineMissed, IssueClosed]

    async def handle(self, event, tx):
        if isinstance(event, RepairCompleted):
            await self.request_confirmation(tx, event)
        for audience, user_ids, facts in await self.recipients(tx, event):
            if not user_ids:
                continue
            message = await self.compose(facts, audience)
            for user_id in user_ids:
                await tx.execute(
                    """INSERT INTO notifications (user_id, issue_id, event_id, message)
                       VALUES ($1, $2, $3, $4) ON CONFLICT (user_id, event_id) DO NOTHING""",
                    user_id, event.issue_id, event.event_id, message)
        return []

    async def after_commit(self, event: DomainEvent) -> None:
        pending = await self.ctx.db.fetch(
            """UPDATE notifications SET pushed_at = now() WHERE event_id = $1 AND pushed_at IS NULL
               RETURNING notification_id, user_id, issue_id, message, created_at""", event.event_id)
        for n in pending:
            await self.ctx.hub.broadcast(f"user:{n['user_id']}", {
                "type": "notification", "notification_id": n["notification_id"], "issue_id": n["issue_id"],
                "message": n["message"], "created_at": n["created_at"], "event_name": event.event_name})

    async def compose(self, facts: str, audience: str) -> str:
        try:
            text = await asyncio.wait_for(
                self.ctx.ai.write_message(REWRITE_PROMPT.format(audience=AUDIENCE[audience], facts=facts)),
                MESSAGE_TIMEOUT_S)
            text = " ".join(text.split())
            if 10 <= len(text) <= 400:
                return text
        except Exception as exc:
            log.info("using template message (%s)", exc)
        return facts

    async def request_confirmation(self, tx: Transaction, event: RepairCompleted) -> None:
        await tx.execute(
            """INSERT INTO resident_confirmations (work_order_id, issue_id, resident_id, auto_close_at)
               SELECT $1, $2, r.reporter_id, now() + make_interval(days => c.auto_close_days)
               FROM reports r, priority_config c
               WHERE r.issue_id = $2 ORDER BY r.submitted_at LIMIT 1
               ON CONFLICT (work_order_id) DO NOTHING""", event.work_order_id, event.issue_id)

    async def _reporters(self, tx: Transaction, issue_id: UUID) -> list[UUID]:
        return [r["reporter_id"] for r in await tx.fetch(
            "SELECT DISTINCT reporter_id FROM reports WHERE issue_id = $1", issue_id)]

    async def _reporter_of(self, tx: Transaction, report_id: UUID) -> list[UUID]:
        uid = await tx.fetchval("SELECT reporter_id FROM reports WHERE report_id = $1", report_id)
        return [uid] if uid else []

    async def _crew(self, tx: Transaction, crew_id: int) -> tuple[str, list[UUID]]:
        name = await tx.fetchval("SELECT name FROM crews WHERE crew_id = $1", crew_id)
        members = [r["user_id"] for r in await tx.fetch("SELECT user_id FROM crew_members WHERE crew_id = $1", crew_id)]
        return name or "A crew", members

    async def recipients(self, tx: Transaction, e: DomainEvent) -> list[tuple[str, list[UUID], str]]:
        f = await issue_facts(tx, e.issue_id) if e.issue_id else {}
        what = _what(f)
        if isinstance(e, IssueValidated):
            how = "A city operator checked it" if e.approved_by else "We checked the photo"
            return [("resident", await self._reporter_of(tx, e.report_id),
                     f"We received your {what}. {how} and rated it severity {e.severity} of 5. "
                     "It is now in the repair queue.")]
        if isinstance(e, IssueDuplicateDetected):
            return [("resident", await self._reporter_of(tx, e.report_id),
                     f"Thanks for your {what}. Someone already reported this problem, so your report was "
                     f"added to it and its priority went up. You will get the same updates.")]
        if isinstance(e, IssueNeedsReview):
            return [("resident", await self._reporter_of(tx, e.report_id),
                     f"We received your {what}. A city operator will look at the photo before it goes to a crew.")]
        if isinstance(e, ReportRejected):
            note = f" Note from the operator: {e.notes}" if e.notes else ""
            return [("resident", await self._reporter_of(tx, e.report_id),
                     f"A city operator reviewed your {what} and could not accept it as a public "
                     f"infrastructure problem.{note}")]
        if isinstance(e, WorkOrderCreated):
            crew_name, members = await self._crew(tx, e.crew_id)
            return [("crew", members, f"New work order: severity {f.get('severity')} {what}. "
                                      f"Due {_when(e.deadline_at)}."),
                    ("resident", await self._reporters(tx, e.issue_id),
                     f"{crew_name} has been assigned to your {what}. "
                     f"The repair is due by {_when(e.deadline_at)}.")]
        if isinstance(e, WorkOrderStatusChanged):
            if e.reason == "reassigned" and e.crew_id:
                crew_name, members = await self._crew(tx, e.crew_id)
                deadline = await tx.fetchval("SELECT deadline_at FROM work_orders WHERE work_order_id = $1",
                                             e.work_order_id)
                return [("crew", members, f"A work order was moved to your crew: severity {f.get('severity')} "
                                          f"{what}. Due {_when(deadline)}.")]
            if e.new_status == "in_progress":
                return [("resident", await self._reporters(tx, e.issue_id),
                         f"A crew has started work on your {what}.")]
            return []
        if isinstance(e, RepairCompleted):
            return [("resident", await self._reporters(tx, e.issue_id),
                     f"The crew says your {what} has been repaired. Please check and confirm the fix, "
                     "or tell us if it is not fixed. It will close automatically in 7 days.")]
        if isinstance(e, DeadlineMissed):
            sup = await tx.fetchrow(
                """SELECT c.supervisor_id, c.name FROM work_orders w JOIN crews c ON c.crew_id = w.crew_id
                   WHERE w.work_order_id = $1""", e.work_order_id)
            out = [("resident", await self._reporters(tx, e.issue_id),
                    f"The repair of your {what} is running late, so it has been escalated to the top of the queue.")]
            if sup and sup["supervisor_id"]:
                out.append(("supervisor", [sup["supervisor_id"]],
                            f"Overdue: a severity {f.get('severity')} {what} assigned to {sup['name']} "
                            f"missed its deadline of {_when(e.deadline_at)} and has been escalated."))
            return out
        if isinstance(e, IssueClosed):
            text = (f"Thanks for confirming. Your {what} is now closed." if e.closed_by == "confirmed" else
                    f"We closed your {what} because there was no reply within 7 days of the repair.")
            return [("resident", await self._reporters(tx, e.issue_id), text)]
        return []


# ---------------------------------------------------------------- inbox
router = APIRouter(tags=["notifications"])


@router.get("/notifications")
async def my_notifications(user: CurrentUser = Depends(current_user), ctx: AppContext = Depends(get_ctx)):
    items = rows(await ctx.db.fetch(
        """SELECT n.notification_id, n.issue_id, n.message, n.created_at, n.read_at, e.event_name
           FROM notifications n LEFT JOIN events e ON e.event_id = n.event_id
           WHERE n.user_id = $1 ORDER BY n.created_at DESC LIMIT 50""", user.user_id))
    unread = await ctx.db.fetchval(
        "SELECT count(*) FROM notifications WHERE user_id = $1 AND read_at IS NULL", user.user_id)
    return {"items": items, "unread": unread}


@router.post("/notifications/read-all", status_code=204)
async def read_all(user: CurrentUser = Depends(current_user), ctx: AppContext = Depends(get_ctx)):
    await ctx.db.fetchval("UPDATE notifications SET read_at = now() WHERE user_id = $1 AND read_at IS NULL",
                          user.user_id)


@router.post("/notifications/{notification_id}/read", status_code=204)
async def read_one(notification_id: UUID, user: CurrentUser = Depends(current_user),
                   ctx: AppContext = Depends(get_ctx)):
    await ctx.db.fetchval(
        "UPDATE notifications SET read_at = now() WHERE notification_id = $1 AND user_id = $2 AND read_at IS NULL",
        notification_id, user.user_id)
