"""Integration fixtures: a fresh smartfix_test database per test, the in-process bus and a
scripted model, so the whole event flow runs deterministically without RabbitMQ or Ollama.

Set TEST_DATABASE_URL to point somewhere else (default: smartfix_test next to DATABASE_URL).
"""
import io
import os
from dataclasses import dataclass, field

import asyncpg
import httpx
import pytest
from PIL import Image, ImageDraw

from app.ai.ollama_client import Classification, DuplicateVerdict, ModelUnavailable, RepairVerdictResult
from app.config import get_settings
from app.context import AppContext, set_context
from app.db import Database
from app.events.bus import InMemoryBus
from app.events.store import EventStore
from app.main import create_app, start_modules
from app.storage import PhotoStorage
from app.ws import WebSocketHub
from scripts.init_db import main as init_db


def _test_dsn() -> str:
    if os.environ.get("TEST_DATABASE_URL"):
        return os.environ["TEST_DATABASE_URL"]
    base = get_settings().database_url.rsplit("/", 1)[0]
    return f"{base}/smartfix_test"


@dataclass
class FakeModel:
    """Scripted ModelClient. Tests change the fields to steer each decision."""
    confidence: float = 0.9
    is_infrastructure: bool = True
    severity: int = 4
    problem_type: str | None = None          # None: agree with the resident
    is_match: bool = True
    verdict: str = "repaired"
    down: bool = False
    calls: list = field(default_factory=list)

    async def classify(self, photo, text, chosen_type):
        self.calls.append("classify")
        if self.down:
            raise ModelUnavailable("model offline")
        return Classification(model_name="fake", latency_ms=5, raw={"summary": "test"},
                              problem_type=self.problem_type or chosen_type, severity=self.severity,
                              confidence=self.confidence, is_infrastructure=self.is_infrastructure)

    async def compare_reports(self, a, b, distance_m, problem_type):
        self.calls.append("compare")
        return DuplicateVerdict(model_name="fake", latency_ms=5, is_match=self.is_match, confidence=0.9)

    async def verify_repair(self, before, after, problem_type):
        self.calls.append("verify")
        return RepairVerdictResult(model_name="fake", latency_ms=5, verdict=self.verdict, confidence=0.8)

    async def write_message(self, prompt):
        raise ModelUnavailable("templates are enough in tests")


def photo_bytes(color=(90, 90, 90)) -> bytes:
    img = Image.new("RGB", (320, 240), color)
    ImageDraw.Draw(img).ellipse((80, 80, 240, 180), fill=(30, 30, 30))
    buf = io.BytesIO()
    img.save(buf, "JPEG")
    return buf.getvalue()


@pytest.fixture
async def ctx(tmp_path):
    dsn = _test_dsn()
    admin = await asyncpg.connect(dsn.rsplit("/", 1)[0] + "/postgres")
    if not await admin.fetchval("SELECT 1 FROM pg_database WHERE datname = 'smartfix_test'") and dsn.endswith("/smartfix_test"):
        await admin.execute("CREATE DATABASE smartfix_test")
    await admin.close()
    await init_db(reset=True, dsn=dsn, quiet=True)

    settings = get_settings().model_copy(update={"database_url": dsn, "storage_dir": tmp_path,
                                                  "enable_dev_tools": True, "scheduler_interval_s": 3600})
    db = Database(dsn)
    await db.connect()
    bus = InMemoryBus(max_attempts=3, retry_delay=0.01)
    context = AppContext(settings=settings, db=db, bus=bus, store=EventStore(db), ai=FakeModel(),
                         hub=WebSocketHub(db), storage=PhotoStorage(tmp_path))
    set_context(context)
    tasks = await start_modules(context)
    yield context
    for t in tasks:
        t.cancel()
    await bus.close()
    await db.close()


@pytest.fixture
async def client(ctx):
    transport = httpx.ASGITransport(app=create_app())
    async with httpx.AsyncClient(transport=transport, base_url="http://test/api") as c:
        yield c


class Api:
    """Small helper: log in as a demo user and call the API."""

    def __init__(self, client: httpx.AsyncClient, ctx: AppContext):
        self.client, self.ctx = client, ctx
        self.tokens: dict[str, dict] = {}

    async def as_(self, email: str) -> dict:
        if email not in self.tokens:
            r = await self.client.post("/auth/login", json={"email": email, "password": "smartfix123"})
            assert r.status_code == 200, r.text
            self.tokens[email] = {"Authorization": f"Bearer {r.json()['access_token']}"}
        return self.tokens[email]

    async def submit(self, email="resident@smartfix.dev", lat=51.0790, lng=-114.1300, ptype="pothole",
                     description="Deep pothole", photo=None):
        r = await self.client.post("/reports", headers=await self.as_(email),
                                   data={"lat": lat, "lng": lng, "problem_type": ptype, "description": description},
                                   files={"photo": ("p.jpg", photo or photo_bytes(), "image/jpeg")})
        assert r.status_code == 202, r.text
        await self.ctx.bus.drain()
        return r.json()

    async def issue(self, issue_id):
        r = await self.client.get(f"/issues/{issue_id}", headers=await self.as_("operator@smartfix.dev"))
        assert r.status_code == 200, r.text
        return r.json()

    async def start_and_complete(self, work_order_id, crew="crew.north@smartfix.dev"):
        h = await self.as_(crew)
        r = await self.client.patch(f"/crew/work-orders/{work_order_id}", headers=h, json={"status": "in_progress"})
        assert r.status_code == 200, r.text
        r = await self.client.post(f"/crew/work-orders/{work_order_id}/complete", headers=h, data={"notes": "done"},
                                   files={"after_photo": ("a.jpg", photo_bytes((60, 60, 60)), "image/jpeg")})
        assert r.status_code == 200, r.text
        await self.ctx.bus.drain()


@pytest.fixture
async def api(client, ctx):
    return Api(client, ctx)
