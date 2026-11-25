"""SF-44: RabbitMQ broker-level integration tests.

These tests verify real message publication, routing, delivery and deserialization.
They do not yet verify database state or the complete multi-module workflows.
Requires a local RabbitMQ broker on 127.0.0.1:5672.
"""
import asyncio
import os
from decimal import Decimal
from uuid import uuid4


from uuid import UUID

import asyncpg
import httpx
import pytest

from app.config import get_settings
from app.context import AppContext, set_context
from app.db import Database
from app.events.store import EventStore
from app.main import create_app, start_modules
from app.storage import LocalPhotoStorage
from app.ws import WebSocketHub
from scripts.init_db import main as init_db
from tests.conftest import FakeModel, photo_bytes, _test_dsn

from app.events.bus import RabbitMQBus
from app.events.models import (
    DomainEvent,
    IssueDuplicateDetected,
    IssueNeedsReview,
    IssueValidated,
    RepairDisputed,
)

class IsolatedRabbitMQBus(RabbitMQBus):
    """Use real RabbitMQ with temporary consumer queues."""

    async def subscribe(self, consumer, events, handler, durable=True, prefetch=10):
        await super().subscribe(
            consumer, events, handler, durable=False, prefetch=prefetch
        )


RABBITMQ_URL = os.getenv("TEST_RABBITMQ_URL", "amqp://guest:guest@127.0.0.1:5672/")


def event_cases():
    common = {"producer": "sf44_test", "correlation_id": uuid4(), "issue_id": uuid4()}
    return [
        pytest.param(
            IssueValidated(**common, problem_type="pothole", severity=3, confidence=Decimal("0.95")),
            id="validated-event",
        ),
        pytest.param(
            IssueDuplicateDetected(
                **common, existing_issue_id=common["issue_id"],
                merged_issue_id=uuid4(), distance_m=Decimal("12.5")
            ),
            id="duplicate-event",
        ),
        pytest.param(
            IssueNeedsReview(**common, review_id=uuid4(), reason="low_confidence", confidence=Decimal("0.3")),
            id="needs-review-event",
        ),
        pytest.param(
            RepairDisputed(**common, work_order_id=uuid4(), dispute_reason="Repair not complete"),
            id="dispute-event",
        ),
    ]


@pytest.mark.parametrize("event", event_cases())
def test_rabbitmq_publishes_and_delivers_event(event):
    """The real broker delivers each event to a subscribed consumer."""

    async def scenario():
        # Unique exchange avoids mixing test traffic with the running application.
        bus = RabbitMQBus(RABBITMQ_URL, exchange=f"smartfix.sf44.test.{uuid4().hex}")
        await bus.connect()
        received = asyncio.get_running_loop().create_future()

        async def handler(event_name: str, body: bytes):
            if not received.done():
                received.set_result((event_name, body))

        try:
            # Exclusive, auto-deleted queue; no persistent test consumer queues.
            await bus.subscribe("sf44_test", [event.event_name], handler, durable=False)
            await bus.publish(event)
            event_name, body = await asyncio.wait_for(received, timeout=10)
            decoded = DomainEvent.from_message(event_name, body)
            assert event_name == event.event_name
            assert decoded == event
        finally:
            # Clean up the test-only exchange before closing the connection.
            if bus.exchange is not None:
                await bus.exchange.delete(if_unused=False)
            await bus.close()

    asyncio.run(scenario())


