
# SmartFix — Test Plan and Requirements Traceability Matrix

## 1. Purpose

This document defines the testing strategy for SmartFix and provides traceability between the project's functional requirements (FRs), non-functional requirements (NFRs), GitHub issues, test cases, and system events.

The objective is to ensure that every requirement has at least one corresponding test and that test coverage can be tracked throughout the project.

## 2. Testing Scope

Testing covers the following areas:

- Resident report submission and AI-based validation.
- Duplicate detection, priority calculation, and work order assignment.
- Operator review and approval.
- Crew repair completion and resident confirmation.
- Repair disputes, issue reopening, and deadline escalation.
- Notifications, event history, dashboards, and analytics.
- Non-functional requirements, including performance, responsiveness, reliability, data integrity, privacy, security, usability, and maintainability.

## 3. Testing Strategy

### 3.1 Unit Testing

Unit tests verify individual functions and components independently, including calculations, validation rules, and business logic.

### 3.2 Integration Testing

Integration tests verify communication between backend modules and supporting services.

RabbitMQ integration tests cover event publishing, routing, and processing across the report, validation, priority, work order, and notification modules.

### 3.3 End-to-End Testing

End-to-end tests verify complete workflows from the user's perspective.

SmartFix includes a Playwright end-to-end testing suite located in e2e/. The suite provides browser-based automated testing for the following workflows:

- Report submission through repair confirmation and closure.
- Repair disputes and issue reopening.
- Deadline escalation.

### 3.4 Manual Testing

Manual tests verify application functionality and user interactions.

Existing test cases are maintained in `Manual Testing.xlsx`, including requirement mappings, test descriptions, priorities, and execution-result fields.

### 3.5 Non-Functional Testing

Non-functional verification includes:

- Classification processing time.
- Event-to-browser update latency.
- RabbitMQ reliability and event idempotency.
- Local-only AI processing and privacy.
- Role-based access control.
- First-time user usability.
- Module communication and automated CI testing.

## 4. Testing Tools

| Tool | Purpose |
|---|---|
| pytest | Backend automated testing |
| RabbitMQ | Event-driven integration testing |
| PostgreSQL/PostGIS | Database integration and state verification |
| Docker | Local test infrastructure |
| Playwright | Browser-based end-to-end testing |
| GitHub Actions | Automated test execution in CI |
| Manual Testing.xlsx | Manual test-case tracking |

## 5. Testing Environments

### Local Development Environment

Backend tests run using Python and pytest, with Docker-hosted PostgreSQL/PostGIS and RabbitMQ services.

Integration tests use an isolated test database and RabbitMQ test exchanges to avoid interfering with normal application data.

### Browser Testing Environment

Browser-based end-to-end tests are organized under e2e/, using Playwright and the configuration defined in e2e/playwright.config.ts. The test suite includes supporting page objects, test utilities, and mock services to support automated browser testing.

### Continuous Integration Environment

GitHub Actions is used to manage automated testing within the repository's continuous integration workflow. Test execution results and workflow outcomes are tracked through GitHub Actions.

## 6. Test Execution and Reporting

Each test should be associated with a requirement identifier.

Test execution results should distinguish between:

- **Passed:** The test executed successfully.
- **Failed:** The test executed but did not meet its expected result.
- **Not Run:** A test exists but has not been executed.
- **Planned:** The test has not yet been implemented.
- **Blocked:** The test cannot be completed due to an unresolved dependency.

Passing tests should not be assumed to verify requirements outside their actual assertions.

## 7. Source Documents

- `docs/requirements/SmartFix_Requirements.xlsx`
- `docs/testing/Manual Testing.xlsx`
- `docs/plan/Plan.xlsx`

The requirements traceability matrix and milestone updates are maintained in the following sections.

## 8. Requirements Traceability Matrix

### 8.1 Functional Requirements

