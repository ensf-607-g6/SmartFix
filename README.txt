Files:
 backend/state_machine.py                 Allowed status transitions and module ownership
 backend/issue_transitions.py             Transactional transition service for PostgreSQL
 backend/tests/test_state_machine.py      Rule validation tests
 backend/tests/test_issue_transitions.py  Mocked database transition tests
 backend/ISSUE_21.md                      Integration notes and usage
 backend/requirements.txt                 Requirements for this issue (merge with yours)

Test from the SmartFix project root:
 python -m pip install -r backend/requirements.txt
 python -m pytest backend/tests -q

The two SQL synchronization tests skip when this standalone patch is run without
SmartFix's docs/System Design/DB Design/smartfix_schema_v2.sql. They will run
when these files are placed inside the full repository.

Integration with actual PostgreSQL and a message broker is not verified by the unit tests.
