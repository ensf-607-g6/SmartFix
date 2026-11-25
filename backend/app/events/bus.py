"""Event bus. RabbitMQBus is the real broker (one topic exchange, one durable queue
per consumer, 3 attempts then dead-letter queue). InMemoryBus has the same
semantics inside the process and is used when RABBITMQ_URL is empty, and in tests."""
import asyncio
import logging
from abc import ABC, abstractmethod
from typing import Awaitable, Callable

import aio_pika

from .models import DomainEvent

log = logging.getLogger("smartfix.bus")

Handler = Callable[[str, bytes], Awaitable[None]]
# (consumer, event_name, body, error, attempts)
DeadLetterHook = Callable[[str, str, bytes, str, int], Awaitable[None]]

DEAD_LETTER_QUEUE = "smartfix.dead_letter"


class EventPublisher(ABC):
    max_attempts: int = 3
    on_dead_letter: DeadLetterHook | None = None

    @abstractmethod
    async def publish(self, event: DomainEvent) -> None: ...

    @abstractmethod
    async def subscribe(self, consumer: str, events: list[str], handler: Handler,
                        durable: bool = True, prefetch: int = 10) -> None:
        """events holds event names; ['*'] subscribes to everything."""

    async def connect(self) -> None: ...
    async def close(self) -> None: ...

    async def _dead_letter(self, consumer: str, event_name: str, body: bytes, error: str, attempts: int):
        log.error("dead-letter %s for %s after %d attempts: %s", event_name, consumer, attempts, error)
        if self.on_dead_letter:
            try:
                await self.on_dead_letter(consumer, event_name, body, error, attempts)
            except Exception:
                log.exception("could not record dead letter")


class RabbitMQBus(EventPublisher):
    def __init__(self, url: str, exchange: str = "smartfix.events", max_attempts: int = 3):
        self.url = url
        self.exchange_name = exchange
        self.max_attempts = max_attempts
        self.connection: aio_pika.abc.AbstractRobustConnection | None = None
        self.channel = None
        self.exchange = None
        self._pending: list[DomainEvent] = []      # committed but not yet accepted by the broker
        self._flusher: asyncio.Task | None = None

    async def connect(self) -> None:
        self.connection = await aio_pika.connect_robust(self.url)
        self.channel = await self.connection.channel(publisher_confirms=True)
        self.exchange = await self.channel.declare_exchange(
            self.exchange_name, aio_pika.ExchangeType.TOPIC, durable=True)
        await self.channel.declare_queue(DEAD_LETTER_QUEUE, durable=True)
        self._flusher = asyncio.create_task(self._flush_pending())
        log.info("connected to RabbitMQ, exchange %s", self.exchange_name)

    async def close(self) -> None:
        if self._flusher:
            self._flusher.cancel()
        if self.connection:
            await self.connection.close()

    async def publish(self, event: DomainEvent) -> None:
        try:
            await self._publish(event)
        except Exception as exc:
            # The event row is already committed; keep it and retry so it is not lost.
            log.warning("publish of %s failed (%s), will retry", event.event_name, exc)
            self._pending.append(event)

    async def _publish(self, event: DomainEvent) -> None:
        message = aio_pika.Message(
            body=event.to_message(), content_type="application/json", type=event.event_name,
            message_id=str(event.event_id), delivery_mode=aio_pika.DeliveryMode.PERSISTENT,
            headers={"x-attempts": 0})
        await self.exchange.publish(message, routing_key=event.routing_key)

    async def _flush_pending(self) -> None:
        while True:
            await asyncio.sleep(5)
            while self._pending:
                event = self._pending[0]
                try:
                    await self._publish(event)
                    self._pending.pop(0)
                except Exception:
                    break

    async def subscribe(self, consumer, events, handler, durable=True, prefetch=10) -> None:
        from .models import EVENT_TYPES
        channel = await self.connection.channel()
        await channel.set_qos(prefetch_count=prefetch)
        if durable:
            queue = await channel.declare_queue(f"smartfix.{consumer}", durable=True)
        else:
            queue = await channel.declare_queue("", exclusive=True, auto_delete=True)
        keys = ["#"] if events == ["*"] else [EVENT_TYPES[name].routing_key for name in events]
        for key in keys:
            await queue.bind(self.exchange, routing_key=key)

        async def on_message(message: aio_pika.abc.AbstractIncomingMessage) -> None:
            attempts = int((message.headers or {}).get("x-attempts", 0)) + 1
            try:
                await handler(message.type, message.body)
                await message.ack()
            except Exception as exc:
                log.warning("%s failed on %s (attempt %d): %s", consumer, message.type, attempts, exc)
                if attempts >= self.max_attempts:
                    await channel.default_exchange.publish(
                        aio_pika.Message(body=message.body, type=message.type,
                                         content_type="application/json",
                                         delivery_mode=aio_pika.DeliveryMode.PERSISTENT,
                                         headers={"x-consumer": consumer, "x-error": str(exc)[:500],
                                                  "x-attempts": attempts}),
                        routing_key=DEAD_LETTER_QUEUE)
                    await self._dead_letter(consumer, message.type, message.body, str(exc), attempts)
                else:
                    await asyncio.sleep(attempts)          # small back-off before redelivery
                    await channel.default_exchange.publish(
                        aio_pika.Message(body=message.body, type=message.type,
                                         content_type="application/json",
                                         message_id=message.message_id,
                                         delivery_mode=aio_pika.DeliveryMode.PERSISTENT,
                                         headers={"x-attempts": attempts}),
                        routing_key=queue.name)
                await message.ack()

        await queue.consume(on_message)
        log.info("subscribed %s to %s", queue.name, ", ".join(keys))


