-- 0021: email_unsubscribe_events — unsubscribe audit + explicit revocation (07 §3, spec 0020).
--
-- NOT a token store. Unsubscribe tokens are stateless HMAC (userId·category·issuedAt,
-- signed with EMAIL_UNSUB_SECRET), so verifying them needs zero DB reads. This table is
-- written ONLY when an unsubscribe actually happens — no per-send write amplification.
-- The effect of an unsubscribe is (a) flip the email_preferences flag and (b) append a
-- row here for audit / analytics.
--
-- RLS: users may read their own history. All writes come from the unsubscribe route,
-- which runs UNAUTHENTICATED (session-less, token-verified) via the service-role client,
-- so there is deliberately no insert policy for the auth role.

create table if not exists email_unsubscribe_events (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  category   text,                                  -- null = global unsubscribe
  source     text not null default 'one_click'
             check (source in ('one_click','footer_link','pref_center')),
  created_at timestamptz not null default now()
);

create index if not exists email_unsub_user_idx
  on email_unsubscribe_events (user_id, created_at desc);

alter table email_unsubscribe_events enable row level security;

create policy "email_unsubscribe_events: read own" on email_unsubscribe_events
  for select using (auth.uid() = user_id);
-- Writes via service role only (the unsubscribe route is session-less).

comment on table email_unsubscribe_events is
  'Audit + explicit-revocation record, written only when an unsubscribe happens. Tokens themselves are stateless HMAC — this is not a token store.';