@pytest.fixture
async def rabbit_app(tmp_path):
    """Fresh test database and real RabbitMQ consumers."""
    dsn = _test_dsn()

    if not dsn.endswith("/smartfix_test"):
        pytest.fail("Workflow tests must use the smartfix_test database")

    admin = await asyncpg.connect(dsn.rsplit("/", 1)[0] + "/postgres")
    try:
        exists = await admin.fetchval(
            "SELECT 1 FROM pg_database WHERE datname = 'smartfix_test'"
        )
        if not exists:
            await admin.execute("CREATE DATABASE smartfix_test")
    finally:
        await admin.close()

    await init_db(reset=True, dsn=dsn, quiet=True)

    settings = get_settings().model_copy(update={
        "database_url": dsn,
        "storage_dir": tmp_path,
        "enable_dev_tools": True,
        "scheduler_interval_s": 3600,
    })

    db = Database(dsn)
    await db.connect()

    bus = IsolatedRabbitMQBus(
        RABBITMQ_URL,
        exchange=f"smartfix.sf44.flow.{uuid4().hex}",
    )
    tasks = []

    try:
        await bus.connect()

        ctx = AppContext(
            settings=settings,
            db=db,
            bus=bus,
            store=EventStore(db),
            ai=FakeModel(),
            hub=WebSocketHub(db),
            storage=LocalPhotoStorage(tmp_path),
        )

        set_context(ctx)
        tasks = await start_modules(ctx)

        transport = httpx.ASGITransport(app=create_app())
        async with httpx.AsyncClient(
            transport=transport, base_url="http://test/api"
        ) as client:
            yield ctx, client

    finally:
        for task in tasks:
            task.cancel()

        if bus.exchange is not None:
            await bus.exchange.delete(if_unused=False)

        await bus.close()
        await db.close()


async def wait_until(check, timeout=20):
    """Wait until RabbitMQ consumers reach the expected state."""
    loop = asyncio.get_running_loop()
    deadline = loop.time() + timeout

    while loop.time() < deadline:
        result = await check()
        if result:
            return result
        await asyncio.sleep(0.1)

    raise AssertionError(
        f"RabbitMQ workflow did not finish within {timeout} seconds"
    )


async def login(client, email):
    response = await client.post(
        "/auth/login",
        json={"email": email, "password": "smartfix123"},
    )
    assert response.status_code == 200, response.text

    return {
        "Authorization": f"Bearer {response.json()['access_token']}"
    }


async def submit(client, email="resident@smartfix.dev",
                 lat=51.0790, lng=-114.1300):
    response = await client.post(
        "/reports",
        headers=await login(client, email),
        data={
            "lat": lat,
            "lng": lng,
            "problem_type": "pothole",
            "description": "Deep pothole",
        },
        files={
            "photo": ("p.jpg", photo_bytes(), "image/jpeg")
        },
    )
    assert response.status_code == 202, response.text
    return response.json()


async def issue(client, issue_id):
    response = await client.get(
        f"/issues/{issue_id}",
        headers=await login(client, "operator@smartfix.dev"),
    )
    assert response.status_code == 200, response.text
    return response.json()


async def event_names(ctx, issue_id):
    records = await ctx.db.fetch(
        "SELECT event_name FROM events WHERE issue_id = $1 ORDER BY occurred_at",
        UUID(str(issue_id)),
    )
    return [record["event_name"] for record in records]


async def assigned_issue(client, issue_id):
    current = await issue(client, issue_id)
    if current["status"] == "assigned" and current["work_orders"]:
        return current
    return None


@pytest.mark.anyio
async def test_rabbitmq_happy_path_work_order_and_notification(rabbit_app):
    """Report -> Validation -> Priority -> WorkOrder -> Notification."""
    ctx, client = rabbit_app
    sub = await submit(client)
    issue_id = sub["issue_id"]

    async def finished():
        current = await issue(client, issue_id)
        names = await event_names(ctx, issue_id)

        inbox_response = await client.get(
            "/notifications",
            headers=await login(client, "resident@smartfix.dev"),
        )
        assert inbox_response.status_code == 200
        inbox = inbox_response.json()

        if (
            current["status"] == "assigned"
            and current["work_orders"]
            and all(name in names for name in (
                "IssueReported",
                "IssueValidated",
                "IssuePrioritized",
                "WorkOrderCreated",
            ))
            and inbox["items"]
        ):
            return current, names

        return None

    current, names = await wait_until(finished)

    assert current["severity"] == 4
    assert current["work_orders"][0]["crew_name"] == "Roads Crew North"
    assert names[:4] == [
        "IssueReported",
        "IssueValidated",
        "IssuePrioritized",
        "WorkOrderCreated",
    ]