class InMemoryBus(EventPublisher):
    def __init__(self, max_attempts: int = 3, retry_delay: float = 0.5):
        self.max_attempts = max_attempts
        self.retry_delay = retry_delay
        self._subs: list[tuple[str, set[str] | None, asyncio.Queue]] = []
        self._workers: list[asyncio.Task] = []
        self.dead_letters: list[tuple[str, str, str]] = []

    async def publish(self, event: DomainEvent) -> None:
        body = event.to_message()
        for _, names, queue in self._subs:
            if names is None or event.event_name in names:
                queue.put_nowait((event.event_name, body, 0))

    async def subscribe(self, consumer, events, handler, durable=True, prefetch=10) -> None:
        queue: asyncio.Queue = asyncio.Queue()
        self._subs.append((consumer, None if events == ["*"] else set(events), queue))
        for _ in range(max(1, min(prefetch, 4))):
            self._workers.append(asyncio.create_task(self._work(consumer, queue, handler)))

    async def _work(self, consumer: str, queue: asyncio.Queue, handler: Handler) -> None:
        while True:
            event_name, body, attempts = await queue.get()
            try:
                await handler(event_name, body)
            except Exception as exc:
                attempts += 1
                log.warning("%s failed on %s (attempt %d): %s", consumer, event_name, attempts, exc)
                if attempts >= self.max_attempts:
                    self.dead_letters.append((consumer, event_name, str(exc)))
                    await self._dead_letter(consumer, event_name, body, str(exc), attempts)
                else:
                    await asyncio.sleep(self.retry_delay * attempts)
                    queue.put_nowait((event_name, body, attempts))
            finally:
                queue.task_done()

    async def drain(self) -> None:
        """Test helper: wait until every queue is empty, including follow-on events."""
        for _ in range(50):
            await asyncio.sleep(0.05)
            if all(q.empty() and q._unfinished_tasks == 0 for _, _, q in self._subs):
                await asyncio.sleep(0.05)
                if all(q.empty() and q._unfinished_tasks == 0 for _, _, q in self._subs):
                    return
        raise TimeoutError("bus did not drain")

    async def close(self) -> None:
        for task in self._workers:
            task.cancel()
