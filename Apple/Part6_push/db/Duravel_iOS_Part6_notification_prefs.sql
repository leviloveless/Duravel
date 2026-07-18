-- Duravel iOS — Part 6
-- notification_preferences: per-user channel + category opt-in and quiet hours.
-- This UNIFIES cadence with the existing lifecycle EMAIL system: the same event
-- fan-outs read both the email flag (existing) and the push flag (new) here.
--
-- If you already have an email-preferences table, you can either:
--   (a) add the push_* / quiet_* columns to it, or
--   (b) keep this separate table (default) and join on user_id.
-- This file assumes (b) and is additive/idempotent.

do $$
begin
  if not exists (select 1 from pg_type where typname = 'notif_category') then
    -- Mirror the lifecycle email event families. Extend as new events land.
    create type public.notif_category as enum (
      'trial_ending',      -- trial-ending lifecycle event
      'workout_reminder',  -- scheduled session nudge
      'streak',            -- streak at-risk / milestone
      'plan_updated',      -- coach updated your program
      'account',           -- security/billing (transactional — see note)
      'marketing'          -- announcements, promos
    );
  end if;
end$$;

create table if not exists public.notification_preferences (
  user_id            uuid primary key references auth.users (id) on delete cascade,

  -- Master switches
  push_enabled       boolean not null default true,   -- user-level push kill switch
  email_enabled      boolean not null default true,   -- mirrors existing email master (keep in sync)

  -- Per-category push opt-in. account/security stays true and is treated as
  -- transactional (see send path: category='account' bypasses marketing gates
  -- but STILL respects push_enabled + OS permission).
  push_trial_ending    boolean not null default true,
  push_workout_reminder boolean not null default true,
  push_streak          boolean not null default true,
  push_plan_updated    boolean not null default true,
  push_marketing       boolean not null default false,  -- opt-IN, off by default

  -- Quiet hours (local to the user). If start=end, quiet hours disabled.
  quiet_hours_enabled  boolean not null default true,
  quiet_start          time not null default '21:00',   -- 9pm local
  quiet_end            time not null default '08:00',    -- 8am local
  timezone             text not null default 'UTC',      -- IANA tz, set from device

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.notification_preferences is
  'Per-user push/email opt-in by category + quiet hours. Unifies cadence across channels.';

-- touch updated_at
create or replace function public.tg_notif_prefs_touch()
returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end; $$;

drop trigger if exists notif_prefs_touch on public.notification_preferences;
create trigger notif_prefs_touch
  before update on public.notification_preferences
  for each row execute function public.tg_notif_prefs_touch();

-- Auto-create a default prefs row on signup so the send path never NULL-checks.
create or replace function public.tg_create_notif_prefs()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.notification_preferences (user_id)
  values (new.id)
  on conflict (user_id) do nothing;
  return new;
end; $$;

drop trigger if exists on_auth_user_created_notif_prefs on auth.users;
create trigger on_auth_user_created_notif_prefs
  after insert on auth.users
  for each row execute function public.tg_create_notif_prefs();

-- Backfill existing users
insert into public.notification_preferences (user_id)
select id from auth.users
on conflict (user_id) do nothing;

-- ─────────────────────────────────────────────────────────────────────────────
-- RLS — owner-only. service_role (send path) bypasses.
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.notification_preferences enable row level security;
alter table public.notification_preferences force row level security;

drop policy if exists notif_prefs_select_own on public.notification_preferences;
create policy notif_prefs_select_own
  on public.notification_preferences for select
  using (auth.uid() = user_id);

drop policy if exists notif_prefs_upsert_own on public.notification_preferences;
create policy notif_prefs_upsert_own
  on public.notification_preferences for insert
  with check (auth.uid() = user_id);

drop policy if exists notif_prefs_update_own on public.notification_preferences;
create policy notif_prefs_update_own
  on public.notification_preferences for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- Helper: does this user allow a push for category X *right now*?
-- Evaluates master switch, per-category flag, and quiet hours in the user's tz.
-- Returns: 'send' | 'suppressed_pref' | 'suppressed_quiet'
-- The send path uses this so the logic lives in one place and can be unit-tested
-- in SQL. Quiet-hours returns 'suppressed_quiet' so caller can DEFER rather than
-- drop (see edge fn).
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.push_gate(
  p_user_id  uuid,
  p_category public.notif_category
)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  pref public.notification_preferences;
  now_local time;
  in_quiet boolean;
begin
  select * into pref from public.notification_preferences where user_id = p_user_id;
  if not found then
    -- no prefs row => treat as defaults (push on, marketing off)
    return case when p_category = 'marketing' then 'suppressed_pref' else 'send' end;
  end if;

  -- master kill switch (account/security still honors this — no OS permission = no push anyway)
  if not pref.push_enabled then
    return 'suppressed_pref';
  end if;

  -- per-category opt-in
  if p_category = 'trial_ending'     and not pref.push_trial_ending     then return 'suppressed_pref'; end if;
  if p_category = 'workout_reminder' and not pref.push_workout_reminder then return 'suppressed_pref'; end if;
  if p_category = 'streak'           and not pref.push_streak           then return 'suppressed_pref'; end if;
  if p_category = 'plan_updated'     and not pref.push_plan_updated     then return 'suppressed_pref'; end if;
  if p_category = 'marketing'        and not pref.push_marketing        then return 'suppressed_pref'; end if;
  -- category 'account' has no per-category flag: transactional, always passes here.

  -- quiet hours — 'account' (security/billing) is exempt and sends anytime.
  if p_category <> 'account' and pref.quiet_hours_enabled then
    now_local := (now() at time zone pref.timezone)::time;
    if pref.quiet_start <= pref.quiet_end then
      in_quiet := now_local >= pref.quiet_start and now_local < pref.quiet_end;
    else
      -- window wraps midnight (e.g. 21:00 -> 08:00)
      in_quiet := now_local >= pref.quiet_start or now_local < pref.quiet_end;
    end if;
    if in_quiet then
      return 'suppressed_quiet';
    end if;
  end if;

  return 'send';
end;
$$;

grant execute on function public.push_gate(uuid, public.notif_category) to service_role;
