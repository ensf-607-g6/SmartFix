"""EventConsumer: the template method every consuming module follows.

parse -> open tx with SET LOCAL app.module -> tryMarkProcessed (skip if false, NFR-4)
-> handle() -> save new events in the same tx -> commit -> publish new events -> ack.
Errors propagate to the bus, which retries and dead-letters after 3 tries (NFR-3).

A module registers its handlers with @handles; subscriptions follow from them:

    class PriorityModule(EventConsumer):
        name = "priority"

        @handles(IssueValidated, IssueDuplicateDetected)
        async def recalculate(self, event, tx): ...
"""
import logging
from abc import ABC
from typing import TYPE_CHECKING, Awaitable, Callable

from .logs import describe, event_fields, extra
from .models import DomainEvent
from .publisher import EventOutbox

if TYPE_CHECKING:
    from ..context import AppContext
    from ..db import Transaction

log = logging.getLogger("smartfix.consumer")

HandlerMethod = Callable[..., Awaitable[list[DomainEvent] | None]]


def handles(*event_types: type[DomainEvent]) -> Callable[[HandlerMethod], HandlerMethod]:
    """Mark a consumer method as the handler for one or more event types."""
    if not event_types:
        raise TypeError("@handles needs at least one event type")

    def mark(method: HandlerMethod) -> HandlerMethod:
        method._handles = event_types
        return method
    return mark


class EventConsumer(ABC):
    name: str                            # app_module value, e.g. 'priority'
    subscriptions: list[type[DomainEvent]] = []
    prefetch: int = 10
    _handlers: dict[type[DomainEvent], HandlerMethod] = {}

    def __init_subclass__(cls, **kwargs):
        super().__init_subclass__(**kwargs)
        handlers: dict[type[DomainEvent], HandlerMethod] = {}
        for klass in reversed(cls.__mro__):
            for attr in vars(klass).values():
                for event_type in getattr(attr, "_handles", ()):
                    handlers[event_type] = attr
        cls._handlers = handlers
        if handlers and "subscriptions" not in cls.__dict__:
            cls.subscriptions = list(handlers)

    def __init__(self, ctx: "AppContext"):
        self.ctx = ctx

    async def start(self) -> None:
        await self.ctx.bus.subscribe(self.name, [e.event_name for e in self.subscriptions],
                                     self.on_message, prefetch=self.prefetch)

    async def on_message(self, event_name: str, body: bytes) -> None:
        event = DomainEvent.from_message(event_name, body)
        fields = {"consumer": self.name, **event_fields(event)}
        outbox = EventOutbox(self.ctx.store, self.ctx.bus)
        async with self.ctx.db.transaction(self.name, event.event_id) as tx:
            if not await self.ctx.store.try_mark_processed(self.name, event.event_id, tx):
                log.info("%s skipping duplicate delivery %s", self.name, describe(event),
                         extra=extra(fields))
                return
            for new in await self.handle(event, tx) or []:
                await outbox.add(new, tx)
        log.info("%s handled %s", self.name, describe(event), extra=extra(fields))
        await outbox.publish()
        await self.after_commit(event)

    async def handle(self, event: DomainEvent, tx: "Transaction") -> list[DomainEvent] | None:
        """Dispatch to the @handles method for this event type. Override for custom routing."""
        method = self._handlers.get(type(event))
        if method is None:
            raise LookupError(f"{self.name} has no handler for {event.event_name}")
        return await method(self, event, tx)

    async def after_commit(self, event: DomainEvent) -> None:
        """Side effects that must only happen once the work is committed (pushes, sockets)."""