| ID | Requirement | Related GitHub Issues | Manual Tests | Automated Verification | Event / Module |
|---|---|---|---|---|---|
| FR-1 | Report submission | SF-14 (#29), SF-34 (#49), SF-46 (#61) | TC-011–TC-016 | SF-44 integration tests; Playwright E2E suite (e2e/) | IssueReported |
| FR-2 | AI classification and severity | SF-15 (#30), SF-24 (#39) | TC-044 | SF-44 mock-model workflow | Validation |
| FR-3 | Duplicate detection and merging | SF-16 (#31), SF-17 (#32) | TC-045 | SF-44 duplicate workflow | IssueDuplicateDetected |
| FR-4 | Operator review and approval/rejection | SF-18 (#33), SF-19 (#34), SF-39 (#54) | TC-020–TC-022, TC-046 | SF-44 review/approval workflow | IssueNeedsReview |
| FR-5 | Priority scoring and aging | SF-20 (#35), SF-21 (#36), SF-43 (#58) | TC-021 | SF-43 unit tests; SF-44 priority assertions | IssuePrioritized |
| FR-6 | Work order creation and assignment | SF-22 (#37), SF-31 (#46) | TC-017, TC-021, TC-028 | SF-44 happy path | WorkOrderCreated |
| FR-7 | Crew work order management | SF-25 (#40), SF-26 (#41), SF-37 (#52) | TC-030–TC-034 | SF-44 dispute workflow | WorkOrderStatusChanged, RepairCompleted |
| FR-8 | Before/after photo comparison | SF-26 (#41), SF-27 (#42) | TC-032–TC-033 | Playwright E2E suite (SF-46) | RepairCompleted / Validation |
| FR-9 | Repair dispute and reopening | SF-28 (#43), SF-35 (#50), SF-46 (#61) | TC-036–TC-037 | SF-44 dispute workflow; Playwright E2E suite (SF-46) | RepairDisputed |
| FR-10 | Resident confirmation and automatic closure | SF-28 (#43), SF-29 (#44), SF-35 (#50), SF-46 (#61) | TC-035*, TC-038 | Backend lifecycle tests; Playwright E2E suite (SF-46) | Reports / Work Orders |
| FR-11 | Deadline escalation | SF-30 (#45), SF-46 (#61) | TC-039 | Playwright E2E suite (SF-46) | DeadlineMissed |
| FR-12 | Resident notifications | SF-23 (#38), SF-36 (#51) | TC-040–TC-041 | SF-44 notification assertions | Notifications / WebSocket |
| FR-13 | Operator map, filters, and reassignment | SF-31 (#46), SF-38 (#53) | TC-024–TC-025, TC-027 | Manual tests TC-024–TC-025, TC-027 | Operator Dashboard |
| FR-14 | Event history and timeline | SF-08 (#23), SF-40 (#55) | TC-019, TC-026 | SF-44 event-history assertions | PostgreSQL Events Table |
| FR-15 | Repair-time statistics | SF-32 (#47), SF-41 (#56) | TC-042 | Manual test TC-042 | Analytics |

*TC-035 is labelled FR-9 in the existing manual testing spreadsheet. Its description concerns resident confirmation, which corresponds to FR-10 in the official requirements. The original spreadsheet is preserved; this matrix uses the requirement definition as the authoritative reference.


### 8.2 Non-Functional Requirements

| ID | Requirement | Related GitHub Issues | Manual Test IDs | Verification Method |
|---|---|---|---|---|
| NFR-1 | Classification performance | SF-24 (#39), SF-47 (#62) | TC-044 | Measure classification and severity assignment for 50+ reports; calculate 95th percentile against 15-second target |
| NFR-2 | Event-to-browser responsiveness | SF-36 (#51), SF-47 (#62) | TC-023 | Measure WebSocket update latency against 2-second target |
| NFR-3 | Reliable event delivery and dead-letter handling | SF-02 (#17), SF-45 (#60) | TC-047–TC-050 | Test consumer recovery, queued-event delivery, three failed attempts, and dead-letter routing |
| NFR-4 | Idempotency and transition ownership | SF-06 (#21), SF-07 (#22), SF-43 (#58) | — | Automated duplicate-event and state-transition tests |
| NFR-5 | Local-only AI processing | SF-10 (#25), SF-47 (#62) | — | Inspect outbound network requests and verify local model processing |
| NFR-6 | Role-based access control | SF-09 (#24), SF-47 (#62) | TC-001–TC-010, TC-018, TC-043 | Authentication and authorization tests for resident, crew, and operator roles |
| NFR-7 | Mobile usability | SF-34 (#49), SF-47 (#62) | — | First-time user study with 3–5 participants; report submission under 2 minutes |
| NFR-8 | Event-based modularity and CI testing | SF-03 (#18), SF-04 (#19), SF-11 (#26), SF-44 (#59), SF-46 (#61) | TC-048, TC-051 | Verify RabbitMQ-based communication and automated tests on pull requests |


### 8.3 Coverage and Verification

The traceability matrix includes all 15 functional requirements and all 8 non-functional requirements defined in the official SmartFix requirements document.

The manual testing workbook contains 51 test cases. Automated tests provide additional verification of backend workflows, event processing, and business rules.

Automated testing is organized across backend unit tests (SF-43), RabbitMQ integration tests (SF-44), and browser-based end-to-end tests (SF-46). The corresponding test implementations are maintained in the repository, with execution outcomes recorded through local test runs and CI workflows.

Requirements are traced to implementation issues, relevant manual or automated tests, and associated events or modules where applicable.

Test coverage and successful verification are distinct:

- **Coverage** indicates that an identifiable test or verification procedure exists for a requirement.
- **Verification** indicates that the test has been executed and its expected results have been confirmed.

The manual testing workbook remains the source of record for manual execution results. Automated test outcomes are maintained through the repository's test suites and CI results.

### 8.4 Traceability Maintenance

The matrix is maintained alongside SmartFix's development milestones:

| Milestone | Traceability Focus |
|---|---|
| M1 — Foundation & Architecture | Authentication, database, event schemas, RabbitMQ, and module boundaries |
| M2 — Core Event Pipeline | Report submission, validation, duplicate detection, prioritization, and work order creation |
| M3 — Repair Lifecycle | Crew operations, repair confirmation, disputes, escalation, and analytics |
| M4 — Frontend & Live Updates | Resident, crew, and operator interfaces, WebSocket updates, and dashboards |
| M5 — Testing, Demo & Delivery | Integration testing, browser end-to-end testing, non-functional verification, and final coverage review |

When requirements, tests, or implementation issues change, the corresponding traceability entries are updated.

Manual testing results are maintained in docs/testing/Manual Testing.xlsx, while automated test definitions and execution records are maintained in the corresponding test suites and CI workflows. This traceability matrix provides a consolidated reference connecting requirements, implementation issues, and verification activities.