@pytest.mark.anyio
async def test_rabbitmq_duplicate_merges_and_notifies(rabbit_app):
    """Duplicate reports merge into the existing issue."""
    ctx, client = rabbit_app

    first = await submit(client)
    await wait_until(
        lambda: assigned_issue(client, first["issue_id"])
    )

    second = await submit(
        client,
        email="resident2@smartfix.dev",
        lat=51.07915,
        lng=-114.13005,
    )

    async def finished():
        merged = await ctx.db.fetchrow(
            """SELECT status::text AS status, merged_into_id
               FROM issues WHERE issue_id = $1""",
            UUID(second["issue_id"]),
        )

        original = await issue(client, first["issue_id"])
        names = await event_names(ctx, first["issue_id"])

        if (
            merged["status"] == "merged"
            and str(merged["merged_into_id"]) == first["issue_id"]
            and original["duplicate_count"] == 1
            and "IssueDuplicateDetected" in names
        ):
            return original

        return None

    original = await wait_until(finished)

    assert len(original["work_orders"]) == 1
    assert len(original["reports"]) == 2

    mine = (
        await client.get(
            "/reports/mine",
            headers=await login(client, "resident2@smartfix.dev"),
        )
    ).json()

    assert mine[0]["report_status"] == "duplicate"


@pytest.mark.anyio
async def test_rabbitmq_needs_review_then_approval(rabbit_app):
    """Low-confidence report enters review and is approved."""
    ctx, client = rabbit_app
    ctx.ai.confidence = 0.3

    sub = await submit(client)
    op = await login(client, "operator@smartfix.dev")

    async def in_review():
        queue = (await client.get("/review", headers=op)).json()
        names = await event_names(ctx, sub["issue_id"])

        if (
            queue
            and queue[0]["reason"] == "low_confidence"
            and "IssueNeedsReview" in names
        ):
            return queue[0]

        return None

    review = await wait_until(in_review)

    assert (await issue(client, sub["issue_id"]))["status"] == "reported"

    response = await client.post(
        f"/review/{review['review_id']}",
        headers=op,
        json={"approve": True, "severity": 5},
    )
    assert response.status_code == 200, response.text

    current = await wait_until(
        lambda: assigned_issue(client, sub["issue_id"])
    )

    assert current["severity"] == 5

    names = await event_names(ctx, sub["issue_id"])
    assert all(name in names for name in (
        "IssueNeedsReview",
        "IssueValidated",
        "IssuePrioritized",
        "WorkOrderCreated",
    ))


@pytest.mark.anyio
async def test_rabbitmq_dispute_reopens_and_creates_new_order(rabbit_app):
    """Disputed repair increases priority and creates another work order."""
    ctx, client = rabbit_app

    sub = await submit(client)
    current = await wait_until(
        lambda: assigned_issue(client, sub["issue_id"])
    )

    first_order = current["work_orders"][0]["work_order_id"]
    crew = await login(client, "crew.north@smartfix.dev")

    response = await client.patch(
        f"/crew/work-orders/{first_order}",
        headers=crew,
        json={"status": "in_progress"},
    )
    assert response.status_code == 200, response.text

    response = await client.post(
        f"/crew/work-orders/{first_order}/complete",
        headers=crew,
        data={"notes": "done"},
        files={
            "after_photo": (
                "a.jpg",
                photo_bytes((60, 60, 60)),
                "image/jpeg",
            )
        },
    )
    assert response.status_code == 200, response.text

    async def completed():
        current = await issue(client, sub["issue_id"])

        if (
            current["status"] == "completed"
            and current["work_orders"][0]["confirmation_id"]
        ):
            return current

        return None

    current = await wait_until(completed)
    confirmation_id = current["work_orders"][0]["confirmation_id"]

    response = await client.post(
        f"/confirmations/{confirmation_id}",
        headers=await login(client, "resident@smartfix.dev"),
        json={
            "action": "dispute",
            "reason": "Still a hole on the left",
        },
    )
    assert response.status_code == 200, response.text

    async def reassigned():
        current = await issue(client, sub["issue_id"])
        names = await event_names(ctx, sub["issue_id"])

        if (
            current["status"] == "assigned"
            and current["reopen_count"] == 1
            and len(current["work_orders"]) == 2
            and all(name in names for name in (
                "RepairDisputed",
                "IssuePrioritized",
                "WorkOrderCreated",
            ))
        ):
            return current

        return None

    current = await wait_until(reassigned)

    assert float(current["priority_base"]) == 50
    assert current["work_orders"][0]["work_order_id"] != first_order
    assert current["work_orders"][1]["status"] == "completed"
