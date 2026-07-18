# Migrations 0020–0025 — lifecycle email schema (07-spec §3)

Six migrations for the trial-conversion email system. **Verified on PostgreSQL 16** (Supabase's engine): applied in order on top of schema stubs mirroring the live `auth.users` / `profiles` / `subscriptions`, then behavior-tested (see below).

## ⚠️ Renumbered from the spec
The 07 spec calls these 0019–0024, but **0019 is already taken** by `0019_calendar_day_rate_limit.sql`. This set is renumbered **0020–0025**. Apply in this order:

| File | Adds | Notes |
|---|---|---|
| `0020_email_preferences.sql` | consent table | SELECT+INSERT+UPDATE own (INSERT policy is what makes the pref-center upsert work) |
| `0021_email_unsubscribe_events.sql` | unsub audit | read-own; writes service-role only (route is session-less) |
| `0022_email_sends.sql` | send ledger | **partial unique index** on `dedup_key` — the load-bearing idempotency piece |
| `0023_email_suppressions.sql` | hard block list | keyed by email; service-role only, no user policies |
| `0024_subscriptions_canceled_at.sql` | `subscriptions.canceled_at` | **verified missing** in live schema (0014 has `status`+`cancel_at_period_end` but no timestamp) |
| `0025_profiles_last_lifecycle_email_at.sql` | `profiles.last_lifecycle_email_at` | frequency-cap column |

0022–0025 are additive/`if not exists`, so safe to re-run. Apply each in the Supabase SQL editor (treat as irreversible per handoff §6).

## What was verified
- All six apply cleanly in order on PG16.
- **Partial-index idempotency (the whole point of the design):**
  - a dry-run `skipped` row does **not** block the later real claim ✓
  - a `failed` row does **not** block a retry ✓
  - a live `queued` row **does** block a second claim (the `ON CONFLICT … DO NOTHING` returns no id) ✓
  - two live rows with the same `dedup_key` → unique violation ✓
- `status` CHECK rejects unknown statuses ✓
- RLS enabled on all four tables with the intended policy counts (preferences 3, sends 1, unsub-events 1, suppressions 0) ✓
- Both new columns present ✓

## The claim query for lib/email/send.ts (matches the partial index arbiter)
```sql
insert into email_sends (user_id, template, category, dedup_key, status, scheduled_for, meta)
values ($1, $2, $3, $4, 'queued', $5, $6)
on conflict (dedup_key) where status in ('queued','sent','delivered','opened','clicked')
do nothing
returning id;
```
No row returned → another attempt owns the key → return early.

## Not in these migrations (by design)
Templates + the `sendEmail()` choke-point, cron, Svix webhook, HMAC unsubscribe, preference center. Schema only here. `has_active_subscription(p_user)` already exists (0014) — reuse it for the late entitlement re-check.
