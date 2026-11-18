"""Validation module: classifies photos (FR-2), merges duplicates within 50 m (FR-3),
sends unsure reports to operator review (FR-4) and checks repairs (FR-8)."""
import logging
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from ..ai.ollama_client import Classification, ModelUnavailable
from ..auth import STAFF, CurrentUser, require
from ..context import AppContext, get_ctx
from ..db import Transaction
from ..events.consumer import EventConsumer
from ..events.models import (DomainEvent, IssueDuplicateDetected, IssueNeedsReview, IssueReported,
                             IssueValidated, RepairCompleted, ReportRejected)

log = logging.getLogger("smartfix.validation")
MODULE = "validation"
MAX_CANDIDATES = 3


async def _type_id(tx: Transaction, code: str) -> int:
    return await tx.fetchval("SELECT problem_type_id FROM problem_types WHERE code = $1", code)


async def mark_validated(tx: Transaction, cause: DomainEvent, issue_id: UUID, report_id: UUID,
                         problem_type: str, severity: int, confidence: float,
                         approved_by: UUID | None = None) -> IssueValidated:
    await tx.execute(
        "UPDATE issues SET status = 'validated', severity = $2, problem_type_id = $3 WHERE issue_id = $1",
        issue_id, severity, await _type_id(tx, problem_type))
    await tx.execute("UPDATE reports SET status = 'validated' WHERE report_id = $1", report_id)
    return cause.follow(IssueValidated, MODULE, issue_id=issue_id, report_id=report_id,
                        actor_id=approved_by, problem_type=problem_type, severity=severity,
                        confidence=round(confidence, 3), approved_by=approved_by)


