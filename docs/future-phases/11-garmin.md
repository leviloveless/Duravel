# Duravel — Garmin Integration Completion: Design & Build Spec

**Status:** Preparatory design for a future phase. Research + design only — no code, migrations, Stripe, or deployment changes are made by this document.
**Scope area:** Wearables / Garmin (OAuth connect → activity sync → link-to-session → adaptation; plus Garmin-only daily health signals).
**Date:** 2026-07-15
**Owner:** Levi (solo founder)
**Repo:** `C:\dev\duravel` (Next.js 16 App Router, React 19, TS strict, Supabase, Vercel).
**Depends on:** Garmin Connect Developer Program approval (Health API + Activity API), production access.
**Migrations continue from:** `0019`.

---

## 0. Corrections incorporated from the prior draft (read first)

The preparatory draft was structurally sound and the "linking a synced workout = writing a `workout_log`, zero engine change" thesis is correct and load-bearing. This revision keeps that spine but fixes the following, each of which materially changes the build, the sequencing, or the risk profile:

1. **Garmin approval may be blocked on the same LLC that blocks native mobile — this is a sequencing dependency the draft missed entirely.** The Garmin Connect Developer Program is **business-use-only** and the production agreement is signed by a **legal entity**, not an individual. The founder's LLC is *not yet formed* (it's the blocker for the Apple Developer account too). **Do not assume Garmin approval is a pure code/calendar problem.** Confirm on the very first contact whether a sole proprietor / unregistered individual can be approved, or whether the LLC is a hard prerequisite. If the latter, **Garmin and native-mobile share a single unblock event (LLC formation)** and should be sequenced together (see §10, Phase 0). This is the single most important correction.

2. **Vercel Cron is not a viable "drain worker" on the current plan.** Vercel Cron on **Hobby is once-per-day**; even Pro cron is not a low-latency queue. A daily drain makes "push activity → link → adaptation" feel broken. **Primary async primitive is Next.js 16 `after()`** (stable `after` from `next/server`) to do the detail-pull/validate/upsert *after* the 200 response, inside the same invocation. The ping-inbox table is retained but only as a **durability/retry backstop**, reconciled by a **low-frequency** cron (or Supabase `pg_cron`, or an external scheduler like QStash) — not as the hot path. The draft's "cron drains the inbox" as the main mechanism is wrong for this stack.

3. **Blind whole-row upsert of daily metrics will null out data.** Garmin delivers **sleep, HRV, and dailies (RHR) as separate pushes** landing on the *same* `(user, date)` row. A naive `upsert` of the mapped row overwrites columns the current push doesn't carry (e.g., the HRV push has no sleep fields) with `NULL`. **Must do column-level `COALESCE`-merge upsert** (only overwrite columns the payload actually contains). The draft's single unique index is right; its implied upsert semantics were not. Added explicitly in §3/§4.

4. **The `wearable_activities` unique index can fail to create against live Strava data.** Adding `unique (user_id, provider, external_id)` to a populated table (0016) fails if existing rows have duplicate or `NULL` `external_id`. Supabase is Postgres 15+, so the migration must (a) run a **de-dup/backfill cleanup first**, (b) use **`NULLS NOT DISTINCT`** deliberately or a **partial index `WHERE external_id IS NOT NULL`**, and (c) create the index **`CONCURRENTLY`** outside a txn block to avoid locking Strava writes. The draft hand-waved this as "guard with IF NOT EXISTS," which does not address duplicate/null data.

5. **Garmin push has no HMAC signature.** There is no shared-secret request signing on Garmin's push/ping callbacks. The draft's token-security section didn't cover *inbound* authenticity. Mitigation baked in: (a) a **secret path segment / query token** on the registered webhook URL (rotatable via env), (b) **never trust the payload as truth** — resolve `garmin_user_id → user_id` against `garmin_connections`, drop unknown users, and for activities **pull the detail from Garmin's API** (authenticated) rather than trusting inline data, (c) idempotent upserts so replay is harmless.

6. **OAuth `code_verifier` needs a defined, multi-tab-safe store.** "cookie *or* a state row" is under-specified for PKCE across redirect. Decided: short-lived **`garmin_oauth_states`** row (service-role written, keyed by random `state`), verifier never sent to the client. Migration `0019` includes it. Prevents the "verifier lost / wrong tab" class of connect failures.

7. **Token "encryption at rest" needs a concrete decision, not a checkbox.** Supabase already encrypts disk at rest; that is *not* what protects tokens from a leaked service-role key or a rogue query. Decided: **app-level envelope encryption (AES-256-GCM)** with a key in Vercel env (`GARMIN_TOKEN_KEY`), ciphertext stored in `garmin_connections`; refresh **rotates** both tokens. Supabase Vault/`pgsodium` is the fallback if key management in-app is undesirable. Pick one; don't ship plaintext refresh tokens.

8. **Data-maturity / device caveats change what the MVP can promise.** Garmin **HRV Status** requires a compatible device *and ~3 weeks of nightly wear* before a status exists; nightly rMSSD is available sooner but not instantly. Sleep stages/score require the watch worn overnight. The UX must degrade gracefully to "not enough data yet," and marketing/onboarding must not imply day-one HRV guidance. Reinforces §8's fatigue-guardrail framing.

