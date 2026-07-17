-- 0023: email_suppressions — hard global block list (07 §3, spec 0022).
--
-- Addresses that hard-bounced or registered a spam complaint. Checked before EVERY
-- send, including transactional/service mail. Keyed by EMAIL (not user_id): a user can
-- change their address, but a dead/complained address must stay dead regardless of who
-- owns it.
--
-- Why this table is load-bearing (spec §0.10): Resend's dashboard suppression list does
-- NOT apply to the transactional `send` API, so we must maintain our own. The Resend
-- webhook (email.bounced / email.complained → hard) writes rows here via the service role.

create table if not exists email_suppressions (
  email      text primary key,
  reason     text not null check (reason in ('hard_bounce','complaint','manual')),
  resend_id  text,
  created_at timestamptz not null default now()
);

alter table email_suppressions enable row level security;
-- Service-role only: no user policies. Contains addresses across all users; never
-- exposed to the authenticated role.

comment on table email_suppressions is
  'Hard global suppression (hard bounce / complaint / manual), keyed by email. Checked before every send incl. transactional. Resend dashboard suppression does not cover the send API, so this is authoritative.';
