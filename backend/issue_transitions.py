"""Transactional PostgreSQL adapter for SF-06 issue status changes.

Call from the owning module's event handler. Do not expose a module parameter from
an untrusted public HTTP request; the server determines the module identity.
"""
import json
from dataclasses import dataclass
from uuid import UUID, uuid4

from state_machine import IssueStatus, Module, validate_transition


class IssueNotFound(LookupError):
    """The requested issue does not exist."""


class StaleTransition(ValueError):
    """The caller's expected status differs from the committed DB status."""


class InvalidTransitionData(ValueError):
    """Required transition-specific data is missing or inconsistent."""


@dataclass(frozen=True)
class TransitionResult:
    issue_id: UUID
    from_status: IssueStatus
    to_status: IssueStatus
    event_id: UUID
    event_name: str


def transition_issue(conn, *, issue_id: UUID, to_status: IssueStatus | str,
                     module: Module | str, correlation_id: UUID,
                     expected_status: IssueStatus | str | None = None,
                     actor_id: UUID | None = None,
                     causation_id: UUID | None = None,
                     merged_into_id: UUID | None = None,
                     payload: dict | None = None) -> TransitionResult:
    """Update issue and create an event + history atomically on a DB connection.

    Locks the issue row to serialize concurrent transitions. The DB trigger writes
    issue_status_history, linked to the inserted event via SET LOCAL app.event_id.
    The connection must be used with a transactional, trusted module identity.

    The caller must publish the stored event to RabbitMQ *after commit*, ideally via
    a durable outbox dispatcher; this function does not claim broker delivery.
    """
    target = IssueStatus(to_status)
    owner_module = Module(module)
    if conn.autocommit:
        raise ValueError("transition_issue requires a non-autocommit connection")
    with conn.transaction():
        with conn.cursor() as cursor:
            cursor.execute("SELECT status, merged_into_id FROM issues WHERE issue_id = %s FOR UPDATE", (issue_id,))
            row = cursor.fetchone()
            if row is None:
                raise IssueNotFound(f"Issue {issue_id} not found")
            current = IssueStatus(row[0])
            if expected_status is not None and current != IssueStatus(expected_status):
                raise StaleTransition(f"Expected {expected_status}, actual {current.value}")
            event_name = validate_transition(current, target, owner_module)
            if target == IssueStatus.MERGED:
                if merged_into_id is None or merged_into_id == issue_id:
                    raise InvalidTransitionData("Merging requires a different merged_into_id")
            elif merged_into_id is not None:
                raise InvalidTransitionData("merged_into_id is only accepted for merged status")
            event_id = uuid4()
            event_payload = dict(payload or {})
            event_payload.update({"from_status": current.value, "to_status": target.value})
            cursor.execute(
                """INSERT INTO events (event_id, event_name, issue_id, producer,
                                       actor_id, payload, correlation_id, causation_id)
                   VALUES (%s, %s, %s, %s, %s, %s::jsonb, %s, %s)""",
                (event_id, event_name, issue_id, owner_module.value, actor_id,
                 json.dumps(event_payload), correlation_id, causation_id),
            )
            cursor.execute("SELECT set_config('app.module', %s, true)", (owner_module.value,))
            cursor.execute("SELECT set_config('app.event_id', %s, true)", (str(event_id),))
            if target == IssueStatus.MERGED:
                cursor.execute(
                    "UPDATE issues SET status = %s, merged_into_id = %s WHERE issue_id = %s",
                    (target.value, merged_into_id, issue_id),
                )
            else:
                cursor.execute(
                    """UPDATE issues SET status = %s,
                         is_escalated = CASE WHEN %s = 'escalated' THEN TRUE ELSE is_escalated END,
                         reopen_count = reopen_count + CASE WHEN %s = 'reopened' THEN 1 ELSE 0 END
                       WHERE issue_id = %s""",
                    (target.value, target.value, target.value, issue_id),
                )
            # Prevent the transaction-local identity leaking to later statements in
            # a surrounding transaction; no more updates should use the old identity.
            cursor.execute("SELECT set_config('app.module', '', true)")
            cursor.execute("SELECT set_config('app.event_id', '', true)")
    return TransitionResult(issue_id, current, target, event_id, event_name)
