-- Daily resting HR + HRV log (Tasks addition #7). One row per (user, date),
-- entered manually by the athlete. The program view rolls these up into a
-- weekly average resting HR and HRV per program week. Distinct from
-- readiness_checkins (weekly, per-program) and wearable_daily (sync-only,
-- service-role writes): this is user-writable, program-agnostic daily data.

create table if not exists daily_metrics (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  date date not null,
  resting_hr int check (resting_hr is null or resting_hr between 25 and 150),
  hrv numeric check (hrv is null or hrv between 1 and 400),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, date)
);

create index if not exists daily_metrics_user_date_idx
  on daily_metrics (user_id, date desc);

alter table daily_metrics enable row level security;

create policy "daily_metrics: select own" on daily_metrics
  for select using (auth.uid() = user_id);
create policy "daily_metrics: insert own" on daily_metrics
  for insert with check (auth.uid() = user_id);
create policy "daily_metrics: update own" on daily_metrics
  for update using (auth.uid() = user_id);
create policy "daily_metrics: delete own" on daily_metrics
  for delete using (auth.uid() = user_id);
