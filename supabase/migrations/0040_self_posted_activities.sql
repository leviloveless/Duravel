-- 0040: wearable_activities.self_posted — "Duravel wrote this activity" (Levi, 2026-08-06).
--
-- THE LOOP THIS CLOSES. Auto-post writes a manual Strava activity from the PLAN.
-- The next sync imports it back. `suggest-data.ts` filters candidates on nothing
-- but "unlinked + same day", so Duravel then offered to link its own post to the
-- very session that produced it:
--
--     Synced workouts ready to link (4)
--       Run · Thu, Aug 6 · 1.00 mi · 8 min
--       Matches your Threshold run on Thursday · Week 1.   [Confirm match]
--
-- Confirming that makes the plan its own evidence: the "actuals" become the
-- planned numbers, and adherence, readiness and the weekly adaptation all read a
-- perfectly-executed week no matter what the athlete actually did. Seen live
-- 2026-08-06 — and the suggestion carried the stale 1.00 mi figure from before
-- patch 21, so it would have written a wrong actual too.
--
-- Additive + nullable-safe + idempotent. Defaults false, so nothing changes for
-- any activity until it is explicitly marked.
--
-- ⚠️ `self_posted` is NOT in `activityToRow`, which is deliberate: the sync
-- upsert lists its own columns, so `ON CONFLICT DO UPDATE` never touches this
-- one. The flag is written once, when Duravel creates the activity, and survives
-- every later re-sync of the same external_id.

alter table wearable_activities
  add column if not exists self_posted boolean not null default false;

comment on column wearable_activities.self_posted is
  'True when Duravel itself created this activity (Strava auto-post). Such an activity is the PLAN, not a record of training — it is never offered as a link candidate for a planned session.';

create index if not exists wearable_activities_user_selfposted_idx
  on wearable_activities (user_id) where self_posted;

-- --- Backfill the auto-posts that already exist ------------------------------
--
-- Activities posted before this column existed have no marker, and they are
-- exactly the ones sitting in the suggestion list today. `raw` already holds the
-- whole Strava payload, so they can be identified after the fact:
--
--   * `manual` is true      — Duravel always creates activities via the manual
--                             endpoint; a watch-recorded activity is never manual.
--   * the NAME matches      — narrows it to Duravel's own two title formats and
--                             spares an athlete's own manual Strava entries,
--                             which stay linkable.
--
--       "Week 1 - Thursday - Threshold Run"   (current, since fd4b58b)
--       "Duravel Run — Week 1"                (the format it replaced)
--
-- Note the em dash in the legacy pattern; it is what that builder emitted.
update wearable_activities
   set self_posted = true
 where provider = 'strava'
   and coalesce((raw ->> 'manual')::boolean, false)
   and (
         raw ->> 'name' ~ '^Week [0-9]+ - '
      or raw ->> 'name' like 'Duravel %'
   );
