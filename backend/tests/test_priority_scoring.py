import os
from decimal import Decimal

import psycopg
import pytest


@pytest.fixture
def db():
    """Connect to the isolated SmartFix test database."""
    url = os.getenv(
        "TEST_DATABASE_URL",
        "postgresql://smartfix:smartfix_test@127.0.0.1:5434/smartfix_test",
    )
    conn = psycopg.connect(url, connect_timeout=5)
    try:
        yield conn
    finally:
        conn.rollback()
        conn.close()


@pytest.mark.parametrize(
    "severity,duplicates,expected",
    [
        (3, 0, Decimal("30")),
        (3, 2, Decimal("34")),
        (3, 5, Decimal("40")),
        (3, 10, Decimal("40")),
        (5, 100, Decimal("60")),
    ],
)
def test_duplicate_bonus_is_capped(db, severity, duplicates, expected):
    """Duplicate reports cannot increase the bonus beyond its cap."""
    with db.cursor() as cursor:
        cursor.execute(
            "SELECT compute_priority_base(%s, %s)",
            (severity, duplicates),
        )
        actual = cursor.fetchone()[0]

    assert actual == expected


def test_older_issues_receive_higher_priority(db):
    """An older issue should receive more aging points."""
    with db.cursor() as cursor:
        cursor.execute(
            """
            INSERT INTO issues (
                problem_type_id, location, severity,
                priority_base, created_at
            )
            VALUES (
                (SELECT problem_type_id FROM problem_types LIMIT 1),
                ST_SetSRID(ST_MakePoint(-114.07, 51.05), 4326)::geography,
                3, 30, now() - INTERVAL '10 days'
            )
            RETURNING issue_id
            """
        )
        older_id = cursor.fetchone()[0]

        cursor.execute(
            """
            INSERT INTO issues (
                problem_type_id, location, severity,
                priority_base, created_at
            )
            VALUES (
                (SELECT problem_type_id FROM problem_types LIMIT 1),
                ST_SetSRID(ST_MakePoint(-114.07, 51.05), 4326)::geography,
                3, 30, now() - INTERVAL '2 days'
            )
            RETURNING issue_id
            """
        )
        newer_id = cursor.fetchone()[0]

        cursor.execute(
            """
            SELECT issue_id, priority_score
            FROM v_issue_queue
            WHERE issue_id IN (%s, %s)
            """,
            (older_id, newer_id),
        )
        scores = dict(cursor.fetchall())

    assert scores[older_id] > scores[newer_id]
    assert abs((scores[older_id] - scores[newer_id]) - Decimal("12")) < Decimal("0.01")

def test_priority_queue_orders_highest_score_first(db):
    """Higher-scoring issues should rank before lower-scoring issues."""
    with db.cursor() as cursor:
        cursor.execute(
            """
            INSERT INTO issues (
                problem_type_id, location, severity,
                priority_base, created_at
            )
            VALUES
                (
                    (SELECT problem_type_id FROM problem_types LIMIT 1),
                    ST_SetSRID(ST_MakePoint(-114.07, 51.05), 4326)::geography,
                    1, 10, now()
                ),
                (
                    (SELECT problem_type_id FROM problem_types LIMIT 1),
                    ST_SetSRID(ST_MakePoint(-114.07, 51.05), 4326)::geography,
                    5, 50, now()
                )
            RETURNING issue_id
            """
        )
        inserted_ids = [row[0] for row in cursor.fetchall()]

        cursor.execute(
            """
            SELECT issue_id, priority_score
            FROM v_issue_queue
            WHERE issue_id = ANY(%s)
            ORDER BY priority_score DESC
            """,
            (inserted_ids,),
        )
        results = cursor.fetchall()

    assert len(results) == 2
    assert results[0][1] > results[1][1]
    assert results[0][1] >= Decimal("50")