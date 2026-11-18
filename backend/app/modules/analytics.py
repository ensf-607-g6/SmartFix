"""Analytics module (FR-15): one repair_metrics row per completed repair."""
from ..events.consumer import EventConsumer
from ..events.models import RepairCompleted

MODULE = "analytics"


class AnalyticsModule(EventConsumer):
    name = MODULE
    subscriptions = [RepairCompleted]

    async def handle(self, event, tx):
        await tx.execute(
            """INSERT INTO repair_metrics (work_order_id, issue_id, problem_type_id, severity, area_id,
                                           reported_at, completed_at, repair_seconds, met_deadline)
               SELECT w.work_order_id, i.issue_id, i.problem_type_id, COALESCE(i.severity, 3), i.area_id,
                      i.created_at, w.completed_at,
                      GREATEST(0, EXTRACT(EPOCH FROM (w.completed_at - i.created_at)))::int,
                      w.completed_at <= w.deadline_at
               FROM work_orders w JOIN issues i ON i.issue_id = w.issue_id
               WHERE w.work_order_id = $1 AND w.completed_at IS NOT NULL
               ON CONFLICT (work_order_id) DO NOTHING""", event.work_order_id)
        return []
