"""Deadline scheduler (producer, FR-11): publishes DeadlineMissed for overdue work orders."""
import asyncio
import logging
from typing import Awaitable, Callable

from ..context import AppContext
from ..events.models import DeadlineMissed

log = logging.getLogger("smartfix.scheduler")


async def check_overdue(ctx: AppContext) -> int:
    overdue = await ctx.db.fetch(
        """SELECT work_order_id FROM work_orders
           WHERE status IN ('assigned', 'in_progress') AND escalated_at IS NULL AND deadline_at < now()""")
    published = 0
    for row in overdue:
        async with ctx.db.transaction(None) as tx:
            wo = await tx.fetchrow(
                """UPDATE work_orders SET escalated_at = now()
                   WHERE work_order_id = $1 AND escalated_at IS NULL
                     AND status IN ('assigned', 'in_progress') AND deadline_at < now()
                   RETURNING work_order_id, issue_id, deadline_at""", row["work_order_id"])
            if not wo:
                continue
            event = DeadlineMissed(issue_id=wo["issue_id"], producer="scheduler",
                                   correlation_id=await ctx.store.correlation_for(wo["issue_id"], tx),
                                   work_order_id=wo["work_order_id"], deadline_at=wo["deadline_at"])
            await ctx.store.save(event, tx)
        await ctx.bus.publish(event)
        published += 1
    if published:
        log.info("escalated %d overdue work orders", published)
    return published


async def run_periodically(name: str, interval_s: float, job: Callable[[AppContext], Awaitable[int]],
                           ctx: AppContext) -> None:
    await asyncio.sleep(3)
    while True:
        try:
            await job(ctx)
        except Exception:
            log.exception("periodic job %s failed", name)
        await asyncio.sleep(interval_s)
