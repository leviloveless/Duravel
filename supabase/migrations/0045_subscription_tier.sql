-- 0045: subscriptions.tier — the first time the app needs to know WHICH thing
-- someone bought, not just whether they bought.
--
-- The custom-program tier ($39.99/mo, Levi 2026-09-08) sits ABOVE the existing
-- plan rather than replacing it. Until now entitlement has been binary —
-- `isEntitled()` returns true or false — and `plan` has meant the billing
-- INTERVAL ("monthly" | "annual"), not a product level. Those are different
-- axes, and collapsing them would have meant a third `plan` value that is not an
-- interval, so a custom annual price could never exist without another
-- migration and a data fix.
--
-- So `plan` keeps meaning interval and `tier` is added alongside it. A custom
-- annual price later is a Stripe price id and a webhook mapping, nothing here.
--
-- Every existing row defaults to 'standard', which is the whole point of Levi's
-- choice of an upgrade tier over a replacement: no current subscriber changes
-- state when this is applied, and no backfill is needed.
--
-- The webhook remains the sole writer (there is deliberately still no write
-- policy on this table); `tier` is read through the same RLS-scoped read-own
-- policy as the rest of the row.

alter table public.subscriptions
  add column if not exists tier text not null default 'standard';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'subscriptions_tier_check'
  ) then
    alter table public.subscriptions
      add constraint subscriptions_tier_check check (tier in ('standard', 'custom'));
  end if;
end $$;

comment on column public.subscriptions.tier is
  'Product level: standard, or custom (athlete-authored week templates). Distinct from plan, which is the billing interval.';
