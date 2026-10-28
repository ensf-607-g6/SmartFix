-- =====================================================================
-- SmartFix: Reporting and Repairing Public Infrastructure
-- ENSF-607 Group 6 | PostgreSQL 15+ with PostGIS (Supabase compatible)
-- Version 2 (Oct 27, 2026)
--
-- Changes from v1
--   * Helper functions take INTEGER instead of SMALLINT parameters. In v1,
--     calls such as compute_priority_base(3, 2) or pick_crew(1, 4) failed with
--     "function does not exist", because PostgreSQL will not implicitly narrow
--     an integer literal (or a Python int sent by asyncpg/psycopg) to SMALLINT.
--   * Role checks (NFR-6): crew members must have role 'crew', crew supervisors
--     role 'supervisor', and review decisions / manual reassignments must be made
--     by an operator or supervisor. Enforced by a trigger (section 8b).
--   * COMMENT ON TABLE / COLUMN for every table (section 12), so the entity and
--     attribute documentation lives in the database itself.
--   * Two new events, IssueClosed and ReportRejected, so closing an issue
--     (resident confirms or 7-day auto-close) and an operator rejecting a
--     report are published like every other status change (FR-12, FR-14).
--   * No table, column or status was renamed or removed. v1 data loads as is.
--
-- Sections
--   0. Extensions and enum types
--   1. Reference data   (problem types, severity SLAs, priority config)
--   2. Users and crews
--   3. Reports and issues (core domain)
--   4. AI validation, duplicate detection, operator review
--   5. Priority, work orders, repair verification, resident confirmation
--   6. Event backbone  (events, idempotency, status history, dead letters)
--   7. Notifications and analytics
--   8. Status-transition ownership trigger (NFR-4) and role checks (NFR-6)
--   9. Functions
--  10. Views
--  11. Seed data
--  12. Documentation comments
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- 0. Extensions and enum types
-- ---------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TYPE user_role           AS ENUM ('resident', 'crew', 'operator', 'supervisor');

-- The nine statuses from the proposal, plus two terminal states that a
-- rejected or merged report needs (see design notes).
CREATE TYPE issue_status        AS ENUM ('reported', 'validated', 'prioritized', 'assigned',
                                         'in_progress', 'completed', 'closed',
                                         'reopened', 'escalated',
                                         'rejected', 'merged');

CREATE TYPE report_status       AS ENUM ('submitted', 'validated', 'duplicate',
                                         'needs_review', 'rejected');

CREATE TYPE app_module          AS ENUM ('reports', 'validation', 'priority',
                                         'work_orders', 'notifications', 'analytics');

CREATE TYPE photo_kind          AS ENUM ('report', 'after');
CREATE TYPE review_reason       AS ENUM ('low_confidence', 'not_infrastructure');
CREATE TYPE review_decision     AS ENUM ('pending', 'approved', 'rejected');
CREATE TYPE work_order_status   AS ENUM ('assigned', 'in_progress', 'completed', 'cancelled');
CREATE TYPE confirmation_status AS ENUM ('pending', 'confirmed', 'disputed', 'auto_closed');
CREATE TYPE repair_verdict      AS ENUM ('repaired', 'not_repaired', 'unclear');

-- ---------------------------------------------------------------------
-- 1. Reference data
-- ---------------------------------------------------------------------
CREATE TABLE problem_types (
    problem_type_id  SMALLINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    code             TEXT NOT NULL UNIQUE,            -- 'pothole', 'streetlight', ...
    display_name     TEXT NOT NULL,
    is_active        BOOLEAN NOT NULL DEFAULT TRUE
);

-- FR-6: work-order deadline depends on severity.
CREATE TABLE severity_sla (
    severity         SMALLINT PRIMARY KEY CHECK (severity BETWEEN 1 AND 5),
    deadline_hours   INTEGER  NOT NULL CHECK (deadline_hours > 0)
);

-- FR-5: priority = severity*w + LEAST(duplicates*bonus, cap) + aging.
-- One row only; tunable without a redeploy.
CREATE TABLE priority_config (
    config_id              BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (config_id),
    severity_weight        NUMERIC(6,2) NOT NULL DEFAULT 10,
    duplicate_bonus_each   NUMERIC(6,2) NOT NULL DEFAULT 2,
    duplicate_bonus_cap    NUMERIC(6,2) NOT NULL DEFAULT 10,   -- caps repeat-report advantage
    aging_points_per_day   NUMERIC(6,2) NOT NULL DEFAULT 1.5,  -- uncapped: everything gains with time
    escalation_boost       NUMERIC(8,2) NOT NULL DEFAULT 1000, -- FR-11: jumps to top of queue
    duplicate_radius_m     INTEGER      NOT NULL DEFAULT 50,   -- FR-3
    auto_close_days        INTEGER      NOT NULL DEFAULT 7     -- FR-10
);

