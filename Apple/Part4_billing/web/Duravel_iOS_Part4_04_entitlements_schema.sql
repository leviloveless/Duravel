-- Duravel iOS — Part 4: Unified entitlements schema (Supabase / Postgres)
-- Single source of truth for "is this user a paying member", regardless of
-- whether they bought via Stripe (web) or Apple/RevenueCat (iOS).
--
-- Design intent:
--   * One row per (user, billing source, product). Access = ANY active row.
--   * `source` distinguishes stripe vs apple, but NOTHING in the app gates on it.
--   * Idempotent upserts keyed on the provider's own subscription/transaction id,
--     so replayed webhooks don't create duplicates.
--   * A view + RPC give the app a single boolean/summary to read.
--
-- Safe to run on an existing DB: it does NOT touch your current Stripe tables.
-- If you already sync Stripe into your own table, either (a) point the Stripe
-- sync at this table with source='stripe', or (b) keep your table and add the
-- `entitlement_from_stripe` UNION into the view at the bottom. Both noted inline.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Enums
-- ─────────────────────────────────────────────────────────────────────────────
do $$ begin
  create type entitlement_source as enum ('stripe', 'apple');
exception when duplicate_object then null; end $$;

do $$ begin
  -- Normalized lifecycle status across BOTH providers.
  create type entitlement_status as enum (
    'active',        -- paid & current (incl. trial that grants access)
    'grace',         -- billing retry / grace period, still grant access
    'expired',       -- lapsed, no access
    'canceled',      -- user turned off auto-renew but may still be active until period end
    'billing_issue', -- payment failing, treat per grace policy
    'refunded',      -- refunded/revoked, no access
    'paused'         -- Apple pause / Stripe pause, no access
  );
exception when duplicate_object then null; end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Core table
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.entitlements (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null references auth.users(id) on delete cascade,

  source                entitlement_source not null,
  entitlement_key       text not null default 'pro',   -- the internal capability, matches RC entitlement id

  -- Provider identifiers (idempotency keys). Exactly one provider id is set.
  stripe_subscription_id   text,                        -- e.g. sub_...
  apple_original_txn_id    text,                        -- Apple originalTransactionId (stable across renewals)
  rc_app_user_id           text,                        -- RevenueCat app user id (== Duravel user_id)

  product_id            text not null,                  -- stripe price_... OR app.duravel.membership.*
  plan                  text,                           -- 'monthly' | 'annual' (normalized)

  status                entitlement_status not null default 'expired',
  is_active             boolean not null default false, -- denormalized convenience: status in (active, grace)

  current_period_start  timestamptz,
  current_period_end    timestamptz,                    -- access valid until here (+ grace policy)
  will_renew            boolean,                        -- auto-renew on?
  environment           text default 'production',      -- 'production' | 'sandbox' (Apple) — never grant prod access from sandbox

  raw_event             jsonb,                          -- last raw provider payload, for debugging
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

-- One entitlement row per provider-subscription. These partial unique indexes
-- are what make webhook upserts idempotent.
create unique index if not exists uq_entitlements_stripe_sub
  on public.entitlements (stripe_subscription_id)
  where stripe_subscription_id is not null;

create unique index if not exists uq_entitlements_apple_txn
  on public.entitlements (apple_original_txn_id)
  where apple_original_txn_id is not null;

create index if not exists ix_entitlements_user       on public.entitlements (user_id);
create index if not exists ix_entitlements_user_active on public.entitlements (user_id) where is_active;

-- keep is_active in sync with status
create or replace function public.entitlements_sync_active() returns trigger as $$
begin
  new.is_active := (new.status in ('active','grace'))
                   and (new.environment = 'production')
                   and (new.current_period_end is null or new.current_period_end > now());
  new.updated_at := now();
  return new;
end $$ language plpgsql;

drop trigger if exists trg_entitlements_sync_active on public.entitlements;
create trigger trg_entitlements_sync_active
  before insert or update on public.entitlements
  for each row execute function public.entitlements_sync_active();

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Overlap / double-charge detection (support surface, non-blocking)
-- ─────────────────────────────────────────────────────────────────────────────
-- When a user ends up with BOTH an active stripe AND an active apple entitlement,
-- we don't auto-cancel (that's a human refund decision) but we log it so Levi
-- can reconcile. The iOS paywall (Part 4.5) already suppresses the second buy in
-- the normal UI; this catches the edge cases.
create table if not exists public.entitlement_overlaps (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  detail      jsonb not null,
  resolved    boolean not null default false,
  created_at  timestamptz not null default now()
);

create or replace function public.detect_entitlement_overlap(p_user uuid)
returns void as $$
declare
  n_sources int;
begin
  select count(distinct source) into n_sources
  from public.entitlements
  where user_id = p_user and is_active;

  if n_sources > 1 then
    insert into public.entitlement_overlaps (user_id, detail)
    values (
      p_user,
      (select jsonb_agg(jsonb_build_object(
         'source', source, 'product_id', product_id, 'status', status,
         'period_end', current_period_end))
       from public.entitlements where user_id = p_user and is_active)
    );
  end if;
end $$ language plpgsql;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. The single thing the app reads: is a user entitled?
-- ─────────────────────────────────────────────────────────────────────────────
-- Access = has ANY active entitlement row. Web and iOS both call this.
create or replace view public.user_entitlement as
select
  u.id                                          as user_id,
  bool_or(e.is_active)                          as has_pro,
  max(e.current_period_end)                     as access_until,
  (array_agg(e.source order by e.updated_at desc)
     filter (where e.is_active))[1]             as active_source,
  (array_agg(e.plan   order by e.updated_at desc)
     filter (where e.is_active))[1]             as active_plan
from auth.users u
left join public.entitlements e on e.user_id = u.id
group by u.id;

-- OPTION (b): if you keep Stripe entitlements in an EXISTING table instead of
-- writing them into public.entitlements, replace the view above with a UNION, e.g.:
--   ... from ( select user_id, is_active, ... from public.entitlements
--              union all
--              select user_id, (status='active'), ... from public.your_stripe_table ) e ...
-- The app-facing contract (has_pro / access_until) stays identical.

-- RPC the client calls (RLS-safe): returns just the caller's entitlement summary.
create or replace function public.my_entitlement()
returns table (has_pro boolean, access_until timestamptz, active_source entitlement_source, active_plan text)
security definer set search_path = public
language sql stable as $$
  select coalesce(ue.has_pro, false), ue.access_until, ue.active_source, ue.active_plan
  from public.user_entitlement ue
  where ue.user_id = auth.uid();
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. RLS — users read only their own entitlements; only service role writes.
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.entitlements enable row level security;
alter table public.entitlement_overlaps enable row level security;

drop policy if exists "read own entitlements" on public.entitlements;
create policy "read own entitlements" on public.entitlements
  for select using (auth.uid() = user_id);

-- No insert/update/delete policies for authenticated users => only the
-- service_role key (used by the edge function) can write. This is deliberate:
-- clients must NEVER be able to grant themselves entitlement.

grant select on public.user_entitlement to authenticated;
grant execute on function public.my_entitlement() to authenticated;
