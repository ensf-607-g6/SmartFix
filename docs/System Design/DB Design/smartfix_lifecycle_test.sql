-- =====================================================================
-- SmartFix: end-to-end database test for smartfix_schema_v2.sql
-- Runs the whole issue lifecycle against the schema, then rolls back,
-- so it is safe to run on a dev database:
--     psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f smartfix_lifecycle_test.sql
-- Every check raises an error if it fails. Prints PASS lines as it goes.
-- Each module's work is simulated with set_config('app.module', ..., true),
-- the same as SET LOCAL app.module in the real consumers.
-- =====================================================================
BEGIN;

DO $$
DECLARE
    -- people
    r1 UUID; r2 UUID; r3 UUID; c1 UUID; o1 UUID; s1 UUID;
    -- reference data
    pothole INTEGER; area INTEGER; crew INTEGER;
    -- domain rows
    ph1 UUID; ph2 UUID; ph3 UUID; ph_after UUID; ph_after2 UUID;
    i1 UUID; i2 UUID; i3 UUID;
    rep1 UUID; rep2 UUID; rep3 UUID;
    wo1 UUID; wo2 UUID;
    ev UUID; n INTEGER; v_num NUMERIC; v_bool BOOLEAN; v_status issue_status;
    pin1 geography := ST_GeogFromText('POINT(-114.0719 51.0447)');   -- downtown Calgary
    pin2 geography := ST_GeogFromText('POINT(-114.0715 51.0448)');   -- ~30 m away
    pin3 geography := ST_GeogFromText('POINT(-114.0900 51.0600)');   -- far away
    corr UUID := gen_random_uuid();
