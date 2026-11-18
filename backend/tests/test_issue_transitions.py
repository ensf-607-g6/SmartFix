"""Adapter-level tests without external database; PG integration remains separate."""
from contextlib import contextmanager
from pathlib import Path
from uuid import uuid4
import sys

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from issue_transitions import (InvalidTransitionData, IssueNotFound,
                               StaleTransition, transition_issue)
from state_machine import IllegalTransition, UnauthorizedTransition


class FakeCursor:
    def __init__(self, conn):
        self.conn = conn

    def __enter__(self):
        return self

    def __exit__(self, *_):
        return False

    def execute(self, statement, params=None):
        self.conn.statements.append((statement, params))

    def fetchone(self):
        return self.conn.issue_row


class FakeConnection:
    autocommit = False

    def __init__(self, issue_row=("reported", None)):
        self.issue_row = issue_row
        self.statements = []
        self.committed = False
        self.rolled_back = False

    def cursor(self):
        return FakeCursor(self)

    @contextmanager
    def transaction(self):
        try:
            yield
            self.committed = True
        except Exception:
            self.rolled_back = True
            raise


def test_valid_transition_persists_event_then_updates_issue():
    conn = FakeConnection()
    issue_id = uuid4()
    correlation_id = uuid4()
    result = transition_issue(conn, issue_id=issue_id, to_status="validated",
                              module="validation", correlation_id=correlation_id,
                              expected_status="reported")
    assert result.event_name == "IssueValidated"
    sqls = [stmt for stmt, _ in conn.statements]
    assert "FOR UPDATE" in sqls[0]
    assert sqls.index(next(s for s in sqls if "INSERT INTO events" in s)) < sqls.index(
        next(s for s in sqls if "UPDATE issues" in s))
    assert conn.committed and not conn.rolled_back
    assert any("app.module" in stmt for stmt in sqls)
    assert any("app.event_id" in stmt for stmt in sqls)


def test_illegal_transition_leaves_database_unchanged():
    conn = FakeConnection()
    with pytest.raises(IllegalTransition):
        transition_issue(conn, issue_id=uuid4(), to_status="closed",
                         module="reports", correlation_id=uuid4())
    assert conn.rolled_back
    assert not any("INSERT INTO events" in s or "UPDATE issues" in s for s, _ in conn.statements)


def test_wrong_module_cannot_modify_issue():
    conn = FakeConnection()
    with pytest.raises(UnauthorizedTransition):
        transition_issue(conn, issue_id=uuid4(), to_status="validated",
                         module="reports", correlation_id=uuid4())
    assert not any("UPDATE issues" in s for s, _ in conn.statements)


def test_stale_transition():
    conn = FakeConnection()
    with pytest.raises(StaleTransition):
        transition_issue(conn, issue_id=uuid4(), to_status="validated", module="validation",
                         correlation_id=uuid4(), expected_status="completed")


def test_missing_issue():
    conn = FakeConnection(None)
    with pytest.raises(IssueNotFound):
        transition_issue(conn, issue_id=uuid4(), to_status="validated",
                         module="validation", correlation_id=uuid4())


def test_merge_requires_target_issue():
    conn = FakeConnection()
    with pytest.raises(InvalidTransitionData):
        transition_issue(conn, issue_id=uuid4(), to_status="merged",
                         module="validation", correlation_id=uuid4())


def test_merge_uses_target_issue():
    conn = FakeConnection()
    target = uuid4()
    transition_issue(conn, issue_id=uuid4(), to_status="merged", module="validation",
                     correlation_id=uuid4(), merged_into_id=target)
    assert any("merged_into_id = %s" in s and params[1] == target
               for s, params in conn.statements)


def test_autocommit_rejected():
    conn = FakeConnection()
    conn.autocommit = True
    with pytest.raises(ValueError, match="non-autocommit"):
        transition_issue(conn, issue_id=uuid4(), to_status="validated",
                         module="validation", correlation_id=uuid4())