9. **Feature flag is its own flag, distinct from `BILLING_ENABLED`.** Introduce **`GARMIN_ENABLED`** to gate the entire Garmin surface independent of billing. `BILLING_ENABLED` continues to gate *only* the weekly-review "Apply" adaptation. The draft conflated "a feature flag" with the billing gate.

10. **Privacy: disconnect must offer delete of health data, and health ingest must be independently opt-outable.** Sleep/HRV are sensitive health data. Disconnect keeps activity history by default (like Strava) but must offer **"delete my Garmin health data,"** and users must be able to **keep activity sync while turning off health ingest** (Garmin scopes are granular — honor that in UI and in what we request).

Everything below is the corrected, build-ready spec.

---

## 1. Goal & Why Now

### Goal
Ship a first-class Garmin integration that **mirrors the live Strava pipeline** (OAuth connect → activity sync → dedupe → link activity to a planned session → feed the deterministic adaptation engine) **and** adds Garmin-exclusive **daily health signals — HRV (nightly rMSSD + status), sleep (duration/stages/score), resting HR** — that flow into the readiness/adaptation layer **with zero engine rewrites**.

The activity path reuses the existing "write a `workout_log`" contract, so synced Garmin activities feed ACWR/monotony/readiness with **no `lib/engine/*` changes**. Only the **daily health metrics** are genuinely new plumbing.

### Why now
1. **Strava is proven; Garmin is an inert scaffold.** `lib/wearables/garmin*.ts` exists but does nothing pending API approval. The Strava pipeline (OAuth, sync, dedupe, `activity → workout_log`, `wearable_activities` + link tables in `0016/0017`) is a working reference architecture. This is a "fill in the provider" job with one new surface, not a greenfield build.
2. **Garmin owns the endurance wrist, and Strava strips exactly the data we want.** HYROX and triathlon/Ironman athletes skew heavily to Garmin. Strava re-broadcasts Garmin *activities* but **strips the physiological daily metrics** (HRV status, sleep, Body Battery, RHR) — the precise signals the adaptation engine (ACWR, monotony, readiness) is hungry for. Garmin is the only mainstream source that gives them to us directly.
3. **Approval + entity is the gating path, not code.** Approval to *grant* is fast (~2 business days), but production access is a **1–4 week** handshake (integration call + production review) **and may require the LLC** (§0.1). Starting the paperwork — and forming the LLC — now de-risks the calendar for the triathlon push, where Garmin coverage is table stakes.
4. **Strategic fit with the diversification bet.** Triathlon/Ironman is the main diversification bet; Garmin multisport data (open-water swim, bike power, brick sessions) is far richer than Strava's normalized feed. Building the ingest now lays track for that expansion.

### Non-goals (this phase)
No native mobile (blocked on LLC/Apple). No Garmin Connect IQ on-device app. No replacement of Strava. No new billing SKU — Garmin sits inside existing entitlement gating. No raw beat-to-beat / R-R (license-gated, §7).

---

## 2. User-Facing Scope

