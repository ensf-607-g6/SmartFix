"""Shared infrastructure handed to every module. Modules get adapters from here,
never references to each other (NFR-8)."""
from dataclasses import dataclass
from typing import TYPE_CHECKING

from .config import Settings
from .db import Database
from .storage import PhotoStorage

if TYPE_CHECKING:
    from .ai.ollama_client import ModelClient
    from .events.bus import EventPublisher
    from .events.store import EventStore
    from .ws import WebSocketHub


@dataclass
class AppContext:
    settings: Settings
    db: Database
    bus: "EventPublisher"
    store: "EventStore"
    ai: "ModelClient"
    hub: "WebSocketHub"
    storage: PhotoStorage


_ctx: AppContext | None = None


def set_context(ctx: AppContext) -> None:
    global _ctx
    _ctx = ctx


def get_ctx() -> AppContext:
    """FastAPI dependency."""
    return _ctx
