"""SF-03: event bus library, tested against a mocked broker (no RabbitMQ needed)."""
import asyncio
import logging
import uuid

import aio_pika
import pytest

from app.events import bus as bus_module
from app.events.bus import InMemoryBus, RabbitMQBus
from app.events.models import IssueReported, IssueValidated, RepairCompleted
from app.events.topology import DEAD_LETTER_EXCHANGE, DEAD_LETTER_QUEUE, queue_arguments

from .fakes import FakeConnection, FakeExchange, FakeMessage


def issue_reported(**fields):
    return IssueReported(producer="reports", correlation_id=uuid.uuid4(), issue_id=uuid.uuid4(),
                         photo_id=uuid.uuid4(), lat=51.05, lng=-114.07, problem_type="pothole",
                         **fields)


def rabbit_bus(exchange_fails=False):
    bus = RabbitMQBus("amqp://test", max_attempts=3)
    bus.connection = FakeConnection()
    bus.exchange = FakeExchange("smartfix.events", fail=exchange_fails)
    return bus


@pytest.fixture(autouse=True)
def no_backoff(monkeypatch):
    real_sleep = asyncio.sleep

    async def instant(delay, *args, **kwargs):
        await real_sleep(0)
    monkeypatch.setattr(bus_module.asyncio, "sleep", instant)


# ---- publishing -------------------------------------------------------------

def test_publish_sends_persistent_message_to_routing_key():
    bus = rabbit_bus()
    event = issue_reported()
    asyncio.run(bus.publish(event))

    message, routing_key = bus.exchange.published[0]
    assert routing_key == "issue.reported"
    assert message.type == "IssueReported"
    assert message.message_id == str(event.event_id)
    assert message.delivery_mode == aio_pika.DeliveryMode.PERSISTENT
    assert IssueReported.model_validate_json(message.body) == event


def test_publish_failure_is_kept_for_retry_not_lost():
    bus = rabbit_bus(exchange_fails=True)
    event = issue_reported()
    asyncio.run(bus.publish(event))
    assert bus._pending == [event]


# ---- subscribing ------------------------------------------------------------

def test_subscribe_declares_durable_queue_with_topology_arguments():
    bus = rabbit_bus()

    async def handler(name, body):
        pass
    asyncio.run(bus.subscribe("validation", ["IssueReported", "RepairCompleted"], handler, prefetch=5))

    channel = bus.connection.channels[0]
    queue = channel.queues["smartfix.validation"]
    assert queue.durable
    assert queue.arguments == queue_arguments("validation")
    assert queue.arguments["x-dead-letter-exchange"] == DEAD_LETTER_EXCHANGE
    assert queue.bindings == ["issue.reported", "repair.completed"]
    assert channel.prefetch == 5


def test_subscribe_to_everything_binds_hash():
    bus = rabbit_bus()

    async def handler(name, body):
        pass
    asyncio.run(bus.subscribe("dashboard", ["*"], handler))
    assert bus.connection.channels[0].queues["smartfix.dashboard"].bindings == ["#"]


# ---- consuming: ack, retry, dead-letter ------------------------------------

def deliver(bus, consumer, handler, event):
    """Subscribe, deliver one message, and keep handing back redeliveries like the broker would."""
    async def run():
        await bus.subscribe(consumer, [event.event_name], handler)
        channel = bus.connection.channels[-1]
        queue = channel.queues[f"smartfix.{consumer}"]
        message = FakeMessage(event.to_message(), event.event_name, str(event.event_id))
        delivered = [message]
        await queue.callback(message)
        while True:
            redeliveries = [m for m, key in channel.default_exchange.published if key == queue.name]
            if len(redeliveries) < len(delivered):
                break
            message = FakeMessage.redelivered(redeliveries[len(delivered) - 1])
            delivered.append(message)
            await queue.callback(message)
        return channel, delivered
    return asyncio.run(run())


def test_successful_handler_acks_once():
    bus = rabbit_bus()
    seen = []

    async def handler(name, body):
        seen.append(name)
    channel, delivered = deliver(bus, "validation", handler, issue_reported())

    assert seen == ["IssueReported"]
    assert [m.acked for m in delivered] == [1]
    assert channel.default_exchange.published == []


def test_failure_is_retried_then_third_failure_goes_to_dead_letter_queue():
    bus = rabbit_bus()
    hook_calls = []

    async def hook(consumer, event_name, body, error, attempts):
        hook_calls.append((consumer, event_name, error, attempts))
    bus.on_dead_letter = hook
    calls = []

    async def handler(name, body):
        calls.append(name)
        raise RuntimeError("boom")
    event = issue_reported()
    channel, delivered = deliver(bus, "validation", handler, event)

    assert len(calls) == 3
    assert all(m.acked == 1 for m in delivered)          # never left unacked or requeued forever
    sent = channel.default_exchange.published
    assert [key for _, key in sent] == ["smartfix.validation", "smartfix.validation", DEAD_LETTER_QUEUE]
    assert [m.headers["x-attempts"] for m, _ in sent] == [1, 2, 3]
    dead, _ = sent[-1]
    assert dead.headers["x-consumer"] == "validation"
    assert dead.headers["x-error"] == "boom"
    assert dead.message_id == str(event.event_id)
    assert hook_calls == [("validation", "IssueReported", "boom", 3)]


def test_handler_that_recovers_on_second_attempt_is_not_dead_lettered():
    bus = rabbit_bus()
    calls = []

    async def handler(name, body):
        calls.append(name)
        if len(calls) == 1:
            raise RuntimeError("temporary")
    channel, _ = deliver(bus, "validation", handler, issue_reported())

    assert len(calls) == 2
    assert DEAD_LETTER_QUEUE not in [key for _, key in channel.default_exchange.published]


def test_failure_logs_carry_event_and_issue_ids(caplog):
    bus = rabbit_bus()

    async def handler(name, body):
        raise RuntimeError("boom")
    event = issue_reported()
    with caplog.at_level(logging.WARNING, logger="smartfix.bus"):
        deliver(bus, "validation", handler, event)

    assert f"event_id={event.event_id}" in caplog.text
    assert f"issue_id={event.issue_id}" in caplog.text
    dead = [r for r in caplog.records if r.levelno == logging.ERROR]
    assert dead and dead[0].smartfix["event_id"] == str(event.event_id)
    assert dead[0].smartfix["consumer"] == "validation"


# ---- in-memory bus (used when RABBITMQ_URL is empty) ------------------------

def test_in_memory_bus_routes_retries_and_dead_letters():
    async def run():
        bus = InMemoryBus(max_attempts=3, retry_delay=0)
        received, failures = [], []

        async def ok(name, body):
            received.append(name)

        async def broken(name, body):
            failures.append(name)
            raise RuntimeError("down")
        await bus.subscribe("priority", ["IssueValidated"], ok)
        await bus.subscribe("analytics", ["RepairCompleted"], broken)
        corr = uuid.uuid4()
        await bus.publish(IssueValidated(producer="validation", correlation_id=corr, problem_type="pothole",
                                         severity=3, confidence="0.9"))
        await bus.publish(RepairCompleted(producer="work_orders", correlation_id=corr,
                                          work_order_id=uuid.uuid4(), after_photo_id=uuid.uuid4()))
        await bus.drain()
        await bus.close()
        return bus, received, failures

    bus, received, failures = asyncio.run(run())
    assert received == ["IssueValidated"]
    assert failures == ["RepairCompleted"] * 3
    assert bus.dead_letters == [("analytics", "RepairCompleted", "down")]
