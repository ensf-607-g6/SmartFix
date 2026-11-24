"""Testing shortcuts (ENABLE_DEV_TOOLS=true). They only move a timestamp into the past and
then run the real producer, so the normal events and status rules still apply."""
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException

from .auth import STAFF, CurrentUser, require
from .context import AppContext, get_ctx
from .modules.reports import auto_close_unconfirmed
from .modules.scheduler import check_overdue

router = APIRouter(prefix="/dev", tags=["dev tools"])


def _enabled(ctx: AppContext = Depends(get_ctx)) -> AppContext:
    if not ctx.settings.enable_dev_tools:
        raise HTTPException(404, "Not found")
    return ctx


@router.post("/work-orders/{work_order_id}/expire-deadline")
async def expire_deadline(work_order_id: UUID, _: CurrentUser = Depends(require(*STAFF)),
                          ctx: AppContext = Depends(_enabled)):
    done = await ctx.db.fetchval(
        """UPDATE work_orders SET deadline_at = now() - interval '1 minute'
           WHERE work_order_id = $1 AND status IN ('assigned','in_progress') AND escalated_at IS NULL
           RETURNING 1""", work_order_id)
    if not done:
        raise HTTPException(409, "Only an active, not yet escalated work order can be expired")
    return {"escalated": await check_overdue(ctx)}


@router.post("/confirmations/{confirmation_id}/expire")
async def expire_confirmation(confirmation_id: UUID, _: CurrentUser = Depends(require(*STAFF)),
                              ctx: AppContext = Depends(_enabled)):
    done = await ctx.db.fetchval(
        """UPDATE resident_confirmations SET auto_close_at = now() - interval '1 minute',
                  requested_at = LEAST(requested_at, now() - interval '7 days 1 minute')
           WHERE confirmation_id = $1 AND status = 'pending' RETURNING 1""", confirmation_id)
    if not done:
        raise HTTPException(409, "Only a pending confirmation can be expired")
    return {"closed": await auto_close_unconfirmed(ctx)}
