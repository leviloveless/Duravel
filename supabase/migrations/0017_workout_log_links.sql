-- Duravel — link synced wearable activities to logged sessions (Sync-Linking feature).
--
-- Linking a synced Strava/Garmin activity to a planned session = writing a
-- workout_log for that session with the activity's actuals + a pointer back to
-- the activity. Because the adaptation engine already consumes workout_logs
-- (sRPE / ACWR / readiness), linked activities feed the training science with no
-- engine changes. `actual_day` records the day a session was actually completed
-- when it differs from the planned `day` (recovery awareness) — the planned
-- day/session_index stay put so session identity + engine mapping are preserved.

alter table workout_logs
  add column if not exists wearable_activity_id uuid references wearable_activities(id) on delete set null,
  add column if not exists source text not null default 'manual'
    check (source in ('manual','strava','garmin')),
  add column if not exists actual_day text
    check (actual_day in ('mon','tue','wed','thu','fri','sat','sun'));

-- A synced activity maps to at most one logged session.
create unique index if not exists workout_logs_wearable_activity_unique
  on workout_logs (wearable_activity_id)
  where wearable_activity_id is not null;
