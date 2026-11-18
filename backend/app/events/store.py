"""EventStore: the events table (FR-14), idempotency (NFR-4) and dead letters (NFR-3)."""
from uuid import UUID

from ..db import Database, Transaction
from .models import DomainEvent


class EventStore:
    def __init__(self, db: Database):
        self.db = db

    async def save(self, event: DomainEvent, tx: Transaction) -> None:
        await tx.execute(
            """INSERT INTO events (event_id, event_name, issue_id, report_id, producer, actor_id,
                                   payload, correlation_id, causation_id, occurred_at)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)""",
            event.event_id, event.event_name, event.issue_id, event.report_id, event.producer,
            event.actor_id, event.payload(), event.correlation_id, event.causation_id,
            event.occurred_at)

    async def try_mark_processed(self, consumer: str, event_id: UUID, tx: Transaction) -> bool:
        """False means this consumer already handled the event: skip it."""
        status = await tx.execute(
            "INSERT INTO processed_events (consumer, event_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
            consumer, event_id)
        return status.endswith(" 1")

    async def correlation_for(self, issue_id: UUID, tx: Transaction) -> UUID:
        """Correlation ID of the issue's journey, for events started by a person or timer."""
        corr = await tx.fetchval(
            "SELECT correlation_id FROM events WHERE issue_id = $1 ORDER BY occurred_at LIMIT 1", issue_id)
        if corr is None:
            corr = await tx.fetchval(
                """SELECT e.correlation_id FROM events e JOIN reports r ON r.report_id = e.report_id
                   WHERE r.issue_id = $1 ORDER BY e.occurred_at LIMIT 1""", issue_id)
        return corr or issue_id

    async def timeline(self, issue_id: UUID):
        return await self.db.fetch(
            "SELECT * FROM v_issue_timeline WHERE issue_id = $1 ORDER BY at", issue_id)

    async def record_dead_letter(self, consumer: str, event_id: UUID | None, error: str, attempts: int) -> None:
        await self.db.fetchval(
            """INSERT INTO dead_letter_events (event_id, consumer, attempts, error_message)
               VALUES ((SELECT event_id FROM events WHERE event_id = $1), $2, $3, $4)
               RETURNING dead_letter_id""",
            event_id, consumer, attempts, error[:2000])
