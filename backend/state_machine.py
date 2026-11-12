"""SmartFix SF-06: authoritative application-level issue transition rules.

PostgreSQL's status_transitions table and trigger remain the final enforcement layer.

"""
from enum import Enum


class IssueStatus(str, Enum):
    REPORTED = "reported"
    VALIDATED = "validated"
    PRIORITIZED = "prioritized"
    ASSIGNED = "assigned"
    IN_PROGRESS = "in_progress"
    COMPLETED = "completed"
    CLOSED = "closed"
    REOPENED = "reopened"
    ESCALATED = "escalated"
    REJECTED = "rejected"
    MERGED = "merged"


class Module(str, Enum):
    REPORTS = "reports"
    VALIDATION = "validation"
    PRIORITY = "priority"
    WORK_ORDERS = "work_orders"
    NOTIFICATIONS = "notifications"
    ANALYTICS = "analytics"


class TransitionError(ValueError):
    """Base class for rejected issue status changes."""


class IllegalTransition(TransitionError):
    """No transition edge exists between these statuses."""


class UnauthorizedTransition(TransitionError):
    """An otherwise valid transition was attempted by its non-owning module."""


# (source status, destination status): ONLY module allowed to make this change.
TRANSITIONS: dict[tuple[IssueStatus, IssueStatus], Module] = {
    (IssueStatus.REPORTED, IssueStatus.VALIDATED): Module.VALIDATION,
    (IssueStatus.REPORTED, IssueStatus.MERGED): Module.VALIDATION,
    (IssueStatus.REPORTED, IssueStatus.REJECTED): Module.VALIDATION,
    (IssueStatus.VALIDATED, IssueStatus.PRIORITIZED): Module.PRIORITY,
    (IssueStatus.PRIORITIZED, IssueStatus.ASSIGNED): Module.WORK_ORDERS,
    (IssueStatus.ASSIGNED, IssueStatus.IN_PROGRESS): Module.WORK_ORDERS,
    (IssueStatus.IN_PROGRESS, IssueStatus.COMPLETED): Module.WORK_ORDERS,
    (IssueStatus.COMPLETED, IssueStatus.CLOSED): Module.REPORTS,
    (IssueStatus.COMPLETED, IssueStatus.REOPENED): Module.REPORTS,
    (IssueStatus.REOPENED, IssueStatus.PRIORITIZED): Module.PRIORITY,
    (IssueStatus.PRIORITIZED, IssueStatus.ESCALATED): Module.PRIORITY,
    (IssueStatus.ASSIGNED, IssueStatus.ESCALATED): Module.PRIORITY,
    (IssueStatus.IN_PROGRESS, IssueStatus.ESCALATED): Module.PRIORITY,
    (IssueStatus.ESCALATED, IssueStatus.ASSIGNED): Module.WORK_ORDERS,
    (IssueStatus.ESCALATED, IssueStatus.IN_PROGRESS): Module.WORK_ORDERS,
    (IssueStatus.ESCALATED, IssueStatus.COMPLETED): Module.WORK_ORDERS,
}

# Event names permitted by the events.event_name CHECK constraint.
EVENT_NAMES: dict[tuple[IssueStatus, IssueStatus], str] = {
    (IssueStatus.REPORTED, IssueStatus.VALIDATED): "IssueValidated",
    (IssueStatus.REPORTED, IssueStatus.MERGED): "IssueDuplicateDetected",
    (IssueStatus.REPORTED, IssueStatus.REJECTED): "ReportRejected",
    (IssueStatus.VALIDATED, IssueStatus.PRIORITIZED): "IssuePrioritized",
    (IssueStatus.PRIORITIZED, IssueStatus.ASSIGNED): "WorkOrderCreated",
    (IssueStatus.ASSIGNED, IssueStatus.IN_PROGRESS): "WorkOrderStatusChanged",
    (IssueStatus.IN_PROGRESS, IssueStatus.COMPLETED): "RepairCompleted",
    (IssueStatus.COMPLETED, IssueStatus.CLOSED): "IssueClosed",
    (IssueStatus.COMPLETED, IssueStatus.REOPENED): "RepairDisputed",
    (IssueStatus.REOPENED, IssueStatus.PRIORITIZED): "IssuePrioritized",
    (IssueStatus.PRIORITIZED, IssueStatus.ESCALATED): "DeadlineMissed",
    (IssueStatus.ASSIGNED, IssueStatus.ESCALATED): "DeadlineMissed",
    (IssueStatus.IN_PROGRESS, IssueStatus.ESCALATED): "DeadlineMissed",
    (IssueStatus.ESCALATED, IssueStatus.ASSIGNED): "WorkOrderCreated",
    (IssueStatus.ESCALATED, IssueStatus.IN_PROGRESS): "WorkOrderStatusChanged",
    (IssueStatus.ESCALATED, IssueStatus.COMPLETED): "RepairCompleted",
}


def validate_transition(current: IssueStatus | str, target: IssueStatus | str,
                        module: Module | str) -> str:
    """Return event name for an allowed, owned transition; otherwise raise.

    Unknown values raise ValueError. An attempted no-op is illegal; the caller must
    not create a second event or timeline entry for an unchanged status.
    """
    current, target, module = IssueStatus(current), IssueStatus(target), Module(module)
    owner = TRANSITIONS.get((current, target))
    if owner is None:
        raise IllegalTransition(f"Illegal issue transition: {current.value} -> {target.value}")
    if owner != module:
        raise UnauthorizedTransition(
            f"{module.value} cannot move {current.value} -> {target.value}; "
            f"owner is {owner.value}"
        )
    return EVENT_NAMES[(current, target)]
