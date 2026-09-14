-- Events: races an athlete can record with or without a program (2026-09-14).
--
-- WHY THIS PROMOTES `races` RATHER THAN ADDING A SECOND TABLE.
--
-- `races` (0001) was WRITE-ONLY. `app/onboarding/actions.ts` inserts rows at
-- generation and replaces them on regenerate, and **nothing anywhere reads them
-- back** — the engine gets its race dates from the program's `input_snapshot`,
-- and every surface that shows a race reads `week.raceDay` out of the generated
-- `program_data`. So the concern that widening it would destabilise the
-- generation path had it backwards: the generation path only writes here, and a
-- new `events` table would have left a vestigial twin that could disagree with
-- it about the same race.
--
-- The table already stored (date, priority), which is exactly an event's core.
-- It was only ever missing an owner and a name.
--
-- ⚠️ THE POLICY HAD TO BE REPLACED, NOT KEPT. The 0001 policy scopes access
-- through the owning program:
--
--     exists (select 1 from programs p where p.id = races.program_id ...)
--
-- With `program_id` now nullable, that EXISTS is FALSE for every athlete-created
-- event — so they would be invisible to SELECT and silently rejected on INSERT,
-- with no error a caller could read. That is this repo's documented
-- "RLS silent noop" failure shape, and it would have made the entire feature
-- look broken for reasons nothing logged. The policy now scopes on `user_id`,
-- which is the column that actually says who owns the row.
--
-- ⚠️ `source` EXISTS SO REGENERATION CANNOT EAT AN ATHLETE'S EVENTS. Regenerate
-- does `delete().eq("program_id", programId)` before re-inserting. Once an
-- athlete's event can be LINKED to a program, that delete would take it with it.
-- Rows the generator owns are `source = 'program'` and are the only ones it may
-- delete; anything the athlete created stays `'athlete'` and survives.

-- Idempotent: these migrations are applied BY HAND, and a re-run that fails
-- halfway leaves a database in a state nobody wrote down. Every statement below
-- is safe to run twice.
do $$
begin
  if exists (select 1 from pg_tables where schemaname = 'public' and tablename = 'races')
     and not exists (select 1 from pg_tables where schemaname = 'public' and tablename = 'events')
  then
    alter table races rename to events;
  end if;
end $$;

alter table events
  add column if not exists user_id uuid references auth.users on delete cascade,
  add column if not exists name text,
  add column if not exists sport text,
  add column if not exists goal_time text,
  add column if not exists notes text,
  add column if not exists source text not null default 'athlete',
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

-- Backfill before the NOT NULL: every existing row came from a program, and the
-- program knows its owner.
update events e
   set user_id = p.user_id
  from programs p
 where p.id = e.program_id
   and e.user_id is null;

-- Everything that existed before this migration was written by the generator.
update events set source = 'program' where program_id is not null;

-- Any orphan with no program and no owner cannot be attributed to anybody and
-- would block the NOT NULL below. There should be none (program_id was NOT NULL
-- until this migration), but a delete that cannot be wrong is cheaper than a
-- migration that fails halfway on someone else's database.
delete from events where user_id is null;

alter table events alter column user_id set not null;
alter table events alter column program_id drop not null;

-- Re-running must not re-mark athlete rows as program rows: the update above is
-- guarded on program_id, and an athlete event has none. Stated because it is the
-- one statement here whose idempotency is not obvious from its own shape.

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'events_source_check'
  ) then
    alter table events
      add constraint events_source_check check (source in ('program', 'athlete'));
  end if;
end $$;

drop policy if exists "races: own via program" on events;

create policy "events: own rows" on events
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create index if not exists events_user_date_idx on events (user_id, race_date);

comment on table events is
  'Races an athlete has recorded. Promoted from the write-only `races` table (0047). program_id is nullable: an event can exist with no block built for it.';
comment on column events.source is
  'program = written by the generator for a specific block, and the only rows regeneration may delete. athlete = created by hand and never deleted by regeneration.';
comment on column events.program_id is
  'The block built for this event, when there is one. NULL is normal and is the whole point of the table.';
