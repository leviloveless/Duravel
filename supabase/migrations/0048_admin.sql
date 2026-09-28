-- Admin tooling: access overrides and an audit trail (2026-09-28).
--
-- Two tables, both WRITTEN ONLY BY THE SERVICE ROLE from the admin server
-- actions. Neither has an insert, update or delete policy, so an athlete's JWT
-- cannot create, change or remove a row — RLS denies by default, and the
-- service role bypasses RLS. That is the same shape the Stripe webhook already
-- uses for `subscriptions`.
--
-- WHY OVERRIDES LIVE HERE AND NOT IN `subscriptions`. `subscriptions` is a
-- mirror of Stripe, written by the webhook on every Stripe event. An admin edit
-- there would be overwritten by the next event for that customer, and in the
-- meantime the app's idea of who is paying would disagree with what Stripe is
-- actually charging. So an admin decision about ACCESS is recorded separately
-- and `resolveAccess` in lib/subscription.ts consults it first. Changes to what
-- someone is CHARGED go to Stripe through its API, and come back through the
-- webhook like any other billing event.
--
-- THERE IS NO TRIAL COLUMN, deliberately. Since 2026-09-20 the trial is carded
-- and lives in Stripe; an app-side trial date here would be exactly the blanket
-- grace window that silently disabled the paywall before. Extending a trial is
-- a Stripe call (`trial_end`) from the admin; free access without a card is a
-- `grant` with an expiry — one named account, dated and audited.

create table if not exists public.entitlement_overrides (
  user_id          uuid primary key references auth.users (id) on delete cascade,
  -- default: normal rules (subscription, then trial)
  -- grant:   access regardless of billing, at grant_tier, until grant_expires_at
  -- revoke:  no access regardless of billing
  access           text not null default 'default'
                   check (access in ('default', 'grant', 'revoke')),
  grant_tier       text check (grant_tier in ('standard', 'custom')),
  grant_expires_at timestamptz,
  note             text,
  updated_by       uuid references auth.users (id) on delete set null,
  updated_at       timestamptz not null default now()
);

alter table public.entitlement_overrides enable row level security;

-- The athlete may READ their own override. getEntitlement runs on the
-- user-scoped client, and a comp or a revoke has to be visible to it.
drop policy if exists "entitlement_overrides: read own" on public.entitlement_overrides;
create policy "entitlement_overrides: read own"
  on public.entitlement_overrides
  for select
  using (auth.uid() = user_id);

create table if not exists public.admin_audit_log (
  id             bigint generated always as identity primary key,
  admin_id       uuid references auth.users (id) on delete set null,
  admin_email    text not null,
  -- Kept as plain text as well as the id, because the point of the log is to
  -- still say who was affected after a hard delete has removed the account.
  target_user_id uuid,
  target_email   text,
  action         text not null,
  detail         jsonb not null default '{}'::jsonb,
  created_at     timestamptz not null default now()
);

alter table public.admin_audit_log enable row level security;
-- No policies at all: nobody reads or writes this through a user JWT.

create index if not exists admin_audit_log_target_idx
  on public.admin_audit_log (target_user_id, created_at desc);
create index if not exists admin_audit_log_created_idx
  on public.admin_audit_log (created_at desc);
