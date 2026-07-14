-- HyroxAI billing — Stripe subscriptions (monetization).
--
-- One row per user, kept in sync by the Stripe webhook. The webhook writes with
-- the service-role key (RLS-bypassing); there is deliberately NO insert/update/
-- delete policy for the auth role, so a user can read but never forge their own
-- entitlement.

create table if not exists subscriptions (
  user_id uuid primary key references profiles(id) on delete cascade,
  stripe_customer_id text not null,
  stripe_subscription_id text unique,
  status text not null default 'incomplete'
    check (status in (
      'incomplete','incomplete_expired','trialing','active',
      'past_due','canceled','unpaid','paused'
    )),
  price_id text,
  plan text check (plan in ('monthly','annual')),
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists subscriptions_customer_idx on subscriptions (stripe_customer_id);

alter table subscriptions enable row level security;

-- Users may READ their own subscription only. No write policy: all writes come
-- from the Stripe webhook via the service-role key.
create policy "subscriptions: read own" on subscriptions
  for select using (auth.uid() = user_id);

-- Convenience predicate usable from SQL / RPC if needed.
create or replace function has_active_subscription(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from subscriptions s
    where s.user_id = p_user
      and s.status in ('active','trialing')
      and (s.current_period_end is null or s.current_period_end > now())
  );
$$;
