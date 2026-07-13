-- Forward readiness check-ins (Review #7 — Hooper wellness + optional RHR/HRV).
-- One row per (program, week). Feeds the adaptation engine's forward signal so
-- it can soften an upcoming week before a bad one. Optional per week.

create table if not exists readiness_checkins (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  program_id uuid not null references programs(id) on delete cascade,
  week_number int not null check (week_number between 1 and 24),
  sleep int not null check (sleep between 1 and 7),
  fatigue int not null check (fatigue between 1 and 7),
  stress int not null check (stress between 1 and 7),
  soreness int not null check (soreness between 1 and 7),
  resting_hr int check (resting_hr is null or resting_hr between 25 and 150),
  hrv numeric check (hrv is null or hrv between 1 and 400),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (program_id, week_number)
);

create index if not exists readiness_checkins_program_week_idx
  on readiness_checkins (program_id, week_number);

alter table readiness_checkins enable row level security;

create policy "readiness_checkins: select own" on readiness_checkins
  for select using (auth.uid() = user_id);
create policy "readiness_checkins: insert own" on readiness_checkins
  for insert with check (auth.uid() = user_id);
create policy "readiness_checkins: update own" on readiness_checkins
  for update using (auth.uid() = user_id);
create policy "readiness_checkins: delete own" on readiness_checkins
  for delete using (auth.uid() = user_id);
