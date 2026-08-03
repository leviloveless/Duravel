-- Extra (unplanned) workouts.
--
-- workout_logs records what the athlete did against a session the ENGINE
-- planned — it is keyed on that session's position, (program, week, day,
-- index-within-day), and the logs API rejects a position with no planned
-- session. So a workout done on a rest day, or any second session the program
-- didn't ask for, had nowhere to live.
--
-- These rows are deliberately NOT part of the program blob: the weekly summary
-- is guaranteed to equal the engine's prescribed volume (see
-- lib/generation/reconcile.ts), and folding unplanned work into it would break
-- that guarantee. Extras are surfaced alongside the week as an addition, and
-- they survive Recalculate — which replaces program_data.weeks wholesale.
--
-- `activity_id` is set when the athlete attached an already-synced wearable
-- activity instead of typing the workout in; the unique constraint stops the
-- same activity being added to one program twice (NULLs repeat freely in
-- Postgres, so manual entries are unaffected).

create table if not exists public.extra_workouts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  program_id uuid not null references programs(id) on delete cascade,
  week_number int not null check (week_number between 1 and 24),
  day text not null check (day in ('mon','tue','wed','thu','fri','sat','sun')),
  kind text not null check (kind in ('run','lift','hybrid','cardio','other')),
  title text check (char_length(title) <= 80),
  duration_min int check (duration_min between 1 and 600),
  distance_miles numeric check (distance_miles >= 0 and distance_miles <= 100),
  avg_hr int check (avg_hr between 40 and 230),
  goal_zone int check (goal_zone between 1 and 5),
  rpe int check (rpe between 1 and 10),
  note text check (char_length(note) <= 280),
  activity_id uuid references wearable_activities(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (program_id, activity_id)
);

-- Hot path: "all extras for this program", sliced per week by the program view.
create index if not exists extra_workouts_program_week_idx
  on public.extra_workouts (program_id, week_number);

alter table public.extra_workouts enable row level security;

create policy "extra_workouts: select own" on public.extra_workouts
  for select using (auth.uid() = user_id);

create policy "extra_workouts: insert own" on public.extra_workouts
  for insert with check (auth.uid() = user_id);

create policy "extra_workouts: update own" on public.extra_workouts
  for update using (auth.uid() = user_id);

create policy "extra_workouts: delete own" on public.extra_workouts
  for delete using (auth.uid() = user_id);
