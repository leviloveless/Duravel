-- 0024: subscriptions.canceled_at — win-back timing (07 §3, spec 0023).
--
-- VERIFIED against the live schema before writing (spec §3 requires this): 0014 gives
-- `subscriptions` a `status` (which includes 'canceled') and `cancel_at_period_end`, but
-- NO cancellation TIMESTAMP. Win-back keys off *when* the sub was canceled (D+3 / D+14 /
-- D+30 after cancellation), so we add the missing timestamp. Idempotent + additive.
--
-- The Stripe webhook stamps this on `customer.subscription.deleted`, strictly downstream
-- of the existing entitlement write (the webhook remains the sole entitlement writer).
-- No RLS change: subscriptions already has read-own + no write policy (writes are
-- service-role only), which is exactly what this column needs.

alter table subscriptions
  add column if not exists canceled_at timestamptz;

comment on column subscriptions.canceled_at is
  'When the subscription was canceled (Stripe customer.subscription.deleted). Drives win-back scheduling (07 lifecycle emails). Null while active.';