BEGIN
    -- ------------------------------------------------------------ setup
    INSERT INTO users (email, password_hash, full_name, role) VALUES
        ('res1@test', 'x', 'Resident One',   'resident')   RETURNING user_id INTO r1;
    INSERT INTO users (email, password_hash, full_name, role) VALUES
        ('res2@test', 'x', 'Resident Two',   'resident')   RETURNING user_id INTO r2;
    INSERT INTO users (email, password_hash, full_name, role) VALUES
        ('res3@test', 'x', 'Resident Three', 'resident')   RETURNING user_id INTO r3;
    INSERT INTO users (email, password_hash, full_name, role) VALUES
        ('crew1@test','x', 'Crew Member',    'crew')       RETURNING user_id INTO c1;
    INSERT INTO users (email, password_hash, full_name, role) VALUES
        ('op1@test',  'x', 'City Operator',  'operator')   RETURNING user_id INTO o1;
    INSERT INTO users (email, password_hash, full_name, role) VALUES
        ('sup1@test', 'x', 'Supervisor',     'supervisor') RETURNING user_id INTO s1;

    SELECT problem_type_id INTO pothole FROM problem_types WHERE code = 'pothole';
    INSERT INTO service_areas (name, boundary) VALUES ('Downtown',
        ST_GeogFromText('MULTIPOLYGON(((-114.10 51.03,-114.05 51.03,-114.05 51.07,-114.10 51.07,-114.10 51.03)))'))
        RETURNING area_id INTO area;
    INSERT INTO crews (name, supervisor_id, max_active_orders) VALUES ('Roads A', s1, 3)
        RETURNING crew_id INTO crew;
    INSERT INTO crew_members VALUES (crew, c1);
    INSERT INTO crew_specialties VALUES (crew, pothole);
    INSERT INTO crew_service_areas VALUES (crew, area);
    RAISE NOTICE 'PASS setup';

    -- NFR-6: a resident cannot be a crew member or a crew supervisor
    BEGIN
        INSERT INTO crew_members VALUES (crew, r1);
        RAISE EXCEPTION 'FAIL resident accepted as crew member';
    EXCEPTION WHEN check_violation THEN NULL; END;
    BEGIN
        UPDATE crews SET supervisor_id = o1 WHERE crew_id = crew;
        RAISE EXCEPTION 'FAIL operator accepted as crew supervisor';
    EXCEPTION WHEN check_violation THEN NULL; END;
    RAISE NOTICE 'PASS role checks';

    -- ------------------------------------------- FR-1 resident submits report 1
    PERFORM set_config('app.module', 'reports', true);
    INSERT INTO photos (kind, storage_path, mime_type, sha256, uploaded_by)
        VALUES ('report', 'reports/r1.jpg', 'image/jpeg', repeat('a', 64), r1) RETURNING photo_id INTO ph1;
    INSERT INTO issues (problem_type_id, location, area_id) VALUES (pothole, pin1, area) RETURNING issue_id INTO i1;
    INSERT INTO reports (issue_id, reporter_id, problem_type_id, photo_id, location, description)
        VALUES (i1, r1, pothole, ph1, pin1, 'Deep pothole in the right lane') RETURNING report_id INTO rep1;
    ev := gen_random_uuid();
    INSERT INTO events (event_id, event_name, issue_id, report_id, producer, actor_id, payload, correlation_id)
        VALUES (ev, 'IssueReported', i1, rep1, 'reports', r1, '{"photo":"reports/r1.jpg"}', corr);
    SELECT count(*) INTO n FROM issue_status_history WHERE issue_id = i1 AND to_status = 'reported';
    ASSERT n = 1, 'initial status not logged';
    RAISE NOTICE 'PASS FR-1 report submitted, initial status logged';

    -- ------------------------------------------- NFR-4 idempotent consumption
    INSERT INTO processed_events (consumer, event_id) VALUES ('validation', ev) ON CONFLICT DO NOTHING;
    GET DIAGNOSTICS n = ROW_COUNT;  ASSERT n = 1, 'first delivery should insert';
    INSERT INTO processed_events (consumer, event_id) VALUES ('validation', ev) ON CONFLICT DO NOTHING;
    GET DIAGNOSTICS n = ROW_COUNT;  ASSERT n = 0, 'duplicate delivery should be skipped';
    RAISE NOTICE 'PASS NFR-4 duplicate delivery detected';

    -- ------------------------------------------- FR-2 validation (severity 4)
    PERFORM set_config('app.module', 'validation', true);
    INSERT INTO validations (report_id, detected_type_id, severity, confidence, is_infrastructure, model_name, latency_ms)
        VALUES (rep1, pothole, 4, 0.92, TRUE, 'qwen3-vl:8b', 6200);
    UPDATE issues SET status = 'validated', severity = 4 WHERE issue_id = i1;
    UPDATE reports SET status = 'validated' WHERE report_id = rep1;

    -- NFR-4: the Reports module may not prioritise
    PERFORM set_config('app.module', 'reports', true);
    BEGIN
        UPDATE issues SET status = 'prioritized' WHERE issue_id = i1;
        RAISE EXCEPTION 'FAIL out-of-turn transition accepted';
    EXCEPTION WHEN check_violation THEN NULL; END;
    RAISE NOTICE 'PASS FR-2 validated; NFR-4 out-of-turn transition rejected';

    -- ------------------------------------------- FR-5 priority
    PERFORM set_config('app.module', 'priority', true);
    v_num := compute_priority_base(4, 0);              -- plain integer literals (v1 bug)
    ASSERT v_num = 40, 'priority base should be 4*10 = 40';
    UPDATE issues SET status = 'prioritized', priority_base = v_num WHERE issue_id = i1;
    INSERT INTO priority_history (issue_id, severity_part, duplicate_part, total_base, reason)
        VALUES (i1, 40, 0, 40, 'validated');
    RAISE NOTICE 'PASS FR-5 priority = 40';

    -- ------------------------------------------- FR-3 duplicate within 50 m
    PERFORM set_config('app.module', 'reports', true);
    INSERT INTO photos (kind, storage_path, mime_type, sha256, uploaded_by)
        VALUES ('report', 'reports/r2.jpg', 'image/jpeg', repeat('b', 64), r2) RETURNING photo_id INTO ph2;
    INSERT INTO issues (problem_type_id, location, area_id) VALUES (pothole, pin2, area) RETURNING issue_id INTO i2;
    INSERT INTO reports (issue_id, reporter_id, problem_type_id, photo_id, location)
        VALUES (i2, r2, pothole, ph2, pin2) RETURNING report_id INTO rep2;

    PERFORM set_config('app.module', 'validation', true);
    SELECT count(*) INTO n FROM find_nearby_open_issues(pin2, pothole, i2) f WHERE f.issue_id = i1 AND f.distance_m < 50;
    ASSERT n = 1, 'issue 1 should be found within 50 m';
    SELECT count(*) INTO n FROM find_nearby_open_issues(pin3, pothole);
    ASSERT n = 0, 'nothing should be near the far pin';
    INSERT INTO duplicate_checks (report_id, candidate_issue_id, distance_m, is_match, confidence, model_name)
        VALUES (rep2, i1, 30, TRUE, 0.88, 'qwen3-vl:8b');
    UPDATE reports SET issue_id = i1, status = 'duplicate' WHERE report_id = rep2;
    UPDATE issues SET status = 'merged', merged_into_id = i1 WHERE issue_id = i2;

    PERFORM set_config('app.module', 'priority', true);
    UPDATE issues SET duplicate_count = duplicate_count + 1,
                      priority_base = compute_priority_base(severity, duplicate_count + 1)
    WHERE issue_id = i1;
    SELECT priority_base INTO v_num FROM issues WHERE issue_id = i1;
    ASSERT v_num = 42, 'priority should be 40 + 2';
    -- cap: 20 duplicates still only add 10
    ASSERT compute_priority_base(4, 20) = 50, 'duplicate bonus should cap at 10';
    SELECT count(*) INTO n FROM reports WHERE issue_id = i1;
    ASSERT n = 2, 'issue 1 should now group two reports';
    RAISE NOTICE 'PASS FR-3 duplicate merged, bonus capped';

    -- ------------------------------------------- FR-6 crew match + deadline
    PERFORM set_config('app.module', 'work_orders', true);
    ASSERT pick_crew(pothole, area) = crew, 'Roads A should be picked';
    INSERT INTO work_orders (issue_id, crew_id, deadline_at)
        VALUES (i1, crew, work_order_deadline(4)) RETURNING work_order_id INTO wo1;
    INSERT INTO work_order_assignments (work_order_id, crew_id) VALUES (wo1, crew);
    UPDATE issues SET status = 'assigned' WHERE issue_id = i1;
    SELECT (deadline_at = now() + interval '24 hours') INTO v_bool FROM work_orders WHERE work_order_id = wo1;
    ASSERT v_bool, 'severity 4 deadline should be 24 h';
    BEGIN
        INSERT INTO work_orders (issue_id, crew_id, deadline_at) VALUES (i1, crew, now());
        RAISE EXCEPTION 'FAIL second active work order accepted';
    EXCEPTION WHEN unique_violation THEN NULL; END;
    RAISE NOTICE 'PASS FR-6 crew matched, 24 h deadline, one active work order';

    -- ------------------------------------------- FR-7 crew starts
    UPDATE work_orders SET status = 'in_progress', started_at = now() WHERE work_order_id = wo1;
    UPDATE issues SET status = 'in_progress' WHERE issue_id = i1;

    -- ------------------------------------------- FR-11 deadline missed
    UPDATE work_orders SET deadline_at = now() - interval '1 hour' WHERE work_order_id = wo1;
    SELECT count(*) INTO n FROM work_orders
     WHERE status IN ('assigned','in_progress') AND escalated_at IS NULL AND deadline_at < now();
    ASSERT n = 1, 'scheduler scan should find the overdue order';
    UPDATE work_orders SET escalated_at = now() WHERE work_order_id = wo1;
    PERFORM set_config('app.module', 'priority', true);
    UPDATE issues SET status = 'escalated', is_escalated = TRUE WHERE issue_id = i1;
    SELECT priority_score INTO v_num FROM v_issue_queue WHERE issue_id = i1;
    ASSERT v_num >= 1042, 'escalated issue should carry the 1000 boost';
    RAISE NOTICE 'PASS FR-11 escalated, priority %', round(v_num, 1);

    -- ------------------------------------------- FR-7/FR-8 crew completes
    PERFORM set_config('app.module', 'work_orders', true);
    INSERT INTO photos (kind, storage_path, mime_type, sha256, uploaded_by)
        VALUES ('after', 'after/wo1.jpg', 'image/jpeg', repeat('c', 64), c1) RETURNING photo_id INTO ph_after;
    UPDATE work_orders SET status = 'completed', completed_at = now(), after_photo_id = ph_after
     WHERE work_order_id = wo1;
    UPDATE issues SET status = 'completed' WHERE issue_id = i1;
    INSERT INTO repair_verifications (work_order_id, before_photo_id, after_photo_id, verdict, confidence, model_name)
        VALUES (wo1, ph1, ph_after, 'repaired', 0.81, 'qwen3-vl:8b');
    INSERT INTO resident_confirmations (work_order_id, issue_id, resident_id, auto_close_at)
        VALUES (wo1, i1, r1, now() + interval '7 days');
    RAISE NOTICE 'PASS FR-7/FR-8 repair completed and verified';

    -- ------------------------------------------- FR-9 dispute
    PERFORM set_config('app.module', 'reports', true);
    UPDATE resident_confirmations SET status = 'disputed', responded_at = now(),
           dispute_reason = 'Still a hole on the left side' WHERE work_order_id = wo1;
    UPDATE issues SET status = 'reopened', reopen_count = reopen_count + 1 WHERE issue_id = i1;
    PERFORM set_config('app.module', 'priority', true);
    UPDATE issues SET status = 'prioritized' WHERE issue_id = i1;
    PERFORM set_config('app.module', 'work_orders', true);
    INSERT INTO work_orders (issue_id, crew_id, deadline_at)
        VALUES (i1, crew, work_order_deadline(4)) RETURNING work_order_id INTO wo2;
    UPDATE issues SET status = 'assigned' WHERE issue_id = i1;
    UPDATE work_orders SET status = 'in_progress', started_at = now() WHERE work_order_id = wo2;
    UPDATE issues SET status = 'in_progress' WHERE issue_id = i1;
    INSERT INTO photos (kind, storage_path, mime_type, sha256, uploaded_by)
        VALUES ('after', 'after/wo2.jpg', 'image/jpeg', repeat('d', 64), c1) RETURNING photo_id INTO ph_after2;
    UPDATE work_orders SET status = 'completed', completed_at = now(), after_photo_id = ph_after2
     WHERE work_order_id = wo2;
    UPDATE issues SET status = 'completed' WHERE issue_id = i1;
    INSERT INTO resident_confirmations (work_order_id, issue_id, resident_id, auto_close_at, requested_at)
        VALUES (wo2, i1, r1, now() - interval '1 minute', now() - interval '7 days 1 minute');
    RAISE NOTICE 'PASS FR-9 dispute reopened the issue with a second work order';

    -- ------------------------------------------- FR-10 auto-close after 7 days
    PERFORM set_config('app.module', 'reports', true);
    SELECT count(*) INTO n FROM resident_confirmations WHERE status = 'pending' AND auto_close_at <= now();
    ASSERT n = 1, 'one confirmation should be due';
    UPDATE resident_confirmations SET status = 'auto_closed' WHERE work_order_id = wo2;
    UPDATE issues SET status = 'closed' WHERE issue_id = i1;
    INSERT INTO events (event_id, event_name, issue_id, producer, payload, correlation_id)
        VALUES (gen_random_uuid(), 'IssueClosed', i1, 'reports',
                jsonb_build_object('work_order_id', wo2, 'closed_by', 'auto_closed'), corr);
    SELECT status INTO v_status FROM issues WHERE issue_id = i1;
    ASSERT v_status = 'closed', 'issue should be closed';
    SELECT count(*) INTO n FROM issues WHERE issue_id = i1 AND closed_at IS NOT NULL;
    ASSERT n = 1, 'closed_at should be stamped by the trigger';
    RAISE NOTICE 'PASS FR-10 auto-closed after 7 days, IssueClosed recorded';

    -- ------------------------------------------- FR-15 analytics
    INSERT INTO repair_metrics (work_order_id, issue_id, problem_type_id, severity, area_id,
                                reported_at, completed_at, repair_seconds, met_deadline)
        VALUES (wo2, i1, pothole, 4, area, now() - interval '30 hours', now(), 108000, FALSE);
    SELECT avg_repair_hours INTO v_num FROM v_repair_stats WHERE problem_type = 'pothole';
    ASSERT v_num = 30.0, 'average repair time should be 30 h';
    RAISE NOTICE 'PASS FR-15 repair stats';

    -- ------------------------------------------- FR-14 timeline
    SELECT count(*) INTO n FROM issue_status_history WHERE issue_id = i1;
    ASSERT n = 13, format('issue 1 should have 13 status rows, has %s', n);
    SELECT count(*) INTO n FROM v_issue_timeline WHERE issue_id = i1;
    ASSERT n = 15, format('timeline should hold 13 status changes + 2 events, has %s', n);
    RAISE NOTICE 'PASS FR-14 full timeline (% rows)', n;

    -- ------------------------------------------- FR-4 operator review
    PERFORM set_config('app.module', 'reports', true);
    INSERT INTO photos (kind, storage_path, mime_type, sha256, uploaded_by)
        VALUES ('report', 'reports/r3.jpg', 'image/jpeg', repeat('e', 64), r3) RETURNING photo_id INTO ph3;
    INSERT INTO issues (problem_type_id, location, area_id) VALUES (pothole, pin3, area) RETURNING issue_id INTO i3;
    INSERT INTO reports (issue_id, reporter_id, problem_type_id, photo_id, location)
        VALUES (i3, r3, pothole, ph3, pin3) RETURNING report_id INTO rep3;
    PERFORM set_config('app.module', 'validation', true);
    INSERT INTO validations (report_id, detected_type_id, severity, confidence, is_infrastructure, model_name)
        VALUES (rep3, NULL, NULL, 0.31, FALSE, 'qwen3-vl:8b');
    UPDATE reports SET status = 'needs_review' WHERE report_id = rep3;
    INSERT INTO review_queue (report_id, reason) VALUES (rep3, 'not_infrastructure');
    BEGIN
        UPDATE review_queue SET decision = 'rejected', reviewed_by = r1, reviewed_at = now() WHERE report_id = rep3;
        RAISE EXCEPTION 'FAIL resident accepted as reviewer';
    EXCEPTION WHEN check_violation THEN NULL; END;
    UPDATE review_queue SET decision = 'rejected', reviewed_by = o1, reviewed_at = now(),
           notes = 'Photo shows a parked car' WHERE report_id = rep3;
    UPDATE reports SET status = 'rejected' WHERE report_id = rep3;
    UPDATE issues SET status = 'rejected' WHERE issue_id = i3;
    INSERT INTO events (event_id, event_name, issue_id, report_id, producer, actor_id, payload, correlation_id)
        VALUES (gen_random_uuid(), 'ReportRejected', i3, rep3, 'validation', o1,
                '{"reason":"not_infrastructure","notes":"Photo shows a parked car"}', gen_random_uuid());
    SELECT count(*) INTO n FROM v_issue_timeline WHERE issue_id = i3 AND label = 'ReportRejected';
    ASSERT n = 1, 'ReportRejected should appear on the rejected issue''s timeline';
    -- only the twelve known event names are accepted
    BEGIN
        INSERT INTO events (event_id, event_name, producer, payload, correlation_id)
            VALUES (gen_random_uuid(), 'IssueDeleted', 'reports', '{}', gen_random_uuid());
        RAISE EXCEPTION 'FAIL unknown event name accepted';
    EXCEPTION WHEN check_violation THEN NULL; END;
    SELECT count(*) INTO n FROM v_issue_queue WHERE issue_id IN (i2, i3);
    ASSERT n = 0, 'merged and rejected issues should not be in the queue';
    RAISE NOTICE 'PASS FR-4 operator rejected flagged report, ReportRejected recorded';

    -- ------------------------------------------- FR-12 notifications are idempotent
    INSERT INTO notifications (user_id, issue_id, event_id, message)
        VALUES (r1, i1, ev, 'We received your pothole report.');
    BEGIN
        INSERT INTO notifications (user_id, issue_id, event_id, message)
            VALUES (r1, i1, ev, 'We received your pothole report.');
        RAISE EXCEPTION 'FAIL duplicate notification accepted';
    EXCEPTION WHEN unique_violation THEN NULL; END;
    RAISE NOTICE 'PASS FR-12 one notification per user per event';

    RAISE NOTICE 'ALL CHECKS PASSED';
END $$;

ROLLBACK;
