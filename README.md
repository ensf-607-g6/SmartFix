# ENSF-607
SmartFix: Reporting and Repairing Public Infrastructure

Residents photograph a pothole, broken streetlight, water leak or cracked sidewalk and drop a pin.
A local vision model rates it, duplicates within 50 m are merged, the issue is prioritised, a crew
is dispatched with a deadline, and the resident confirms (or disputes) the repair.

🚀 Check out the **[Live Demo](https://smart-fix-delta.vercel.app)** to see the project in action!

## How the code maps to the design

| Design artefact | Code |
|---|---|
| Component diagram (01a): one FastAPI app, six modules, RabbitMQ, Ollama, WebSocket hub | `backend/app/main.py`, `backend/app/modules/*`, `backend/app/ws.py` |
| Backend class diagram (05b): `DomainEvent` + 12 events, `EventConsumer` template method, `RabbitMQBus`, `EventStore`, `OllamaClient` | `backend/app/events/models.py`, `consumer.py`, `bus.py`, `store.py`, `backend/app/ai/ollama_client.py` |
| State machine (01b) and status ownership (NFR-4) | enforced by the schema's `status_transitions` trigger; every module writes inside `Database.transaction(module)` |
| SD-1 submit and validate | `modules/reports.py` → `modules/validation.py` |
| SD-2 prioritise and dispatch | `modules/priority.py`, `modules/work_orders.py`, `modules/notifications.py` |
| SD-3 repair, verify, confirm / dispute / auto-close | `modules/work_orders.py` (crew portal), `validation.py` (before/after check), `notifications.py`, `analytics.py`, `reports.py` |
| SD-4 deadline escalation | `modules/scheduler.py` → `priority.py` + `notifications.py` |
| Database design v2 | loaded unchanged from `docs/System Design/DB Design/smartfix_schema_v2.sql` |
| Client tier: resident app, crew portal, operator dashboard | `frontend/src/pages/{resident,crew,ops}` |

Modules never import each other; they only publish and consume events (NFR-8). Each consumer has its
own durable queue (`smartfix.validation`, `smartfix.priority`, ...); a message that fails 3 times goes
to `smartfix.dead_letter` and the `dead_letter_events` table (NFR-3).

## Prerequisites (macOS / Homebrew)

```bash
brew install postgresql@17 postgis rabbitmq
brew services start postgresql@17      # this repo uses port 5433, see below
brew services start rabbitmq           # management console: http://localhost:15672 (guest/guest)
ollama pull qwen3-vl:8b-instruct       # vision model
ollama pull gemma3:4b                  # fallback model
```

Homebrew's PostGIS only ships for Postgres 17/18. If you already run another Postgres on 5432, set
`port = 5433` in `/opt/homebrew/var/postgresql@17/postgresql.conf` (or change `DATABASE_URL`).
Any PostgreSQL 15+ with PostGIS works, including Supabase.

## Setup (once)

```bash
cd <path to your postgres installation>
createdb -p 5433 smartfix
```

### Windows (Command Prompt)
```bash
git clone https://github.com/ensf-607-g6/SmartFix
cd backend
python -m venv .venv
.venv\Scripts\activate.bat
pip install -r requirements.txt
copy .env.example .env
:: Update the database URL in the .env file
python -m scripts.init_db # schema v2 + Calgary service areas, crews, demo users
                          # add --reset to wipe and start over
```

### Linux and macOS
```bash
git clone https://github.com/ensf-607-g6/SmartFix
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
:: Update the database URL in the .env file
python -m scripts.init_db     # schema v2 + Calgary service areas, crews, demo users
                              # add --reset to wipe and start over

cd ../frontend
npm install
```

## Run

```bash
./start.sh          # backend on :8000, frontend on :5173
```

Open http://127.0.0.1:5173. API docs: http://127.0.0.1:8000/docs.

### Demo accounts (password `smartfix123`)

| Role | Email |
|---|---|
| Resident | `resident@smartfix.dev`, `resident2@smartfix.dev` |
| City operator | `operator@smartfix.dev` |
| Supervisor (alerted on missed deadlines) | `supervisor@smartfix.dev` |
| Crews | `crew.north@` (pothole/sidewalk; Downtown, NW, NE) · `crew.south@` (pothole/sidewalk; Downtown, SW, SE) · `crew.lights@` · `crew.water@` · `crew.general@` (all `@smartfix.dev`) |

Residents can also register from the login page.

### A full walkthrough

1. **Resident**: *Report a problem*, add a photo, click the map in Calgary, pick a category, submit.
   Within a few seconds the report is validated, prioritised and assigned (watch the notification bell).
2. **Second resident**: report the same thing within 50 m and it merges into the first issue (priority +2, no second crew).
   A photo that isn't infrastructure, or one the model is unsure about, lands in the operator's **Review queue**.
3. **Operator**: the *Live map* shows every open issue by priority. Filter by status, type or severity, open an issue
   for its photos, AI result, priority breakdown and **Event timeline**, and reassign it to another crew.
4. **Crew** (the one shown on the work order): *Start work*, then *Complete repair* with an after photo.
   The model compares before and after photos, and the resident is asked to confirm.
5. **Resident**: answer *Is it fixed?*. *Yes* closes the issue; *No* reopens it with higher priority and a new work order.

Deadlines are 8 h to 14 days and the auto-close window is 7 days, so with `ENABLE_DEV_TOOLS=true` the operator's issue
panel has two testing buttons: **Miss the deadline now** (escalation, FR-11) and **Skip ahead 7 days** (auto-close, FR-10).
They only move a timestamp into the past and then run the real scheduler, so the normal events still happen.

## Tests

```bash
cd backend && .venv/bin/pytest
```

17 integration tests run the whole event flow against a throwaway `smartfix_test` database, using the
in-process bus and a scripted model: happy path, duplicate merge, review approve and reject, model
offline, dispute, escalation and reassignment, auto-close, idempotent redelivery, the status-ownership
trigger, dead-lettering, and role-based access.

## Configuration (`backend/.env`)

| Variable | Default | Notes |
|---|---|---|
| `DATABASE_URL` | `postgresql://localhost:5433/smartfix` | a Supabase connection string works too |
| `RABBITMQ_URL` | `amqp://guest:guest@localhost:5672/` | CloudAMQP `amqps://` URL works; **empty** = in-process bus with the same retry and dead-letter behaviour |
| `VISION_MODEL` / `FALLBACK_MODEL` | `qwen3-vl:8b-instruct` / `gemma3:4b` | the plain `qwen3-vl:8b` tag is the *thinking* build and takes 20-30 s per photo, missing NFR-1's 15 s |
| `SCHEDULER_INTERVAL_S` | `30` | how often deadlines, auto-close and waiting dispatches are checked |
| `ENABLE_DEV_TOOLS` | `true` locally | turn off for a real deployment |

## Design decisions made while building

- **Dispute priority (FR-9):** each dispute adds one severity level's worth of points (`severity_weight`) to
  `priority_base`, on top of aging. `priority_history` still records the severity and duplicate parts.
- **Duplicate candidates (FR-3):** a report only merges into an issue that has already passed validation, so two
  reports that are both still being checked can't merge into each other. The Validation queue is processed one at a time.
- **No crew available:** the issue stays *Prioritized*, is retried every scheduler tick, and the operator can dispatch it manually.
- **Reassignment (FR-13):** possible while a work order is *Assigned*, or after escalation. The new crew gets a fresh
  deadline, and the move is logged in `work_order_assignments`.
- **Notifications (FR-12):** the local model rewrites a factual template into plain language (falling back to the
  template if the model is slow). They are delivered live over WebSocket to an in-app inbox, and as desktop
  alerts through the browser Notification API when the tab is in the background.
- **Photos** are stored under `backend/storage/` and served with per-role checks. Swap `PhotoStorage` for Supabase Storage to deploy.
