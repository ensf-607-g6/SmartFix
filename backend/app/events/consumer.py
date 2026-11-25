"""EventConsumer: the template method every consuming module follows.

parse -> open tx with SET LOCAL app.module -> tryMarkProcessed (skip if false, NFR-4)
-> handle() -> save new events in the same tx -> commit -> publish new events -> ack.
Errors propagate to the bus, which retries and dead-letters after 3 tries (NFR-3)."""
import logging
from abc import ABC, abstractmethod

from ..context import AppContext
from ..db import Transaction
from .models import DomainEvent

log = logging.getLogger("smartfix.consumer")


class EventConsumer(ABC):
    name: str                            # app_module value, e.g. 'priority'
    subscriptions: list[type[DomainEvent]]
    prefetch: int = 10

    def __init__(self, ctx: AppContext):
        self.ctx = ctx

    async def start(self) -> None:
        await self.ctx.bus.subscribe(self.name, [e.event_name for e in self.subscriptions],
                                     self.on_message, prefetch=self.prefetch)

    async def on_message(self, event_name: str, body: bytes) -> None:
        event = DomainEvent.from_message(event_name, body)
        async with self.ctx.db.transaction(self.name, event.event_id) as tx:
            if not await self.ctx.store.try_mark_processed(self.name, event.event_id, tx):
                log.info("%s skipping duplicate delivery of %s", self.name, event.event_id)
                return
            new_events = await self.handle(event, tx) or []
            for new in new_events:
                await self.ctx.store.save(new, tx)
        for new in new_events:
            await self.ctx.bus.publish(new)
        await self.after_commit(event)

    @abstractmethod
    async def handle(self, event: DomainEvent, tx: Transaction) -> list[DomainEvent] | None: ...

    async def after_commit(self, event: DomainEvent) -> None:
        """Side effects that must only happen once the work is committed (pushes, sockets)."""
