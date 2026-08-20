-- 0044: extra_workouts.strava_activity_id — one extra workout, one Strava activity.
--
-- Extras can now be pushed to Strava on demand (Levi, 2026-08-19). That button
-- can be pressed twice, and the athlete can edit an extra and push it again
-- after correcting a duration — so without a stored pointer the second press
-- would leave a second copy on Strava, which is exactly the bug migration 0041
-- fixed for logged sessions (THREE activities for one week-1 threshold run).
--
-- The same key applies for the same reason: the extra row IS the identity of
-- that workout, so the id of the activity it posted belongs on it.
-- `updateExtraWorkout` lists its columns explicitly and does not include this
-- one, so editing an extra preserves the pointer, and deleting the extra (or its
-- program) takes it with it.
--
-- ⚠️ Strava's `UpdatableActivity` accepts only name, description, type/sport_type,
-- gear_id, commute, trainer and private — NOT distance, elapsed_time or
-- start_date — and there is no DELETE for activities at all. So a second push
-- refreshes the TEXT of the activity it already created and nothing more; the
-- numbers stay as first posted. Same trade Levi took on 2026-08-06: correct text
-- beats a duplicate.
--
-- Additive, nullable, idempotent. Existing rows read as "never pushed".

alter table extra_workouts
  add column if not exists strava_activity_id text;

comment on column extra_workouts.strava_activity_id is
  'Strava activity id created when this extra workout was pushed to Strava. Present = already pushed, so pushing again refreshes that activity''s name/description instead of creating a second one. Re-set when Strava reports the activity is gone (the athlete deleted it), which lets the next push post afresh.';

-- Reverse lookup ("which extra produced this activity?") for support and for
-- reconciling against wearable_activities.self_posted.
create index if not exists extra_workouts_strava_activity_idx
  on extra_workouts (strava_activity_id)
  where strava_activity_id is not null;
