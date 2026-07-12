-- Adaptive weekly updates (Phase 2, Milestone 10 — see phase2-spec.md §5).
--
-- One row per weekly review the user resolved (applied OR dismissed). The row
-- is the audit trail: which deterministic rule fired, the signals that drove
-- it, and a snapshot of the replaced week (for undo/audit). A week with a row
-- here is "reviewed" and its logs are frozen when the decision was applied.

create table if not exists adaptations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  program_id uuid not null references programs(id) on delete cascade,
  week_number int not null check (week_number between 1 and 24),   -- reviewed week
  target_week int not null check (target_week between 1 and 24),   -- revised week
  decision text not null check (decision in ('applied','dismissed')),
  rule_applied text not null check (rule_applied in
    ('none','hold','early_deload','protect_long_run','earned_bump','re_anchor')),
  signals jsonb,                 -- computed compliance/strain inputs (audit)
  previous_week jsonb,           -- replaced week (program week + skeleton targets)
  revised_targets jsonb,         -- { targetMileage, targetCardioMinutes, microWeek? }
  created_at timestamptz not null default now(),
  unique (program_id, week_number)
);

create index if not exists adaptations_program_idx
  on adaptations (program_id, week_number);

alter table adaptations enable row level security;

-- Append-only from the client's perspective: no update/delete policies.
create policy "adaptations: select own" on adaptations
  for select using (auth.uid() = user_id);

create policy "adaptations: insert own" on adaptations
  for insert with check (auth.uid() = user_id);

-- Tag generation_events by what kind of run consumed the tokens, so the
-- 3/day generate limit and the 7/day adapt limit count independently and the
-- daily-cost query can group by kind. Existing rows default to 'create'.
alter table generation_events
  add column if not exists kind text not null default 'create'
    check (kind in ('create','recalculate','adapt'));
