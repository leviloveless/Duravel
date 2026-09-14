-- Signup collects a profile BEFORE onboarding does (2026-09-13).
--
-- Until now the `profiles` row was created by ONE writer: `profileUpsertRow` in
-- `app/onboarding/actions.ts`, at the moment an athlete generated their first
-- program. Three things followed from that, and all three were invisible:
--
--   1. THE FREE TRIAL DID NOT START AT SIGNUP. `trial_started_at` defaults to
--      now() on THIS row (migration 0015), so the 14-day clock began at first
--      generation, not at account creation. An athlete who signed up in March
--      and generated in September got a fresh 14 days in September. Nobody had
--      complained, because nobody had been told otherwise — but the new signup
--      page says "your 14-day trial is running", and that sentence is only true
--      if the row exists by then.
--   2. A SIGNED-UP-BUT-NOT-ONBOARDED USER WAS INVISIBLE to anything that reads
--      `profiles` — including the onboarding-nudge email, whose entire audience
--      is exactly those people.
--   3. There was nowhere to record WHICH policy version someone accepted, or
--      when. That is the one fact a refund or billing dispute turns on.
--
-- So signup now creates the row. The seven columns below were NOT NULL because
-- onboarding always had values for them; signup does not, and cannot invent
-- them. Dropping the constraint is safe, and this was MEASURED rather than
-- assumed: outside `supabase/queries.ts` (the type) every reader of these seven
-- is a form PREFILL that already spells it `profile?.x ?? fallback` —
-- `app/profile/profile-form.tsx`, `app/onboarding/onboarding-form.tsx`,
-- `app/program/[id]/edit/page.tsx`. The ENGINE never reads them from here at
-- all: it reads the program's `input_snapshot` (see `snapshotProfile?.age` in
-- `app/program/[id]/page.tsx`), which is why a half-filled profile cannot reach
-- a generated program.
--
-- `age` stays, and is still written, because 31 call sites read it — but it is
-- now DERIVED from `date_of_birth` at signup rather than typed. An age integer
-- is wrong within a year of being stored; a date of birth never goes stale.
-- Onboarding may still overwrite `age` (the athlete can correct it there), so
-- the two can disagree; `date_of_birth` is the authority when it is present.

alter table profiles
  alter column body_weight    drop not null,
  alter column weight_unit    drop not null,
  alter column running_exp    drop not null,
  alter column hybrid_exp     drop not null,
  alter column lifting_exp    drop not null,
  alter column training_class drop not null,
  alter column training_days  drop not null,
  alter column age            drop not null,
  alter column first_name     drop not null;

alter table profiles
  add column if not exists last_name text,
  add column if not exists date_of_birth date,
  add column if not exists primary_sport text,
  add column if not exists terms_accepted_at timestamptz,
  add column if not exists terms_version text,
  -- Account setup (the five-step wizard at /setup) collects two more things.
  -- Height is asked because the sandbag-lunge and wall-ball standards are height
  -- -dependent, and it is stored in INCHES to match `body_weight`/`weight_unit`
  -- already being US units by default rather than introducing a second
  -- convention on the same row.
  add column if not exists height_in numeric,
  -- Null until the athlete finishes (or dismisses) setup. Nullable rather than a
  -- boolean default false so "never saw it" and "chose to skip it" stay
  -- distinguishable from "finished it", which a boolean would flatten.
  add column if not exists setup_completed_at timestamptz;

comment on column profiles.date_of_birth is
  'Captured at signup. The authority for age: profiles.age is derived from this and can go stale. Also the 13+ age gate (Terms of Use).';
comment on column profiles.terms_accepted_at is
  'When the athlete ticked the combined Terms / Privacy / Refund consent at signup. Paired with terms_version.';
comment on column profiles.terms_version is
  'Which published version of the policies was accepted, e.g. "2026-09-13". Bump when any of the three pages materially changes.';
comment on column profiles.primary_sport is
  'Sport chosen at signup, used to pick benchmark tables and default the onboarding sport. NOT the program sport — that lives on the program.';

-- The signup path writes the row; existing athletes keep the row they have.
-- No backfill: every pre-existing profile already has a trial_started_at, and
-- date_of_birth is genuinely unknown for them rather than defaultable.

comment on column profiles.height_in is
  'Height in inches, collected at account setup. Used by the height-dependent station standards (sandbag lunge, wall ball).';
comment on column profiles.setup_completed_at is
  'When the athlete finished or skipped the /setup wizard. NULL means they have not been through it — which is why it is nullable rather than a false-defaulting boolean.';
