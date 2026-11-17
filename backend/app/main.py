"""SmartFix backend: one FastAPI app, six event-driven modules that only talk through the bus."""
import asyncio
import json
import logging
from contextlib import asynccontextmanager
from uuid import UUID

from fastapi import APIRouter, Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware

from . import auth, dev_tools, photos, ws
from .ai.ollama_client import OllamaClient
from .config import Settings, get_settings
from .context import AppContext, get_ctx, set_context
from .db import Database
from .events.bus import EventPublisher, InMemoryBus, RabbitMQBus
from .events.store import EventStore
from .modules import analytics, dashboard, notifications, priority, reports, scheduler, validation, work_orders
from .storage import PhotoStorage

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("smartfix")

CONSUMERS = [validation.ValidationModule, priority.PriorityModule, work_orders.WorkOrdersModule,
             notifications.NotificationsModule, analytics.AnalyticsModule]


def build_bus(settings: Settings) -> EventPublisher:
    if settings.rabbitmq_url:
        return RabbitMQBus(settings.rabbitmq_url, settings.rabbitmq_exchange, settings.max_attempts)
    log.warning("RABBITMQ_URL is empty: using the in-process event bus")
    return InMemoryBus(settings.max_attempts)


async def start_modules(ctx: AppContext) -> list[asyncio.Task]:
    async def record_dead_letter(consumer, event_name, body, error, attempts):
        try:
            event_id = UUID(json.loads(body)["event_id"])
        except Exception:
            event_id = None
        await ctx.store.record_dead_letter(consumer, event_id, error, attempts)

    ctx.bus.on_dead_letter = record_dead_letter
    for consumer_cls in CONSUMERS:
        await consumer_cls(ctx).start()
    await ctx.bus.subscribe("dashboard", ["*"], ctx.hub.on_event, durable=False)

    every = ctx.settings.scheduler_interval_s
    return [asyncio.create_task(scheduler.run_periodically(name, every, job, ctx)) for name, job in (
        ("deadline_scheduler", scheduler.check_overdue),
        ("auto_close", reports.auto_close_unconfirmed),
        ("assign_waiting", work_orders.assign_waiting),
    )]


def create_app(ctx_factory=None) -> FastAPI:
    @asynccontextmanager
    async def lifespan(app: FastAPI):
        settings = get_settings()
        if ctx_factory:
            ctx = await ctx_factory()
        else:
            db = Database(settings.database_url)
            await db.connect()
            bus = build_bus(settings)
            await bus.connect()
            ai = OllamaClient(settings.ollama_url, settings.vision_model, settings.fallback_model,
                              settings.ollama_timeout_s)
            ctx = AppContext(settings=settings, db=db, bus=bus, store=EventStore(db), ai=ai,
                             hub=ws.WebSocketHub(db), storage=PhotoStorage(settings.storage_dir))
            asyncio.create_task(ai.warm_up())
        set_context(ctx)
        tasks = await start_modules(ctx)
        log.info("SmartFix backend ready")
        yield
        for task in tasks:
            task.cancel()
        await ctx.bus.close()
        if hasattr(ctx.ai, "close"):
            await ctx.ai.close()
        await ctx.db.close()

    app = FastAPI(title="SmartFix API", version="1.0.0", lifespan=lifespan)
    app.add_middleware(CORSMiddleware, allow_origins=get_settings().cors_origins.split(","),
                       allow_credentials=True, allow_methods=["*"], allow_headers=["*"])

    api = APIRouter(prefix="/api")

    @api.get("/health", tags=["health"])
    async def health(ctx: AppContext = Depends(get_ctx)):
        try:
            db_ok = await ctx.db.fetchval("SELECT 1") == 1
        except Exception:
            db_ok = False
        ai = await ctx.ai.health() if hasattr(ctx.ai, "health") else {"reachable": True}
        return {"database": db_ok, "bus": type(ctx.bus).__name__, "ai": ai,
                "vision_model": ctx.settings.vision_model, "dev_tools": ctx.settings.enable_dev_tools}

    for router in (auth.router, reports.router, validation.router, work_orders.router, notifications.router,
                   dashboard.router, photos.router, dev_tools.router):
        api.include_router(router)
    app.include_router(api)
    app.include_router(ws.router, prefix="/api")
    return app


app = create_app()
