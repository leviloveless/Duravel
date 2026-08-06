-- 0042: re-run the 0040 self_posted backfill, and note why once was not enough.
--
-- FOUND LIVE 2026-08-06, minutes after 0040 was applied. The program page went
-- straight back to:
--
--     Synced workouts ready to link (4)
--       Run · Thu, Aug 6 · 2.55 mi · 30 min
--       Matches your Zone 1–2 cardio on Thursday · Week 1.   [Confirm match]
--
-- Both of those "Run"s were posted BY Duravel that morning — the threshold-run
-- re-logs. They were never claimed by `markSelfPosted` (they predate patch 23),
-- and they were imported into `wearable_activities` only when `Sync now` ran,
-- which was AFTER 0040's backfill. A backfill is a point-in-time UPDATE: it can
-- only flag rows that exist when it runs.
--
-- So this migration does the cheap half — repeat the UPDATE, which is idempotent
-- and clears whatever has landed since — while the DURABLE half lives in code:
-- `looksSelfPosted` now runs inside `ingestActivities`, so a pre-patch-23 post
-- imported at any point in the future is claimed on arrival and this cannot
-- recur. See `lib/wearables/self-posted.ts`.
--
-- The predicate below is UNCHANGED from 0040 and must stay in step with the TS
-- one: `manual` true AND the name in one of Duravel's own two title formats.
--
--     "Week 1 - Thursday - Threshold Run"   (current, since fd4b58b)
--     "Duravel Run — Week 1"                (the format it replaced; em dash)

update wearable_activities
   set self_posted = true
 where provider = 'strava'
   and not self_posted
   and coalesce((raw ->> 'manual')::boolean, false)
   and (
         raw ->> 'name' ~ '^Week [0-9]+ - '
      or raw ->> 'name' like 'Duravel %'
   );
