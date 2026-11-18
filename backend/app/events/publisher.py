"""EventOutbox: the one way a module emits events (NFR-8).

    outbox = EventOutbox(ctx.store, ctx.bus)
    async with ctx.db.transaction("reports") as tx:
        ...                                   # write the module's own rows
        await outbox.add(IssueReported(...), tx)
    await outbox.publish()                    # only after the commit succeeded

add() re-validates the event with Pydantic and saves it to the events table in the
caller's transaction (FR-14); publish() sends it to the exchange. If the transaction
rolls back, nothing was published."""
import logging

from pydantic import ValidationError

from .logs import describe, event_fields, extra
from .models import DomainEvent

log = logging.getLogger("smartfix.publisher")


class InvalidEvent(ValueError):
    pass


def validate(event: DomainEvent) -> DomainEvent:
    """Pydantic validates on construction, but fields can be changed afterwards
    (or built with model_construct), so check again before anything leaves the module."""
    try:
        return type(event).model_validate(event.model_dump())
    except ValidationError as exc:
        raise InvalidEvent(f"{event.event_name} is not valid: {exc}") from exc


class EventOutbox:
    def __init__(self, store, bus):
        self.store = store
        self.bus = bus
        self.pending: list[DomainEvent] = []

    async def add(self, event: DomainEvent, tx) -> DomainEvent:
        event = validate(event)
        await self.store.save(event, tx)
        self.pending.append(event)
        return event

    async def publish(self) -> None:
        events, self.pending = self.pending, []
        for event in events:
            await self.bus.publish(event)
            log.info("published %s", describe(event), extra=extra(event_fields(event)))

    def discard(self) -> None:
        """Forget unpublished events, e.g. after the transaction rolled back."""
        self.pending.clear()
