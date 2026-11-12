# SF-06: Issue status state machine with per-module ownership

The authoritative transition diagram is
`docs/System Design/UML Diagrams/source/01b_uml_state_issue.puml`.
The schema and `status_transitions` seed are in
`docs/System Design/DB Design/smartfix_schema_v2.sql`.

## Design

`state_machine.py` validates the legal transition edge and owning module.
`issue_transitions.py` performs a locked, transactional PostgreSQL update:

1. Lock the issue row (`SELECT ... FOR UPDATE`).
2. Optionally compare its actual status with the consumer's expected status.
3. Reject illegal or unauthorized transitions before mutation.
4. Insert a named domain event into `events`.
5. Set `app.module` and `app.event_id` as transaction-local PostgreSQL settings.
6. Update `issues`, allowing the pre-existing database trigger to verify ownership and
   insert `issue_status_history` with the new `event_id`.
7. Commit as a unit or roll back as a unit.

`rejected` and `merged` are additional terminal statuses already defined by the
v2 database design. `merged` requires a different `merged_into_id`.

## Usage from a trusted module handler

```python
from uuid import UUID
import psycopg
from issue_transitions import transition_issue

with psycopg.connect(DB_DSN) as conn:
    result = transition_issue(
        conn,
        issue_id=UUID("00000000-0000-0000-0000-000000000001"),
        to_status="prioritized",
        module="priority",  # derived from the server-side handler, NOT request JSON
        correlation_id=UUID("00000000-0000-0000-0000-000000000002"),
        expected_status="validated",
    )
# committed here; enqueue the persisted event for delivery.
```

**Security:** Module ownership is a service identity, not an arbitrary public input.
A client must never be allowed to choose its `module` or database session settings.
For strict database-level trust boundaries, use separate DB roles / stored procedures
that prevent modules from impersonating one another; the existing `app.module` trigger
by itself trusts whoever is able to set the database session variable.

**Event delivery:** A row in `events` does not prove RabbitMQ publication. Add a
transactional outbox and dispatcher (or integrate with the project's chosen reliable
event publishing mechanism) when the event bus is implemented. In the meantime,
the atomic database event log satisfies the issue's recorded-transitions requirement.

**Business prerequisites:** This function enforces status ownership, not all business
conditions (photo validation, crew assignment, resident confirmation, etc.). Owning
module handlers must validate those before calling it.

## Tests

From the repository root:

```bash
python -m pip install -r backend/requirements.txt
python -m pytest backend/tests/test_state_machine.py -v
```

Tests cover all 16 allowed transitions, every other module being denied, every
illegal status pair, terminal states, no-ops, and Python/SQL consistency.
Actual DB trigger/transaction behavior still needs an integration test against a
PostgreSQL instance initialized with `smartfix_schema_v2.sql` (includes PostGIS).