class ValidationModule(EventConsumer):
    name = MODULE
    subscriptions = [IssueReported, RepairCompleted]
    prefetch = 1          # one report at a time, so two near-simultaneous duplicates can't merge into each other

    async def handle(self, event, tx):
        if isinstance(event, IssueReported):
            return await self.validate(event, tx)
        if isinstance(event, RepairCompleted):
            await self.verify_repair(event, tx)
        return []

    async def classify(self, photo: bytes, description: str, chosen: str) -> Classification:
        try:
            return await self.ctx.ai.classify(photo, description, chosen)
        except ModelUnavailable as exc:
            # No model answered: an operator decides instead (FR-4).
            return Classification(model_name="unavailable", latency_ms=0, raw={"error": str(exc)[:500]},
                                  problem_type=chosen, severity=3, confidence=0.0, is_infrastructure=True)

    async def validate(self, event: IssueReported, tx: Transaction) -> list[DomainEvent]:
        report = await tx.fetchrow(
            """SELECT r.report_id, r.issue_id, r.status::text AS status, r.description, p.storage_path,
                      pt.code AS chosen_type
               FROM reports r JOIN photos p ON p.photo_id = r.photo_id
               JOIN problem_types pt ON pt.problem_type_id = r.problem_type_id
               WHERE r.report_id = $1""", event.report_id)
        if not report or report["status"] != "submitted":
            return []
        photo = self.ctx.storage.load(report["storage_path"])
        c = await self.classify(photo, report["description"] or "", report["chosen_type"])
        detected_id = await _type_id(tx, c.problem_type)
        await tx.execute(
            """INSERT INTO validations (report_id, detected_type_id, severity, confidence, is_infrastructure,
                                        model_name, raw_output, latency_ms)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8)""",
            report["report_id"], detected_id, c.severity, round(c.confidence, 3), c.is_infrastructure,
            c.model_name, c.raw, c.latency_ms)

        threshold = self.ctx.settings.confidence_threshold
        if not c.is_infrastructure or c.confidence < threshold:
            reason = "not_infrastructure" if not c.is_infrastructure else "low_confidence"
            await tx.execute("UPDATE reports SET status = 'needs_review' WHERE report_id = $1", report["report_id"])
            review_id = await tx.fetchval(
                "INSERT INTO review_queue (report_id, reason) VALUES ($1, $2) RETURNING review_id",
                report["report_id"], reason)
            return [event.follow(IssueNeedsReview, MODULE, review_id=review_id, reason=reason,
                                 confidence=round(c.confidence, 3))]

        merged = await self.find_duplicate(event, tx, report, photo, c, detected_id)
        if merged:
            return [merged]
        return [await mark_validated(tx, event, report["issue_id"], report["report_id"],
                                     c.problem_type, c.severity, c.confidence)]

    async def find_duplicate(self, event, tx, report, photo, c: Classification, type_id: int):
        # Issues still waiting for their own validation are skipped, so a report can only
        # join an issue that has been confirmed as a real problem.
        candidates = await tx.fetch(
            """SELECT f.issue_id, f.distance_m FROM find_nearby_open_issues(
                   (SELECT location FROM reports WHERE report_id = $1), $2, $3) f
               JOIN issues i ON i.issue_id = f.issue_id
               WHERE i.status <> 'reported' ORDER BY f.distance_m LIMIT $4""",
            report["report_id"], type_id, report["issue_id"], MAX_CANDIDATES)
        for cand in candidates:
            path = await tx.fetchval(
                """SELECT p.storage_path FROM reports r JOIN photos p ON p.photo_id = r.photo_id
                   WHERE r.issue_id = $1 ORDER BY r.submitted_at LIMIT 1""", cand["issue_id"])
            try:
                verdict = await self.ctx.ai.compare_reports(self.ctx.storage.load(path), photo,
                                                            cand["distance_m"], c.problem_type)
                is_match, confidence, model = verdict.is_match, verdict.confidence, verdict.model_name
            except ModelUnavailable:
                is_match, confidence, model = False, 0.0, "unavailable"
            await tx.execute(
                """INSERT INTO duplicate_checks (report_id, candidate_issue_id, distance_m, is_match, confidence, model_name)
                   VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (report_id, candidate_issue_id) DO NOTHING""",
                report["report_id"], cand["issue_id"], round(cand["distance_m"], 2), is_match,
                round(confidence, 3), model)
            if is_match and confidence >= self.ctx.settings.confidence_threshold:
                await tx.execute("UPDATE reports SET issue_id = $2, status = 'duplicate' WHERE report_id = $1",
                                 report["report_id"], cand["issue_id"])
                await tx.execute("UPDATE issues SET status = 'merged', merged_into_id = $2 WHERE issue_id = $1",
                                 report["issue_id"], cand["issue_id"])
                return event.follow(IssueDuplicateDetected, MODULE, issue_id=cand["issue_id"],
                                    existing_issue_id=cand["issue_id"], merged_issue_id=report["issue_id"],
                                    distance_m=round(cand["distance_m"], 2))
        return None

    async def verify_repair(self, event: RepairCompleted, tx: Transaction) -> None:
        """FR-8: compare the original photo with the crew's after photo."""
        row = await tx.fetchrow(
            """SELECT (SELECT r.photo_id FROM reports r WHERE r.issue_id = w.issue_id
                       ORDER BY r.submitted_at LIMIT 1) AS before_id,
                      w.after_photo_id AS after_id, pt.code AS problem_type
               FROM work_orders w JOIN issues i ON i.issue_id = w.issue_id
               JOIN problem_types pt ON pt.problem_type_id = i.problem_type_id
               WHERE w.work_order_id = $1""", event.work_order_id)
        if not row or not row["before_id"] or not row["after_id"]:
            return
        paths = dict(await tx.fetch("SELECT photo_id, storage_path FROM photos WHERE photo_id = ANY($1::uuid[])",
                                    [row["before_id"], row["after_id"]]))
        try:
            result = await self.ctx.ai.verify_repair(self.ctx.storage.load(paths[row["before_id"]]),
                                                     self.ctx.storage.load(paths[row["after_id"]]),
                                                     row["problem_type"])
            verdict, confidence, model = result.verdict, result.confidence, result.model_name
        except ModelUnavailable:
            verdict, confidence, model = "unclear", 0.0, "unavailable"
        await tx.execute(
            """INSERT INTO repair_verifications (work_order_id, before_photo_id, after_photo_id, verdict,
                                                 confidence, model_name)
               VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (work_order_id) DO NOTHING""",
            event.work_order_id, row["before_id"], row["after_id"], verdict, round(confidence, 3), model)


