-- =====================================================================
-- SmartFix: Reporting and Repairing Public Infrastructure
-- ENSF-607 Group 6 | PostgreSQL 15+ with PostGIS (Supabase compatible)
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
--   8. Status-transition ownership trigger (NFR-4)
--   9. Functions
--  10. Views
--  11. Seed data
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
                        'DeadlineMissed')),
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
-- 9. Functions
-- ---------------------------------------------------------------------
-- FR-3: open issues of the same type within the configured radius (default 50 m),
-- nearest first. Used by the Validation module before the model compares photos.
CREATE FUNCTION find_nearby_open_issues(
    p_location        geography,
    p_problem_type_id SMALLINT,
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
CREATE FUNCTION compute_priority_base(p_severity SMALLINT, p_duplicates INTEGER)
RETURNS NUMERIC LANGUAGE sql STABLE AS $$
    SELECT COALESCE(p_severity, 0) * c.severity_weight
         + LEAST(p_duplicates * c.duplicate_bonus_each, c.duplicate_bonus_cap)
    FROM   priority_config c;
$$;

-- FR-6: deadline for a new work order, from severity.
CREATE FUNCTION work_order_deadline(p_severity SMALLINT, p_from TIMESTAMPTZ DEFAULT now())
RETURNS TIMESTAMPTZ LANGUAGE sql STABLE AS $$
    SELECT p_from + make_interval(hours => s.deadline_hours)
    FROM   severity_sla s WHERE s.severity = p_severity;
$$;

-- FR-6: best crew = right specialty + covers the area + has spare capacity,
-- least loaded first.
CREATE FUNCTION pick_crew(p_problem_type_id SMALLINT, p_area_id INTEGER)
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

COMMIT;
