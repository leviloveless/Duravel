-- Duravel iOS — Part 6
-- Quiet-hours DEFERRAL support: scheduled_pushes table + next_quiet_end() +
-- a claim function for a cron worker. Optional but referenced by send-push.
--
-- If you don't want deferral (just drop during quiet hours), you can skip this
-- file — the edge fn degrades gracefully and reports 'suppressed'.

create table if not exists public.scheduled_pushes (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  category   public.notif_category not null,
  payload    jsonb not null,               -- {title, body, data, badge, sound, collapseId}
  deliver_at timestamptz not null,         -- UTC; computed from user's quiet_end
  sent_at    timestamptz,
  attempts   int not null default 0,
  created_at timestamptz not null default now()
);

comment on table public.scheduled_pushes is
  'Pushes deferred out of quiet hours; a cron worker delivers at deliver_at.';

create index if not exists scheduled_pushes_due_idx
  on public.scheduled_pushes (deliver_at)
  where sent_at is null;

-- RLS: no client access at all. Only service_role (worker) touches this.
alter table public.scheduled_pushes enable row level security;
alter table public.scheduled_pushes force row level security;
-- (No policies created => authenticated/anon cannot read or write. service_role bypasses.)

-- ─────────────────────────────────────────────────────────────────────────────
-- next_quiet_end(user) → timestamptz: the next moment the user is OUT of quiet
-- hours, in UTC. If quiet hours disabled, returns now() (deliver asap).
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.next_quiet_end(p_user_id uuid)
returns timestamptz
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  pref public.notification_preferences;
  now_local timestamptz;
  today_end timestamptz;
begin
  select * into pref from public.notification_preferences where user_id = p_user_id;
  if not found or not pref.quiet_hours_enabled then
    return now();
  end if;

  now_local := now() at time zone pref.timezone;  -- wall-clock in user's tz

  -- Candidate end today at quiet_end wall time, interpreted back to UTC.
  today_end := (date_trunc('day', now_local) + pref.quiet_end)::timestamp
                 at time zone pref.timezone;

  if pref.quiet_start <= pref.quiet_end then
    -- Non-wrapping window (e.g. 01:00–06:00). If we're before end today, use it.
    if (now_local)::time < pref.quiet_end then
      return today_end;
    else
      return now();  -- already past quiet end today
    end if;
  else
    -- Wrapping window (e.g. 21:00–08:00).
    if (now_local)::time >= pref.quiet_start then
      -- Evening side: quiet_end is tomorrow morning.
      return today_end + interval '1 day';
    elsif (now_local)::time < pref.quiet_end then
      -- Early-morning side: quiet_end is later today.
      return today_end;
    else
      return now();  -- daytime, not in quiet hours
    end if;
  end if;
end;
$$;

grant execute on function public.next_quiet_end(uuid) to service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- claim_due_pushes(limit) → rows: atomically grab due, unsent rows for a worker
-- so two workers don't double-send. Uses FOR UPDATE SKIP LOCKED.
-- The worker then calls send-push per row and marks sent_at.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.claim_due_pushes(p_limit int default 100)
returns setof public.scheduled_pushes
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  with due as (
    select id
    from public.scheduled_pushes
    where sent_at is null
      and deliver_at <= now()
    order by deliver_at
    for update skip locked
    limit p_limit
  )
  update public.scheduled_pushes s
    set attempts = s.attempts + 1
  from due
  where s.id = due.id
  returning s.*;
end;
$$;

grant execute on function public.claim_due_pushes(int) to service_role;

-- Worker loop (pseudocode, run from a cron edge fn every 1–5 min):
--   rows = rpc('claim_due_pushes', { p_limit: 200 })
--   for row in rows:
--     resp = invoke send-push { user_id, category, notification: row.payload,
--                               respectQuietHours: false }  -- gate already passed
--     if resp.ok: update scheduled_pushes set sent_at = now() where id = row.id
-- Schedule via Supabase pg_cron or an external scheduler hitting a cron fn.
