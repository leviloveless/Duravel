-- Canonical wearable schema (multi-source health integrations, spec
-- docs/future-phases/20 §1.1). Brings the repo schema up to the shared canonical
-- model so every provider — Strava, Oura, Apple Health, and WHOOP/Garmin later —
-- feeds ONE ingestion pipeline:
--   * widen the provider allow-list to 'whoop' + 'apple_health';
--   * extend wearable_daily to the canonical daily-metrics shape (sleep stages,
--     readiness/recovery score, respiratory rate, VO2max);
--   * add cross-source dedupe columns to wearable_activities (dedupe_group +
--     is_primary), stamped by the shared ingest writer (lib/wearables/pipeline);
--   * add a generalized wearable_oauth_states table for PKCE/state.
--
-- Fully additive + idempotent. No data is destroyed; existing rows keep working
-- (is_primary defaults true, so nothing is hidden until the dedupe pass demotes a
-- confirmed duplicate).

-- --- 1. Widen provider CHECK constraints (add whoop + apple_health) -----------
alter table wearable_connections drop constraint if exists wearable_connections_provider_check;
alter table wearable_connections
  add constraint wearable_connections_provider_check
  check (provider in ('strava','garmin','oura','whoop','apple_health'));

alter table wearable_activities drop constraint if exists wearable_activities_provider_check;
alter table wearable_activities
  add constraint wearable_activities_provider_check
  check (provider in ('strava','garmin','oura','whoop','apple_health'));

alter table wearable_daily drop constraint if exists wearable_daily_provider_check;
alter table wearable_daily
  add constraint wearable_daily_provider_check
  check (provider in ('strava','garmin','oura','whoop','apple_health'));

-- --- 2. wearable_activities: canonical slug + cross-source dedupe -------------
--   activity_type = normalized slug shared across sources (lib/wearables/pipeline
--   normalizeActivityType); dedupe_group clusters the same real-world session
--   seen from multiple sources; is_primary marks the one canonical record per
--   cluster (default true so un-clustered rows always render).
alter table wearable_activities add column if not exists activity_type text;
alter table wearable_activities add column if not exists dedupe_group text;
alter table wearable_activities add column if not exists is_primary boolean not null default true;

create index if not exists wearable_activities_dedupe_group_idx
  on wearable_activities (user_id, dedupe_group);

-- --- 3. wearable_daily: canonical daily-metrics columns -----------------------
--   (spec §1.1 "wearable_daily_metrics"). All nullable — a provider fills only
--   what it reports; cross-provider merging happens at read time (normalize.ts).
alter table wearable_daily add column if not exists sleep_total_min numeric;
alter table wearable_daily add column if not exists sleep_deep_min numeric;
alter table wearable_daily add column if not exists sleep_rem_min numeric;
alter table wearable_daily add column if not exists sleep_light_min numeric;
alter table wearable_daily add column if not exists sleep_awake_min numeric;
alter table wearable_daily add column if not exists readiness_score numeric;
alter table wearable_daily add column if not exists respiratory_rate numeric;
alter table wearable_daily add column if not exists vo2max numeric;

-- --- 4. wearable_oauth_states (generalized PKCE / CSRF state) -----------------
--   Holds the short-lived OAuth `state` + PKCE `code_verifier` between the
--   connect redirect and the callback, for providers that need server-side PKCE
--   (WHOOP confidential-client, future Garmin). The verifier is a secret, so —
--   like wearable_connections — RLS is enabled with NO policies: service-role
--   only. TTL is enforced in code (expires_at); a periodic prune can sweep old
--   rows. Strava/Oura currently use an httpOnly cookie for state; this table is
--   the canonical home as more providers land.
create table if not exists wearable_oauth_states (
  state text primary key,
  user_id uuid not null references profiles(id) on delete cascade,
  provider text not null check (provider in ('strava','garmin','oura','whoop','apple_health')),
  code_verifier text,
  redirect_uri text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create index if not exists wearable_oauth_states_expiry_idx
  on wearable_oauth_states (expires_at);

alter table wearable_oauth_states enable row level security;
-- No policies on purpose: only the service-role admin client may touch this table.
