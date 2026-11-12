"""Unit tests for all SF-06 status/ownership rules."""
from pathlib import Path
import re
import sys

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from state_machine import (EVENT_NAMES, TRANSITIONS, IllegalTransition,
                           IssueStatus, Module, UnauthorizedTransition,
                           validate_transition)


@pytest.mark.parametrize("edge,owner", list(TRANSITIONS.items()))
def test_each_permitted_transition_accepts_its_owner(edge, owner):
    assert validate_transition(*edge, owner) == EVENT_NAMES[edge]


@pytest.mark.parametrize("edge,owner", list(TRANSITIONS.items()))
def test_every_other_module_is_rejected(edge, owner):
    for attacker in Module:
        if attacker != owner:
            with pytest.raises(UnauthorizedTransition):
                validate_transition(*edge, attacker)


@pytest.mark.parametrize("source", list(IssueStatus))
def test_no_op_is_illegal(source):
    with pytest.raises(IllegalTransition):
        validate_transition(source, source, Module.REPORTS)


def test_every_unlisted_transition_is_illegal():
    for source in IssueStatus:
        for target in IssueStatus:
            if (source, target) not in TRANSITIONS:
                with pytest.raises(IllegalTransition):
                    validate_transition(source, target, Module.REPORTS)


def test_terminal_states_have_no_outgoing_edges():
    for status in (IssueStatus.CLOSED, IssueStatus.MERGED, IssueStatus.REJECTED):
        assert all(source != status for source, _ in TRANSITIONS)


def test_every_transition_has_named_event():
    assert EVENT_NAMES.keys() == TRANSITIONS.keys()


def _read_repository_schema():
    """Schema lives in the full SmartFix repository, not this patch archive."""
    path = (Path(__file__).resolve().parents[2] /
            "docs/System Design/DB Design/smartfix_schema_v2.sql")
    if not path.exists():
        pytest.skip("Run this repository integration check after copying files into SmartFix")
    return path.read_text()


def test_python_rules_match_seed_sql():
    """Prevent drift between Python rules and PostgreSQL transition ownership."""
    sql = _read_repository_schema()
    block = sql.split("INSERT INTO status_transitions (from_status, to_status, owner_module) VALUES", 1)[1].split(";", 1)[0]
    entries = re.findall(r"\('([a-z_]+)',\s*'([a-z_]+)',\s*'([a-z_]+)'\)", block)
    assert {(IssueStatus(a), IssueStatus(b)): Module(c) for a, b, c in entries} == TRANSITIONS


def test_named_events_exist_in_schema_constraint():
    sql = _read_repository_schema()
    block = sql.split("event_name      TEXT NOT NULL CHECK (event_name IN (", 1)[1].split("))", 1)[0]
    allowed = set(re.findall(r"'([A-Za-z]+)'", block))
    assert set(EVENT_NAMES.values()) <= allowed
