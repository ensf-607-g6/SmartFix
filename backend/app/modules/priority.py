"""Priority module (FR-5, FR-9, FR-11). Stores severity + capped duplicate bonus;
aging and the escalation boost are added at read time by v_issue_queue."""
from uuid import UUID

from ..db import Transaction
from ..events.consumer import EventConsumer
from ..events.models import (DeadlineMissed, IssueDuplicateDetected, IssuePrioritized, IssueValidated,
                             RepairDisputed)

MODULE = "priority"
ESCALATABLE = ("prioritized", "assigned", "in_progress")


class PriorityModule(EventConsumer):
    name = MODULE
    subscriptions = [IssueValidated, IssueDuplicateDetected, RepairDisputed, DeadlineMissed]

    async def handle(self, event, tx):
        if isinstance(event, IssueValidated):
            issue_id, reason = event.issue_id, "validated"
            await self.recalculate(tx, issue_id, reason)
            await tx.execute("UPDATE issues SET status = 'prioritized' WHERE issue_id = $1 AND status = 'validated'",
                             issue_id)
        elif isinstance(event, IssueDuplicateDetected):
            issue_id, reason = event.existing_issue_id, "duplicate"
            await tx.execute("UPDATE issues SET duplicate_count = duplicate_count + 1 WHERE issue_id = $1", issue_id)
            await self.recalculate(tx, issue_id, reason)
        elif isinstance(event, RepairDisputed):
            issue_id, reason = event.issue_id, "disputed"
            await self.recalculate(tx, issue_id, reason)
            await tx.execute("UPDATE issues SET status = 'prioritized' WHERE issue_id = $1 AND status = 'reopened'",
                             issue_id)
        elif isinstance(event, DeadlineMissed):
            issue_id, reason = event.issue_id, "deadline_missed"
            await tx.execute(
                """UPDATE issues SET is_escalated = TRUE,
                          status = CASE WHEN status = ANY($2::issue_status[]) THEN 'escalated' ELSE status END
                   WHERE issue_id = $1""", issue_id, list(ESCALATABLE))
            await self.recalculate(tx, issue_id, reason)
        else:
            return []
        score = await tx.fetchval("SELECT priority_score FROM v_issue_queue WHERE issue_id = $1", issue_id)
        if score is None:
            return []
        return [event.follow(IssuePrioritized, MODULE, issue_id=issue_id, report_id=None,
                             priority_score=round(score, 2), reason=reason)]

    async def recalculate(self, tx: Transaction, issue_id: UUID, reason: str):
        issue = await tx.fetchrow(
            "SELECT severity, duplicate_count, reopen_count FROM issues WHERE issue_id = $1 FOR UPDATE", issue_id)
        cfg = await tx.fetchrow("SELECT * FROM priority_config")
        severity_part = (issue["severity"] or 0) * cfg["severity_weight"]
        duplicate_part = min(issue["duplicate_count"] * cfg["duplicate_bonus_each"], cfg["duplicate_bonus_cap"])
        # FR-9 "reopened with increased priority": each dispute is worth one severity level.
        reopen_part = issue["reopen_count"] * cfg["severity_weight"]
        base = await tx.fetchval("SELECT compute_priority_base($1, $2)",
                                 issue["severity"] or 0, issue["duplicate_count"])
        total = base + reopen_part
        await tx.execute("UPDATE issues SET priority_base = $2 WHERE issue_id = $1", issue_id, total)
        await tx.execute(
            """INSERT INTO priority_history (issue_id, severity_part, duplicate_part, total_base, reason)
               VALUES ($1, $2, $3, $4, $5)""", issue_id, severity_part, duplicate_part, total, reason)
        return total
