"""End-to-end flows through the API and the event bus (SD-1 to SD-4)."""
import asyncpg
import pytest

from app.events.models import IssueValidated
from app.modules.reports import auto_close_unconfirmed
from app.modules.scheduler import check_overdue


async def test_happy_path_report_to_closed(api, ctx):
    """FR-1, FR-2, FR-5 to FR-8, FR-10, FR-12, FR-14, FR-15."""
    sub = await api.submit()
    issue = await api.issue(sub["issue_id"])
    assert issue["status"] == "assigned"
    assert issue["severity"] == 4
    assert float(issue["priority_base"]) == 40
    wo = issue["work_orders"][0]
    assert wo["crew_name"] == "Roads Crew North"       # NW pin, pothole specialty

    await api.start_and_complete(wo["work_order_id"])
    issue = await api.issue(sub["issue_id"])
    assert issue["status"] == "completed"
    assert issue["work_orders"][0]["verdict"] == "repaired"
    conf_id = issue["work_orders"][0]["confirmation_id"]
    assert conf_id

    res = await api.as_("resident@smartfix.dev")
    r = await api.client.post(f"/confirmations/{conf_id}", headers=res, json={"action": "confirm"})
    assert r.status_code == 200
    await ctx.bus.drain()
    assert (await api.issue(sub["issue_id"]))["status"] == "closed"

    assert await ctx.db.fetchval("SELECT count(*) FROM repair_metrics") == 1
    names = [r["event_name"] for r in await ctx.db.fetch(
        "SELECT event_name FROM events WHERE issue_id = $1 ORDER BY occurred_at", sub["issue_id"])]
    assert names == ["IssueReported", "IssueValidated", "IssuePrioritized", "WorkOrderCreated",
                     "WorkOrderStatusChanged", "RepairCompleted", "IssueClosed"]
    inbox = (await api.client.get("/notifications", headers=res)).json()
    assert len(inbox["items"]) == 5
    crew_inbox = (await api.client.get("/notifications", headers=await api.as_("crew.north@smartfix.dev"))).json()
    assert "New work order" in crew_inbox["items"][0]["message"]


async def test_duplicate_within_50m_is_merged(api, ctx):
    """FR-3: the second report joins the first issue, priority rises, no second crew."""
    first = await api.submit()
    second = await api.submit(email="resident2@smartfix.dev", lat=51.07915, lng=-114.13005)   # ~17 m away
    merged = await ctx.db.fetchrow("SELECT status::text AS status, merged_into_id FROM issues WHERE issue_id = $1",
                                   second["issue_id"])
    assert merged["status"] == "merged" and str(merged["merged_into_id"]) == first["issue_id"]
    issue = await api.issue(first["issue_id"])
    assert issue["duplicate_count"] == 1
    assert float(issue["priority_base"]) == 42
    assert len(issue["reports"]) == 2 and len(issue["work_orders"]) == 1
    mine = (await api.client.get("/reports/mine", headers=await api.as_("resident2@smartfix.dev"))).json()
    assert mine[0]["report_status"] == "duplicate" and mine[0]["issue_status"] == "assigned"


async def test_far_away_or_different_problem_is_not_merged(api, ctx):
    first = await api.submit()
    far = await api.submit(lat=51.0900, lng=-114.1300)            # > 1 km away
    ctx.ai.is_match = False
    near_but_different = await api.submit(lat=51.07915, lng=-114.13005)
    for sub in (far, near_but_different):
        assert (await api.issue(sub["issue_id"]))["status"] == "assigned"
    assert (await api.issue(first["issue_id"]))["duplicate_count"] == 0


async def test_low_confidence_goes_to_review_and_is_approved(api, ctx):
    """FR-4 approve path."""
    ctx.ai.confidence = 0.3
    sub = await api.submit()
    op = await api.as_("operator@smartfix.dev")
    queue = (await api.client.get("/review", headers=op)).json()
    assert len(queue) == 1 and queue[0]["reason"] == "low_confidence"
    assert (await api.issue(sub["issue_id"]))["status"] == "reported"
    r = await api.client.post(f"/review/{queue[0]['review_id']}", headers=op, json={"approve": True, "severity": 5})
    assert r.status_code == 200
    await ctx.bus.drain()
    issue = await api.issue(sub["issue_id"])
    assert issue["status"] == "assigned" and issue["severity"] == 5
    assert (await api.client.get("/review", headers=op)).json() == []


async def test_not_infrastructure_is_rejected(api, ctx):
    """FR-4 reject path, ReportRejected reaches the resident."""
    ctx.ai.is_infrastructure = False
    sub = await api.submit()
    op = await api.as_("operator@smartfix.dev")
    item = (await api.client.get("/review", headers=op)).json()[0]
    assert item["reason"] == "not_infrastructure"
    r = await api.client.post(f"/review/{item['review_id']}", headers=op, json={"approve": False, "notes": "A cat"})
    assert r.status_code == 200
    await ctx.bus.drain()
    assert (await api.issue(sub["issue_id"]))["status"] == "rejected"
    inbox = (await api.client.get("/notifications", headers=await api.as_("resident@smartfix.dev"))).json()
    assert "A cat" in inbox["items"][0]["message"]


async def test_model_offline_sends_report_to_review(api, ctx):
    ctx.ai.down = True
    sub = await api.submit()
    row = await ctx.db.fetchrow("SELECT reason::text AS reason FROM review_queue")
    assert row["reason"] == "low_confidence"
    assert (await api.issue(sub["issue_id"]))["status"] == "reported"


