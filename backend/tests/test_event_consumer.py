"""SF-03: consumer base class, handler registration, idempotency and the outbox."""
import asyncio
import uuid

import pytest

from app.events.consumer import EventConsumer, handles
from app.events.models import (DeadlineMissed, IssueDuplicateDetected, IssuePrioritized,
                               IssueValidated)
from app.events.publisher import EventOutbox, InvalidEvent, validate

from .fakes import FakeContext


def validated(**fields):
    defaults = dict(producer="validation", correlation_id=uuid.uuid4(), issue_id=uuid.uuid4(),
                    problem_type="pothole", severity=4, confidence="0.92")
    return IssueValidated(**(defaults | fields))


class PriorityModule(EventConsumer):
    name = "priority"

    def __init__(self, ctx):
        super().__init__(ctx)
        self.seen = []

    @handles(IssueValidated, IssueDuplicateDetected)
    async def recalculate(self, event, tx):
        self.seen.append(event.event_name)
        return [event.follow(IssuePrioritized, "priority", priority_score="7.5", reason="new issue")]

    @handles(DeadlineMissed)
    async def escalate(self, event, tx):
        self.seen.append("escalate")


class FailingModule(EventConsumer):
    name = "work_orders"

    @handles(IssuePrioritized)
    async def dispatch(self, event, tx):
        return [event.follow(IssueValidated, "work_orders", problem_type="pothole",
                             severity=2, confidence="0.5")]

    async def after_commit(self, event):
        raise AssertionError("must not run when the handler failed")


class BrokenAfterSaveModule(EventConsumer):
    name = "notifications"

    @handles(IssueValidated)
    async def notify(self, event, tx):
        raise RuntimeError("model offline")


def deliver(consumer, event):
    return asyncio.run(consumer.on_message(event.event_name, event.to_message()))


# ---- registration ------------------------------------------------------------

def test_handles_decorator_builds_subscriptions():
    assert PriorityModule.subscriptions == [IssueValidated, IssueDuplicateDetected, DeadlineMissed]


def test_start_subscribes_by_event_name():
    ctx = FakeContext()
    asyncio.run(PriorityModule(ctx).start())
    assert ctx.bus.subscriptions == [("priority", ["IssueValidated", "IssueDuplicateDetected",
                                                   "DeadlineMissed"])]


def test_event_is_dispatched_to_its_handler():
    ctx = FakeContext()
    module = PriorityModule(ctx)
    deliver(module, validated())
    deliver(module, DeadlineMissed(producer="scheduler", correlation_id=uuid.uuid4(),
                                   work_order_id=uuid.uuid4(), deadline_at="2026-11-17T10:00:00Z"))
    assert module.seen == ["IssueValidated", "escalate"]


def test_subclass_inherits_and_extends_handlers():
    class Extended(PriorityModule):
        @handles(IssuePrioritized)
        async def log_only(self, event, tx):
            return None

    assert set(Extended.subscriptions) == {IssueValidated, IssueDuplicateDetected, DeadlineMissed,
                                           IssuePrioritized}


def test_explicit_subscriptions_and_handle_override_still_work():
    class Manual(EventConsumer):
        name = "analytics"
        subscriptions = [IssueValidated]

        async def handle(self, event, tx):
            self.got = event.event_name

    ctx = FakeContext()
    module = Manual(ctx)
    deliver(module, validated())
    assert module.got == "IssueValidated"


def test_event_without_a_handler_is_an_error():
    ctx = FakeContext()
    with pytest.raises(LookupError):
        deliver(FailingModule(ctx), validated())


def test_handles_needs_an_event_type():
    with pytest.raises(TypeError):
        handles()


# ---- idempotency and transaction order --------------------------------------

def test_duplicate_delivery_is_skipped():
    ctx = FakeContext()
    module = PriorityModule(ctx)
    event = validated()
    deliver(module, event)
    deliver(module, event)                       # broker redelivers the same event_id

    assert module.seen == ["IssueValidated"]
    assert len(ctx.bus.published) == 1


def test_same_event_is_handled_once_per_consumer():
    ctx = FakeContext()
    event = validated()
    deliver(PriorityModule(ctx), event)

    class Notifications(EventConsumer):
        name = "notifications"

        @handles(IssueValidated)
        async def notify(self, event, tx):
            self.done = True
    other = Notifications(ctx)
    deliver(other, event)
    assert other.done


def test_new_events_are_saved_in_the_transaction_and_published_after_commit():
    ctx = FakeContext()
    incoming = validated()
    deliver(PriorityModule(ctx), incoming)

    (saved, tx), = ctx.store.saved
    assert isinstance(saved, IssuePrioritized)
    assert tx.committed
    assert ctx.bus.published == [saved]             # RecordingBus asserts commit happened first
    assert saved.correlation_id == incoming.correlation_id
    assert saved.causation_id == incoming.event_id
    assert saved.issue_id == incoming.issue_id


def test_handler_error_rolls_back_and_publishes_nothing():
    ctx = FakeContext()
    with pytest.raises(RuntimeError):
        deliver(BrokenAfterSaveModule(ctx), validated())
    assert ctx.db.transactions[0].rolled_back
    assert ctx.bus.published == []


# ---- publisher / outbox ------------------------------------------------------

def test_invalid_event_is_rejected_before_it_is_saved():
    event = validated()
    event.severity = 9                              # outside 1..5, set after construction
    with pytest.raises(InvalidEvent):
        validate(event)

    ctx = FakeContext()
    outbox = EventOutbox(ctx.store, ctx.bus)
    with pytest.raises(InvalidEvent):
        asyncio.run(outbox.add(event, tx=None))
    assert ctx.store.saved == [] and outbox.pending == []


def test_outbox_publishes_only_when_asked_and_only_once():
    async def run():
        ctx = FakeContext()
        outbox = EventOutbox(ctx.store, ctx.bus)
        async with ctx.db.transaction("reports") as tx:
            await outbox.add(validated(), tx)
            assert ctx.bus.published == []
        await outbox.publish()
        await outbox.publish()
        return ctx
    ctx = asyncio.run(run())
    assert len(ctx.bus.published) == 1


def test_outbox_discard_drops_pending_events():
    ctx = FakeContext()
    outbox = EventOutbox(ctx.store, ctx.bus)
    asyncio.run(outbox.add(validated(), tx=None))
    outbox.discard()
    asyncio.run(outbox.publish())
    assert ctx.bus.published == []
