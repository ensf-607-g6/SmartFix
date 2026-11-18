"""RabbitMQ topology (NFR-3): one topic exchange, one durable queue per consuming
module, and a dead-letter exchange + queue. Bindings follow sequence diagrams SD-1..SD-4.

scripts/setup_rabbitmq.py builds this on a broker, and RabbitMQBus.subscribe declares
queues with the same arguments, so the two never disagree (RabbitMQ refuses to
redeclare a queue with different arguments)."""
from .models import (DeadlineMissed, DomainEvent, IssueClosed, IssueDuplicateDetected,
                     IssueNeedsReview, IssuePrioritized, IssueReported, IssueValidated,
                     RepairCompleted, RepairDisputed, ReportRejected, WorkOrderCreated,
                     WorkOrderStatusChanged)

EXCHANGE = "smartfix.events"
DEAD_LETTER_EXCHANGE = "smartfix.dlx"
DEAD_LETTER_QUEUE = "smartfix.dead_letter"
QUEUE_PREFIX = "smartfix."

ALL_EVENTS = "#"

# consumer -> events it handles
BINDINGS: dict[str, list[type[DomainEvent]] | str] = {
    "validation": [IssueReported, RepairCompleted],
    "priority": [IssueValidated, IssueDuplicateDetected, RepairDisputed, DeadlineMissed],
    "work_orders": [IssuePrioritized, RepairDisputed],
    "notifications": [IssueValidated, IssueDuplicateDetected, IssueNeedsReview, ReportRejected,
                      WorkOrderCreated, WorkOrderStatusChanged, RepairCompleted, DeadlineMissed,
                      IssueClosed],
    "analytics": [RepairCompleted, IssueClosed],
    "dashboard": ALL_EVENTS,
}

# The live map only cares about recent events, so its queue does not pile up
# while no dashboard is connected.
DASHBOARD_TTL_MS = 60_000
DASHBOARD_MAX_LENGTH = 10_000


def queue_name(consumer: str) -> str:
    return f"{QUEUE_PREFIX}{consumer}"


def queue_arguments(consumer: str) -> dict:
    """Arguments every declaration of a consumer queue must use."""
    args = {"x-dead-letter-exchange": DEAD_LETTER_EXCHANGE}
    if consumer == "dashboard":
        args |= {"x-message-ttl": DASHBOARD_TTL_MS, "x-max-length": DASHBOARD_MAX_LENGTH}
    return args


def routing_keys(consumer: str) -> list[str]:
    events = BINDINGS[consumer]
    if events == ALL_EVENTS:
        return [ALL_EVENTS]
    return [e.routing_key for e in events]
