from uuid import uuid4

import pytest
from pydantic import ValidationError

from app.events.models import (
    DomainEvent,
    IssueReported,
    IssueValidated,
    IssueNeedsReview,
    IssuePrioritized,
    EVENT_TYPES,
)


def valid_event():
    """Create a valid IssueValidated event."""
    return IssueValidated(
        producer="validation",
        correlation_id=uuid4(),
        issue_id=uuid4(),
        problem_type="pothole",
        severity=3,
        confidence="0.95",
    )


def test_valid_event_is_accepted():
    event = valid_event()

    assert event.event_name == "IssueValidated"
    assert event.severity == 3
    assert event.producer == "validation"


def test_missing_required_field_is_rejected():
    """Events must include all required fields."""
    with pytest.raises(ValidationError):
        IssueReported(
            producer="reports",
            correlation_id=uuid4(),
            photo_id=uuid4(),
            lat=51.05,
            lng=-114.07,
            # Missing problem_type
        )


@pytest.mark.parametrize("severity", [0, -1, 6, 10])
def test_invalid_severity_is_rejected(severity):
    """Severity must be between 1 and 5."""
    with pytest.raises(ValidationError):
        IssueValidated(
            producer="validation",
            correlation_id=uuid4(),
            problem_type="pothole",
            severity=severity,
            confidence="0.9",
        )


def test_invalid_review_reason_is_rejected():
    """Review reasons must match the allowed values."""
    with pytest.raises(ValidationError):
        IssueNeedsReview(
            producer="validation",
            correlation_id=uuid4(),
            review_id=uuid4(),
            reason="unknown_reason",
            confidence="0.5",
        )


def test_event_serialization_round_trip():
    """An event should survive serialization and deserialization."""
    original = valid_event()

    message = original.to_message()
    restored = DomainEvent.from_message(original.event_name, message)

    assert isinstance(restored, IssueValidated)
    assert restored == original


def test_follow_preserves_event_relationships():
    """Follow-up events retain correlation and causation IDs."""
    original = valid_event()

    follow_up = original.follow(
        IssuePrioritized,
        "priority",
        priority_score="35.5",
        reason="validated",
    )

    assert follow_up.correlation_id == original.correlation_id
    assert follow_up.causation_id == original.event_id
    assert follow_up.issue_id == original.issue_id
    assert follow_up.producer == "priority"


def test_all_registered_event_types_have_unique_names():
    """Every registered event type should have a unique name."""
    names = [event_type.event_name for event_type in EVENT_TYPES.values()]

    assert len(names) == len(set(names))
    assert len(EVENT_TYPES) == 12