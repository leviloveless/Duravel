-- Performance logging (Phase 2, Milestone 8 — see phase2-spec.md §5).
-- One row per logged session. Logs are written incrementally and queried
-- per-week (the opposite access pattern from the program JSONB blob), so they
-- get their own normalized table. Upserts key on the session's position in the
-- program: (program, week, day, index-within-day).

create table if not exists workout_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  program_id uuid not null references programs(id) on delete cascade,
  week_number int not null check (week_number between 1 and 24),
  day text not null check (day in ('mon','tue','wed','thu','fri','sat','sun')),
  session_index int not null check (session_index >= 0),
  status text not null check (status in ('completed','partial','skipped')),
  rpe int check (rpe between 1 and 10),
  actuals jsonb,                 -- { durationMin?, distanceMiles?, avgHr? }
  note text check (char_length(note) <= 280),
  logged_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (program_id, week_number, day, session_index)
);

-- Hot path: "all logs for this program" (program view) and per-week slices.
create index if not exists workout_logs_program_week_idx
  on workout_logs (program_id, week_number);

alter table workout_logs enable row level security;

create policy "workout_logs: select own" on workout_logs
  for select using (auth.uid() = user_id);

create policy "workout_logs: insert own" on workout_logs
  for insert with check (auth.uid() = user_id);

create policy "workout_logs: update own" on workout_logs
  for update using (auth.uid() = user_id);

create policy "workout_logs: delete own" on workout_logs
  for delete using (auth.uid() = user_id);
