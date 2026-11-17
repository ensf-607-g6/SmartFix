"""Stand-ins for the broker, database and event store, so the event library can be
tested without RabbitMQ or Postgres."""
from contextlib import asynccontextmanager


# ---- aio-pika -------------------------------------------------------------

class FakeExchange:
    def __init__(self, name="", fail=False):
        self.name = name
        self.fail = fail
        self.published = []                      # (message, routing_key)

    async def publish(self, message, routing_key):
        if self.fail:
            raise ConnectionError("broker unreachable")
        self.published.append((message, routing_key))


class FakeQueue:
    def __init__(self, name, durable, arguments):
        self.name = name
        self.durable = durable
        self.arguments = arguments
        self.bindings = []                       # routing keys
        self.callback = None

    async def bind(self, exchange, routing_key=""):
        self.bindings.append(routing_key)

    async def consume(self, callback):
        self.callback = callback


class FakeChannel:
    def __init__(self):
        self.default_exchange = FakeExchange()
        self.queues = {}
        self.prefetch = None

    async def set_qos(self, prefetch_count):
        self.prefetch = prefetch_count

    async def declare_queue(self, name="", durable=False, arguments=None, exclusive=False, auto_delete=False):
        queue = FakeQueue(name or "amq.gen-test", durable, arguments)
        self.queues[queue.name] = queue
        return queue


class FakeConnection:
    def __init__(self):
        self.channels = []

    async def channel(self, publisher_confirms=False):
        channel = FakeChannel()
        self.channels.append(channel)
        return channel


class FakeMessage:
    """What a consumer callback receives from the broker."""

    def __init__(self, body, type, message_id=None, headers=None):
        self.body = body
        self.type = type
        self.message_id = message_id
        self.headers = headers or {}
        self.acked = 0

    async def ack(self):
        self.acked += 1

    @classmethod
    def redelivered(cls, message):
        """The broker handing back a message the bus re-published."""
        return cls(message.body, message.type, message.message_id, dict(message.headers or {}))


# ---- database / store / bus -------------------------------------------------

class FakeTransaction:
    def __init__(self):
        self.committed = False
        self.rolled_back = False


class FakeDatabase:
    def __init__(self):
        self.transactions = []

    @asynccontextmanager
    async def transaction(self, module, event_id=None):
        tx = FakeTransaction()
        self.transactions.append(tx)
        try:
            yield tx
        except BaseException:
            tx.rolled_back = True
            raise
        tx.committed = True


class FakeStore:
    def __init__(self):
        self.processed = set()
        self.saved = []                           # (event, tx)

    async def try_mark_processed(self, consumer, event_id, tx):
        key = (consumer, event_id)
        if key in self.processed:
            return False
        self.processed.add(key)
        return True

    async def save(self, event, tx):
        self.saved.append((event, tx))


class RecordingBus:
    def __init__(self, store=None):
        self.published = []
        self.store = store
        self.subscriptions = []

    async def publish(self, event):
        if self.store is not None:
            # publish must only happen after the event row was committed
            tx = next(tx for saved, tx in self.store.saved if saved.event_id == event.event_id)
            assert tx.committed, "published before commit"
        self.published.append(event)

    async def subscribe(self, consumer, events, handler, durable=True, prefetch=10):
        self.subscriptions.append((consumer, events))


class FakeContext:
    def __init__(self):
        self.db = FakeDatabase()
        self.store = FakeStore()
        self.bus = RecordingBus(self.store)
