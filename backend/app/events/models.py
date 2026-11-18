"""Domain events (class diagram 05b). Pydantic checks every event carries the
fields it should before it is stored or published."""
from datetime import datetime, timezone
from decimal import Decimal
from typing import ClassVar, Literal
from uuid import UUID, uuid4

from pydantic import BaseModel, Field


def _now() -> datetime:
    return datetime.now(timezone.utc)


class DomainEvent(BaseModel):
    event_name: ClassVar[str]
    routing_key: ClassVar[str]

    event_id: UUID = Field(default_factory=uuid4)
    issue_id: UUID | None = None
    report_id: UUID | None = None
    producer: str
    actor_id: UUID | None = None
    correlation_id: UUID
    causation_id: UUID | None = None
    occurred_at: datetime = Field(default_factory=_now)

    def to_message(self) -> bytes:
        return self.model_dump_json().encode()

    @staticmethod
    def from_message(event_name: str, body: bytes) -> "DomainEvent":
        return EVENT_TYPES[event_name].model_validate_json(body)

    def payload(self) -> dict:
        """Event-specific fields, stored in events.payload."""
        common = set(DomainEvent.model_fields)
        return self.model_dump(mode="json", exclude=common)

    def follow(self, cls: type["DomainEvent"], producer: str, **fields) -> "DomainEvent":
        """Build the next event in this report's journey (same correlation, caused by self)."""
        fields.setdefault("issue_id", self.issue_id)
        fields.setdefault("report_id", self.report_id)
        return cls(producer=producer, correlation_id=self.correlation_id, causation_id=self.event_id, **fields)


class IssueReported(DomainEvent):
    event_name = "IssueReported"
    routing_key = "issue.reported"
    photo_id: UUID
    lat: float
    lng: float
    problem_type: str


class IssueValidated(DomainEvent):
    event_name = "IssueValidated"
    routing_key = "issue.validated"
    problem_type: str
    severity: int = Field(ge=1, le=5)
    confidence: Decimal
    approved_by: UUID | None = None


class IssueDuplicateDetected(DomainEvent):
    event_name = "IssueDuplicateDetected"
    routing_key = "issue.duplicate_detected"
    existing_issue_id: UUID
    merged_issue_id: UUID
    distance_m: Decimal


class IssueNeedsReview(DomainEvent):
    event_name = "IssueNeedsReview"
    routing_key = "issue.needs_review"
    review_id: UUID
    reason: Literal["low_confidence", "not_infrastructure"]
    confidence: Decimal


class IssuePrioritized(DomainEvent):
    event_name = "IssuePrioritized"
    routing_key = "issue.prioritized"
    priority_score: Decimal
    reason: str


class WorkOrderCreated(DomainEvent):
    event_name = "WorkOrderCreated"
    routing_key = "work_order.created"
    work_order_id: UUID
    crew_id: int
    deadline_at: datetime


class WorkOrderStatusChanged(DomainEvent):
    event_name = "WorkOrderStatusChanged"
    routing_key = "work_order.status_changed"
    work_order_id: UUID
    old_status: str
    new_status: str
    crew_id: int | None = None
    reason: str | None = None


class RepairCompleted(DomainEvent):
    event_name = "RepairCompleted"
    routing_key = "repair.completed"
    work_order_id: UUID
    after_photo_id: UUID


class RepairDisputed(DomainEvent):
    event_name = "RepairDisputed"
    routing_key = "repair.disputed"
    work_order_id: UUID
    dispute_reason: str


class DeadlineMissed(DomainEvent):
    event_name = "DeadlineMissed"
    routing_key = "deadline.missed"
    work_order_id: UUID
    deadline_at: datetime


class IssueClosed(DomainEvent):
    event_name = "IssueClosed"
    routing_key = "issue.closed"
    work_order_id: UUID
    closed_by: Literal["confirmed", "auto_closed"]


class ReportRejected(DomainEvent):
    event_name = "ReportRejected"
    routing_key = "report.rejected"
    review_id: UUID
    reason: Literal["low_confidence", "not_infrastructure"]
    notes: str | None = None


EVENT_TYPES: dict[str, type[DomainEvent]] = {
    cls.event_name: cls
    for cls in (IssueReported, IssueValidated, IssueDuplicateDetected, IssueNeedsReview,
                IssuePrioritized, WorkOrderCreated, WorkOrderStatusChanged, RepairCompleted,
                RepairDisputed, DeadlineMissed, IssueClosed, ReportRejected)
}
ROUTING_TO_NAME = {cls.routing_key: name for name, cls in EVENT_TYPES.items()}
