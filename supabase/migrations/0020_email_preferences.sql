-- 0020: email_preferences — lifecycle email consent (docs/future-phases/07 §3, spec table 0019).
--
-- One row per user: per-category opt-outs + a global kill switch. Seeded lazily on
-- first read/write by the email module. Billing/service categories (welcome, receipts,
-- trial-ending) are intentionally NOT stored here — they are non-suppressible and only
-- honor the hard global suppression list (0023).
--
-- RLS: the user owns their row and the preference-center server action UPSERTS it, so
-- we need SELECT + INSERT + UPDATE policies (the INSERT policy is what makes the first
-- save work — without it the upsert's insert half fails silently under RLS). The
-- service-role admin client bypasses RLS for lazy seed / backfill, so it needs no policy.
--
-- (Numbering note: the 07 spec calls this 0019, but 0019 was taken by
--  0019_calendar_day_rate_limit.sql — this set is renumbered 0020–0025.)

create table if not exists email_preferences (
  user_id          uuid primary key references auth.users(id) on delete cascade,
  unsubscribed_all boolean not null default false,
  onboarding       boolean not null default true,
  weekly_summary   boolean not null default true,
  race             boolean not null default true,
  milestone        boolean not null default true,
  winback          boolean not null default true,
  engagement       boolean not null default true,
  product          boolean not null default true,
  updated_at       timestamptz not null default now()
);

alter table email_preferences enable row level security;

create policy "email_preferences: read own" on email_preferences
  for select using (auth.uid() = user_id);
create policy "email_preferences: insert own" on email_preferences
  for insert with check (auth.uid() = user_id);
create policy "email_preferences: update own" on email_preferences
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

comment on table email_preferences is
  'Per-category lifecycle-email opt-outs + global kill switch. Service/billing categories are not stored here (non-suppressible). Seeded lazily by lib/email.';
