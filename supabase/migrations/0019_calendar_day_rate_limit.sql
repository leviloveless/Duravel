-- 0019: calendar-day counting option for claim_generation_slot + retuned limits.
--
-- Program generation is now 2 per rolling 7 days (the /api/generate route passes
-- p_limit=2, p_window_hours=168 — no function change needed for that).
--
-- Weekly adaptation is now 1 per CALENDAR day. A rolling 24h window is not the
-- same as "once per calendar day", so we add p_calendar_day: when true, the
-- count runs from date_trunc('day', now()) — i.e. since 00:00 in the database
-- timezone (UTC on Supabase) — instead of a rolling window. The /api/adapt/apply
-- route passes p_calendar_day => true. The UI warns the user that applying locks
-- re-adaptation until the next calendar day.
--
-- NOTE: resets at 00:00 UTC (no per-user timezone is stored yet). To make the
-- reset land at the user's local midnight, add a profiles.timezone column and
-- use date_trunc('day', now() at time zone p_timezone).
--
-- We drop the old 4-arg signature and recreate with the extra defaulted param so
-- there is exactly one overload (avoids PostgREST ambiguity). Existing 4-arg
-- callers (the generate route) resolve to this function via the default.

drop function if exists claim_generation_slot(text, uuid, int, int);

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
  v_since timestamptz := case
      when p_calendar_day then date_trunc('day', now())
      else now() - make_interval(hours => p_window_hours)
    end;
  v_count int;
  v_id uuid;
begin
  if v_user is null then
    raise exception 'not authenticated';
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
