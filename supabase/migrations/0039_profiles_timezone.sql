-- 0039: profiles.timezone — the athlete's IANA time zone (Levi, 2026-08-06).
--
-- Two things were quietly wrong for want of this column:
--
--   1. Strava auto-post stamped every activity with `new Date().toISOString()`
--      in `start_date_local` — a UTC string in a field Strava treats as LOCAL
--      wall clock. An 8:12am CDT workout landed on Strava at 1:12 PM. Seen live
--      2026-08-06 on activity 19626903555.
--   2. `claim_generation_slot(..., p_calendar_day => true)` counted from
--      `date_trunc('day', now())` — 00:00 UTC. An athlete adapting at 8pm CDT
--      had their "once per calendar day" reset four hours later, mid-evening.
--      Migration 0019 flagged this exact gap and named this exact fix.
--
-- Additive + nullable + idempotent. Every reader coalesces to 'UTC', so code
-- deployed BEFORE this migration is applied behaves exactly as it does today,
-- and an athlete whose zone has not been captured yet is unaffected.
--
-- No RLS change: profiles already carries the "profiles: own row" policy, which
-- is `for all` and therefore covers this column.
--
-- NOTE: `Apple/Part6_push/db/Duravel_iOS_Part6_notification_prefs.sql` (design
-- only, never applied — iOS is parked) also declares a `timezone` on a separate
-- `notification_prefs` table. If that work is ever picked up, it should READ
-- this column rather than introduce a second source of truth.

alter table profiles
  add column if not exists timezone text;

comment on column profiles.timezone is
  'IANA time zone (e.g. "America/Chicago"), captured from the browser at onboarding and refreshed on later visits. NULL until captured; every reader falls back to UTC.';

-- Recreate `claim_generation_slot` so the calendar-day window runs from the
-- athlete's local midnight. The SIGNATURE IS UNCHANGED, deliberately: the two
-- callers (/api/generate 4-arg, /api/adapt/apply 5-arg) need no edit, and
-- keeping one overload avoids the PostgREST ambiguity that 0019 called out.
-- The zone is read inside the function from the already-resolved v_user.
create or replace function claim_generation_slot(
  p_kind text,
  p_program_id uuid,
  p_limit int,
  p_window_hours int,
  p_calendar_day boolean default false
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_tz text;
  v_since timestamptz;
  v_count int;
  v_id uuid;
begin
  if v_user is null then
    raise exception 'not authenticated';
  end if;

  -- The athlete's local midnight, or UTC midnight when we don't know their zone.
  -- A bad/stale IANA name would raise from `at time zone`, which would fail the
  -- whole request over a rate-limit detail, so it falls back instead.
  if p_calendar_day then
    select timezone into v_tz from profiles where id = v_user;
    begin
      v_since := date_trunc('day', now() at time zone coalesce(v_tz, 'UTC'))
                   at time zone coalesce(v_tz, 'UTC');
    exception when others then
      v_since := date_trunc('day', now());
    end;
  else
    v_since := now() - make_interval(hours => p_window_hours);
  end if;

  -- Serialize concurrent claims for this user (released at transaction end).
  perform pg_advisory_xact_lock(hashtextextended(v_user::text, 0));

  if p_kind = 'adapt' then
    select count(*) into v_count
      from generation_events
      where user_id = v_user and kind = 'adapt' and created_at >= v_since;
  else
    select count(*) into v_count
      from generation_events
      where user_id = v_user and kind <> 'adapt' and created_at >= v_since;
  end if;

  if v_count >= p_limit then
    return null;
  end if;

  insert into generation_events (user_id, program_id, kind)
    values (v_user, p_program_id, p_kind)
    returning id into v_id;

  return v_id;
end;
$$;

grant execute on function claim_generation_slot(text, uuid, int, int, boolean) to authenticated;
