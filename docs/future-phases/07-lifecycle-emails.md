# Duravel — Lifecycle & Transactional Email System

### Implementation-Ready Design & Build Spec

**Author:** Product + Engineering (prep phase) · **Date:** 2026-07-15 · **Status:** Final — ready for phased build · **Owner:** Levi (solo founder) · **Provider:** Resend · **Migrations continue from:** 0019 · **Repo:** `C:\dev\duravel`

> **Scope note.** This is a *future-phase* spec: it defines design, schema, routes, and a phased build plan so work can start cleanly when prioritized. It is grounded in the current stack (Next.js 16 App Router, React 19, TypeScript strict with `noUnusedLocals` + `noUncheckedIndexedAccess`, Supabase + RLS with an untyped service-role admin client, Anthropic Haiku, Vercel from GitHub `main`, Stripe web billing live as of 2026-07-14). Nothing here modifies the deterministic engine (`lib/engine/*`) or the Haiku generation pipeline (`lib/generation/*`); email is a strictly **read-only, downstream** consumer of their outputs. The Stripe webhook remains the **sole writer of entitlement**; email only *reads* trial/subscription state.

---

## 0. What changed from the prep draft (corrections folded in)

The prep draft was directionally strong — right provider, right choke-point pattern, right feature-flag discipline — but had several concrete defects that would have shipped bugs, poisoned future sends, or failed `next build`. This final resolves them:

1. **Dry-run "skipped" rows would poison every real send (critical).** The draft's plan — write a `status='skipped'` ledger row **carrying the real `dedup_key`** while `EMAIL_ENABLED=false`, under a plain `UNIQUE(dedup_key)` index — means that when the flag is later flipped **on**, the genuine send hits `ON CONFLICT (dedup_key) DO NOTHING`, finds the skipped row, and returns early. **Every email dry-run in prod would permanently block its own real send.** Fixed by making the idempotency index **partial**: unique only over live/terminal-success statuses, so `skipped` and `failed` rows never occupy the dedup slot (§3.3).
2. **Failed sends could never be retried (correctness).** Same root cause: once a send failed (`status='failed'`) the dedup row blocked all retries. The partial unique index also fixes this — `failed` drops out of the index, so a later attempt can re-claim the key. Adds an explicit stale-`queued` reaper so a crash between claim and provider-ack doesn't wedge a key forever (§3.3, §4.1).
3. **RLS made the preference-center write impossible as written (correctness).** The draft declared *only* SELECT + UPDATE policies on `email_preferences` ("inserts handled by service role") but then had the user-session preference action **upsert** — the INSERT half fails silently under RLS on first save. Fixed by adding a scoped `INSERT ... WITH CHECK (auth.uid() = user_id)` policy (§3.1).
4. **Per-send DB token mint was write-amplified and unnecessary.** Minting + storing a hashed unsubscribe token on *every* send is one extra write per email. Replaced with a **stateless HMAC-signed token** (userId · category · issued-at, signed with a server secret) that verifies with zero DB reads, plus a small `email_unsubscribe_events` audit/revocation table written only *when someone actually unsubscribes* (§3.2, §4.2).
5. **Welcome-email trigger raced Supabase email confirmation (sequencing).** "First sign-in" can fire before the address is confirmed (or, with double-opt-in, may send to an unverified address). Retriggered on **first authenticated session with a confirmed email**, and made explicit that Supabase Auth still owns confirm/reset mail this phase (§2.1, §5-adjacent, §9).
6. **Single-invocation cron will time out at scale (complexity underestimate).** A daily route that renders + `await`s hundreds of sequential Resend calls in one serverless function blows the Vercel function limit (Hobby ~10s default, extendable to 60s; Pro to 300s). Redesigned around Resend's **batch endpoint** (≤100/call) with bounded chunking and `maxDuration`, and a hard note that the Free-tier 100/day cap is a *design constraint*, not just pricing (§4.1, §7.1).
7. **React 19 / Next 16 peer-dependency risk with `react-email` was unstated.** Added explicit version-pinning + `next build` verification step before any template work, since `@react-email/components` + `@react-email/render` peer ranges must be confirmed against React 19 (§4.5, §10 Phase A).
8. **Recipient address source was vague.** Made concrete: the address lives in `auth.users.email`, reachable only via the **service-role** admin client (`auth.admin.getUserById` or a `select` on `auth.users`), not the anon client — and every read is Zod-parsed at the module boundary because the client is untyped (§4.1).
9. **`dedup_key` "trial_cycle" was undefined.** Defined the trial-cycle discriminator so a reset `trial_started_at` (re-trial / support action) produces fresh keys rather than being silently suppressed by an old cycle's ledger rows (§3.3, §2.1).
10. **Webhook raw-body + Svix specifics were missing.** Added the App Router raw-body requirement (Svix verifies over the exact bytes), replay tolerance, and the fact that Resend's own suppression list does **not** cover the transactional `send` API — so our `email_suppressions` table is load-bearing, not belt-and-suspenders (§4.2, §3.4).
11. **Effort realism.** Phase A is not "S–M": DNS/DKIM/DMARC propagation, Svix webhook verification, the unsubscribe POST path, and the idempotency/partial-index logic under an untyped client are genuinely **M**. Re-sized in §10, with MVP (A+B) called honestly at the low end of **L**.