async def test_dispute_reopens_with_higher_priority_and_new_work_order(api, ctx):
    """FR-9."""
    sub = await api.submit()
    first_wo = (await api.issue(sub["issue_id"]))["work_orders"][0]["work_order_id"]
    await api.start_and_complete(first_wo)
    conf_id = (await api.issue(sub["issue_id"]))["work_orders"][0]["confirmation_id"]
    r = await api.client.post(f"/confirmations/{conf_id}", headers=await api.as_("resident@smartfix.dev"),
                              json={"action": "dispute", "reason": "Still a hole on the left"})
    assert r.status_code == 200
    await ctx.bus.drain()
    issue = await api.issue(sub["issue_id"])
    assert issue["status"] == "assigned" and issue["reopen_count"] == 1
    assert float(issue["priority_base"]) == 50
    assert len(issue["work_orders"]) == 2
    assert issue["work_orders"][0]["work_order_id"] != first_wo
    assert issue["work_orders"][1]["status"] == "completed"


async def test_missed_deadline_escalates_alerts_supervisor_and_can_be_reassigned(api, ctx):
    """FR-11 and FR-13 reassign."""
    sub = await api.submit()
    wo = (await api.issue(sub["issue_id"]))["work_orders"][0]["work_order_id"]
    await ctx.db.fetchval("UPDATE work_orders SET deadline_at = now() - interval '1 minute' WHERE work_order_id = $1", wo)
    assert await check_overdue(ctx) == 1
    await ctx.bus.drain()
    issue = await api.issue(sub["issue_id"])
    assert issue["status"] == "escalated" and issue["is_escalated"]
    assert float(issue["priority_score"]) > 1000
    sup = (await api.client.get("/notifications", headers=await api.as_("supervisor@smartfix.dev"))).json()
    assert sup["items"] and "missed its deadline" in sup["items"][0]["message"]
    assert await check_overdue(ctx) == 0                               # only once

    op = await api.as_("operator@smartfix.dev")
    south = await ctx.db.fetchval("SELECT crew_id FROM crews WHERE name = 'Roads Crew South'")
    r = await api.client.post(f"/work-orders/{wo}/reassign", headers=op, json={"crew_id": south})
    assert r.status_code == 200, r.text
    await ctx.bus.drain()
    issue = await api.issue(sub["issue_id"])
    assert issue["status"] == "assigned" and issue["work_orders"][0]["crew_name"] == "Roads Crew South"
    assert issue["is_escalated"]                                       # stays on top until closed
    south_orders = (await api.client.get("/crew/work-orders", headers=await api.as_("crew.south@smartfix.dev"))).json()
    assert [o["work_order_id"] for o in south_orders] == [wo]


async def test_unanswered_confirmation_auto_closes_after_7_days(api, ctx):
    """FR-10."""
    sub = await api.submit()
    await api.start_and_complete((await api.issue(sub["issue_id"]))["work_orders"][0]["work_order_id"])
    assert await auto_close_unconfirmed(ctx) == 0
    await ctx.db.fetchval("UPDATE resident_confirmations SET auto_close_at = now() - interval '1 minute'")
    assert await auto_close_unconfirmed(ctx) == 1
    await ctx.bus.drain()
    assert (await api.issue(sub["issue_id"]))["status"] == "closed"
    closed_by = await ctx.db.fetchval("SELECT payload->>'closed_by' FROM events WHERE event_name = 'IssueClosed'")
    assert closed_by == "auto_closed"


async def test_same_event_delivered_twice_is_processed_once(api, ctx):
    """NFR-4 idempotency."""
    ctx.ai.confidence = 0.3                    # park the issue in review so nothing else moves it
    sub = await api.submit()
    async with ctx.db.transaction("validation") as tx:
        await tx.execute("UPDATE issues SET status = 'validated', severity = 3 WHERE issue_id = $1", sub["issue_id"])
    event = IssueValidated(issue_id=sub["issue_id"], report_id=sub["report_id"], producer="validation",
                           correlation_id=sub["issue_id"], problem_type="pothole", severity=3, confidence=0.9)
    async with ctx.db.transaction("validation") as tx:
        await ctx.store.save(event, tx)
    from app.modules.priority import PriorityModule
    priority = PriorityModule(ctx)
    await priority.on_message(event.event_name, event.to_message())
    await priority.on_message(event.event_name, event.to_message())
    assert await ctx.db.fetchval("SELECT count(*) FROM priority_history WHERE issue_id = $1", sub["issue_id"]) == 1


async def test_only_owning_module_may_change_status(api, ctx):
    """NFR-4 ownership: the database refuses an out-of-turn transition."""
    ctx.ai.confidence = 0.3
    sub = await api.submit()
    with pytest.raises(asyncpg.CheckViolationError):
        async with ctx.db.transaction("reports") as tx:
            await tx.execute("UPDATE issues SET status = 'validated' WHERE issue_id = $1", sub["issue_id"])


async def test_failing_consumer_dead_letters_after_three_attempts(ctx):
    """NFR-3."""
    attempts = []

    async def broken(event_name, body):
        attempts.append(1)
        raise RuntimeError("boom")

    await ctx.bus.subscribe("analytics", ["IssueClosed"], broken)
    from uuid import uuid4

    from app.events.models import IssueClosed
    event = IssueClosed(producer="reports", correlation_id=uuid4(), work_order_id=uuid4(), closed_by="confirmed")
    async with ctx.db.transaction("reports") as tx:
        await ctx.store.save(event, tx)
    await ctx.bus.publish(event)
    await ctx.bus.drain()
    assert len(attempts) == 3
    row = await ctx.db.fetchrow("SELECT consumer::text AS consumer, attempts, event_id FROM dead_letter_events")
    assert row["consumer"] == "analytics" and row["attempts"] == 3 and row["event_id"] == event.event_id
