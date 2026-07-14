-- HyroxAI — Phase 1: wearable integrations (Strava, Garmin). Web-first OAuth.
--
-- SECURITY MODEL
--   wearable_connections stores OAuth tokens (secrets). Unlike the other tables it
--   grants the authenticated role NO access at all: RLS is enabled with no policies,
--   so tokens can never be selected through the anon/authenticated key. ALL reads and
--   writes happen server-side via the service-role admin client, always scoped
--   explicitly by user_id (mirrors the Stripe-webhook / subscriptions pattern).
--
--   The staging tables (wearable_activities, wearable_daily) hold no secrets, so they
--   use normal read-own RLS for the UI/engine; writes are still service-role only
--   (the sync job), so there are deliberately no insert/update policies.

-- --- OAuth connections (SECRETS — no authenticated access) ---------------------
create table if not exists wearable_connections (
  user_id uuid not null references profiles(id) on delete cascade,
  provider text not null check (provider in ('strava','garmin')),
  access_token text not null,
  refresh_token text,
  expires_at timestamptz,
  scope text,
  provider_athlete_id text,
  last_sync_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, provider)
);

alter table wearable_connections enable row level security;
-- No policies on purpose: only the service-role admin client may touch this table.

-- --- Imported activities (no secrets; read-own) --------------------------------
create table if not exists wearable_activities (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  provider text not null check (provider in ('strava','garmin')),
  external_id text not null,          -- provider's own activity id
  type text,                          -- run / ride / workout / ...
  start_time timestamptz,
  duration_s int,
  distance_m numeric,
  avg_hr numeric,
  max_hr numeric,
  raw jsonb,
  created_at timestamptz not null default now(),
  unique (user_id, provider, external_id)
);

create index if not exists wearable_activities_user_time_idx
  on wearable_activities (user_id, start_time desc);

alter table wearable_activities enable row level security;
create policy "wearable_activities: select own" on wearable_activities
  for select using (auth.uid() = user_id);
-- Writes are service-role only (sync job): no insert/update/delete policy.

-- --- Daily recovery metrics (resting HR, HRV, sleep) → feeds readiness ---------
create table if not exists wearable_daily (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  provider text not null check (provider in ('strava','garmin')),
  date date not null,
  resting_hr numeric,
  hrv numeric,
  sleep_score numeric,
  raw jsonb,
  created_at timestamptz not null default now(),
  unique (user_id, provider, date)
);

create index if not exists wearable_daily_user_date_idx
  on wearable_daily (user_id, date desc);

alter table wearable_daily enable row level security;
create policy "wearable_daily: select own" on wearable_daily
  for select using (auth.uid() = user_id);
