-- Atomic per-user generation/adaptation rate limit (roadmap #0.2).
--
-- The routes previously did `select count(...)` and THEN inserted the marker
-- row in two separate statements. Under concurrency that is a TOCTOU race: N
-- simultaneous requests all read count < limit before any of them inserts, so
-- all N slip past the cap and each runs an expensive Haiku pipeline. The
-- in-code "concurrent requests can't slip past" comment was not actually true.
--
-- This function makes the count + insert atomic. It takes a per-user advisory
-- lock for the duration of the transaction, so concurrent claims for the same
-- user serialize; the count then reflects any row a racing request just
-- inserted. Returns the new event id when the slot is granted, or NULL when the
-- cap is hit (the caller maps NULL -> HTTP 429).
--
-- Counting buckets mirror the routes exactly:
--   p_kind = 'adapt'  -> counts only kind = 'adapt'      (adapt daily limit)
--   otherwise         -> counts kind <> 'adapt'          (generate daily limit)
--
-- SECURITY DEFINER so the insert/count run with a stable search_path; the row is
-- always written for auth.uid(), so a caller can only ever consume/insert their
-- own slot. Unlimited (allowlisted) callers are handled app-side by passing a
-- very high p_limit.

create or replace function claim_generation_slot(
  p_kind text,
  p_program_id uuid,
  p_limit int,
  p_window_hours int
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_since timestamptz := now() - make_interval(hours => p_window_hours);
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

grant execute on function claim_generation_slot(text, uuid, int, int) to authenticated;