# ---------------------------------------------------------------- operator review (FR-4)
router = APIRouter(tags=["validation"])


class ReviewDecision(BaseModel):
    approve: bool
    notes: str | None = Field(None, max_length=1000)
    severity: int | None = Field(None, ge=1, le=5)
    problem_type: str | None = None


@router.post("/review/{review_id}")
async def review_report(review_id: UUID, body: ReviewDecision,
                        user: CurrentUser = Depends(require(*STAFF)),
                        ctx: AppContext = Depends(get_ctx)):
    async with ctx.db.transaction(MODULE) as tx:
        item = await tx.fetchrow(
            """SELECT rq.review_id, rq.reason::text AS reason, rq.decision::text AS decision, r.report_id,
                      r.issue_id, i.status::text AS issue_status, pt.code AS chosen_type,
                      v.severity AS ai_severity, dt.code AS ai_type
               FROM review_queue rq
               JOIN reports r ON r.report_id = rq.report_id
               JOIN issues i ON i.issue_id = r.issue_id
               JOIN problem_types pt ON pt.problem_type_id = r.problem_type_id
               LEFT JOIN LATERAL (SELECT * FROM validations WHERE report_id = r.report_id
                                  ORDER BY created_at DESC LIMIT 1) v ON TRUE
               LEFT JOIN problem_types dt ON dt.problem_type_id = v.detected_type_id
               WHERE rq.review_id = $1 FOR UPDATE OF rq""", review_id)
        if not item:
            raise HTTPException(404, "Review item not found")
        if item["decision"] != "pending" or item["issue_status"] != "reported":
            raise HTTPException(409, "This report has already been reviewed")
        cause_row = await tx.fetchrow(
            """SELECT event_id, correlation_id FROM events WHERE event_name = 'IssueNeedsReview' AND report_id = $1
               ORDER BY occurred_at DESC LIMIT 1""", item["report_id"])
        cause = IssueNeedsReview(event_id=cause_row["event_id"], correlation_id=cause_row["correlation_id"],
                                 issue_id=item["issue_id"], report_id=item["report_id"], producer=MODULE,
                                 review_id=review_id, reason=item["reason"], confidence=0)
        await tx.execute(
            """UPDATE review_queue SET decision = $2, reviewed_by = $3, reviewed_at = now(), notes = $4
               WHERE review_id = $1""",
            review_id, "approved" if body.approve else "rejected", user.user_id, body.notes)
        if body.approve:
            ptype = body.problem_type or item["ai_type"] or item["chosen_type"]
            if not await _type_id(tx, ptype):
                raise HTTPException(422, "Unknown problem category")
            event = await mark_validated(tx, cause, item["issue_id"], item["report_id"], ptype,
                                         body.severity or item["ai_severity"] or 3, 1.0, approved_by=user.user_id)
        else:
            await tx.execute("UPDATE reports SET status = 'rejected' WHERE report_id = $1", item["report_id"])
            await tx.execute("UPDATE issues SET status = 'rejected' WHERE issue_id = $1", item["issue_id"])
            event = cause.follow(ReportRejected, MODULE, actor_id=user.user_id, review_id=review_id,
                                 reason=item["reason"], notes=body.notes)
        await ctx.store.save(event, tx)
    await ctx.bus.publish(event)
    return {"decision": "approved" if body.approve else "rejected"}
