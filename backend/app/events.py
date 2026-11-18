"""Event catalogue. Every event carries a Pydantic-validated payload (NFR-8)."""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from enum import Enum
from typing import Any, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, model_validator

ProblemType = Literal["pothole", "streetlight", "water_leak", "sidewalk", "other"]


class EventName(str, Enum):
    ISSUE_REPORTED = "issue.reported"
    ISSUE_VALIDATED = "issue.validated"
    ISSUE_DUPLICATE_DETECTED = "issue.duplicate_detected"
    ISSUE_NEEDS_REVIEW = "issue.needs_review"
    ISSUE_REJECTED = "issue.rejected"                      # added: operator rejects a review item
    ISSUE_PRIORITIZED = "issue.prioritized"
    WORK_ORDER_CREATED = "work_order.created"
    WORK_ORDER_STATUS_CHANGED = "work_order.status_changed"
    REPAIR_COMPLETED = "repair.completed"
    REPAIR_DISPUTED = "repair.disputed"
    DEADLINE_MISSED = "deadline.missed"
    CONFIRMATION_EXPIRED = "repair.confirmation_expired"   # added: 7-day auto-close trigger
    ISSUE_CLOSED = "issue.closed"                          # added: history + notification


class _P(BaseModel):
    model_config = ConfigDict(extra="forbid")


class IssueReportedP(_P):
    report_id: uuid.UUID
    category: ProblemType
    latitude: float
    longitude: float


class IssueValidatedP(_P):
    problem_type: ProblemType
    severity: int = Field(ge=1, le=5)
    summary: str = ""
    source: Literal["model", "operator"] = "model"


class IssueDuplicateDetectedP(_P):
    report_id: uuid.UUID
    source_issue_id: uuid.UUID
    reason: str = ""


class IssueNeedsReviewP(_P):
    reason: str
    problem_type: Optional[ProblemType] = None
    severity: Optional[int] = Field(default=None, ge=1, le=5)
    confidence: Optional[float] = None


class IssueRejectedP(_P):
    reason: str


class IssuePrioritizedP(_P):
    priority_base: float
    severity: int
    dup_count: int
    reason: str
    escalated: bool = False


class WorkOrderCreatedP(_P):
    work_order_id: uuid.UUID
    crew_id: Optional[uuid.UUID] = None
    crew_name: Optional[str] = None
    deadline_at: datetime


class WorkOrderStatusChangedP(_P):
    work_order_id: uuid.UUID
    status: str
    note: str = ""
    visible_to_resident: bool = True


class RepairCompletedP(_P):
    work_order_id: uuid.UUID
    after_photo: str


class RepairDisputedP(_P):
    reason: str = ""


class DeadlineMissedP(_P):
    work_order_id: uuid.UUID
    crew_id: Optional[uuid.UUID] = None


class ConfirmationExpiredP(_P):
    pass


class IssueClosedP(_P):
    reason: Literal["confirmed", "auto_closed"]


PAYLOADS: dict[EventName, type[BaseModel]] = {
    EventName.ISSUE_REPORTED: IssueReportedP,
    EventName.ISSUE_VALIDATED: IssueValidatedP,
    EventName.ISSUE_DUPLICATE_DETECTED: IssueDuplicateDetectedP,
    EventName.ISSUE_NEEDS_REVIEW: IssueNeedsReviewP,
    EventName.ISSUE_REJECTED: IssueRejectedP,
    EventName.ISSUE_PRIORITIZED: IssuePrioritizedP,
    EventName.WORK_ORDER_CREATED: WorkOrderCreatedP,
    EventName.WORK_ORDER_STATUS_CHANGED: WorkOrderStatusChangedP,
    EventName.REPAIR_COMPLETED: RepairCompletedP,
    EventName.REPAIR_DISPUTED: RepairDisputedP,
    EventName.DEADLINE_MISSED: DeadlineMissedP,
    EventName.CONFIRMATION_EXPIRED: ConfirmationExpiredP,
    EventName.ISSUE_CLOSED: IssueClosedP,
}


class Event(BaseModel):
    event_id: uuid.UUID = Field(default_factory=uuid.uuid4)
    name: EventName
    issue_id: uuid.UUID
    producer: str
    occurred_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    payload: dict[str, Any] = {}

    @model_validator(mode="after")
    def _check_payload(self) -> "Event":
        parsed = PAYLOADS[self.name].model_validate(self.payload)
        self.payload = parsed.model_dump(mode="json")
        return self

    @property
    def data(self) -> Any:
        """Typed payload for this event."""
        return PAYLOADS[self.name].model_validate(self.payload)


def make_event(name: EventName, issue_id: uuid.UUID, producer: str, **payload: Any) -> Event:
    return Event(name=name, issue_id=issue_id, producer=producer, payload=payload)