-- ---------------------------------------------------------------------
-- 2. Users and crews
-- ---------------------------------------------------------------------
CREATE TABLE users (
    user_id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email          TEXT NOT NULL UNIQUE,
    password_hash  TEXT NOT NULL,
    full_name      TEXT NOT NULL,
    role           user_role NOT NULL,                 -- NFR-6 role-based access
    is_active      BOOLEAN NOT NULL DEFAULT TRUE,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Browser push (FR-12): one user may have several browsers/devices.
CREATE TABLE push_subscriptions (
    subscription_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    endpoint        TEXT NOT NULL UNIQUE,
    p256dh_key      TEXT NOT NULL,
    auth_key        TEXT NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE service_areas (
    area_id    INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name       TEXT NOT NULL UNIQUE,
    boundary   geography(MultiPolygon, 4326) NOT NULL
);
CREATE INDEX idx_service_areas_boundary ON service_areas USING GIST (boundary);

CREATE TABLE crews (
    crew_id             INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name                TEXT NOT NULL UNIQUE,
    supervisor_id       UUID REFERENCES users(user_id),   -- alerted on DeadlineMissed (FR-11)
    max_active_orders   SMALLINT NOT NULL DEFAULT 5 CHECK (max_active_orders > 0),
    is_active           BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE crew_members (
    crew_id   INTEGER NOT NULL REFERENCES crews(crew_id) ON DELETE CASCADE,
    user_id   UUID    NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    PRIMARY KEY (crew_id, user_id),
    UNIQUE (user_id)                                  -- a crew member belongs to one crew
);

-- Crew matching inputs for FR-6: problem type + area (+ workload, computed).
CREATE TABLE crew_specialties (
    crew_id          INTEGER  NOT NULL REFERENCES crews(crew_id) ON DELETE CASCADE,
    problem_type_id  SMALLINT NOT NULL REFERENCES problem_types(problem_type_id),
    PRIMARY KEY (crew_id, problem_type_id)
);

CREATE TABLE crew_service_areas (
    crew_id  INTEGER NOT NULL REFERENCES crews(crew_id) ON DELETE CASCADE,
    area_id  INTEGER NOT NULL REFERENCES service_areas(area_id) ON DELETE CASCADE,
    PRIMARY KEY (crew_id, area_id)
);

-- ---------------------------------------------------------------------
-- 3. Reports and issues
-- ---------------------------------------------------------------------
CREATE TABLE photos (
    photo_id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    kind          photo_kind NOT NULL,
    storage_path  TEXT NOT NULL UNIQUE,               -- Supabase Storage key / local path
    mime_type     TEXT NOT NULL,
    sha256        CHAR(64) NOT NULL,
    uploaded_by   UUID NOT NULL REFERENCES users(user_id),
    uploaded_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- An issue is the real-world problem. Many reports can point at one issue.
CREATE TABLE issues (
    issue_id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    problem_type_id     SMALLINT NOT NULL REFERENCES problem_types(problem_type_id),
    status              issue_status NOT NULL DEFAULT 'reported',
    location            geography(Point, 4326) NOT NULL,
    address_text        TEXT,
    area_id             INTEGER REFERENCES service_areas(area_id),
    severity            SMALLINT CHECK (severity BETWEEN 1 AND 5),   -- FR-2, NULL until validated
    duplicate_count     INTEGER NOT NULL DEFAULT 0 CHECK (duplicate_count >= 0),
    priority_base       NUMERIC(8,2) NOT NULL DEFAULT 0,             -- severity + capped dup bonus (FR-5)
    is_escalated        BOOLEAN NOT NULL DEFAULT FALSE,              -- FR-11
    merged_into_id      UUID REFERENCES issues(issue_id),            -- set when status = 'merged'
    reopen_count        INTEGER NOT NULL DEFAULT 0,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),          -- aging clock starts here
    closed_at           TIMESTAMPTZ,
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK ((status = 'merged') = (merged_into_id IS NOT NULL)),
    CHECK (merged_into_id IS DISTINCT FROM issue_id)
);
-- FR-3 / FR-13: nearby-open-issue lookups and the live map.
CREATE INDEX idx_issues_location ON issues USING GIST (location);
CREATE INDEX idx_issues_open_by_type
    ON issues (problem_type_id)
    WHERE status NOT IN ('closed', 'rejected', 'merged');
CREATE INDEX idx_issues_status   ON issues (status);

CREATE TABLE reports (
    report_id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    issue_id         UUID NOT NULL REFERENCES issues(issue_id),      -- re-pointed on merge
    reporter_id      UUID NOT NULL REFERENCES users(user_id),
    problem_type_id  SMALLINT NOT NULL REFERENCES problem_types(problem_type_id),  -- resident's category (FR-1)
    photo_id         UUID NOT NULL REFERENCES photos(photo_id),
    location         geography(Point, 4326) NOT NULL,                -- the pin dropped (FR-1)
    description      TEXT,
    status           report_status NOT NULL DEFAULT 'submitted',
    submitted_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (photo_id)
);
CREATE INDEX idx_reports_issue    ON reports (issue_id);
CREATE INDEX idx_reports_reporter ON reports (reporter_id, submitted_at DESC);
CREATE INDEX idx_reports_location ON reports USING GIST (location);

-- ---------------------------------------------------------------------
-- 4. AI validation, duplicate detection, operator review
-- ---------------------------------------------------------------------
-- One row per model run on a report (FR-2, NFR-1 latency tracking).
CREATE TABLE validations (
    validation_id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    report_id          UUID NOT NULL REFERENCES reports(report_id) ON DELETE CASCADE,
    detected_type_id   SMALLINT REFERENCES problem_types(problem_type_id),
    severity           SMALLINT CHECK (severity BETWEEN 1 AND 5),
    confidence         NUMERIC(4,3) NOT NULL CHECK (confidence BETWEEN 0 AND 1),
    is_infrastructure  BOOLEAN NOT NULL,
    model_name         TEXT NOT NULL,                  -- 'qwen3-vl:8b' or fallback 'gemma3:4b'
    raw_output         JSONB,
    latency_ms         INTEGER CHECK (latency_ms >= 0),
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_validations_report ON validations (report_id);

-- Candidate comparisons against nearby open issues (FR-3).
CREATE TABLE duplicate_checks (
    check_id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    report_id         UUID NOT NULL REFERENCES reports(report_id) ON DELETE CASCADE,
    candidate_issue_id UUID NOT NULL REFERENCES issues(issue_id),
    distance_m        NUMERIC(8,2) NOT NULL CHECK (distance_m >= 0),
    is_match          BOOLEAN NOT NULL,
    confidence        NUMERIC(4,3) NOT NULL CHECK (confidence BETWEEN 0 AND 1),
    model_name        TEXT NOT NULL,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (report_id, candidate_issue_id)
);

-- FR-4: low-confidence / non-infrastructure photos wait here for an operator.
CREATE TABLE review_queue (
    review_id    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    report_id    UUID NOT NULL UNIQUE REFERENCES reports(report_id) ON DELETE CASCADE,
    reason       review_reason NOT NULL,
    decision     review_decision NOT NULL DEFAULT 'pending',
    reviewed_by  UUID REFERENCES users(user_id),
    reviewed_at  TIMESTAMPTZ,
    notes        TEXT,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK ((decision = 'pending') = (reviewed_by IS NULL AND reviewed_at IS NULL))
);
CREATE INDEX idx_review_pending ON review_queue (created_at) WHERE decision = 'pending';

-- ---------------------------------------------------------------------
-- 5. Priority, work orders, repair verification, resident confirmation
-- ---------------------------------------------------------------------
-- Audit of every recalculation (FR-5): why did this issue move?
CREATE TABLE priority_history (
    priority_id       BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    issue_id          UUID NOT NULL REFERENCES issues(issue_id) ON DELETE CASCADE,
    severity_part     NUMERIC(8,2) NOT NULL,
    duplicate_part    NUMERIC(8,2) NOT NULL,
    total_base        NUMERIC(8,2) NOT NULL,
    reason            TEXT NOT NULL,                  -- 'validated','duplicate','disputed','deadline_missed'
    calculated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_priority_history_issue ON priority_history (issue_id, calculated_at DESC);

CREATE TABLE work_orders (
    work_order_id    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    issue_id         UUID NOT NULL REFERENCES issues(issue_id),
    crew_id          INTEGER NOT NULL REFERENCES crews(crew_id),
    status           work_order_status NOT NULL DEFAULT 'assigned',
    deadline_at      TIMESTAMPTZ NOT NULL,            -- from severity_sla (FR-6)
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    started_at       TIMESTAMPTZ,
    completed_at     TIMESTAMPTZ,
    escalated_at     TIMESTAMPTZ,                     -- set by DeadlineMissed (FR-11)
    after_photo_id   UUID REFERENCES photos(photo_id),
    crew_notes       TEXT,
    CHECK (completed_at IS NULL OR started_at IS NULL OR completed_at >= started_at),
    CHECK (status <> 'completed' OR (completed_at IS NOT NULL AND after_photo_id IS NOT NULL))
);
-- An issue has at most one live work order; disputes create a new one (FR-9).
CREATE UNIQUE INDEX uq_work_orders_one_active
    ON work_orders (issue_id) WHERE status IN ('assigned', 'in_progress');
CREATE INDEX idx_work_orders_crew     ON work_orders (crew_id, status);
CREATE INDEX idx_work_orders_deadline ON work_orders (deadline_at)
    WHERE status IN ('assigned', 'in_progress') AND escalated_at IS NULL;   -- scheduler scan

-- Reassignment trail (FR-13): operators can move work between crews.
CREATE TABLE work_order_assignments (
    assignment_id  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    work_order_id  UUID NOT NULL REFERENCES work_orders(work_order_id) ON DELETE CASCADE,
    crew_id        INTEGER NOT NULL REFERENCES crews(crew_id),
    assigned_by    UUID REFERENCES users(user_id),    -- NULL = automatic matching
    reason         TEXT NOT NULL DEFAULT 'auto_match',
    assigned_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- FR-8: before/after comparison by the vision model.
CREATE TABLE repair_verifications (
    verification_id  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    work_order_id    UUID NOT NULL UNIQUE REFERENCES work_orders(work_order_id) ON DELETE CASCADE,
    before_photo_id  UUID NOT NULL REFERENCES photos(photo_id),
    after_photo_id   UUID NOT NULL REFERENCES photos(photo_id),
    verdict          repair_verdict NOT NULL,
    confidence       NUMERIC(4,3) NOT NULL CHECK (confidence BETWEEN 0 AND 1),
    model_name       TEXT NOT NULL,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- FR-9 / FR-10: resident confirms, disputes, or the 7-day timer closes it.
CREATE TABLE resident_confirmations (
    confirmation_id  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    work_order_id    UUID NOT NULL UNIQUE REFERENCES work_orders(work_order_id) ON DELETE CASCADE,
    issue_id         UUID NOT NULL REFERENCES issues(issue_id),
    resident_id      UUID NOT NULL REFERENCES users(user_id),   -- original reporter
    status           confirmation_status NOT NULL DEFAULT 'pending',
    auto_close_at    TIMESTAMPTZ NOT NULL,             -- requested_at + auto_close_days
    requested_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    responded_at     TIMESTAMPTZ,
    dispute_reason   TEXT,
    CHECK ((status IN ('pending', 'auto_closed')) = (responded_at IS NULL)),
    CHECK (status <> 'disputed' OR dispute_reason IS NOT NULL)
);
CREATE INDEX idx_confirmations_due ON resident_confirmations (auto_close_at)
    WHERE status = 'pending';

-- ---------------------------------------------------------------------
-- 6. Event backbone
-- ---------------------------------------------------------------------
-- FR-14: every event ever published, the full issue timeline.
CREATE TABLE events (
    event_id        UUID PRIMARY KEY,                  -- generated by the producer
    event_name      TEXT NOT NULL CHECK (event_name IN (
                        'IssueReported','IssueValidated','IssueDuplicateDetected',
                        'IssueNeedsReview','IssuePrioritized','WorkOrderCreated',
                        'WorkOrderStatusChanged','RepairCompleted','RepairDisputed',
                        'DeadlineMissed','IssueClosed','ReportRejected')),  -- last two added in v2
    issue_id        UUID REFERENCES issues(issue_id),
    report_id       UUID REFERENCES reports(report_id),
    producer        TEXT NOT NULL,                     -- module, 'crew_portal' or 'scheduler'
    actor_id        UUID REFERENCES users(user_id),    -- human who triggered it, if any
    payload         JSONB NOT NULL,                    -- validated by Pydantic before publish
    correlation_id  UUID NOT NULL,                     -- groups one report's whole journey
    causation_id    UUID REFERENCES events(event_id),  -- the event that caused this one
    occurred_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_events_issue_time ON events (issue_id, occurred_at);
CREATE INDEX idx_events_name_time  ON events (event_name, occurred_at DESC);
CREATE INDEX idx_events_correlation ON events (correlation_id);

-- NFR-4 idempotency: a consumer records the event ID before/while handling it.
-- INSERT ... ON CONFLICT DO NOTHING; zero rows inserted means "already done, skip".
CREATE TABLE processed_events (
    consumer      app_module NOT NULL,
    event_id      UUID NOT NULL REFERENCES events(event_id),
    processed_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (consumer, event_id)
);

-- Events that failed 3 times and went to the RabbitMQ dead-letter queue (NFR-3),
-- mirrored here so the team can inspect and replay them.
CREATE TABLE dead_letter_events (
    dead_letter_id  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    event_id        UUID REFERENCES events(event_id),
    consumer        app_module NOT NULL,
    attempts        SMALLINT NOT NULL DEFAULT 3,
    error_message   TEXT NOT NULL,
    failed_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    resolved_at     TIMESTAMPTZ
);

-- Which module may make which status change (NFR-4: "only the owner can transition").
CREATE TABLE status_transitions (
    from_status   issue_status NOT NULL,
    to_status     issue_status NOT NULL,
    owner_module  app_module   NOT NULL,
    PRIMARY KEY (from_status, to_status)
);

CREATE TABLE issue_status_history (
    history_id   BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    issue_id     UUID NOT NULL REFERENCES issues(issue_id) ON DELETE CASCADE,
    from_status  issue_status,
    to_status    issue_status NOT NULL,
    module       app_module,
    event_id     UUID REFERENCES events(event_id),
    changed_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_status_history_issue ON issue_status_history (issue_id, changed_at);

-- ---------------------------------------------------------------------
-- 7. Notifications and analytics
-- ---------------------------------------------------------------------
-- FR-12: plain-language message generated by the local model per event.
CREATE TABLE notifications (
    notification_id  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id          UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    issue_id         UUID REFERENCES issues(issue_id),
    event_id         UUID REFERENCES events(event_id),
    message          TEXT NOT NULL,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    pushed_at        TIMESTAMPTZ,
    read_at          TIMESTAMPTZ,
    UNIQUE (user_id, event_id)                         -- idempotent delivery
);
CREATE INDEX idx_notifications_user_unread
    ON notifications (user_id, created_at DESC) WHERE read_at IS NULL;

-- FR-15: one row per completed repair, written by the Analytics module.
CREATE TABLE repair_metrics (
    metric_id        BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    work_order_id    UUID NOT NULL UNIQUE REFERENCES work_orders(work_order_id),
    issue_id         UUID NOT NULL REFERENCES issues(issue_id),
    problem_type_id  SMALLINT NOT NULL REFERENCES problem_types(problem_type_id),
    severity         SMALLINT NOT NULL CHECK (severity BETWEEN 1 AND 5),
    area_id          INTEGER REFERENCES service_areas(area_id),
    reported_at      TIMESTAMPTZ NOT NULL,
    completed_at     TIMESTAMPTZ NOT NULL,
    repair_seconds   INTEGER NOT NULL CHECK (repair_seconds >= 0),
    met_deadline     BOOLEAN NOT NULL
);
CREATE INDEX idx_repair_metrics_type ON repair_metrics (problem_type_id);

-- ---------------------------------------------------------------------
-- 8. Status-transition ownership trigger (NFR-4)
-- ---------------------------------------------------------------------
-- Each module opens its DB transaction with:   SET LOCAL app.module = 'priority';
-- (and optionally SET LOCAL app.event_id = '<uuid>'). Any status change that is
-- not in status_transitions for that module is rejected by the database itself.
CREATE FUNCTION enforce_issue_status_transition() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    v_module   app_module;
    v_event_id UUID;
BEGIN
    IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
        RETURN NEW;
    END IF;

    v_module   := NULLIF(current_setting('app.module', true), '')::app_module;
    v_event_id := NULLIF(current_setting('app.event_id', true), '')::uuid;

    IF NOT EXISTS (SELECT 1 FROM status_transitions
                   WHERE from_status = OLD.status
                     AND to_status   = NEW.status
                     AND owner_module = v_module) THEN
        RAISE EXCEPTION 'Module % may not move issue % from % to %',
            COALESCE(v_module::text, '<none>'), OLD.issue_id, OLD.status, NEW.status
            USING ERRCODE = 'check_violation';
    END IF;

    NEW.updated_at := now();
    IF NEW.status = 'closed' THEN
        NEW.closed_at := now();
    END IF;

    INSERT INTO issue_status_history (issue_id, from_status, to_status, module, event_id)
    VALUES (OLD.issue_id, OLD.status, NEW.status, v_module, v_event_id);
    RETURN NEW;
END $$;

CREATE TRIGGER trg_issue_status_transition
    BEFORE UPDATE OF status ON issues
    FOR EACH ROW EXECUTE FUNCTION enforce_issue_status_transition();

-- Record the initial 'reported' status too, so the timeline starts at the beginning.
CREATE FUNCTION log_initial_issue_status() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    INSERT INTO issue_status_history (issue_id, from_status, to_status, module)
    VALUES (NEW.issue_id, NULL, NEW.status, 'reports');
    RETURN NEW;
END $$;

CREATE TRIGGER trg_issue_initial_status
    AFTER INSERT ON issues
    FOR EACH ROW EXECUTE FUNCTION log_initial_issue_status();

-- ---------------------------------------------------------------------
-- 8b. Role checks (NFR-6)
-- ---------------------------------------------------------------------
-- Generic trigger: TG_ARGV[0] is the column holding a user_id, the remaining
-- arguments are the roles allowed in that column. NULL is always allowed
-- (for example assigned_by is NULL when the system matched the crew itself).
CREATE FUNCTION enforce_user_role() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    v_user  UUID;
    v_role  user_role;
    v_allow TEXT[] := TG_ARGV[1:TG_NARGS - 1];
BEGIN
    EXECUTE format('SELECT ($1).%I', TG_ARGV[0]) USING NEW INTO v_user;
    IF v_user IS NULL THEN
        RETURN NEW;
    END IF;
    SELECT role INTO v_role FROM users WHERE user_id = v_user;
    IF v_role IS NULL OR NOT (v_role::text = ANY (v_allow)) THEN
        RAISE EXCEPTION '%.% must reference a user with role %, got %',
            TG_TABLE_NAME, TG_ARGV[0], array_to_string(v_allow, ' or '),
            COALESCE(v_role::text, '<no user>')
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END $$;

CREATE TRIGGER trg_crew_members_role
    BEFORE INSERT OR UPDATE OF user_id ON crew_members
    FOR EACH ROW EXECUTE FUNCTION enforce_user_role('user_id', 'crew');

CREATE TRIGGER trg_crews_supervisor_role
    BEFORE INSERT OR UPDATE OF supervisor_id ON crews
    FOR EACH ROW EXECUTE FUNCTION enforce_user_role('supervisor_id', 'supervisor');

CREATE TRIGGER trg_review_queue_reviewer_role
    BEFORE INSERT OR UPDATE OF reviewed_by ON review_queue
    FOR EACH ROW EXECUTE FUNCTION enforce_user_role('reviewed_by', 'operator', 'supervisor');

CREATE TRIGGER trg_assignments_assigner_role
    BEFORE INSERT OR UPDATE OF assigned_by ON work_order_assignments
    FOR EACH ROW EXECUTE FUNCTION enforce_user_role('assigned_by', 'operator', 'supervisor');

-- ---------------------------------------------------------------------
-- 9. Functions
-- ---------------------------------------------------------------------
-- FR-3: open issues of the same type within the configured radius (default 50 m),
-- nearest first. Used by the Validation module before the model compares photos.
CREATE FUNCTION find_nearby_open_issues(
    p_location        geography,
    p_problem_type_id INTEGER,
    p_exclude_issue   UUID DEFAULT NULL
) RETURNS TABLE (issue_id UUID, distance_m DOUBLE PRECISION)
LANGUAGE sql STABLE AS $$
    SELECT i.issue_id, ST_Distance(i.location, p_location) AS distance_m
    FROM   issues i, priority_config c
    WHERE  i.problem_type_id = p_problem_type_id
      AND  i.status NOT IN ('closed', 'rejected', 'merged')
      AND  i.issue_id IS DISTINCT FROM p_exclude_issue
      AND  ST_DWithin(i.location, p_location, c.duplicate_radius_m)
    ORDER  BY distance_m;
$$;

-- FR-5: severity part + capped duplicate bonus (aging is added at read time,
-- see v_issue_queue, so it never needs a background job to keep rows fresh).
CREATE FUNCTION compute_priority_base(p_severity INTEGER, p_duplicates INTEGER)
RETURNS NUMERIC LANGUAGE sql STABLE AS $$
    SELECT COALESCE(p_severity, 0) * c.severity_weight
         + LEAST(p_duplicates * c.duplicate_bonus_each, c.duplicate_bonus_cap)
    FROM   priority_config c;
$$;

-- FR-6: deadline for a new work order, from severity.
CREATE FUNCTION work_order_deadline(p_severity INTEGER, p_from TIMESTAMPTZ DEFAULT now())
RETURNS TIMESTAMPTZ LANGUAGE sql STABLE AS $$
    SELECT p_from + make_interval(hours => s.deadline_hours)
    FROM   severity_sla s WHERE s.severity = p_severity;
$$;

-- FR-6: best crew = right specialty + covers the area + has spare capacity,
-- least loaded first.
CREATE FUNCTION pick_crew(p_problem_type_id INTEGER, p_area_id INTEGER)
RETURNS INTEGER LANGUAGE sql STABLE AS $$
    SELECT c.crew_id
    FROM   crews c
    JOIN   crew_specialties  cs ON cs.crew_id = c.crew_id AND cs.problem_type_id = p_problem_type_id
    JOIN   crew_service_areas ca ON ca.crew_id = c.crew_id AND ca.area_id = p_area_id
    LEFT   JOIN LATERAL (
              SELECT count(*) AS active
              FROM   work_orders w
              WHERE  w.crew_id = c.crew_id AND w.status IN ('assigned', 'in_progress')
           ) load ON TRUE
    WHERE  c.is_active AND load.active < c.max_active_orders
    ORDER  BY load.active::numeric / c.max_active_orders, c.crew_id
    LIMIT  1;
$$;

-- ---------------------------------------------------------------------
-- 10. Views
-- ---------------------------------------------------------------------
-- FR-5 / FR-13: the live priority queue. Aging is computed here.
CREATE VIEW v_issue_queue AS
SELECT i.issue_id,
       i.problem_type_id,
       pt.code                              AS problem_type,
       i.status,
       i.severity,
       i.duplicate_count,
       i.is_escalated,
       i.location,
       i.created_at,
       i.priority_base
         + c.aging_points_per_day * EXTRACT(EPOCH FROM (now() - i.created_at)) / 86400.0
         + CASE WHEN i.is_escalated THEN c.escalation_boost ELSE 0 END
                                            AS priority_score
FROM   issues i
JOIN   problem_types pt ON pt.problem_type_id = i.problem_type_id
CROSS  JOIN priority_config c
WHERE  i.status NOT IN ('closed', 'rejected', 'merged');

-- FR-13: operator map payload (latitude/longitude split out for React-Leaflet).
CREATE VIEW v_operator_map AS
SELECT q.issue_id, q.problem_type, q.status, q.severity, q.priority_score,
       ST_Y(q.location::geometry) AS lat,
       ST_X(q.location::geometry) AS lng,
       w.work_order_id, w.crew_id, w.deadline_at
FROM   v_issue_queue q
LEFT   JOIN work_orders w
       ON w.issue_id = q.issue_id AND w.status IN ('assigned', 'in_progress');

-- FR-14: the full timeline of any issue, events interleaved with status changes.
CREATE VIEW v_issue_timeline AS
SELECT issue_id, occurred_at AS at, 'event'::text AS kind,
       event_name AS label, producer AS source, payload AS detail
FROM   events WHERE issue_id IS NOT NULL
UNION ALL
SELECT issue_id, changed_at, 'status_change',
       COALESCE(from_status::text, '-') || ' -> ' || to_status::text,
       module::text, NULL
FROM   issue_status_history;

-- FR-15: average repair time by problem type.
CREATE VIEW v_repair_stats AS
SELECT pt.code                                   AS problem_type,
       count(*)                                  AS repairs,
       round(avg(m.repair_seconds) / 3600.0, 1)  AS avg_repair_hours,
       round(100.0 * avg(m.met_deadline::int), 1) AS pct_met_deadline
FROM   repair_metrics m
JOIN   problem_types pt ON pt.problem_type_id = m.problem_type_id
GROUP  BY pt.code;

-- Equity view (SDG 9.1 stretch goal): repeat-problem hot spots by service area.
CREATE VIEW v_area_hotspots AS
SELECT a.area_id, a.name,
       count(*)                                         AS issues_30d,
       sum(i.duplicate_count)                           AS repeat_reports_30d,
       count(*) FILTER (WHERE i.status NOT IN ('closed','rejected','merged')) AS still_open
FROM   service_areas a
JOIN   issues i ON i.area_id = a.area_id
WHERE  i.created_at >= now() - interval '30 days'
GROUP  BY a.area_id, a.name;

-- ---------------------------------------------------------------------
-- 11. Seed data
-- ---------------------------------------------------------------------
INSERT INTO problem_types (code, display_name) VALUES
    ('pothole',        'Pothole'),
    ('streetlight',    'Broken streetlight'),
    ('water_leak',     'Water leak'),
    ('sidewalk_crack', 'Cracked sidewalk'),
    ('other',          'Other infrastructure');

INSERT INTO severity_sla (severity, deadline_hours) VALUES
    (5, 8), (4, 24), (3, 72), (2, 168), (1, 336);

INSERT INTO priority_config DEFAULT VALUES;

-- Transition table. Escalated is reachable from any live state; the Priority
-- module owns that move because it consumes DeadlineMissed.
INSERT INTO status_transitions (from_status, to_status, owner_module) VALUES
    ('reported',    'validated',   'validation'),
    ('reported',    'merged',      'validation'),
    ('reported',    'rejected',    'validation'),
    ('validated',   'prioritized', 'priority'),
    ('prioritized', 'assigned',    'work_orders'),
    ('assigned',    'in_progress', 'work_orders'),
    ('in_progress', 'completed',   'work_orders'),
    ('completed',   'closed',      'reports'),
    ('completed',   'reopened',    'reports'),
    ('reopened',    'prioritized', 'priority'),
    ('prioritized', 'escalated',   'priority'),
    ('assigned',    'escalated',   'priority'),
    ('in_progress', 'escalated',   'priority'),
    ('escalated',   'assigned',    'work_orders'),
    ('escalated',   'in_progress', 'work_orders'),
    ('escalated',   'completed',   'work_orders');


-- ---------------------------------------------------------------------
-- 12. Documentation comments (shown by \d+ and in the Supabase table editor)
-- ---------------------------------------------------------------------
COMMENT ON TABLE users IS 'Residents, crew members, operators and supervisors';
COMMENT ON COLUMN users.user_id IS 'Unique ID';
COMMENT ON COLUMN users.email IS 'Login name';
COMMENT ON COLUMN users.password_hash IS 'Hashed password';
COMMENT ON COLUMN users.full_name IS 'Display name';
COMMENT ON COLUMN users.role IS 'resident, crew, operator or supervisor (drives access)';
COMMENT ON COLUMN users.is_active IS 'Account enabled or disabled';
COMMENT ON COLUMN users.created_at IS 'Sign-up time';

COMMENT ON TABLE push_subscriptions IS 'Browser push addresses for notifications';
COMMENT ON COLUMN push_subscriptions.subscription_id IS 'Unique ID';
COMMENT ON COLUMN push_subscriptions.user_id IS 'Owner of the browser';
COMMENT ON COLUMN push_subscriptions.endpoint IS 'Browser push URL';
COMMENT ON COLUMN push_subscriptions.p256dh_key IS 'Encryption keys required by web push';
COMMENT ON COLUMN push_subscriptions.auth_key IS 'Encryption keys required by web push';
COMMENT ON COLUMN push_subscriptions.created_at IS 'When subscribed';

COMMENT ON TABLE service_areas IS 'City zones';
COMMENT ON COLUMN service_areas.area_id IS 'Unique ID';
COMMENT ON COLUMN service_areas.name IS 'Zone name';
COMMENT ON COLUMN service_areas.boundary IS 'Map polygon of the zone';

COMMENT ON TABLE crews IS 'Repair teams';
COMMENT ON COLUMN crews.crew_id IS 'Unique ID';
COMMENT ON COLUMN crews.name IS 'Crew name';
COMMENT ON COLUMN crews.supervisor_id IS 'Supervisor alerted on missed deadlines';
COMMENT ON COLUMN crews.max_active_orders IS 'Workload limit';
COMMENT ON COLUMN crews.is_active IS 'Whether the crew can receive work';

COMMENT ON TABLE crew_members IS 'Links users to crews';
COMMENT ON COLUMN crew_members.crew_id IS 'The crew';
COMMENT ON COLUMN crew_members.user_id IS 'The member (one crew per person)';

COMMENT ON TABLE crew_specialties IS 'Problem types a crew handles';
COMMENT ON COLUMN crew_specialties.crew_id IS 'The crew';
COMMENT ON COLUMN crew_specialties.problem_type_id IS 'The problem type';

COMMENT ON TABLE crew_service_areas IS 'Zones a crew covers';
COMMENT ON COLUMN crew_service_areas.crew_id IS 'The crew';
COMMENT ON COLUMN crew_service_areas.area_id IS 'The zone';

COMMENT ON TABLE photos IS 'Every uploaded image';
COMMENT ON COLUMN photos.photo_id IS 'Unique ID';
COMMENT ON COLUMN photos.kind IS 'report (before) or after';
COMMENT ON COLUMN photos.storage_path IS 'File location in storage';
COMMENT ON COLUMN photos.mime_type IS 'Image format';
COMMENT ON COLUMN photos.sha256 IS 'File fingerprint';
COMMENT ON COLUMN photos.uploaded_by IS 'Uploader';
COMMENT ON COLUMN photos.uploaded_at IS 'Upload time';

COMMENT ON TABLE issues IS 'The real-world problem, shared by all its reports';
COMMENT ON COLUMN issues.issue_id IS 'Unique ID';
COMMENT ON COLUMN issues.problem_type_id IS 'Problem type';
COMMENT ON COLUMN issues.status IS 'Reported, Validated, Prioritized, Assigned, In Progress, Completed, Closed, Reopened, Escalated, plus Rejected and Merged';
COMMENT ON COLUMN issues.location IS 'Map point of the problem';
COMMENT ON COLUMN issues.address_text IS 'Readable address';
COMMENT ON COLUMN issues.area_id IS 'Service area it falls in';
COMMENT ON COLUMN issues.severity IS '1 to 5 from the vision model';
COMMENT ON COLUMN issues.duplicate_count IS 'Number of extra reports merged in';
COMMENT ON COLUMN issues.priority_base IS 'Severity plus capped duplicate bonus (aging is added when read)';
COMMENT ON COLUMN issues.is_escalated IS 'True after a missed deadline';
COMMENT ON COLUMN issues.merged_into_id IS 'Issue this one was merged into, if a duplicate';
COMMENT ON COLUMN issues.reopen_count IS 'Times a resident disputed the repair';
COMMENT ON COLUMN issues.created_at IS 'Report time, which starts the aging clock';
COMMENT ON COLUMN issues.closed_at IS 'Closing time';
COMMENT ON COLUMN issues.updated_at IS 'Last change';

COMMENT ON TABLE reports IS 'One resident submission';
COMMENT ON COLUMN reports.report_id IS 'Unique ID';
COMMENT ON COLUMN reports.issue_id IS 'Issue the report belongs to';
COMMENT ON COLUMN reports.reporter_id IS 'Resident who submitted it';
COMMENT ON COLUMN reports.problem_type_id IS 'Category the resident chose';
COMMENT ON COLUMN reports.photo_id IS 'The photo submitted';
COMMENT ON COLUMN reports.location IS 'Pin the resident dropped';
COMMENT ON COLUMN reports.description IS 'Optional text';
COMMENT ON COLUMN reports.status IS 'submitted, validated, duplicate, needs_review or rejected';
COMMENT ON COLUMN reports.submitted_at IS 'Submission time';

COMMENT ON TABLE validations IS 'One model run on a report (FR-2)';
COMMENT ON COLUMN validations.validation_id IS 'Unique ID';
COMMENT ON COLUMN validations.report_id IS 'Report analysed';
COMMENT ON COLUMN validations.detected_type_id IS 'Problem type the model found';
COMMENT ON COLUMN validations.severity IS 'Score 1 to 5';
COMMENT ON COLUMN validations.confidence IS 'Model certainty, 0 to 1';
COMMENT ON COLUMN validations.is_infrastructure IS 'False if the photo isn''t infrastructure';
COMMENT ON COLUMN validations.model_name IS 'Model used (Qwen3-VL or the Gemma fallback)';
COMMENT ON COLUMN validations.raw_output IS 'Full model response, kept for accuracy testing';
COMMENT ON COLUMN validations.latency_ms IS 'Processing time (checks the 15 s target)';
COMMENT ON COLUMN validations.created_at IS 'Time of run';

COMMENT ON TABLE duplicate_checks IS 'Comparison of a report against a nearby open issue (FR-3)';
COMMENT ON COLUMN duplicate_checks.check_id IS 'Unique ID';
COMMENT ON COLUMN duplicate_checks.report_id IS 'New report';
COMMENT ON COLUMN duplicate_checks.candidate_issue_id IS 'Existing issue compared against';
COMMENT ON COLUMN duplicate_checks.distance_m IS 'Distance between them';
COMMENT ON COLUMN duplicate_checks.is_match IS 'Whether the model says they match';
COMMENT ON COLUMN duplicate_checks.confidence IS 'Model certainty';
COMMENT ON COLUMN duplicate_checks.model_name IS 'Model used';
COMMENT ON COLUMN duplicate_checks.created_at IS 'Time of check';

COMMENT ON TABLE review_queue IS 'Reports waiting for an operator (FR-4)';
COMMENT ON COLUMN review_queue.review_id IS 'Unique ID';
COMMENT ON COLUMN review_queue.report_id IS 'Report under review';
COMMENT ON COLUMN review_queue.reason IS 'low_confidence or not_infrastructure';
COMMENT ON COLUMN review_queue.decision IS 'pending, approved or rejected';
COMMENT ON COLUMN review_queue.reviewed_by IS 'Operator who decided';
COMMENT ON COLUMN review_queue.reviewed_at IS 'Decision time';
COMMENT ON COLUMN review_queue.notes IS 'Operator comment';
COMMENT ON COLUMN review_queue.created_at IS 'When queued';

COMMENT ON TABLE priority_history IS 'Audit trail of score changes (FR-5)';
COMMENT ON COLUMN priority_history.priority_id IS 'Unique ID';
COMMENT ON COLUMN priority_history.issue_id IS 'Issue scored';
COMMENT ON COLUMN priority_history.severity_part IS 'Points from severity';
COMMENT ON COLUMN priority_history.duplicate_part IS 'Points from duplicates (after the cap)';
COMMENT ON COLUMN priority_history.total_base IS 'Sum stored on the issue';
COMMENT ON COLUMN priority_history.reason IS 'Why it was recalculated, e.g. validated or disputed';
COMMENT ON COLUMN priority_history.calculated_at IS 'Time';

COMMENT ON TABLE work_orders IS 'Repair jobs given to crews (FR-6, FR-7)';
COMMENT ON COLUMN work_orders.work_order_id IS 'Unique ID';
COMMENT ON COLUMN work_orders.issue_id IS 'Issue to fix';
COMMENT ON COLUMN work_orders.crew_id IS 'Assigned crew';
COMMENT ON COLUMN work_orders.status IS 'assigned, in_progress, completed or cancelled';
COMMENT ON COLUMN work_orders.deadline_at IS 'Due time, set from severity';
COMMENT ON COLUMN work_orders.created_at IS 'Creation time';
COMMENT ON COLUMN work_orders.started_at IS 'Work began';
COMMENT ON COLUMN work_orders.completed_at IS 'Work finished';
COMMENT ON COLUMN work_orders.escalated_at IS 'When the deadline was missed';
COMMENT ON COLUMN work_orders.after_photo_id IS 'Photo uploaded by the crew';
COMMENT ON COLUMN work_orders.crew_notes IS 'Crew comments';

COMMENT ON TABLE work_order_assignments IS 'Log of crew changes (FR-13)';
COMMENT ON COLUMN work_order_assignments.assignment_id IS 'Unique ID';
COMMENT ON COLUMN work_order_assignments.work_order_id IS 'The work order';
COMMENT ON COLUMN work_order_assignments.crew_id IS 'Crew it was given to';
COMMENT ON COLUMN work_order_assignments.assigned_by IS 'Operator, or empty if automatic';
COMMENT ON COLUMN work_order_assignments.reason IS 'auto_match, manual reassign, etc.';
COMMENT ON COLUMN work_order_assignments.assigned_at IS 'Time';

COMMENT ON TABLE repair_verifications IS 'Before/after photo check (FR-8)';
COMMENT ON COLUMN repair_verifications.verification_id IS 'Unique ID';
COMMENT ON COLUMN repair_verifications.work_order_id IS 'The work order';
COMMENT ON COLUMN repair_verifications.before_photo_id IS 'Original photo';
COMMENT ON COLUMN repair_verifications.after_photo_id IS 'Crew''s photo';
COMMENT ON COLUMN repair_verifications.verdict IS 'repaired, not_repaired or unclear';
COMMENT ON COLUMN repair_verifications.confidence IS 'Model certainty';
COMMENT ON COLUMN repair_verifications.model_name IS 'Model used';
COMMENT ON COLUMN repair_verifications.created_at IS 'Time';

COMMENT ON TABLE resident_confirmations IS 'Resident confirms or disputes (FR-9, FR-10)';
COMMENT ON COLUMN resident_confirmations.confirmation_id IS 'Unique ID';
COMMENT ON COLUMN resident_confirmations.work_order_id IS 'The completed work order';
COMMENT ON COLUMN resident_confirmations.issue_id IS 'The issue';
COMMENT ON COLUMN resident_confirmations.resident_id IS 'Original reporter';
COMMENT ON COLUMN resident_confirmations.status IS 'pending, confirmed, disputed or auto_closed';
COMMENT ON COLUMN resident_confirmations.auto_close_at IS '7-day deadline for a reply';
COMMENT ON COLUMN resident_confirmations.requested_at IS 'When the resident was asked';
COMMENT ON COLUMN resident_confirmations.responded_at IS 'When they answered';
COMMENT ON COLUMN resident_confirmations.dispute_reason IS 'Why they disagree (required if disputed)';

COMMENT ON TABLE events IS 'Every event ever published (FR-14)';
COMMENT ON COLUMN events.event_id IS 'ID set by the producer';
COMMENT ON COLUMN events.event_name IS 'One of the twelve events, e.g. IssueReported or IssueClosed';
COMMENT ON COLUMN events.issue_id IS 'Related issue';
COMMENT ON COLUMN events.report_id IS 'Related report';
COMMENT ON COLUMN events.producer IS 'Module, crew portal or scheduler';
COMMENT ON COLUMN events.actor_id IS 'Person who triggered it, if any';
COMMENT ON COLUMN events.payload IS 'Event data in JSON';
COMMENT ON COLUMN events.correlation_id IS 'Groups all events from one report''s journey';
COMMENT ON COLUMN events.causation_id IS 'Event that caused this one';
COMMENT ON COLUMN events.occurred_at IS 'Time';

COMMENT ON TABLE processed_events IS 'Which module already handled which event (NFR-4)';
COMMENT ON COLUMN processed_events.consumer IS 'Module name';
COMMENT ON COLUMN processed_events.event_id IS 'Event handled';
COMMENT ON COLUMN processed_events.processed_at IS 'Time';

COMMENT ON TABLE dead_letter_events IS 'Events that failed 3 times (NFR-3)';
COMMENT ON COLUMN dead_letter_events.dead_letter_id IS 'Unique ID';
COMMENT ON COLUMN dead_letter_events.event_id IS 'Failed event';
COMMENT ON COLUMN dead_letter_events.consumer IS 'Module that failed';
COMMENT ON COLUMN dead_letter_events.attempts IS 'Number of tries';
COMMENT ON COLUMN dead_letter_events.error_message IS 'What went wrong';
COMMENT ON COLUMN dead_letter_events.failed_at IS 'Time';
COMMENT ON COLUMN dead_letter_events.resolved_at IS 'When fixed or replayed';

COMMENT ON TABLE status_transitions IS 'The allowed status changes and who owns them';
COMMENT ON COLUMN status_transitions.from_status IS 'Current status';
COMMENT ON COLUMN status_transitions.to_status IS 'Next status';
COMMENT ON COLUMN status_transitions.owner_module IS 'The only module allowed to make this change';

COMMENT ON TABLE issue_status_history IS 'Log of every status change';
COMMENT ON COLUMN issue_status_history.history_id IS 'Unique ID';
COMMENT ON COLUMN issue_status_history.issue_id IS 'The issue';
COMMENT ON COLUMN issue_status_history.from_status IS 'Previous status (empty for the first)';
COMMENT ON COLUMN issue_status_history.to_status IS 'New status';
COMMENT ON COLUMN issue_status_history.module IS 'Module that made the change';
COMMENT ON COLUMN issue_status_history.event_id IS 'Event that triggered it';
COMMENT ON COLUMN issue_status_history.changed_at IS 'Time';

COMMENT ON TABLE notifications IS 'Plain-language messages to residents (FR-12)';
COMMENT ON COLUMN notifications.notification_id IS 'Unique ID';
COMMENT ON COLUMN notifications.user_id IS 'Recipient';
COMMENT ON COLUMN notifications.issue_id IS 'Related issue';
COMMENT ON COLUMN notifications.event_id IS 'Event that produced the message (unique per user, which prevents double sends)';
COMMENT ON COLUMN notifications.message IS 'Text written by the local model';
COMMENT ON COLUMN notifications.created_at IS 'Time created';
COMMENT ON COLUMN notifications.pushed_at IS 'Time sent to the browser';
COMMENT ON COLUMN notifications.read_at IS 'Time the user read it';

COMMENT ON TABLE repair_metrics IS 'One row per finished repair (FR-15)';
COMMENT ON COLUMN repair_metrics.metric_id IS 'Unique ID';
COMMENT ON COLUMN repair_metrics.work_order_id IS 'The work order';
COMMENT ON COLUMN repair_metrics.issue_id IS 'The issue';
COMMENT ON COLUMN repair_metrics.problem_type_id IS 'Problem type';
COMMENT ON COLUMN repair_metrics.severity IS 'Severity at repair time';
COMMENT ON COLUMN repair_metrics.area_id IS 'Service area';
COMMENT ON COLUMN repair_metrics.reported_at IS 'When the issue was first reported';
COMMENT ON COLUMN repair_metrics.completed_at IS 'When the repair finished';
COMMENT ON COLUMN repair_metrics.repair_seconds IS 'Total repair time';
COMMENT ON COLUMN repair_metrics.met_deadline IS 'Whether the deadline was met';

COMMENT ON TABLE problem_types IS 'The categories of infrastructure problem';
COMMENT ON COLUMN problem_types.problem_type_id IS 'Unique ID';
COMMENT ON COLUMN problem_types.code IS 'Short machine name, e.g. pothole';
COMMENT ON COLUMN problem_types.display_name IS 'Label shown to users';
COMMENT ON COLUMN problem_types.is_active IS 'Whether residents can still pick it';

COMMENT ON TABLE severity_sla IS 'The repair deadline for each severity level';
COMMENT ON COLUMN severity_sla.severity IS 'Severity 1 to 5';
COMMENT ON COLUMN severity_sla.deadline_hours IS 'Hours a crew has to finish (FR-6)';

COMMENT ON TABLE priority_config IS 'One row of tunable scoring rules';
COMMENT ON COLUMN priority_config.config_id IS 'Always true, so only one row can exist';
COMMENT ON COLUMN priority_config.severity_weight IS 'Points per severity level';
COMMENT ON COLUMN priority_config.duplicate_bonus_each IS 'Points added per duplicate report';
COMMENT ON COLUMN priority_config.duplicate_bonus_cap IS 'Maximum duplicate bonus, so repeat reporting can''t dominate';
COMMENT ON COLUMN priority_config.aging_points_per_day IS 'Points gained per day an issue stays open';
COMMENT ON COLUMN priority_config.escalation_boost IS 'Large bonus that puts escalated issues first';
COMMENT ON COLUMN priority_config.duplicate_radius_m IS 'Distance for duplicate matching (50 m)';
COMMENT ON COLUMN priority_config.auto_close_days IS 'Days before silent auto-close (7)';

COMMIT;