### MVP (behind `GARMIN_ENABLED` + Garmin production approval)
1. **Connect Garmin** — OAuth 2.0 **PKCE** "Connect Garmin" button on Settings → Integrations, alongside Strava. Stores encrypted tokens; shows connected state, connected Garmin account, granted scopes, last sync.
2. **Activity sync** — On connect, bounded backfill of recent history (default **90 days**, chunked; see §4.3). Thereafter, **push/ping** activity notifications land in `wearable_activities` (`provider = 'garmin'`), deduped by Garmin `summaryId`.
3. **Link activity → planned session** — Reuse the existing Strava link UX and `workout_log` write path. Auto-suggest a match (same day, sport, duration proximity); user confirms. Manual link fallback identical to Strava.
4. **Daily health ingest (Garmin-only)** — HRV (nightly rMSSD + status), sleep (duration + stages + score), resting HR → new `wearable_daily_metrics` table, **column-merge upsert** on `(user, provider, date)`.
5. **Readiness auto-fill** — Pre-populate the daily `readiness_checkins` form with objective Garmin signals (last night's sleep, HRV status vs baseline, RHR trend). Purely additive; the human still confirms/adjusts.
6. **Disconnect / revoke / delete** — One-click disconnect that deregisters at Garmin, purges tokens, honors Garmin deregistration/permission-change webhooks, and offers **"delete my Garmin health data."** Independent **"pause health ingest, keep activities"** toggle.

### Later (post-MVP)
- **HRV-informed adaptation nudge** — deterministic objective readiness delta surfaced in the weekly review and fed as an adaptation signal (§5.2, §8). Gated behind existing `BILLING_ENABLED` weekly-review "Apply."
- **Stress / Body Battery / SpO₂ / respiration** — additional daily columns once value is proven.
- **Richer multisport** — bike power zones, open-water swim, brick detection for triathlon.
- **On-demand deeper backfill** (chunked Garmin backfill endpoints).
- **Cross-provider dedupe UI** (Strava+Garmin reporting the same workout; §9).

---

## 3. Data Model / Schema Changes

New migrations continue from **`0019`**. All tables RLS-protected; the Stripe webhook remains the sole writer of entitlement (untouched). Follow existing conventions: **untyped Supabase client, queries cast with `as`**; **service-role admin client** for all privileged webhook/callback writes.

> **Repo-dependent assumptions (confirm against actual migrations before writing SQL):** the exact columns of `wearable_activities` (0016) and its link table (0017), and whether `wearable_activities` already has `external_id`/`raw_payload`. The guards below are written to be idempotent, but **the de-dup cleanup in 0020 must be tailored to real data.**

### 0019 — Garmin connections + OAuth state

```sql
-- 0019_garmin_connections.sql
create table public.garmin_connections (
  user_id             uuid primary key references auth.users(id) on delete cascade,
  garmin_user_id      text not null,                    -- Garmin Health API User ID (stable, permanent)
  access_token_enc    text not null,                    -- AES-256-GCM ciphertext (see §7)
  refresh_token_enc   text not null,
  token_nonce         text not null,                    -- GCM nonce/IV (per-encryption)
  access_expires_at   timestamptz not null,
  refresh_expires_at  timestamptz not null,
  scopes              text[] not null default '{}',     -- granted scopes from User Permissions endpoint
  health_ingest_on    boolean not null default true,    -- user toggle: ingest sleep/HRV/RHR
  status              text not null default 'active',    -- active | revoked | error
  last_sync_at        timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create unique index garmin_connections_garmin_user_id_key
  on public.garmin_connections (garmin_user_id);

alter table public.garmin_connections enable row level security;
-- Owner may READ connection state; NO insert/update/delete policy => service-role only.
create policy "own garmin connection read"
  on public.garmin_connections for select
  using (auth.uid() = user_id);

-- PKCE state: verifier never leaves the server; keyed by random state; short TTL.
create table public.garmin_oauth_states (
  state          text primary key,                      -- random, opaque; returned in callback
  user_id        uuid not null references auth.users(id) on delete cascade,
  code_verifier  text not null,
  created_at     timestamptz not null default now(),
  expires_at     timestamptz not null                   -- e.g. now() + interval '10 minutes'
);
alter table public.garmin_oauth_states enable row level security;
-- No policies => service-role only (callback reads/deletes; nothing user-facing).
```

**Why `garmin_user_id` is unique + indexed:** push/deregistration webhooks arrive with a Garmin `userId` and **no Supabase session**. The handler resolves Garmin user → `user_id` via this index.

### 0020 — Extend `wearable_activities` for Garmin (with safe unique index)

```sql
-- 0020_wearable_activities_garmin.sql
alter table public.wearable_activities
  add column if not exists external_id  text,           -- Garmin summaryId for provider='garmin'
  add column if not exists raw_payload  jsonb;          -- raw push/detail for reprocessing

-- STEP 1 (tailor to real data): resolve any existing dup/null (user_id, provider, external_id)
--   before creating a unique constraint, or the index build fails on live Strava rows.
--   e.g. backfill external_id for legacy Strava rows; delete/merge exact duplicates.

-- STEP 2: build the index CONCURRENTLY (own migration step, no surrounding txn) so it
--   does not lock Strava inserts. NULLS NOT DISTINCT makes (user,provider,NULL) collide;
--   if legacy nulls must coexist, use the partial-index form instead.
create unique index concurrently if not exists wearable_activities_provider_ext_key
  on public.wearable_activities (user_id, provider, external_id) nulls not distinct;
-- Alternative if legacy nulls are unavoidable:
-- create unique index concurrently if not exists wearable_activities_provider_ext_key
--   on public.wearable_activities (user_id, provider, external_id) where external_id is not null;
```

The existing `workout_log` link table (0017) is **reused unchanged** — a Garmin activity links to a planned session exactly as a Strava one does. That link write is the "zero engine change" path.

### 0021 — Garmin daily health metrics (the genuinely new surface)

```sql
-- 0021_wearable_daily_metrics.sql
create table public.wearable_daily_metrics (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references auth.users(id) on delete cascade,
  provider            text not null default 'garmin',
  calendar_date       date not null,                    -- Garmin-provided calendarDate (device-local). Canonical. See §9.
  -- Sleep
  sleep_seconds       integer,
  sleep_score         integer,                          -- 0-100 if provided
  sleep_deep_seconds  integer,
  sleep_rem_seconds   integer,
  sleep_light_seconds integer,
  sleep_awake_seconds integer,
  -- HRV
  hrv_rmssd_ms        numeric,                          -- nightly avg rMSSD (ms)
  hrv_status          text,                             -- balanced | unbalanced | low | poor (as provided)
  hrv_baseline_low    numeric,
  hrv_baseline_high   numeric,
  -- Resting HR / other
  resting_hr_bpm      integer,
  stress_avg          integer,                          -- later
  body_battery_high   integer,                          -- later
  -- provenance: which push last touched which metric group (debugging late/duplicate pushes)
  sources             jsonb not null default '{}',      -- {"sleep":"<summaryId>","hrv":"...","dailies":"..."}
  raw_payload         jsonb,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

-- One row per user/provider/day; UPSERT TARGET for column-merge (see §4.2).
create unique index wearable_daily_metrics_user_date_key
  on public.wearable_daily_metrics (user_id, provider, calendar_date);

alter table public.wearable_daily_metrics enable row level security;
create policy "own daily metrics read"
  on public.wearable_daily_metrics for select
  using (auth.uid() = user_id);
-- Writes service-role only.
```

**Upsert semantics (critical):** each push (sleep / HRV / dailies) is a *partial* row. On conflict, **only overwrite the columns the payload actually carries** (`COALESCE(excluded.col, existing.col)` per-column, or targeted per-group `update ... set col = excluded.col`). Never overwrite a populated column with `NULL` from an unrelated push. This is the single easiest way to silently corrupt the readiness data.

### 0022 — (Later) Readiness objective-signal columns

```sql
-- 0022_readiness_objective_signal.sql  (LATER — ships with HRV-informed adaptation)
alter table public.readiness_checkins
  add column if not exists objective_source   text,       -- 'garmin' when auto-filled
  add column if not exists hrv_deviation       numeric,    -- (today rMSSD - 7d baseline) / baseline SD
  add column if not exists rhr_deviation        numeric,
  add column if not exists sleep_debt_seconds    integer;
```

Cache the derived deltas so the deterministic engine reads a stable value rather than recomputing from raw metrics each run.

---

## 4. API / Routes + Server-Action Changes

All new server code lives under the App Router (route handlers for external callbacks/webhooks; server actions for user-initiated flows). Fill out `lib/wearables/garmin*.ts` to mirror `lib/wearables/strava*.ts`.

### 4.1 `lib/wearables/garmin/` (fill the scaffold)
- **`garminOAuth.ts`** — PKCE helpers: `buildAuthUrl(state, codeChallenge)`, `exchangeCode(code, codeVerifier)`, `refreshToken(refreshTokenPlain)`. Garmin OAuth 2.0 PKCE authorize + token endpoints per Garmin's OAuth2 PKCE spec.
- **`garminClient.ts`** — fetch wrapper: decrypts + injects bearer token, **auto-refreshes on 401 and rotates stored ciphertext**, base URL `apis.garmin.com`. Endpoints: activity/FIT detail pull, backfill request, **User Permissions**, deregistration.
- **`garminCrypto.ts`** — AES-256-GCM `seal(plaintext) → {ciphertext, nonce}` / `open(...)` using `GARMIN_TOKEN_KEY` from env (§7). Pure, vitest-covered.
- **`garminMap.ts`** — **pure** functions: Garmin activity JSON → `wearable_activities` row; Garmin sleep/HRV/dailies → *partial* `wearable_daily_metrics` patch (only the fields present). **vitest-covered** (per conventions).
- **`garminZod.ts`** — Zod schemas validating every inbound payload shape before it touches the DB (consistent with the Haiku-output Zod convention). Reject → log → 200 (don't NACK malformed pushes into infinite retry).

### 4.2 Route handlers (App Router `route.ts`)

| Route | Method | Purpose |
|---|---|---|
| `app/api/wearables/garmin/callback/route.ts` | GET | OAuth PKCE redirect. Look up `garmin_oauth_states` by `state`; exchange `code`+verifier → tokens; encrypt + upsert `garmin_connections` (service-role); call **User Permissions** to record granted scopes; delete state row; kick off bounded backfill via `after()`. |
| `app/api/wearables/garmin/webhook/[secret]/activities/route.ts` | POST | Activity ping/push. Validate secret segment; resolve user; **return 200 immediately**; process in `after()` (pull authenticated detail → Zod → map → upsert → dedupe). |
| `app/api/wearables/garmin/webhook/[secret]/health/route.ts` | POST | Sleep / HRV / dailies (RHR) push. Validate secret; 200 fast; `after()` → Zod → map to partial patch → **column-merge upsert**. |
| `app/api/wearables/garmin/webhook/[secret]/deregistration/route.ts` | POST | Garmin deregistration / permission change → mark connection `revoked`, purge tokens, disable ingest. |

**Webhook contract (from Garmin's push model):**
- **Acknowledge within seconds, 200 fast**, do heavy work off the response path. Garmin **retries failed deliveries on a schedule**, and **data delivered after the retry window closes is lost unless backfill exists** — so idempotent upserts + a backfill fallback are mandatory.
- **Async primitive = Next.js 16 `after()`** for the hot path (detail pull + upsert after the response). **Not** Vercel Cron (Hobby = daily; §0.2).
- **Durability backstop = ping-inbox.** Before doing `after()` work, insert the raw ping into a lightweight `garmin_ping_inbox` (service-role) with a processed flag. A **low-frequency reconcile** job (Supabase `pg_cron`, or QStash/external scheduler, or a Pro Vercel cron every few minutes) reprocesses any inbox rows still unprocessed after N minutes — covering cold starts, deploys mid-request, and `after()` failures. Idempotent upserts make reprocessing safe.
- **No HMAC** (§0.5): trust the payload only as a *trigger*; authenticate via the secret URL segment + `garmin_user_id` lookup; for activities, pull the authenticated detail rather than trusting inline numbers.

`garmin_ping_inbox` (part of 0020 or its own migration):
```sql
create table public.garmin_ping_inbox (
  id            uuid primary key default gen_random_uuid(),
  kind          text not null,                 -- 'activity' | 'sleep' | 'hrv' | 'dailies' | 'dereg'
  garmin_user_id text,
  payload       jsonb not null,
  received_at   timestamptz not null default now(),
  processed_at  timestamptz,
  attempts      integer not null default 0,
  last_error    text
);
```

### 4.3 Server actions (user-initiated)
- **`connectGarminAction()`** — generate PKCE `code_verifier`/`challenge` + random `state`; insert `garmin_oauth_states` (service-role, 10-min TTL); redirect to Garmin authorize URL. Verifier never reaches the client.
- **`disconnectGarminAction({ deleteHealth })`** — call Garmin **user deregistration**; delete `garmin_connections` (tokens); if `deleteHealth`, delete this user's `wearable_daily_metrics`. RLS + `auth.uid()` scoped; actual deletes via service-role.
- **`setGarminHealthIngestAction(on: boolean)`** — flip `health_ingest_on` without disconnecting activities.
- **`linkGarminActivityAction(activityId, plannedSessionId)`** — **reuses the existing Strava link server action / `workout_log` writer**; only the source lookup changes. This is the zero-engine-change path.
- **`requestGarminBackfillAction(fromDate, toDate)`** — chunked backfill (Garmin caps historic backfill windows and delivers results **asynchronously via the same push endpoints**, subject to rate limits). On connect, auto-request the last 90 days in chunks; results flow through the normal inbox/`after()` path. **Backfill is not synchronous** — the UI shows "importing…" until pushes arrive.

### 4.4 Entitlement / billing gating
- **Connecting Garmin and syncing (activities + health) are free**, like Strava — they improve the product regardless of plan and shouldn't be paywalled.
- The **HRV-informed weekly-review "Apply"** stays gated by **`BILLING_ENABLED`**, exactly as today. Garmin adds signal quality to that gated action; it does not change the gate. **No Stripe/webhook changes.**
- The whole Garmin surface is additionally behind **`GARMIN_ENABLED`** so it can ship dark and flip on only after production approval.

---

## 5. Engine / AI Implications

**Design principle preserved:** the **deterministic engine owns structure, volume, and zones**; Haiku only fills session content; **Garmin data enters as *signals*, never as authored structure.**

### 5.1 Activities → adaptation (no engine change)
A linked Garmin activity writes a `workout_log`. The existing adaptation signals — **ACWR, training monotony, session RPE, readiness** — already consume `workout_log` rows. Garmin improves signal **completeness/accuracy** (auto-captured duration, distance, HR, avg pace) with **no changes to `lib/engine/*`.** This is why the ingest is low-risk.

### 5.2 Daily health metrics → readiness signal (bounded new input)
New `wearable_daily_metrics` feed the **readiness** side of adaptation:
- **MVP:** auto-fill the subjective `readiness_checkins` with objective values (sleep hours, HRV status, RHR). The engine already weighs a readiness check-in; we improve its *inputs*, human still confirms. **No new engine math for MVP.**
- **Later:** add a **deterministic, rule-based objective readiness delta** as a first-class adaptation signal in `lib/engine/adaptation/*`, computed from cached `hrv_deviation` / `rhr_deviation` / `sleep_debt`. It **nudges the upcoming week's intensity distribution within existing guardrails** (e.g., down-shift a threshold session to Z2 when HRV is suppressed multiple days). It **never** rewrites periodization phases, mesocycle volume, or zone models, and **never adds volume beyond engine targets.**

### 5.3 AI (Haiku) implications — minimal
- Haiku authors session *content*; it does **not** see raw Garmin streams. Keep it that way.
- Optional (later): pass a **compact, pre-computed** readiness descriptor (e.g., `readiness: "suppressed HRV 2 days, RHR +6, sleep debt 90m"`) into session-generation context so wording/coaching notes reflect it — but the **decision** to lower intensity is made deterministically by the engine, then handed to Haiku as a *constraint*. Continue validating Haiku output with Zod.
- No change to mileage/cardio reconciliation: engine targets remain authoritative; Garmin never overrides reconciled volume.

---

## 6. UX Outline

**Settings → Integrations (extend the existing Strava card).**
- "Connect Garmin" button (Garmin brand mark per brand guidelines). States: Not connected → Connecting → Connected (Garmin account + last sync + granted scopes) → Error/Reconnect.
- Toggles: **Health ingest on/off** (independent of activities). Disconnect with confirm, offering **"also delete my Garmin health data."**

**Activity linking (reuse Strava flow).**
- Unlinked synced activities appear in the same "Recent activities" list with a Garmin source badge. Auto-suggested planned-session match with confirm/reject; manual link fallback identical to Strava.

**Daily readiness (enhanced).**
- The daily check-in shows an "auto-filled from Garmin" chip on sleep/HRV/RHR fields, pre-populated and editable. A "last night" card (sleep duration + stages, HRV status vs baseline, RHR trend arrow) sits above the subjective sliders.
- **Data-maturity states (required):** "Not enough data yet — HRV Status needs ~3 weeks of nightly wear," "Wear your watch overnight to see sleep/HRV," and per-metric "no data last night."
- **Later:** weekly-review objective readiness strip (7-day HRV/RHR/sleep sparkline) next to the adaptation recommendation, so the athlete sees *why* the plan adapts. Follow the Duravel **dataviz** conventions for sparklines/trend colors.

**Permission states.**
- Garmin scopes are granular: if activities granted but health not, show which signals are missing and a "grant health data" reconnect path.

---

## 7. Third-Party Services + Rough Costs

| Item | Cost | Notes |
|---|---|---|
| **Garmin Connect Developer Program (Health + Activity API)** | **Free** for approved developers; no per-call/licensing fee for standard access | **Business-use only; production agreement signed by a legal entity** — see §0.1 / §9 (LLC dependency). ~2-day approval to grant, then integration call + production review (1–4 wks). **Advanced metrics (raw R-R / "Enhanced BBI")** need a commercial license or minimum device order — **MVP avoids these** by using nightly HRV summary + status only. |
| **Token encryption** | Included in stack | **App-level AES-256-GCM**, key = `GARMIN_TOKEN_KEY` (Vercel env), ciphertext + nonce in `garmin_connections`; rotate on refresh. Fallback: Supabase Vault/`pgsodium`. Disk-at-rest encryption alone is **not** sufficient. |
| **Vercel function execution** | Marginal on current plan | Webhooks are tiny + fast (200-and-`after()`). Detail pulls/backfill are the heavier calls; chunk them and watch invocation counts if a large base syncs frequently. |
| **Async scheduler (reconcile backstop)** | Low / included | **Not the hot path.** Options: Supabase `pg_cron` (free, in-DB), QStash (generous free tier), or Vercel Pro cron. **Hobby Vercel cron (daily) is insufficient** as a queue — do not rely on it for latency. |
| **Supabase** | Existing plan | New tables small; `raw_payload` jsonb is the main growth — add a **prune job** (drop `raw_payload` + processed inbox rows after successful processing + N days). |
| **Anthropic Haiku** | Negligible delta | Only an optional compact readiness descriptor added to context; no new high-volume calls. |

**Net:** no material new recurring spend for MVP. The real cost is **legal-entity + approval lead time and review effort**, not dollars.

---

## 8. Domain / Training-Science Basis

The daily-health work is grounded in the HRV-guided-training literature, which dictates a **conservative, deterministic** use of the signal.

- **Metric choice — rMSSD.** Garmin's nightly HRV maps to the rMSSD family; rMSSD dominates the literature (~62.5% of studies) and is the most reproducible parasympathetic marker.
- **Rolling baseline, not single-day.** ~70% of studies use a **3- or 7-day rolling average**, because night-to-night HRV is noisy. Duravel computes a **7-day rolling rMSSD** with a personal baseline band (mean ± ~0.5 SD); hence `wearable_daily_metrics` stores raw nightly values and `hrv_deviation` (0022) is derived against the window.
- **Decision rule (deterministic, engine-owned).** *High-intensity when resting HRV is within/above the individual's baseline; low-intensity or rest when suppressed.* Duravel applies exactly this within existing zone guardrails — suppressed multi-day HRV (and/or elevated RHR and/or sleep debt) can **down-shift** an upcoming hard session; normal/high HRV leaves the plan intact. It never *adds* volume.
- **Honest effect size.** Meta-analysis shows HRV-guided training yields at best a **small, non-significant** edge over well-designed predefined plans (SMD ≈ 0.20, CI crossing zero). Framing must be **"HRV helps you avoid training hard on a bad day," not "HRV makes you faster."** This drives the human-in-the-loop UX and the guardrail (not plan-driver) role.
- **RHR + sleep as corroborators.** Elevated RHR vs baseline and accumulated sleep debt are established fatigue/illness proxies; combining them with HRV reduces false positives from single-night HRV noise — hence a **multi-signal** readiness delta.
- **Data maturity (see §0.8).** HRV **Status** needs ~3 weeks of nightly wear; the engine must treat "insufficient baseline" as "no nudge," never as "suppressed."

This keeps Duravel's differentiator — a **deterministic, defensible engine** — intact: the science sets conservative rules; it does not hand plan control to a noisy biometric.

---

## 9. Risks & Open Questions

**Risks**
1. **Legal-entity dependency (highest).** Garmin production access is business-only and entity-signed; the LLC is not yet formed and also blocks Apple. If Garmin requires the entity, **Garmin ≈ shares the native-mobile unblock event.** Mitigation: confirm on first contact; **form the LLC now** to unblock both; build against the evaluation environment meanwhile behind `GARMIN_ENABLED`.
2. **Approval/production-review dependency.** Whole feature gated on Health + Activity API **production** approval (not just eval). Mitigation: apply now; build against eval; keep the scaffold flagged so nothing ships half-wired.
3. **Push delivery loss.** Finite retry window; endpoint downtime = permanent gaps unless backfill exists. Mitigation: idempotent upserts on unique indexes + backfill fallback from day one + ping-inbox reconcile so a slow processor never NACKs.
4. **Wrong async primitive on Vercel.** Vercel Hobby cron is daily; relying on it as a queue makes sync feel broken. Mitigation: `after()` hot path + `pg_cron`/QStash reconcile (§4.2).
5. **Migration hazard on live Strava data.** The `wearable_activities` unique index can fail against existing dup/null rows. Mitigation: de-dup cleanup first, `NULLS NOT DISTINCT` or partial index, `CREATE INDEX CONCURRENTLY` (§3/0020).
6. **Partial-push data loss.** Whole-row upsert nulls out sibling metrics. Mitigation: column-merge upsert (§4.2).
7. **Inbound webhook authenticity (no HMAC).** Mitigation: secret URL segment + `garmin_user_id` resolution + authenticated detail pull; never trust inline payload (§0.5).
8. **Token security.** Long-lived refresh tokens across users. Mitigation: AES-GCM at app level, service-role-only writes, RLS read, rotate on refresh, honor deregistration promptly.
9. **Cross-provider duplication.** A Garmin activity re-broadcast by Strava can double-count in ACWR. Mitigation (design now, ship later): cross-provider heuristic (same user, overlapping start ± window, similar duration/distance) flags one canonical before it becomes a `workout_log`. **MVP mitigation:** steer users to one activity source, Garmin preferred.
10. **Commercial-license creep.** Raw R-R is license-gated. Mitigation: MVP uses nightly HRV summary + status only.
11. **Privacy/consent.** Sleep/HRV are sensitive. Mitigation: explicit consent copy at connect, granular scopes, independent health-ingest toggle, disconnect+delete, documented `raw_payload` retention/prune.
12. **Science over-claim.** Mitigation: fatigue-avoidance framing (§8).

**Open questions (resolve on the integration call / before coding the relevant phase)**
- **Does Garmin approve a sole proprietor / unregistered individual, or is the LLC a hard prerequisite?** (Gates Phase 0 sequencing.)
- Current `wearable_activities` (0016) actual columns — does `external_id`/`raw_payload` exist, and are there dup/null rows to clean before the unique index?
- Exact Garmin push cadence + retry window for our agreement/region — sizes the backfill window and reconcile frequency.
- Which async scheduler is available/cheapest for the reconcile backstop (Supabase `pg_cron` vs QStash vs Vercel Pro cron)?
- Backfill historic depth cap and rate limits (how far back, how large per chunk).
- Canonical `calendar_date` rule confirmed: **use Garmin-provided `calendarDate` (device-local) as canonical** to avoid off-by-one sleep rows — validate this matches how `readiness_checkins` keys its day.
- Ping vs Push per data type (activities as ping+detail-pull; health as push) — confirm what the portal lets us configure.

---

## 10. Effort Estimate + Phased Build Plan

**Overall: L** — dominated by external approval + legal entity + async-delivery robustness, not raw code volume.

| Component | Size |
|---|---|
| LLC formation (if required by Garmin) | **S effort, long calendar** (shared with native mobile) |
| Garmin approval paperwork + integration call | **S effort, long calendar** |
| OAuth PKCE connect/callback/disconnect + state table + token crypto | **M** |
| Activity webhook → `after()`/inbox → `wearable_activities` → link/`workout_log` (+ safe unique-index migration) | **M** |
| Health webhook → `wearable_daily_metrics` (column-merge upsert) | **M** |
| Readiness auto-fill UX (+ data-maturity states) | **S–M** |
| Reconcile backstop (pg_cron/QStash) + `raw_payload` prune | **S** |
| HRV-informed adaptation signal (deterministic engine rule) | **M** (later) |
| Cross-provider dedupe | **M** (later) |

### Phase 0 — Legal + approval + scaffolding prerequisites (start immediately)
- **Confirm the LLC requirement with Garmin.** If required, form the LLC (also unblocks Apple — do it once). 
- Submit Garmin Connect Developer Program application (Health + Activity API, business use).
- Complete integration call; obtain **evaluation** consumer credentials.
- Confirm push cadence, retry window, granular scopes, license-gated metrics, backfill caps, canonical date rule.
- Register production callback/webhook URLs (with secret segment) + TLS.
- **Exit:** eval credentials in hand; entity question resolved; §9 open questions answered.

### Phase 1 — OAuth + connection (MVP core) — behind `GARMIN_ENABLED`
- Migration `0019` (`garmin_connections` + `garmin_oauth_states`).
- Fill `garminOAuth.ts`, `garminClient.ts`, `garminCrypto.ts`; `connectGarminAction`, callback route, `disconnectGarminAction`, deregistration webhook.
- Settings connect/disconnect/health-toggle UI.
- **Exit:** connect/disconnect works in eval; tokens refresh + rotate; deregistration honored; `next build` green.

### Phase 2 — Activity sync + linking (MVP core, reaches the engine)
- Migration `0020` (+ **tailored de-dup cleanup**, `CONCURRENTLY` unique index, `garmin_ping_inbox`).
- Activity webhook (secret segment) → `after()` + inbox; `garminMap`/`garminZod` for activities (vitest).
- Reuse Strava link action → `workout_log`. Bounded 90-day backfill on connect.
- Reconcile backstop job.
- **Exit:** synced Garmin activities dedupe, link to planned sessions, appear in ACWR/monotony via `workout_log`; backfill recovers a simulated outage; `next build` green.

### Phase 3 — Daily health ingest + readiness auto-fill (MVP-completing)
- Migration `0021`; health webhook → **column-merge upsert** into `wearable_daily_metrics`.
- `garminMap` partial-patch mappers + vitest for the merge logic (null-preservation is the key test).
- Readiness auto-fill UX (chips + last-night card + data-maturity states).
- `raw_payload` prune job.
- **Exit:** overnight metrics populate without nulling siblings; readiness form pre-fills; human confirms; **no engine changes**; `next build` green.

### Phase 4 — Production go-live
- Garmin **production-access review passed**; production webhooks verified end-to-end under retry/backfill.
- Flip `GARMIN_ENABLED` for real users. Go-live checklist below.

### Phase 5 — Later
- Migration `0022`; deterministic HRV/RHR/sleep readiness-delta signal in `lib/engine/adaptation/*`, gated behind `BILLING_ENABLED` weekly-review "Apply."
- Cross-provider dedupe; on-demand backfill; stress/Body Battery/SpO₂; multisport/power for triathlon.

**Critical path:** Phase 0's *entity + approval* gate everything. Engineering to first production go-live (excluding waiting): roughly **3–5 focused solo weeks**, plus approval latency. If the LLC is the shared blocker, **sequence Garmin and native-mobile Phase 0 together.**

---

### Go-Live Checklist (Garmin)
- [ ] Legal entity in place if Garmin requires it; production agreement signed.
- [ ] Garmin Health **and** Activity API approved for **production** (not just evaluation).
- [ ] Production callback + all webhook URLs (with secret segment) registered, publicly reachable, valid HTTPS at all times.
- [ ] OAuth PKCE round-trip verified in production; `garmin_oauth_states` TTL/cleanup working; token refresh + refresh-token expiry + **rotation** handled.
- [ ] Deregistration & permission-change webhooks handled (revoke + purge tokens + disable ingest).
- [ ] Webhooks return **200 within budget**; processing async via `after()`; ping-inbox + reconcile backstop verified.
- [ ] Idempotent upserts confirmed: `wearable_activities` (user+provider+ext id), `wearable_daily_metrics` (user+date) with **column-merge** (null-preservation tested).
- [ ] `wearable_activities` unique index built without breaking live Strava data (dedup done, `CONCURRENTLY`).
- [ ] Backfill path verified to recover data missed during a webhook outage.
- [ ] Only **non-license-gated** metrics used (nightly HRV summary/status, sleep, RHR); no raw R-R.
- [ ] Tokens encrypted (AES-GCM) at rest; service-role-only writes; RLS read policies verified with a second test user.
- [ ] Consent copy + privacy/retention policy for health data + `raw_payload` prune job in place; disconnect+delete works; health-ingest toggle independent of activities.
- [ ] Data-maturity UX states present (insufficient HRV baseline, no overnight wear).
- [ ] `GARMIN_ENABLED` gates the whole surface; `BILLING_ENABLED` still solely gates weekly-review "Apply."
- [ ] `next build` green; vitest covers `garminMap`/`garminZod`/`garminCrypto` and the column-merge upsert logic.
- [ ] Garmin brand assets/attribution comply with brand guidelines.
- [ ] Cross-provider double-count risk documented; users steered to a single canonical activity source for launch.

---

## Appendix — Sources
- Garmin Health API — developer.garmin.com/gc-developer-program/health-api/
- Garmin Activity API — developer.garmin.com/gc-developer-program/activity-api/
- Garmin Connect Developer Program FAQ (business-use, approval) — developer.garmin.com/gc-developer-program/program-faq/
- Garmin OAuth2 PKCE Specification (PDF) — developerportal.garmin.com/sites/default/files/OAuth2PKCE_1.pdf
- Garmin Connect API developer guide (activities + health metrics) — openwearables.io/blog/garmin-connect-api-developer-guide-activities-health-metrics
- Garmin push notifications / callback sync (ping vs push, retries, backfill) — openwearables.io/blog/garmin-api-push-notifications-how-callback-sync-works
- Next.js `after()` (post-response work) — nextjs.org/docs/app/api-reference/functions/after
- Vercel Cron limits (Hobby daily) & Vercel Queues — vercel.com/docs/cron-jobs ; vercel.com/docs/queues
- Supabase `pg_cron` / Vault — supabase.com/docs/guides/database/extensions/pg_cron ; supabase.com/docs/guides/database/vault
- Postgres 15 `NULLS NOT DISTINCT` & `CREATE INDEX CONCURRENTLY` — postgresql.org/docs/15/
- HRV-Guided Training for Endurance Performance: systematic review + meta-analysis (PMC8507742) — pmc.ncbi.nlm.nih.gov/articles/PMC8507742/
- Monitoring/adapting endurance training on the basis of HRV: systematic review + meta-analysis (JSAMS) — jsams.org/article/S1440-2440(21)00108-0/fulltext
