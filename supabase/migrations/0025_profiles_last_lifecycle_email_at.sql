-- 0025: profiles.last_lifecycle_email_at — global frequency cap (07 §3, spec 0024).
--
-- Cheap "≤1 lifecycle email/day/user" guard without scanning the email_sends ledger:
-- sendEmail() checks this for LIFECYCLE (suppressible) categories only and, on a
-- successful lifecycle send, stamps it to now(). Service/billing categories (welcome,
-- trial-ending, receipts) ignore this cap — they must always go out.
--
-- Idempotent + additive. No RLS change: profiles already has the "profiles: own row"
-- policy; this column is written by the service-role client, read-only to the user.

alter table profiles
  add column if not exists last_lifecycle_email_at timestamptz;

comment on column profiles.last_lifecycle_email_at is
  'Last lifecycle (suppressible) email send time. Enforces ≤1 lifecycle email/day/user in lib/email/send.ts. Service/billing categories bypass this cap.';
