-- Oura wearable provider (roadmap: multi-source health integrations, spec
-- docs/future-phases/20). Oura is the first cloud adapter built after the Garmin
-- program was paused. It reuses the existing wearable_* tables unchanged; the
-- only schema change needed is to widen the provider CHECK constraints so 'oura'
-- rows are allowed. Everything else (RLS, indexes, unique keys) already fits.
--
-- Column-merge concern (spec §0.3) does not apply here: Oura owns its own
-- (user_id,'oura',date) rows in wearable_daily, computed in full each sync, so a
-- straight upsert never nulls another provider's columns.

alter table wearable_connections drop constraint if exists wearable_connections_provider_check;
alter table wearable_connections
  add constraint wearable_connections_provider_check
  check (provider in ('strava','garmin','oura'));

alter table wearable_activities drop constraint if exists wearable_activities_provider_check;
alter table wearable_activities
  add constraint wearable_activities_provider_check
  check (provider in ('strava','garmin','oura'));

alter table wearable_daily drop constraint if exists wearable_daily_provider_check;
alter table wearable_daily
  add constraint wearable_daily_provider_check
  check (provider in ('strava','garmin','oura'));
