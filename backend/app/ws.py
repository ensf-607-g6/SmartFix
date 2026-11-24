"""WebSocketHub: subscribes to every event and forwards it to the people who can see
it (NFR-2: map and status pages update within 2 s; NFR-6: only their own data)."""
import asyncio
import json
import logging
from collections import defaultdict
from uuid import UUID

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from .auth import STAFF, CurrentUser, user_from_token
from .context import get_ctx
from .db import Database
from .events.models import DomainEvent

log = logging.getLogger("smartfix.ws")


class WebSocketHub:
    def __init__(self, db: Database):
        self.db = db
        self.channels: dict[str, set[WebSocket]] = defaultdict(set)

    def connect(self, user: CurrentUser, socket: WebSocket) -> list[str]:
        names = [f"user:{user.user_id}"]
        if user.role in STAFF:
            names.append("staff")
        if user.crew_id is not None:
            names.append(f"crew:{user.crew_id}")
        for name in names:
            self.channels[name].add(socket)
        return names

    def disconnect(self, socket: WebSocket, names: list[str]) -> None:
        for name in names:
            self.channels[name].discard(socket)

    async def broadcast(self, channel: str, update: dict) -> None:
        text = json.dumps(update, default=str)
        dead = []
        for socket in list(self.channels.get(channel, ())):
            try:
                await socket.send_text(text)
            except Exception:
                dead.append(socket)
        for socket in dead:
            self.channels[channel].discard(socket)

    async def on_event(self, event_name: str, body: bytes) -> None:
        """Bus subscription (non-durable queue). Never raises: a socket problem must
        not send an event to the dead-letter queue."""
        try:
            event = DomainEvent.from_message(event_name, body)
            update = {"type": "event", "event_name": event_name, "issue_id": event.issue_id,
                      "report_id": event.report_id, "occurred_at": event.occurred_at,
                      "payload": event.payload()}
            targets = {"staff"}
            issue_ids = [i for i in (event.issue_id, getattr(event, "merged_issue_id", None)) if i]
            if issue_ids or event.report_id:
                rows = await self.db.fetch(
                    """SELECT DISTINCT reporter_id FROM reports
                       WHERE issue_id = ANY($1::uuid[]) OR report_id = $2""", issue_ids, event.report_id)
                targets |= {f"user:{r['reporter_id']}" for r in rows}
            wo_id = getattr(event, "work_order_id", None)
            if wo_id:
                crew_id = await self.db.fetchval("SELECT crew_id FROM work_orders WHERE work_order_id = $1", wo_id)
                if crew_id:
                    targets.add(f"crew:{crew_id}")
            await asyncio.gather(*(self.broadcast(t, update) for t in targets))
        except Exception:
            log.exception("websocket fan-out failed for %s", event_name)


router = APIRouter()


@router.websocket("/ws")
async def websocket_endpoint(socket: WebSocket):
    ctx = get_ctx()
    user = await user_from_token(ctx, socket.query_params.get("token", ""))
    if not user:
        await socket.close(code=4401)
        return
    await socket.accept()
    names = ctx.hub.connect(user, socket)
    try:
        await socket.send_text(json.dumps({"type": "hello", "channels": names}))
        while True:
            await socket.receive_text()          # keep-alive pings from the client
    except WebSocketDisconnect:
        pass
    finally:
        ctx.hub.disconnect(socket, names)
