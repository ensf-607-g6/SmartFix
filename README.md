# ENSF-607
SmartFix: Reporting and Repairing Public Infrastructure

# SmartFix backend

One FastAPI app, six event-driven modules (Reports, Validation, Priority, Work Orders, Notifications,
Analytics). Modules don't call each other: they publish/consume events on RabbitMQ.