Everything else in the draft (choke-point `sendEmail()`, category/consent tiers, `EMAIL_ENABLED` gate, read-only engine stance, deliverability posture) is preserved and made more concrete below.

---

## 1. Goal & Why-Now

### Goal
Give Duravel a **durable, first-party communication channel** that (a) lifts **trial→paid** conversion, (b) reduces **involuntary and voluntary churn**, and (c) reinforces the **logging/check-in habit** the product depends on — without adding operational burden for a solo founder and without coupling to the training engine. It must pass the real gate: **`next build` green** (feature off *and* on), pure logic **vitest**-covered.

### Why now
- **Billing went live 2026-07-14.** The single highest-ROI email in any subscription business — **trial-ending** — does not yet exist. The trial is enforced app-side via `profiles.trial_started_at` (+14d), so every user's exact expiry is already known and conversion mail can be driven **deterministically with zero new billing infrastructure**. Email only *reads* trial/sub state; the Stripe webhook stays the sole entitlement writer.
- **The adaptation loop rewards engagement.** Duravel's value compounds only when the user logs sessions and completes readiness check-ins (those feed ACWR / monotony / readiness → weekly revisions). Lifecycle mail that nudges logging **improves the core product's output quality**, not just a retention vanity metric.
- **Cost floor is ~$0.** Resend's free tier covers current scale; the system builds and runs for **$0** until volume justifies ~$20/mo Pro. ([Resend pricing](https://resend.com/pricing))
- **A draft already exists but breaks the build.** `_phase3_draft` has an unresolved `resend` import (build-breaking) and ad-hoc scheduling. Finishing it cleanly converts sunk work into a shipping feature.
- **Sport-agnostic by design.** Nothing here is HYROX-specific; race-week and weekly-summary flows read whatever program exists, so the system carries forward unchanged into the triathlon/Ironman expansion.

### Non-goals (this phase)
- Marketing/newsletter broadcast tooling, A/B experimentation platforms, or a visual campaign builder.
- Push / SMS (native mobile is blocked on forming the LLC; revisit post-mobile).
- In-app notification center (separate surface; email is the beachhead).
- **Replacing Supabase Auth's own transactional mail** (email confirm / password reset). Those stay on Supabase this phase; a later consolidation onto Resend for brand consistency is explicitly deferred (§9).

---

## 2. User-Facing Scope

### 2.1 MVP (Phases A + B) — ship first

| # | Email | Type | Trigger (concrete) | Category | Consent tier |
|---|-------|------|--------------------|----------|--------------|
| 1 | **Welcome** | Triggered | First authenticated session **with a confirmed email**; profile row exists | `onboarding` | Service |
| 2 | **Onboarding nudge** | Scheduled | Signed up **2–3 days ago** AND **no program generated** | `onboarding` | Lifecycle |
| 3 | **Trial-ending T-3 / T-1 / T-0** | Scheduled | `trial_started_at + 14d` threshold reached AND no active sub | `billing` | Service (see §2.4) |
| 4 | **Payment receipt / subscription confirmed** | Triggered | Stripe `checkout.session.completed` / `invoice.paid` | `billing` | Service |
| 5 | **Weekly summary** | Scheduled | User's **program-week boundary** rolls today AND **≥1 logged session** that week | `weekly_summary` | Lifecycle |

These five cover the two revenue-critical moments (activation, trial conversion), the transactional receipt, and the retention backbone (weekly summary).

**Trial-cycle discriminator.** The trial-ending dedup key embeds a `trial_cycle` = a short hash/epoch of `trial_started_at` (e.g. `date_trunc('second', trial_started_at)::text`). If support or a re-trial resets `trial_started_at`, the cycle string changes and a fresh T-3/T-1/T-0 sequence is allowed rather than being silently blocked by the prior cycle's ledger rows.

### 2.2 Later (Phases C + D)

