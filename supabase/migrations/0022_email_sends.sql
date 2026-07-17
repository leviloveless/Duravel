-- 0022: email_sends — send ledger + idempotency (07 §3, spec 0021). THE load-bearing table.
--
-- One row per send attempt. Two idempotency guarantees:
--   * app-level (belt): the PARTIAL unique index on dedup_key below;
--   * provider-level (suspenders): Resend's `Idempotency-Key: <dedup_key>` header.
-- Status is advanced by the Resend webhook (0023 suppression is written there too).
--
-- WHY THE INDEX IS PARTIAL (critical — this is the bug the spec's §0.1/§0.2 fixes):
-- a plain UNIQUE(dedup_key) would let a dry-run 'skipped' row (written while
-- EMAIL_ENABLED=false) or a 'failed' row permanently occupy the dedup slot, so the
-- later REAL send / retry hits ON CONFLICT DO NOTHING and silently never sends. By
-- indexing only the live/terminal-success statuses, 'skipped' and 'failed' rows drop
-- out of the index → dry-runs never block real sends, and failed sends stay retryable.
--
-- CLAIM (in lib/email/send.ts) uses the matching partial index as the arbiter:
--   insert into email_sends (user_id, template, category, dedup_key, status, scheduled_for, meta)
--   values (...)
--   on conflict (dedup_key) where status in ('queued','sent','delivered','opened','clicked')
--   do nothing
--   returning id;
-- No row returned → another attempt owns this key → return early.
--
-- A stale-'queued' reaper (top of the daily cron) flips 'queued' rows older than ~30 min
-- to 'failed', so a crash between claim and provider-ack cannot wedge a key forever —
-- email_sends_status_idx supports that scan.

create table if not exists email_sends (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  template      text not null,            -- 'welcome' | 'trial_ending' | 'weekly_summary' | ...
  category      text not null,            -- 'onboarding' | 'billing' | 'weekly_summary' | ...
  dedup_key     text not null,            -- e.g. 'trial_ending:T-3:<user>:<trial_cycle>'
  resend_id     text,                     -- Resend message id (set after the API accepts)
  status        text not null default 'queued'
                check (status in (
                  'queued','sent','delivered','opened','clicked',
                  'bounced','complained','failed','skipped'
                )),
  scheduled_for timestamptz,              -- intended send time (scheduled flows)
  sent_at       timestamptz,
  error         text,
  attempt       int  not null default 1,
  meta          jsonb not null default '{}'::jsonb,  -- program_id, week_no, race_date, cached copy...
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- Idempotency: 'skipped' (dry-run) and 'failed' rows do NOT occupy the dedup slot.
create unique index if not exists email_sends_dedup_uk
  on email_sends (dedup_key)
  where status in ('queued','sent','delivered','opened','clicked');

create index if not exists email_sends_user_idx   on email_sends (user_id, created_at desc);
create index if not exists email_sends_resend_idx  on email_sends (resend_id);
create index if not exists email_sends_status_idx  on email_sends (status, created_at); -- reaper scan

alter table email_sends enable row level security;

create policy "email_sends: read own" on email_sends
  for select using (auth.uid() = user_id);
-- All writes via the service-role client in lib/email/send.ts (RLS-bypassing).

comment on table email_sends is
  'Send ledger + app-level idempotency. Partial unique index on dedup_key excludes skipped/failed so dry-runs never block real sends and failures stay retryable.';
