# SmartFix end-to-end tests (Playwright)

Browser tests for the resident app, crew portal and operator dashboard, plus API checks for the
rules behind them (roles, validation, the event flow). They automate the manual test plan in
`docs/testing/Manual Testing.xlsx` (TC-001 to TC-043) and add edge cases around it.

## What the suite starts

`npx playwright test` starts its own copy of the stack, so it never touches your dev data:

| Server | Port | Notes |
|---|---|---|
| Backend (uvicorn) | 8001 | database `smartfix_e2e`, **dropped and reseeded before every run** |
| Frontend (Vite) | 5174 | calls the backend above (`VITE_API_BASE_URL`) |
| Mock Ollama | 11435 | `mock-ollama/server.mjs`, scripted and instant |

- **Database.** `scripts/prepare_db.py` creates `smartfix_e2e` on the same Postgres server as your
  `DATABASE_URL`, loads schema v2 and the demo seed, and raises crew capacity to 50. It refuses to
  reset any database whose name does not end in `_e2e` or `_test`.
- **Event bus.** The in-process bus, with the same retry and dead-letter rules as RabbitMQ. A
  test backend on the shared RabbitMQ would compete with your dev backend for the same queues.
  To test against RabbitMQ anyway, set `E2E_RABBITMQ_URL=amqp://guest:guest@localhost:5672/`
  and stop the dev backend first.
- **AI model.** A mock of the Ollama HTTP API, so the backend's real `OllamaClient` runs and every
  result is predictable. Tests steer it with tags in the report description:

  | Tag | Effect |
  |---|---|
  | `[ai:low-confidence]` | confidence 0.35, so the report goes to operator review |
  | `[ai:not-infra]` | "not infrastructure", so it goes to operator review |
  | `[ai:offline]` | every model fails, so it goes to review as "unavailable" |
  | `[ai:severity=5]` | sets the severity (default 3) |
  | `[ai:type=streetlight]` | sets the detected type (default: the resident's choice) |

  Two photos count as the same problem only when they are byte-identical. Every test photo is
  generated unique unless a duplicate test reuses one on purpose. Notification rewrites return
  the backend's own template text.
- **Network.** Map tiles, reverse geocoding and Google Fonts are stubbed, so the run works offline.

## Prerequisites

1. The backend set up as in the main README (`backend/.venv` with `requirements.txt` installed).
2. Postgres + PostGIS running and reachable at `postgresql://localhost:5433`.
3. `frontend/node_modules` installed (`cd frontend && npm ci`).
4. Ollama and RabbitMQ are **not** needed.

## Run

```bash
cd e2e
npm install
npx playwright install chromium   # once

npm test                 # everything (desktop + mobile projects), about 3 minutes
npm run test:smoke       # the @smoke subset
npm run test:ui          # Playwright UI mode
npx playwright test tests/operator/review-queue.spec.ts   # one file
npm run report           # open the HTML report of the last run
```

You don't need to start the app yourself: Playwright starts and stops all three servers, in UI
mode too. To watch a test in a real browser window, tick **Show browser** in UI mode's Settings
tab, or run headed and slowed down:

```bash
E2E_SLOWMO=500 npx playwright test tests/system/lifecycle.spec.ts --headed
```

Set `E2E_SERVER_LOGS=1` to see the backend's request log. If a port is taken, override it with
`E2E_BACKEND_PORT`, `E2E_FRONTEND_PORT` or `E2E_MOCK_OLLAMA_PORT`. `E2E_DATABASE_URL` overrides
the database (its name must end in `_e2e` or `_test`).

Tests run one at a time (`workers: 1`) because they share one database, review queue and set of
crews. Each test creates the data it needs through the API. Tests about a resident's own list or
inbox use a resident registered just for that test (the `freshResident` fixture).

## Layout

```
e2e/
├── playwright.config.ts      projects (desktop, mobile) and the three web servers
├── mock-ollama/server.mjs    scripted Ollama API
├── scripts/prepare_db.py     fresh smartfix_e2e before each run
├── support/
│   ├── env.ts                ports, URLs, demo accounts, crew -> member map
│   ├── fixtures.ts           test/expect with api, signIn, openAs, freshResident; network stubs
│   ├── api.ts                REST client + eventually() polling helper
│   ├── flows.ts              put an issue in a stage: report, assigned, in progress, completed, in review
│   ├── photos.ts             unique PNGs, a fake image, an oversized file
│   ├── geo.ts                Calgary / downtown / outside-area points
│   └── db.ts                 direct SQL for set-ups the API cannot express (crew off duty)
├── pages/                    page objects: Login, AppShell, resident, crew, operator pages
└── tests/
    ├── auth/                 login, register, role access        TC-001..010, 018, 029
    ├── resident/             submit, my reports, duplicates, confirm/dispute
    │                                                             TC-011..019, 034..036, FR-2, FR-3
    ├── crew/                 work orders; *.mobile.spec.ts runs on a phone viewport
    │                                                             TC-029..033
    ├── operator/             review queue, live map, issue drawer, stats, supervisor
    │                                                             TC-020..028, 037, 038, 041, 042
    ├── notifications/        bell, live toasts, mark read        TC-039, 040, FR-12
    └── system/               health, full UI lifecycle           TC-043
```

## Known failures (marked `test.fail`)

These tests assert the behaviour the requirements ask for and currently fail because of app bugs.
Playwright reports them as expected failures. Once a bug is fixed the test starts passing, and
Playwright flags it as "expected to fail, but passed": remove the `test.fail` line then.

| Test | Bug |
|---|---|
| `auth/login.spec.ts` TC-010 redirect | Signed out, any protected URL shows a blank page instead of redirecting to `/login`. `AppShell` returns `null` without a user, so the `RequireRole` redirect inside it never renders. |
| `crew/crew-portal.mobile.spec.ts` (both) | TC-033: at phone width the fixed 256 px sidebar covers the crew page (fixed 400 px list column), so work orders cannot be tapped. |

## Not covered here

TC-044 to TC-046 (durable RabbitMQ queues, messages surviving a backend restart, dead-lettering
after 3 failures) are broker and process-level checks, not browser flows. The backend's pytest
suite covers durable queue declaration, retries, dead-lettering and idempotent redelivery
(`backend/tests/test_event_bus.py`, `test_event_consumer.py`). Stopping and restarting a real
broker or backend (TC-045) is still a manual check. The e2e suite asserts that no event was
dead-lettered during the run.
