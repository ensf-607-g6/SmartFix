"""Structured log fields for events, so every line about an event can be traced by
event_id and issue_id (and the whole journey by correlation_id)."""
import json
from typing import Any

from .models import DomainEvent


def _fmt(fields: dict[str, Any]) -> str:
    return " ".join(f"{k}={v}" for k, v in fields.items() if v is not None)


def event_fields(event: DomainEvent) -> dict[str, Any]:
    return {"event": event.event_name, "event_id": str(event.event_id),
            "issue_id": str(event.issue_id) if event.issue_id else None,
            "correlation_id": str(event.correlation_id)}


def message_fields(event_name: str, body: bytes, message_id: str | None = None) -> dict[str, Any]:
    """Same fields from a raw message, without failing on a body that does not parse."""
    try:
        data = json.loads(body)
    except (ValueError, TypeError):
        data = {}
    return {"event": event_name, "event_id": message_id or data.get("event_id"),
            "issue_id": data.get("issue_id"), "correlation_id": data.get("correlation_id")}


def describe(event: DomainEvent) -> str:
    return _fmt(event_fields(event))


def describe_message(event_name: str, body: bytes, message_id: str | None = None) -> str:
    return _fmt(message_fields(event_name, body, message_id))


def extra(fields: dict[str, Any]) -> dict[str, Any]:
    """For logging's extra=, so a JSON log formatter can pick the fields up as keys."""
    return {"smartfix": fields}