| # | Email | Type | Trigger | Category |
|---|-------|------|---------|----------|
| 6 | **Race-week ramp** | Scheduled | Program has a race date; T-7 taper-start + T-1 pre-race | `race` |
| 7 | **Streak / milestone** | Scheduled or triggered | N consecutive weeks logged; 10th/50th/100th session; first PR | `milestone` |
| 8 | **Win-back** | Scheduled | D+3 / D+14 / D+30 after `subscriptions` cancellation | `winback` |
| 9 | **Re-engagement / lapsed** | Scheduled | No login + no log for 10 days (previously active) | `engagement` |
| 10 | **Payment failed / dunning nudge** | Triggered | Stripe `invoice.payment_failed` (complements Stripe's own dunning) | `billing` |
| 11 | **Weekly-review ready** | Triggered | Weekly revision computed and awaiting the user's **Apply** | `product` |

### 2.3 Cross-cutting user features
- **Preference center** (`/settings/email`) — per-category toggles + a master switch. Server-rendered (App Router), server-action writes.
- **One-click unsubscribe** — RFC 8058 `List-Unsubscribe` + `List-Unsubscribe-Post: List-Unsubscribe=One-Click` on every non-essential email, plus a visible footer link resolving to a tokenized, session-less route (GET confirm page + POST one-click). ([Resend unsubscribe docs](https://resend.com/docs/dashboard/emails/add-unsubscribe-to-transactional-emails), [List-Unsubscribe-Post](https://paul.af/list-unsubscribe-post))
- **Transactional exemption** — receipts, password reset (Supabase-owned), and trial-ending are **service** messages, not category-suppressible — but still honor the **hard global suppression** for bounced/complained addresses.

### 2.4 Category & consent model
Two tiers:
- **Service (transactional):** welcome, receipts, trial-ending, payment-failed. Always sent unless the address is hard-suppressed (bounce/complaint). No marketing consent required; still carry a "manage preferences" footer link (unsubscribe labeled "manage" rather than a hard opt-out).
- **Lifecycle (suppressible):** onboarding nudge, weekly summary, race-week, milestone, win-back, re-engagement, weekly-review-ready. Each maps to a per-category flag the user can disable; all default **on** at signup (legitimate-interest / single-opt-in, acceptable for existing customers), every one carrying a genuine one-click unsubscribe.

> **Legal footer caveat.** CAN-SPAM (and Gmail/Yahoo bulk-sender rules) require a **valid physical postal address** in the footer. This ties to the open LLC question (§9): until the entity exists, use the founder's registerable business address. Do not ship lifecycle mail without a real postal line.

---

## 3. Data Model / Schema Changes

New migrations continue from **0019**. All tables are RLS-enabled. The **service-role admin client** is the only writer for ledger, suppression, and webhook-driven rows; users never write these directly. Reads from the untyped client cast with `as` and are **Zod-parsed at the module boundary** (§4.1).

### 0019 — `email_preferences`
One row per user; per-category opt-outs + a global kill switch. Seeded lazily on first read/write.

```sql
create table public.email_preferences (
  user_id            uuid primary key references auth.users(id) on delete cascade,
  unsubscribed_all   boolean not null default false,
  onboarding         boolean not null default true,
  weekly_summary     boolean not null default true,
  race               boolean not null default true,
  milestone          boolean not null default true,
  winback            boolean not null default true,
  engagement         boolean not null default true,
  product            boolean not null default true,
  -- billing/service categories intentionally NOT stored here (non-suppressible)
  updated_at         timestamptz not null default now()
);

alter table public.email_preferences enable row level security;

-- user can read / insert / update ONLY their own row (INSERT policy added vs. draft — see §0.3)
create policy "own prefs read"   on public.email_preferences
  for select using (auth.uid() = user_id);
create policy "own prefs insert" on public.email_preferences
  for insert with check (auth.uid() = user_id);
create policy "own prefs update" on public.email_preferences
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
-- service role (admin client) bypasses RLS for backfill / lazy seed
```

### 0020 — `email_unsubscribe_events`
Not a token store (tokens are **stateless HMAC**, §4.2). This is an audit + explicit-revocation record, written **only when an unsubscribe actually happens** — no per-send write amplification.

```sql
create table public.email_unsubscribe_events (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  category     text,                         -- null = global unsubscribe
  source       text not null default 'one_click', -- 'one_click' | 'footer_link' | 'pref_center'
  created_at   timestamptz not null default now()
);
create index email_unsub_user_idx on public.email_unsubscribe_events (user_id, created_at desc);

alter table public.email_unsubscribe_events enable row level security;
create policy "own unsub read" on public.email_unsubscribe_events
  for select using (auth.uid() = user_id);
-- writes via service role only (the unsubscribe route runs unauthenticated)
```

### 0021 — `email_sends` (send ledger + idempotency)
One row per send attempt. The **partial** `dedup_key` unique index is the app-level idempotency guarantee (belt); the Resend `Idempotency-Key` header is the provider-level guarantee (suspenders). Status is advanced by the webhook.

```sql
create table public.email_sends (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users(id) on delete cascade,
  template       text not null,             -- 'welcome' | 'trial_ending' | 'weekly_summary' | ...
  category       text not null,             -- 'onboarding' | 'billing' | 'weekly_summary' | ...
  dedup_key      text not null,             -- e.g. 'trial_ending:T-3:<user>:<trial_cycle>'
  resend_id      text,                      -- Resend message id (set after API accepts)
  status         text not null default 'queued',
                 -- queued|sent|delivered|opened|clicked|bounced|complained|failed|skipped
  scheduled_for  timestamptz,               -- intended send time (scheduled flows)
  sent_at        timestamptz,
  error          text,
  attempt        int  not null default 1,
  meta           jsonb not null default '{}'::jsonb,  -- program_id, week_no, race_date, cached copy...
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- CRITICAL (see §0.1 / §0.2): partial unique index. 'skipped' (dry-run) and 'failed'
-- rows DO NOT occupy the dedup slot, so a disabled dry-run never blocks the real send,
-- and a failed send remains retryable.
create unique index email_sends_dedup_uk
  on public.email_sends (dedup_key)
  where status in ('queued','sent','delivered','opened','clicked');

create index email_sends_user_idx    on public.email_sends (user_id, created_at desc);
create index email_sends_resend_idx  on public.email_sends (resend_id);
create index email_sends_status_idx  on public.email_sends (status, created_at); -- stale-queued reaper

alter table public.email_sends enable row level security;
create policy "own sends read" on public.email_sends for select using (auth.uid() = user_id);
-- all writes via service role only
```

**Claim semantics.** `sendEmail()` claims a key with:

```sql
insert into public.email_sends (user_id, template, category, dedup_key, status, scheduled_for, meta)
values (...)
on conflict (dedup_key) where status in ('queued','sent','delivered','opened','clicked')
do nothing
returning id;
```

If no row returns, another attempt owns this send → return early. A **stale-`queued` reaper** (runs at the top of the daily cron) flips `queued` rows older than ~30 min to `failed` so a crash between claim and provider-ack cannot wedge a key permanently.

### 0022 — `email_suppressions` (hard global block)
Addresses that hard-bounced or complained. Checked before **every** send, including transactional. Keyed by **email**, not user (a user can change address; a dead address must stay dead). Resend's dashboard suppression list does **not** apply to the transactional `send` API, so this table is load-bearing.

```sql
create table public.email_suppressions (
  email        text primary key,
  reason       text not null,               -- 'hard_bounce' | 'complaint' | 'manual'
  resend_id    text,
  created_at   timestamptz not null default now()
);
alter table public.email_suppressions enable row level security;
-- service-role only; no user policies
```

### 0023 — `subscriptions.canceled_at` (conditional; verify live schema first)
Win-back keys off cancellation time. If `subscriptions` (0014, FK→auth.users in 0018) lacks a cancellation timestamp/status, add it idempotently:

```sql
alter table public.subscriptions add column if not exists canceled_at timestamptz;
-- If a status enum/text already captures 'canceled', prefer reading that; add only what's missing.
```
> **Verify against the live schema before writing.** Do not blind-add if `status` + a Stripe `canceled_at` mirror already exist.

### 0024 — `profiles.last_lifecycle_email_at` (frequency cap; nice-to-have)
Cheap global cap of **≤1 lifecycle email/day/user** without scanning the ledger.

```sql
alter table public.profiles add column if not exists last_lifecycle_email_at timestamptz;
```

### Existing tables — read-only inputs, no destructive change
`profiles.trial_started_at` (trial scheduling), `subscriptions` (entitlement + cancellation), `workout_logs` (0005), `readiness_checkins` (0010), `adaptations` (0006), `programs` (race date, current phase). Email never writes any of these.

**Canonical migration set this phase: 0019–0024 (six migrations),** four of them additive-guarded so they are safe to re-run.

---

## 4. API / Route + Server-Action Changes

### 4.1 New module layout (`lib/email/*`) — replaces the `_phase3_draft` scaffold

```
lib/email/
  resend.ts        // singleton Resend client (server-only import), reads RESEND_API_KEY
  send.ts          // sendEmail(): the single choke point (contract below)
  recipient.ts     // resolveRecipient(userId) -> email via service-role auth.users; Zod-parsed
  categories.ts    // Category enum + isSuppressible() + template->category map
  unsubscribe.ts   // stateless HMAC token mint/verify + List-Unsubscribe header builder
  render.ts        // React Email component -> { html, text } via @react-email/render
  copy.ts          // OPTIONAL Haiku "coach's note" (Zod-validated, cached, fallback) — §5
  dedup.ts         // dedup-key builders per template (embeds trial_cycle, week_no, etc.)
  templates/       // React Email components (Welcome, OnboardingNudge, TrialEnding,
                   //   Receipt, WeeklySummary, RaceWeek, Milestone, Winback, _Layout)
  flows/           // one file per scheduled campaign: due-detection + payload build
                   //   trialEnding.ts onboardingNudge.ts weeklySummary.ts winback.ts
                   //   raceWeek.ts milestone.ts engagement.ts
  scheduler.ts     // orchestrates flows/* for the daily cron; chunks + batches sends
lib/wearables/...  // unchanged
```

**`sendEmail()` contract — everything routes through it:**
1. **Feature flag.** If `EMAIL_ENABLED=false` → write a ledger row `status='skipped'` (safe: partial index excludes it, §0.1) and return.
2. **Resolve recipient** via `recipient.ts` (service-role read of `auth.users.email`), Zod-parsed.
3. **Suppression check** (`email_suppressions`) → if hit, `status='skipped'` (+ `error='suppressed'`), return.
4. **Preference check** (skipped for service category): read/lazy-seed `email_preferences`; if `unsubscribed_all` or the category flag is off → `status='skipped'`, return.
5. **Frequency cap** (lifecycle only, if 0024 present): if `last_lifecycle_email_at` is today → `status='skipped'`, return.
6. **Idempotency claim** (partial-index `ON CONFLICT DO NOTHING`, §3.3). No row returned → another attempt owns it → return.
7. **Late entitlement re-check** for trial-ending (§9 R1): re-read `subscriptions`; if now active → `status='skipped'`, return.
8. **Render** template → `{ html, text }`.
9. **Send via Resend** with `Idempotency-Key: <dedup_key>`, `headers: { 'List-Unsubscribe': '<url>, <mailto>', 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' }`, optional `scheduledAt`.
10. **Advance ledger:** `resend_id`, `status='sent'`, `sent_at`; stamp `profiles.last_lifecycle_email_at` for lifecycle. On error → `status='failed'`, `error`, `attempt+1` (drops out of the dedup index → retryable next run).

**Scheduler / cron scaling (fixes §0.6).** The daily route must not `await` hundreds of sends serially in one invocation:
- Each flow returns a **due list** (user + payload). The scheduler renders and dispatches via Resend's **batch endpoint (≤100 messages/call)**, in bounded chunks, honoring the Free-tier **100/day** ceiling as a design limit until Pro.
- Route sets `export const maxDuration = 60` (Hobby-max) and processes in chunks; if a run is cut short, **idempotent dedup keys make the next day's run pick up the remainder safely** (trial-ending is time-critical, so it runs *first* in the flow order, before bulk weekly-summary).
- Ledger claim happens *before* the batch dispatch so a chunk that fails mid-flight leaves reclaimable `failed`/reaped-`queued` rows, never silent double-sends.

### 4.2 Route handlers (App Router `route.ts`)

| Route | Method | Auth | Purpose |
|-------|--------|------|---------|
| `app/api/cron/lifecycle/route.ts` | GET | `Authorization: Bearer ${CRON_SECRET}` (Vercel-injected) | Reaper → run scheduled flows (trial-ending first) → chunked batch send. Returns a JSON summary. Returns 200 "disabled" when `EMAIL_ENABLED=false`. |
| `app/api/webhooks/resend/route.ts` | POST | **Svix signature verify over the raw body** | Advance ledger on `email.delivered/opened/clicked/bounced/complained`; write `email_suppressions` on hard bounce / complaint. |
| `app/api/email/unsubscribe/route.ts` | GET **+ POST** | Stateless HMAC token (no session) | GET → branded confirm page; POST → one-click: toggle the category flag (or `unsubscribed_all`), write `email_unsubscribe_events`. **Must accept POST** for RFC 8058. |

- **Cron security.** Verify the bearer secret; reject otherwise. Vercel injects `CRON_SECRET` for configured crons. ([Securing Vercel cron routes](https://codingcat.dev/post/how-to-secure-vercel-cron-job-routes-in-next-js-14-app-router))
- **Resend webhook.** Resend signs with **Svix**; verification is over the **exact raw request bytes**, so the handler must read `await req.text()` (not `req.json()`) and pass the raw body + `svix-id/svix-timestamp/svix-signature` headers to the verifier. Tolerate replays via ledger idempotency (advancing an already-advanced status is a no-op). ([Resend webhooks / Svix])
- **Unsubscribe token.** `base64url(userId · category · issuedAt) + '.' + HMAC_SHA256(secret, payload)`. Verify signature + optional max-age; no DB read to verify. Revocation/audit is the *effect* (write `email_preferences` + `email_unsubscribe_events`), not the token itself.

**`vercel.json`:**
```json
{ "crons": [ { "path": "/api/cron/lifecycle", "schedule": "0 14 * * *" } ] }
```
14:00 UTC ≈ mid-morning US. One daily job is all MVP needs and — critically — **works on Vercel Hobby**, which caps crons at once/day; Pro is required only for intra-day precision or per-user send-time localization. ([Vercel cron limits](https://vercel.com/docs/cron-jobs/usage-and-pricing))

### 4.3 Server-action changes (existing files, additive only)
- **First-authenticated-session / profile action** → after profile insert **and email confirmed**, `void sendEmail({ template:'welcome', ... })`, wrapped so a Resend failure never blocks sign-in.
- **Stripe webhook handler** (`app/api/webhooks/stripe/route.ts`, existing) → **strictly after** the existing entitlement write (unchanged; still the sole entitlement writer), additionally enqueue `receipt` on `checkout.session.completed` / `invoice.paid`, `payment_failed` nudge on `invoice.payment_failed`, and stamp `subscriptions.canceled_at` for win-back on `customer.subscription.deleted`. Email logic must not alter the entitlement write.
- **Preference-center action** (`app/settings/email/actions.ts`) → `upsert email_preferences` for `auth.uid()` (now valid — INSERT policy added, §0.3).
- **Weekly-review Apply action** (existing, `BILLING_ENABLED`-gated) → optionally enqueue `weekly_review_ready` when a revision is computed (Phase C).

### 4.4 Feature flag — `EMAIL_ENABLED` (mirrors `BILLING_ENABLED`)
When false, `sendEmail()` short-circuits at step 1 to a no-op that still writes a `status='skipped'` ledger row (dry-run visibility) **without occupying the dedup slot** (§0.1), and the cron returns a "disabled" summary. This lets every migration + route + template merge to `main` and deploy **without sending a single email**, keeping `next build` and prod behavior safe until the switch is flipped.

### 4.5 Dependency + build guardrail (fixes §0.7)
Before any template work: install `resend`, `react-email`, `@react-email/components`, `@react-email/render`; **pin versions and confirm React 19 peer ranges resolve**, then run `next build` to prove green. `resend.ts` and `render.ts` must be `import 'server-only'` to keep the client out of any client bundle. This is the step that finally kills the `_phase3_draft` build break.

---

## 5. Engine / AI Implications

**The deterministic engine (`lib/engine/*`) and generation pipeline (`lib/generation/*`) are NOT touched.** Email is a read-only consumer of already-computed data. Hard architectural rule: email must never influence program structure, volume, zones, or adaptation. `git diff lib/engine lib/generation` is empty at DoD.

### 5.1 Data the emails read (all existing)
- **Weekly summary:** `workout_logs` for the program-week (planned vs actual volume, sessions completed, pace vs target), `readiness_checkins` (avg), and derived signals **already persisted** by the engine (`adaptations`, 0006 — ACWR/monotony **displayed**, never recomputed). Where a signal isn't persisted, the email omits the stat rather than computing anything novel.
- **Trial-ending:** `profiles.trial_started_at + 14d`; `subscriptions` for active status.
- **Race-week:** `programs` race date + current phase (Taper) from the engine's already-materialized microcycle.
- **Streak/milestone:** counts over `workout_logs`.

### 5.2 Optional Haiku usage — copy only, never structure (Phase C)
For email we may use Haiku for exactly one thing: a short, warm **1–2 sentence "coach's note"** in weekly-summary / race-week mail. Rules:
- Input is a **compact, pre-computed stat block** produced by deterministic code (volumes, adherence %, readiness avg, next-week focus label). Haiku never sees raw logs and never decides any number.
- Output is **Zod-validated** (`{ note: string, max 240 chars }`), with a **deterministic fallback string** if generation fails/invalidates — the email always sends.
- **Cached** per (user, week) in `email_sends.meta`, so a resend never re-bills Haiku.
- **MVP recommendation: no Haiku in email.** Ship deterministic string interpolation; add the coach's note in Phase C behind the same validation discipline.

### 5.3 Training-data → engine loop is unaffected
Nothing in email writes `workout_logs` / `readiness_checkins`. (Contrast: Strava linking *writes* a `workout_log`, feeding adaptation. Email is the opposite direction — pure read/notify.) Zero risk of email creating feedback into ACWR/monotony.

---

## 6. UX Outline

### 6.1 Email design system
- **Shared `_Layout.tsx`** (React Email): Duravel wordmark header, generous whitespace, single accent color, system font stack, mobile-first single column, dark-mode-safe colors.
- **Always ship a plain-text alternative** (`render(..., { plainText: true })`) — the `text` half of `{ html, text }` — for deliverability.
- **Footer on every email:** valid **postal identity line** (§2.4 caveat), "Manage email preferences" → `/settings/email`, and one-click "Unsubscribe" (tokenized). Service emails label the control "manage," not "unsubscribe."
- **Content pattern:** one hero stat/CTA per email; secondary detail below the fold. Trial-ending and win-back lead with a single primary button (Subscribe / Reactivate → Stripe checkout / billing portal).

### 6.2 Per-email skeletons
- **Welcome:** "You're in. Here's how Duravel builds your plan." CTA → *Generate your program*; sets trial-length expectation.
- **Onboarding nudge:** "Your plan is one step away." Only if no program exists. CTA → generator.
- **Trial-ending T-3 / T-1 / T-0:** headline countdown, 2-line value recap (adaptive plan + *your own logged progress so far*), CTA → subscribe. T-0 adds urgency + annual-plan framing ($149/yr vs $19.99/mo). ([Trial-expiration patterns](https://userlist.com/blog/trial-expiration-emails-saas/))
- **Weekly summary:** "Week N recap" — sessions completed, adherence %, key pace/HR highlight, readiness trend, next-week focus label, CTA → open this week's plan. (Optional coach's note.)
- **Race-week:** "Race week: trust the taper." Taper rationale, key reminders (sleep, fueling, no new stimulus), CTA → view race-day plan.
- **Win-back:** "Your plan is paused, not gone." Re-emphasize adaptive continuity; optional incentive later; CTA → reactivate.

### 6.3 In-app: preference center
`/settings/email` — server component reads `email_preferences`, renders a master toggle + per-category switches with plain-language labels ("Weekly training recap," "Race-week guidance," "Milestones & streaks," "We-miss-you"). Save via server action. Billing/receipt emails shown as **"Always on (account & receipts)"** — non-toggleable.

### 6.4 Unsubscribe landing
`/api/email/unsubscribe` GET → minimal branded confirmation ("You've been unsubscribed from weekly recaps. Manage all preferences →"). One-click POST from mail clients renders no page (200 + minimal body).

---

## 7. Third-Party Services + Rough Costs

### 7.1 Resend (email provider)
| Tier | Volume | Key limits | Price |
|---|---|---|---|
| **Free** | 3,000/mo | **100/day cap**, 1 domain, 1 webhook endpoint | **$0** |
| **Pro** | 50,000/mo | no daily cap, 10 domains, 10 webhooks, $0.90 / extra 1k | **$20/mo** |
| **Scale** | 100,000/mo | dedicated-IP add-on ~$30/mo | ~$90/mo |

*(Verify current tier limits at build time — Resend adjusts them.)* ([Resend pricing](https://resend.com/pricing))

**Volume + the real constraint.** Weekly summary is the driver: `active_users × ~4.3/mo` + lifecycle one-offs. At ~150 active users → ~700–900/mo → **Free by monthly volume**. But the binding constraint is the **100/day cap**: because weekly summaries fire only on each user's program-week boundary, load spreads naturally across the week, but a heavy day (weekly-summary cohort + trial-ending) must stay < 100 until ~500 users. **The chunked batch scheduler (§4.1) is what keeps a single day under the cap.** Move to **Pro ($20/mo)** when daily volume nears 100 or active users cross ~600. Even 100k/mo on Pro ≈ $20 + ~$45 overage — trivial vs. $19.99 subscriptions.

### 7.2 Vercel Cron
Included on all plans; Hobby = once/day min (fits the design), Pro = once/minute. One function run/day is a negligible invocation cost. **Constraint:** per-user send-time localization or intra-day cadence needs Pro or an external scheduler — not needed for MVP. ([Vercel cron pricing](https://vercel.com/docs/cron-jobs/usage-and-pricing))

### 7.3 Anthropic Haiku (optional, Phase C)
~1 call / weekly-summary recipient / week, tiny prompt+response, cached per week. At ~150 users ≈ 650 calls/mo of a few hundred tokens → **< $1/mo** even at current Haiku pricing. Resends free (cached).

### 7.4 Domain / DNS
Use a **dedicated sending subdomain** (e.g. `send.duravel.com`) so lifecycle-mail reputation is isolated from any future corporate mail on the root. Records at the registrar / Vercel DNS: **DKIM (CNAME/TXT), SPF (TXT include), DMARC (TXT `_dmarc`, start `p=none`), custom Return-Path/bounce subdomain for alignment.** $0 beyond the domain. **Budget for DNS propagation + Resend verification lead time in Phase A** (can take hours). ([Resend DKIM/SPF/DMARC](https://resend.com/docs/dashboard/domains/dmarc))

### 7.5 Env vars to add
`RESEND_API_KEY`, `RESEND_WEBHOOK_SECRET` (Svix signing), `EMAIL_FROM` (e.g. `Duravel <coach@send.duravel.com>`), `EMAIL_ENABLED`, `EMAIL_UNSUB_SECRET` (HMAC signing key), `CRON_SECRET`, `APP_URL` (absolute links). Set in Vercel project + local `.env`.

**Total recurring cost at launch: $0.** First paid step: ~$20/mo Resend Pro at scale. Effectively free until hundreds of paying users.

---

## 8. Domain / Training-Science & Deliverability Basis

### 8.1 Behavior / retention science
- **Trial-ending cadence (T-3/T-1/T-0):** multi-touch sequences materially outperform single reminders; the last 72h carry most conversion. Leading with the user's *own accumulated progress* frames cancellation as loss of continuity. ([Trial-expiration emails](https://userlist.com/blog/trial-expiration-emails-saas/), [trial email tactics](https://www.dansiepen.io/growth-checklists/saas-email-trial-period-tactics))
- **Win-back windows (D+3 / D+14 / D+30):** staged re-engagement catches *situational* churn (injury, travel) — common in endurance. ([SaaS win-back examples](https://userpilot.com/blog/saas-win-back-email-campaign-examples/))
- **Weekly summary = habit reinforcement:** the adaptation engine only works with logged data; a weekly recap closes the loop and cues the next week (the same mechanic behind Strava/Whoop weekly recaps).

### 8.2 Endurance-specific content correctness
- **Race-week must reinforce the taper, not sabotage it.** Endurance periodization ends in **Taper** (reduced volume, maintained intensity). The email explicitly validates the volume drop as intended, because athletes commonly panic-train in race week. Content is read from the engine's already-computed Taper microcycle; email never suggests adding load.
- **Weekly summary respects load management.** It surfaces engine-computed readiness/ACWR trends (not new advice), keeping the athlete oriented to recovery vs. accumulation. Email presents; the engine decides.
- **Sport-agnostic phrasing.** Copy says "sessions," "volume," "your race" — not HYROX stations — so nothing needs rewriting for triathlon/Ironman.

### 8.3 Deliverability engineering (non-negotiable for a paid product)
- **Full auth:** DKIM + SPF + DMARC on the dedicated subdomain; DMARC `p=none` → `quarantine` after monitoring. ([Email auth guide](https://resend.com/blog/email-authentication-a-developers-guide))
- **RFC 8058 one-click unsubscribe** headers on all lifecycle mail (effectively required by Gmail/Yahoo bulk-sender rules). ([List-Unsubscribe guide](https://autosend.com/blog/list-unsubscribe-header))
- **Suppression discipline:** webhook-driven hard-bounce/complaint suppression is the single biggest deliverability lever for a solo operator — and (§0.10) it is *required* because Resend's dashboard suppression doesn't cover the transactional API.
- **Reputation warm-up:** new subdomain has no reputation. Enable low-volume transactional first (welcome/receipt) before turning on weekly bulk.
- **Separate transactional vs. lifecycle intent** in copy and headers to keep complaint rates on service mail near zero.

---

## 9. Risks & Open Questions

**Risks**
1. **Trial-ending must never fire for a now-paying user.** A same-day race (user subscribes as the cron runs) could misfire. *Mitigation:* **late entitlement re-check inside `sendEmail()` immediately before send** (§4.1 step 7); dedup key bound to `trial_cycle`; T-0 tolerant window.
2. **Dry-run / retry poisoning.** *Mitigated by design* via the partial unique index (§0.1/§0.2, §3.3) + stale-`queued` reaper.
3. **Cron partial failure / timeout at scale.** *Mitigated* by chunked batch sends, `maxDuration`, trial-ending-first ordering, and idempotent re-runs (§4.1).
4. **RLS + service-role correctness.** All ledger/suppression writes route through `lib/email/send.ts`, which imports the service-role client only; a stray anon write would fail silently under RLS.
5. **Untyped Supabase client shape drift.** Zod-parse every row at the email module boundary (`recipient.ts`, flow inputs).
6. **Hobby cron granularity.** Once/day limits send-time personalization. Accept daily batch for MVP; upgrade to Pro only if data warrants.
7. **Reputation cold-start.** Warm gradually (transactional first) on the new subdomain.
8. **React 19 / react-email peer conflicts.** Pin + `next build` before template work (§4.5).

**Open questions**
- Migrate Supabase Auth confirm/reset mail to Resend for brand consistency? *Recommend: leave for now; revisit post-MVP (§0.5).*
- Is `subscriptions.canceled_at`/status already present, or does 0023 add it? **Verify live schema before writing.**
- Send-time: fixed 14:00 UTC, or defer localization to post-Pro? *Recommend fixed for MVP.*
- Weekly-summary "week boundary": ISO Monday vs. per-user program week? **Recommend program-week** (matches engine microcycles).
- Haiku coach-notes in v1 or later? **Recommend deterministic copy first; Haiku in Phase C.**
- **Legal postal identity** for the footer — depends on the pending LLC. **Blocks lifecycle launch** until a valid address exists (§2.4).

---

## 10. Effort Estimate + Phased Build Plan

**Sizing:** S = ≤1 day · M = 2–4 days · L = 1–2+ weeks (solo). Each phase is independently shippable and build-safe (`EMAIL_ENABLED` gates runtime).

| Phase | Scope | Size |
|---|---|---|
| **A — Foundation & draft rescue** | Install + **pin** `resend`, `react-email`, `@react-email/components`, `@react-email/render`; confirm React 19 peers; resolve `_phase3_draft` and prove `next build` green. `lib/email/{resend,recipient,send,categories,render,unsubscribe,dedup}.ts` + `_Layout.tsx`. Migrations **0019–0022** (+ conditional 0023, nice-to-have 0024). Resend account + **domain auth (DKIM/SPF/DMARC + return-path) on `send.duravel.com`** (budget DNS propagation). Env vars; `EMAIL_ENABLED=false`. Webhook route + **Svix raw-body verify**; unsubscribe route (GET/POST, HMAC token). vitest for dedup/suppression/preference/partial-index logic. **Gate:** build green, prod deploys, nothing sends. | **M** |
| **B — MVP flows** | Templates + flows: Welcome (triggered, post-confirm), Onboarding nudge, Trial-ending T-3/T-1/T-0 (with late entitlement re-check), Receipt (Stripe webhook), Weekly summary. `app/api/cron/lifecycle/route.ts` + `vercel.json` + **chunked batch scheduler** + reaper. Preference center `/settings/email`. Wire welcome into first-session action; receipt/payment-failed/cancel-stamp into Stripe webhook (downstream of entitlement write). Dry-run inspection of `skipped` rows → self-test → **flip `EMAIL_ENABLED=true`**. → **launchable product.** | **M** |
| **C — Engagement depth** | Race-week, streak/milestone, weekly-review-ready, re-engagement flows. Optional Haiku coach-note (`copy.ts`, Zod-validated, cached, deterministic fallback). DMARC `p=none` → `quarantine`. | **M** |
| **D — Win-back & polish** | Win-back D+3/D+14/D+30 off `subscriptions` cancellation. Global frequency cap (0024). Analytics view over `email_sends` (delivery/open/complaint rates). Deliverability review; consider Resend Pro if volume warrants. | **S–M** |

**MVP = Phase A + B: overall the low end of L** (~1.5–2 weeks solo), honestly up from the draft's optimistic framing. A alone is a real **M** — DNS/DKIM/DMARC + Svix + the unsubscribe POST path + partial-index idempotency under an untyped client are each easy to get subtly wrong. Everything past B is gated on the MVP demonstrating a conversion/retention signal.

### Definition of done (system-level)
- `next build` passes with the feature both **off and on**.
- Every send routes through `sendEmail()` → flag → suppression → preference → frequency-cap → idempotency → **late entitlement re-check** enforced in order.
- Partial-index idempotency verified: a dry-run `skipped` row does **not** block the later real send; a `failed` send is retryable; the stale-`queued` reaper reclaims wedged rows.
- Webhook advances ledger status and populates `email_suppressions`; suppression is honored before every send incl. transactional.
- One-click unsubscribe works from a **real Gmail client** (RFC 8058 headers honored; POST toggles the pref + writes an audit event).
- **Trial-ending cannot fire for an active subscriber** (verified with a live-state re-check test).
- Preference-center upsert succeeds on first save (INSERT policy verified under RLS).
- Engine + generation unchanged: `git diff lib/engine lib/generation` is empty.
- Pure logic (dedup keys, suppression/preference gating, HMAC token verify) covered by vitest.

---

## Sources
- [Resend pricing](https://resend.com/pricing) · [Resend DKIM/SPF/DMARC](https://resend.com/docs/dashboard/domains/dmarc) · [Resend unsubscribe in transactional email](https://resend.com/docs/dashboard/emails/add-unsubscribe-to-transactional-emails) · [Email authentication guide (Resend)](https://resend.com/blog/email-authentication-a-developers-guide)
- [Vercel cron usage & pricing](https://vercel.com/docs/cron-jobs/usage-and-pricing) · [Securing Vercel cron routes](https://codingcat.dev/post/how-to-secure-vercel-cron-job-routes-in-next-js-14-app-router)
- [List-Unsubscribe-Post (paul.af)](https://paul.af/list-unsubscribe-post) · [List-Unsubscribe header guide (autosend)](https://autosend.com/blog/list-unsubscribe-header)
- [SaaS trial-expiration emails (Userlist)](https://userlist.com/blog/trial-expiration-emails-saas/) · [SaaS trial email tactics (Dan Siepen)](https://www.dansiepen.io/growth-checklists/saas-email-trial-period-tactics) · [SaaS win-back campaigns (Userpilot)](https://userpilot.com/blog/saas-win-back-email-campaign-examples/)
