-- 0041: workout_logs.strava_activity_id — one session, one Strava activity.
--
-- THE BUG. `POST /api/logs` UPSERTS the log on
-- (program_id, week_number, day, session_index), so re-logging a session edits
-- one row — but the auto-post that follows it called `createManualActivity`
-- unconditionally. Every save therefore created a BRAND NEW Strava activity for
-- the same workout. Seen live 2026-08-06: THREE activities for one week-1
-- Thursday threshold run (19626903555, 19628136284, 19628388163), each one a
-- successive correction, all three still sitting on Strava.
--
-- THE KEY. The log row already IS the identity of a logged session, so the
-- posted activity id belongs on it. Nothing else needs to change: the upsert
-- payload does not list this column, so re-logging preserves it, and a log
-- deleted with its program takes the pointer with it.
--
-- ⚠️ WHY THE ACTIVITY CANNOT SIMPLY BE REWRITTEN. Strava's `UpdatableActivity`
-- accepts only name, description, type/sport_type, gear_id, commute, trainer and
-- private — NOT distance, elapsed_time or start_date — and the v3 API exposes no
-- DELETE for activities at all. So a re-log can refresh the TEXT of the activity
-- it already posted, and nothing more; the numbers on Strava stay as first
-- posted. Levi's call, 2026-08-06: correct text beats a duplicate.
--
-- Additive, nullable, idempotent. Existing rows keep a NULL pointer, which reads
-- as "never auto-posted" — so the next save on an old log posts once and claims
-- the id, and the duplicates already on Strava are left alone (there is no API
-- to remove them).

alter table workout_logs
  add column if not exists strava_activity_id text;

comment on column workout_logs.strava_activity_id is
  'Strava activity id created by the auto-post for this logged session. Present = already posted, so a re-log refreshes the activity''s name/description instead of creating a second one. Cleared when Strava reports the activity is gone (the athlete deleted it), which lets the next save post afresh.';

-- Reverse lookup ("which session produced this activity?") for support and for
-- reconciling against wearable_activities.self_posted.
create index if not exists workout_logs_strava_activity_idx
  on workout_logs (strava_activity_id)
  where strava_activity_id is not null;
