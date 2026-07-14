-- HyroxAI — free trial (monetization).
--
-- Every athlete gets a 14-day, no-card free trial that begins when their profile
-- is first created (i.e. at onboarding — the first real use of the product).
-- Entitlement (lib/subscription.ts) = billing disabled, OR a live subscription,
-- OR now() still inside the trial window. No Stripe trial is used: the trial is
-- enforced entirely app-side, so we never ask for a card up front.
--
-- RLS is unchanged: trial_started_at lives on the user's own `profiles` row,
-- already covered by the "profiles: own row" policy (read + write scoped to
-- auth.uid()). The value is only ever written by the column default at insert.

alter table profiles
  add column if not exists trial_started_at timestamptz not null default now();

-- Backfill existing profiles to their account-creation time, so current users get
-- a trial that reflects real account age rather than the migration moment.
-- To instead grant every current user a FRESH 14 days at launch, run
--   update profiles set trial_started_at = now();
-- once, just before setting BILLING_ENABLED=true.
update profiles set trial_started_at = created_at;

comment on column profiles.trial_started_at is
  '14-day free-trial start; defaults to profile creation (onboarding). Entitlement checked in lib/subscription.ts.';
