# Duravel Engine API Licensing (B2B) — Design & Build Spec

**Status:** Preparatory design (no code / infra changes yet)
**Author:** Levi (solo founder — product + eng)
**Date:** 2026-07-15
**Repo:** `C:\dev\duravel`
**Scope:** Productize the deterministic periodization engine as a licensable, multi-tenant HTTP API — sold to gyms, coaches, and other apps — without exposing the Duravel consumer app or its billing.

---

## 0. TL;DR

Extract `lib/engine/*` into a **pure, DB-free core**, expose it behind versioned `POST /api/engine/v1/*` route handlers (`athlete/derive`, `programs/generate`, `weeks/adapt`), authenticate with **hashed, prefixed API keys**, isolate tenants with new Supabase tables (migrations **0019–0024**) under **default-deny RLS**, meter every billable call to a **local ledger** and push to **Stripe Billing Meters** for usage-based invoicing, and gate access via a curated **apply → approve → provision** flow. The default path runs **zero LLM** (deterministic → cacheable → near-free); Haiku is reserved for an opt-in, higher-priced prose endpoint.

**The pivotal, highest-value, highest-risk work is the engine extraction** — the same boundary needed for the triathlon/Ironman and white-label bets. Realistic solo effort end-to-end is **~8–11 focused weeks**, dominated by that extraction and by billing/reconciliation correctness — not the 2–3 weeks a single "L" line item implies.

---

## 1. Goal & Why Now

### Goal
Expose Duravel's **deterministic training engine** (`lib/engine/*` + the reconciliation layer of `lib/generation/*`) as a **stateless, versioned, multi-tenant HTTP API** third parties can license. A caller sends an athlete profile + goal race and receives a fully-periodized, zone-correct, volume-reconciled program — or an adapted week from logged performance — as structured JSON. Billing is **Stripe metered (usage-based)**; isolation is **Supabase RLS + hashed API keys**; the engine code is **reused verbatim** so there is one source of truth for training logic.

### Why now
- **The asset already exists and is defensible.** The differentiated IP — Base/Build/Peak/Taper periodization, mesocycle/microcycle structure, exact volume reconciliation, formula-based paces, the custom-bands → threshold-HR → resting-HR → sex-specific %HRmax zone-derivation chain, and ACWR/monotony/readiness adaptation — is already built and **deterministic**. Deterministic ⇒ pure function: same input → same output, no per-call LLM cost for structure, trivially cacheable, cheap on Vercel.
- **Revenue that doesn't cannibalize B2C.** Gyms and coaching platforms are not the $19.99/mo individual athlete. Licensing reaches a segment the consumer app can't, at near-zero marginal cost.
- **Proven market shape.** [TrainingPeaks runs a gated, approval-based Partner API](https://www.trainingpeaks.com/blog/an-update-on-trainingpeaks-partner-api/) ("we are being selective… a value-driven ecosystem") with Garmin, Wahoo, Zwift, Polar. Curated commercial access — not open self-serve — fits a solo founder who cannot absorb unbounded free-tier support.
- **Strategic option value.** A clean engine boundary ("expose the engine without the app") is the *same* refactor needed for triathlon/Ironman and white-label. Doing it as an API forces the boundary to be honest.
- **Low blast radius.** Additive only: new tables (from 0019), new route handlers under a new namespace, a new Stripe product and webhook. It does not touch B2C billing (the consumer webhook stays the sole writer of consumer entitlement) or the engine internals.

### Non-goals (this phase)
- No public, ungated self-serve signup with instant keys. Access is **application → approval → provision**.
- No GraphQL/gRPC. REST/JSON only.
- No hosting the consumer UI for partners (that's the separate white-label doc).
- No storing partner end-users' PII beyond what a request needs. The API is **stateless by default** (§5).
- No SLA guarantees at MVP — support is explicitly **best-effort** until revenue justifies more.

---

## 2. User-Facing Scope

"User" here = the **integrating developer / partner org** (a gym's dev, a coaching-platform engineer, an indie app builder).

### MVP (Phases 1–2)
1. **Application & provisioning flow** — partner applies via a form; Levi approves; a tenant + first API key is provisioned. No instant self-serve.
2. **Three core endpoints** (the engine's public surface):
   - `POST /api/engine/v1/programs/generate` — full periodized program from profile + goal.
   - `POST /api/engine/v1/weeks/adapt` — adapted upcoming week from logged sessions + readiness/ACWR signals.
   - `POST /api/engine/v1/athlete/derive` — zones + paces + HR bands only (cheap, high-volume "calculator").
3. **API-key auth** — `Authorization: Bearer dvl_live_…`, hashed at rest, prefix-identifiable, scope-checked.
4. **Usage metering → Stripe** — every billable call writes a local ledger row and emits a Stripe **Billing Meter** event; monthly invoice = base platform fee + metered overage.
5. **Rate limiting** — per-tenant, per-plan (Postgres counters at MVP; Upstash only if it becomes a hot spot).
6. **Minimal test-mode keys** (`dvl_test_…`) — pulled forward from "later" into MVP because integrating devs expect a free, unmetered sandbox on day one (see §2 note). Test keys never meter and never bill.
7. **A minimal developer dashboard** (inside the existing Next.js app, gated to tenant members): show/create/rotate/revoke keys, current-period usage, plan, and a recent-request log tail.
8. **Versioned contract** (`/v1/`) + **OpenAPI 3.1 spec generated from Zod** + a **Docs page** with copy-paste `curl`/TS examples.
9. **Idempotency keys** on the two expensive endpoints (`generate`, `adapt`).

> **Note on test mode:** full sandbox fixtures and a hosted interactive playground stay Phase 3, but a *minimal* test key that runs the real deterministic engine without metering is cheap (it reuses the whole pipeline minus the meter step) and removes the single biggest onboarding objection. Ship it in MVP.

### Later (Phase 3+)
- **Session-prose endpoint** (`POST /api/engine/v1/sessions/fill`) — Haiku expands a skeleton session into human-readable instructions; metered at a higher unit weight (real LLM cost).
- **`includeSessionProse:true`** flag on `generate` (same Haiku path, inline).
- **Webhooks out** — notify partner systems when an async job completes (if generation moves async).
- **Async batch generation** for gyms provisioning many athletes at once.
- **Self-serve signup with automated approval + card-on-file** once support tooling matures.
- **Per-tenant config overrides** (a gym's house strength templates) — the multi-tenant "config" seam.
- **SDKs** (TypeScript first, generated from OpenAPI) + Postman collection + hosted interactive reference.
- **SOC 2 Lite / DPA** package for enterprise gym chains.
- **Triathlon/Ironman engine endpoints** reusing the same boundary.

---

## 3. Data Model / Schema Changes

New migrations continue from **0019**. All new tables live in `public` with **RLS ON, default deny**. Consumer tables are untouched. B2B tenants and keys are **not** `auth.users` rows — they are their own org concept, so partner staff can share a tenant. Follow the untyped-client convention: queries cast with `as` (e.g. `(data as ApiKeyRow[])`). Every table with mutable state gets an `updated_at` maintained by a shared trigger (0024).

### 0019 — tenants & membership
```sql
-- 0019_engine_api_tenants.sql
create table public.api_tenants (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  slug          text not null unique,
  status        text not null default 'pending'
                  check (status in ('pending','active','suspended','closed')),
  plan          text not null default 'trial'
                  check (plan in ('trial','starter','growth','scale','enterprise')),
  stripe_customer_id      text,   -- Stripe Customer for this tenant
  stripe_subscription_id  text,   -- the metered subscription
  monthly_unit_cap        integer,-- hard safety cap; null = plan default; enforced in pipeline
  contact_email text not null,
  metadata      jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- Links a Duravel auth.users account (partner staff) to a tenant, for the dashboard only.
create table public.api_tenant_members (
  tenant_id  uuid not null references public.api_tenants(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  role       text not null default 'admin' check (role in ('admin','viewer')),
  created_at timestamptz not null default now(),
  primary key (tenant_id, user_id)
);
create index on public.api_tenant_members(user_id);
```

### 0020 — API keys (hashed, prefixed, rotatable)
Store only a **hash**; show the full secret exactly once at creation. Keep a display **prefix** and **last4**. Mirrors industry practice (Stripe-style prefix + one-time reveal; [Stripe key best practices](https://docs.stripe.com/keys-best-practices), [Zuplo](https://zuplo.com/learning-center/how-to-implement-api-key-authentication)).

```sql
-- 0020_engine_api_keys.sql
create table public.api_keys (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.api_tenants(id) on delete cascade,
  name         text not null default 'default',
  key_prefix   text not null,            -- e.g. 'dvl_live_a1b2c3' (env tag + first chars; safe to display)
  key_hash     text not null,            -- sha256(full_secret); the lookup key
  last4        text not null,            -- for UI: '…9f2a'
  mode         text not null default 'live' check (mode in ('live','test')),
  scopes       text[] not null default '{generate,adapt,derive}',
  created_by   uuid references auth.users(id),
  last_used_at timestamptz,
  revoked_at   timestamptz,
  rotated_from uuid references public.api_keys(id),  -- rotation lineage; both valid during grace
  expires_at   timestamptz,             -- optional rotation deadline / grace-window end
  created_at   timestamptz not null default now()
);
create unique index on public.api_keys(key_hash);
create index on public.api_keys(tenant_id) where revoked_at is null;
```

**Key format & hashing.**
- Secret = `dvl_{mode}_` + 32 random bytes, base62 (≈190 bits entropy). `mode ∈ {live,test}`.
- `key_prefix` = the tag plus the first ~6 chars of the random part (like GitHub `ghp_…`), enough to disambiguate in logs without revealing the secret.
- Hash is **SHA-256, not bcrypt/argon2** — correct here because the secret is high-entropy random, so it's not brute-forceable; a fast hash enables a single indexed lookup per request. This is the standard API-key trade-off (vs. passwords). Compare in constant time is unnecessary since we look up by hash, not compare a stored secret.
- **Rotation grace:** `rotateApiKey` mints a new key with `rotated_from` set and stamps the old key's `expires_at` = now + 7 days, so partners can roll without downtime. The pipeline treats a key valid if `revoked_at is null and (expires_at is null or expires_at > now())`.

### 0021 — usage events (metering ledger + request log)
The **local source of truth** for usage; Stripe meter events are a *derived* push so we can reconcile/replay if ingestion fails. Records **every authenticated request** (billable and not) so the dashboard log tail includes errors; non-billable outcomes carry `units = 0`. Auth failures with no resolvable tenant cannot be attributed and go to app logs only.

```sql
-- 0021_engine_api_usage.sql
create table public.api_usage_events (
  id              bigint generated always as identity primary key,
  tenant_id       uuid not null references public.api_tenants(id) on delete cascade,
  api_key_id      uuid references public.api_keys(id) on delete set null,
  endpoint        text not null,           -- 'programs.generate' | 'weeks.adapt' | 'athlete.derive' | 'sessions.fill'
  units           integer not null default 0,   -- billable units (0 for errors / test mode)
  mode            text not null default 'live',  -- test-mode rows never sync to Stripe
  request_id      text not null,           -- our per-request id (also returned in header)
  idempotency_key text,                    -- client-supplied, if any
  status_code     integer not null,
  latency_ms      integer,
  cache_hit       boolean not null default false,
  meter_synced_at timestamptz,             -- when pushed to Stripe; null = pending
  created_at      timestamptz not null default now()
);
create index on public.api_usage_events(tenant_id, created_at desc);
create index on public.api_usage_events(meter_synced_at)
  where meter_synced_at is null and units > 0 and mode = 'live';
-- Dedup guard for idempotent billable replays:
create unique index on public.api_usage_events(tenant_id, idempotency_key)
  where idempotency_key is not null;
```

### 0022 — idempotency + deterministic response cache
Lets `generate`/`adapt` be safely retried, and lets identical deterministic requests be served from cache. The engine is a pure function of `(canonical request, engineVersion)`, so the cache key is **not tenant-scoped** for the response body (the same input yields the same program for everyone) — but metering and idempotency **are** tenant-scoped.

```sql
-- 0022_engine_api_idempotency.sql
create table public.api_idempotency (
  tenant_id       uuid not null references public.api_tenants(id) on delete cascade,
  idempotency_key text not null,
  request_hash    text not null,         -- sha256 of canonicalized body; detects key reuse w/ different body
  response_body   jsonb,
  response_status integer,
  locked_at       timestamptz,           -- in-flight lock to serialize concurrent retries
  created_at      timestamptz not null default now(),
  expires_at      timestamptz not null default (now() + interval '24 hours'),
  primary key (tenant_id, idempotency_key)
);

-- Cross-tenant deterministic cache keyed by input+engine version (optional but high-value):
create table public.api_engine_cache (
  cache_key      text primary key,       -- sha256(engineVersion || endpoint || canonical(body))
  response_body  jsonb not null,
  engine_version text not null,
  hits           bigint not null default 0,
  created_at     timestamptz not null default now(),
  expires_at     timestamptz not null default (now() + interval '30 days')
);
```

### 0023 — rate-limit counters (Postgres; Upstash optional later)
```sql
-- 0023_engine_api_ratelimit.sql
create table public.api_rate_counters (
  tenant_id    uuid not null references public.api_tenants(id) on delete cascade,
  window_start timestamptz not null,     -- truncated to the window (e.g. date_trunc('minute', now()))
  count        integer not null default 0,
  primary key (tenant_id, window_start)
);
```
Atomic increment (avoids the read-modify-write race under serverless concurrency):
```sql
insert into public.api_rate_counters (tenant_id, window_start, count)
values ($1, date_trunc('minute', now()), 1)
on conflict (tenant_id, window_start)
do update set count = api_rate_counters.count + 1
returning count;
```
A Vercel Cron (§7) prunes windows older than a few minutes. **Caveat:** this adds one DB round-trip per request and consumes a pooled connection; if p99 latency or connection pressure becomes visible, switch this single check to Upstash (§7) without touching anything else.

### 0024 — updated_at trigger
```sql
-- 0024_engine_api_touch.sql
create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$
begin new.updated_at = now(); return new; end $$;
create trigger trg_api_tenants_touch before update on public.api_tenants
  for each row execute function public.touch_updated_at();
```

### RLS policy shape
- **All B2B tables: RLS ON, default deny.**
- **Dashboard access** (browser, anon/authenticated client): a member may `select` rows for tenants they belong to — a policy joining `api_tenant_members` on `auth.uid()`. `key_hash` is **never** selected client-side: read keys through a column-restricted query or a view that omits `key_hash`.
- **Request-time access** (the API route handlers) runs through the **service-role admin client**, which bypasses RLS — correct and intended, because the caller is authenticated by API key, not a Supabase session. RLS is defense-in-depth for the dashboard path. Every service-role query is still explicitly scoped by `tenant_id` in `where`, and the tenant id comes **only** from the resolved key, never from the request body.
- **Required test:** a member of tenant A cannot read tenant B's keys or usage through the dashboard client.

---

## 4. API / Route + Server-Action Changes

### Routing & runtime
New **route handlers** (not server actions — external machine callers, no CSRF/session) under a dedicated namespace so middleware can target them cleanly:

```
app/api/engine/v1/
  programs/generate/route.ts     POST
  weeks/adapt/route.ts           POST
  athlete/derive/route.ts        POST
  _health/route.ts               GET   (unmetered, unauthenticated liveness)
```

- **Node runtime** (`export const runtime = 'nodejs'`, `export const dynamic = 'force-dynamic'`) — these need the service-role Supabase client, the engine, and (later) the Anthropic SDK.
- **URL style:** paths use plain segments (`/programs/generate`) to match Next.js file routing. Docs may present them as custom-method aliases (`programs:generate`) for readers familiar with that style, but the wire path is the segment form. Be consistent everywhere — this was ambiguous in the draft.
- **No CORS / no browser calls.** Keys are secrets and must live only in partner backends. The dashboard is same-origin and uses server actions, not these routes.
- **Request body limits:** enforce a max body size (e.g. 256 KB) before parsing; `weeks/adapt` `logs[]` and any array inputs get explicit max-length caps in Zod to prevent memory/cost abuse.

### Shared handler pipeline (`lib/engine-api/pipeline.ts`)
Every endpoint runs through one wrapper:
1. **Resolve key** — parse `Authorization: Bearer`, SHA-256, single indexed lookup on `api_keys.key_hash` (service-role). Reject if revoked or past `expires_at`. Load tenant; reject unless `status = 'active'`. Never log the raw header.
2. **Scope check** — verify the endpoint's scope (`generate`/`adapt`/`derive`) is in `api_keys.scopes`; else `403 permission_error`.
3. **Mode** — `test` keys skip metering, Stripe, and rate billing but still validate and execute (deterministic path returns real output; prose paths return fixtures in Phase 3).
4. **Rate limit** — atomic per-tenant window increment; on breach `429` + `Retry-After` + `RateLimit-*` headers.
5. **Unit cap** — reject with `429 rate_limit` (`code: monthly_cap_reached`) if the tenant is over `monthly_unit_cap` for the period (cheap running total from the ledger, cached).
6. **Idempotency** — if `Idempotency-Key` present: hit → return cached response; miss → take a lock; key reuse with a different `request_hash` → `422`.
7. **Cache** — for deterministic endpoints, compute `cache_key` and serve from `api_engine_cache` on hit (mark `cache_hit`).
8. **Validate body** — Zod parse (schemas shared with the engine's Zod validators; §5). Failure → `400`/`422` with a structured error list.
9. **Execute** — call the pure engine. **No writes of athlete data** (stateless).
10. **Meter** — insert `api_usage_events`; enqueue Stripe meter push (local row is the durable backstop). Test/error rows carry `units = 0`.
11. **Respond** — attach `X-Request-Id`, `RateLimit-*`, and `Duravel-Engine-Version` headers.

### Request/response contracts (illustrative)

`POST /api/engine/v1/programs/generate`
```jsonc
// Request
{
  "athlete": {
    "sex": "female", "age": 34, "restingHr": 52, "maxHr": 187,
    "thresholdHr": 168, "fiveKSeconds": 1350,
    "experience": "intermediate"
  },
  "goal": { "event": "hyrox", "division": "open", "raceDate": "2026-11-15" },
  "constraints": { "sessionsPerWeek": 5, "longSessionDay": "saturday" },
  "options": { "includeSessionProse": false }  // false = pure engine, cheap, cacheable
}
// Response 200
{
  "programId": null,                 // stateless: caller persists if they want
  "engineVersion": "2026.07.0",
  "phases": [ /* Base/Build/Peak/Taper mesocycles */ ],
  "microcycles": [ /* weekly zone distribution + reconciled volume */ ],
  "zones": { "hr": [/*…*/], "run": [/*…*/] },
  "meta": { "requestId": "req_…", "units": 5, "cacheHit": false }
}
```

`POST /api/engine/v1/weeks/adapt`
```jsonc
{
  "programContext": { "phase": "Build", "weekIndex": 6 /*, prior microcycle */ },
  "logs": [ /* recent workout_log-shaped sessions: planned vs actual (max 60) */ ],
  "signals": { "readiness": 6, "sessionRpe": [7,8,6], "acwr": 1.31, "monotony": 2.1 },
  "options": {}
}
// Response: revised upcoming microcycle + rationale flags (e.g. "deload: ACWR>1.3")
```

`POST /api/engine/v1/athlete/derive` — profile in → zones/paces/HR bands out. Cheapest, highest-volume, the natural free-tier/trial hook.

### Error contract (uniform, Stripe-shaped)
```jsonc
{ "error": { "type": "invalid_request", "code": "zone_input_missing",
             "message": "thresholdHr or maxHr required to derive HR zones",
             "requestId": "req_…", "docsUrl": "https://…/errors#zone_input_missing" } }
```
Types: `authentication_error` (401), `permission_error` (403 scope/plan), `invalid_request` (400/422), `rate_limit` (429), `engine_error` (422 valid-but-unsatisfiable, e.g. race date in the past), `internal_error` (500).

### Middleware
Extend `middleware.ts` (matcher for `/api/engine/v1/*`) to short-circuit these routes away from the consumer app's session/redirect logic — they must **never** 302 to login. Keep the matcher precise so consumer routes are unaffected.

### Server actions (dashboard only — session-authenticated members)
- `createApiKey(tenantId, name, scopes, mode)` → returns the plaintext secret **once**; stores hash + prefix + last4.
- `rotateApiKey(keyId)` (mints successor, sets 7-day grace on the old), `revokeApiKey(keyId)`.
- `getUsageSummary(tenantId, period)` — reads `api_usage_events`.
- `getRecentRequests(tenantId)` — last 100 rows for the log tail.
- `updateTenantPlan(...)` (operator/admin-guarded).

### Billing flag interaction
Introduce a **separate** flag `ENGINE_API_ENABLED`. Do **not** reuse consumer `BILLING_ENABLED` (which gates B2C generation/apply). The B2B gate is `api_tenants.status = 'active'` + a valid metered subscription. Add a **new, separate webhook handler** for tenant subscription lifecycle so the two billing domains never cross-write; the consumer webhook remains the sole writer of consumer entitlement.

---

## 5. Engine / AI Implications

### The core refactor: "expose the engine without the app"
Today `lib/generation/*` assembles the engine skeleton **and** persists to `programs`/etc. For the API the engine must be callable as a **pure function with zero DB and zero Supabase coupling**:

1. **Extract a pure core.** Ensure `lib/engine/*` takes plain typed inputs and returns plain typed outputs — no `supabase` imports, no `profiles` reads, no env reads. If any engine function reaches into the DB or session, hoist that I/O into the *caller*. **This is the single highest-value and highest-risk piece**; it benefits triathlon and white-label equally. **Phase 1 begins with an import audit** (grep `lib/engine/*` for `supabase`, `createClient`, `process.env`, `cookies`, `headers`) to size it honestly before committing.
2. **Input adapter.** `lib/engine-api/adapters.ts` maps the public request shape → internal engine input types, decoupling the **public contract** (versioned, stable) from **internal engine types** (free to evolve). Never leak internal types onto the wire.
3. **Reuse Zod validators.** The engine already validates Haiku output with Zod. Export/extend those schemas for request validation so there is one schema authority, and generate OpenAPI/JSON-Schema from Zod (`@asteasolutions/zod-to-openapi` or `zod-to-json-schema`) so **docs can't drift from validation**.
4. **Determinism ⇒ cache + no LLM by default.**
   - `programs/generate` with `includeSessionProse:false` is **pure compute** — no Anthropic call; cache by `hash(engineVersion || canonical(request))` in `api_engine_cache`. The flagship endpoint is near-free and instant.
   - HR-zone derivation (custom bands → threshold HR → resting HR (Karvonen-style reserve) → sex-specific %HRmax) and formula-based run paces are pure math — ideal for the high-volume `athlete/derive`.
5. **Haiku only where prose is requested** (Phase 3: `includeSessionProse:true` / `sessions/fill`). Expand skeletons into human instructions, then reconcile mileage/cardio to engine targets exactly as the consumer app does. Real per-call LLM cost ⇒ higher unit weight, tighter rate limits. **Always** validate Haiku output with the existing Zod guard; on failure retry once, then fall back to the deterministic skeleton — never return unvalidated LLM output to a paying partner.
6. **Version the engine output.** Emit `engineVersion` (e.g. `2026.07.0`) in every response, pinned per API version. Snapshot engine constants per version so a partner replaying last week's inputs gets last week's plan (adaptation must be reproducible). `engineVersion` is part of every cache key.
7. **No cross-tenant training-data pooling.** The engine is deterministic and does not learn from partner traffic — this sidesteps a class of data-governance concerns; state it explicitly to enterprise partners.

### AI cost posture
Because the differentiator is deterministic, the **default B2B product has ~zero variable AI cost**. Haiku cost is opt-in and pass-through-priced. This is the core economic argument for the whole line.

---

## 6. UX Outline

Two audiences: **Levi (operator)** and **the partner developer**.

### Partner developer — public docs site
- **`/developers`** — rendered from the same Next.js app (MDX or a docs route group). Overview, Authentication, the three endpoints with request/response, error reference, rate limits, **versioning & deprecation policy**, changelog, "Get access" CTA.
- **`/developers/apply`** — company, use case, expected volume, contact. Writes an `api_tenants` row with `status='pending'` and emails Levi.
- **Interactive reference** — render the OpenAPI 3.1 spec with Scalar or Redoc; copy-paste `curl` + TS snippets. (MVP can ship the static spec; the interactive viewer is Phase 3.)

### Partner developer — authenticated dashboard (gated to `api_tenant_members`)
- **Keys** — list (prefix + last4 + last used), "Create key" (one-time reveal modal: "copy now, we won't show it again"), rotate (with grace notice), revoke; live vs test toggle.
- **Usage** — current-period units by endpoint, a simple chart, projected invoice.
- **Logs** — last 100 requests: timestamp, endpoint, status, requestId, latency, cache-hit (from `api_usage_events`).
- **Billing** — link to the Stripe customer portal for the tenant.
- **Settings** — plan, rate limits, contact.

### Levi — operator surface
Lightweight admin (protected route; Supabase table views acceptable for MVP):
- Approve/suspend tenants (`pending → active → suspended`), set plan, provision the Stripe customer + metered subscription.
- View top tenants by usage; flag abuse; hit the kill switch (`status='suspended'`).

**MVP UX cut:** docs page + application form + bare-bones keys/usage/logs dashboard + minimal operator approve flow. Interactive OpenAPI viewer, charts, and usage-alert emails are Phase 3.

---

## 7. Third-Party Services + Rough Costs

| Service | Role | Rough cost |
|---|---|---|
| **Vercel** (existing) | Hosts Node route handlers + **Vercel Cron** (reconciliation, rate-window prune, idempotency/cache TTL sweep). Deterministic endpoints are cheap CPU. | Pro ~$20/mo baseline; watch function-invocation + CPU + **Cron** at scale. |
| **Supabase** (existing) | Postgres for tenants/keys/usage/idempotency/cache/rate; RLS. | Pro ~$25/mo already paid; these tables are small. **Watch connection limits** — see note below. |
| **Stripe Billing — Meters** (existing account) | Usage-based B2B billing. New product, meter, metered prices, **separate webhook**. | ~2.9% + 30¢ per charge; Billing adds ~0.5–0.7% on billed volume. |
| **Anthropic Haiku** (existing) | Only for `includeSessionProse` / `sessions/fill` (Phase 3). | Pennies per generation, passed through as higher units; **$0 on the default path**. |
| **Upstash Redis** (optional) | Distributed rate limiting + response cache if Postgres counters become a hot spot. | Free tier generous; ~$10/mo pay-as-you-go. **Defer** — start with Postgres. |
| **Resend** (drafted in `_phase3_draft`) | Transactional email: application received/approved, key created, usage alerts. **Fix the unresolved `resend` imports in `_phase3_draft` before reuse.** | Free ≤3k/mo; ~$20/mo after. |
| **Error tracking (Sentry free tier or Vercel logs)** | Capture 5xx and metering failures. Not optional at MVP — you cannot debug a partner's failing integration from memory. | $0 on free tier. |
| **Docs viewer (Scalar/Redoc)** | Render OpenAPI. Self-hostable. | $0. |

> **Connection-pooling caveat (was missing from the draft).** Vercel serverless spins many concurrent function instances; each B2B call touches Postgres several times (key resolve, rate limit, unit cap, idempotency/cache, usage insert). Supabase's direct connection limit is small. **Use the Supavisor/pgBouncer transaction-pooling connection string for the API route handlers**, keep queries short, and consider collapsing the per-request writes (e.g. one `insert` for usage; fire the Stripe push after responding). If pooling pressure or p99 latency shows up, move the rate-limit check to Upstash first — it's the hottest per-request write.

**Stripe meter mechanics** ([Stripe Meters API](https://docs.stripe.com/api/billing/meter), [usage-based pricing plans](https://docs.stripe.com/billing/subscriptions/usage-based/pricing-plans)): create a meter with an `event_name` (e.g. `engine_units`) and `sum` aggregation over `payload.value`; on each billable **live** call, send a meter event (`payload.value` = units, and the tenant's `stripe_customer_id` per the meter's customer mapping); attach the meter to a metered price on the tenant's subscription; Stripe aggregates per period and invoices automatically. **The local `api_usage_events` ledger is the durable source of truth**; a **nightly Vercel Cron reconciliation job** finds rows where `meter_synced_at is null and units > 0 and mode = 'live'`, pushes them, stamps `meter_synced_at`, and alerts if the backlog grows — so a Stripe ingestion blip never loses billable usage. Meter events are also **idempotent by our `request_id`** to prevent double counting on retries.

### Rough packaging / pricing (to validate, not final)
| Plan | Monthly base | Included units | Overage / unit | Rate limit | Fit |
|---|---|---|---|---|---|
| **Trial** | $0 (30 days) | 500 | — | 10 req/min | Evaluation |
| **Starter** | $49 | 2,000 | $0.03 | 30 req/min | Indie coach / small app |
| **Growth** | $199 | 15,000 | $0.02 | 120 req/min | Coaching platform |
| **Scale** | $699 | 75,000 | $0.012 | 600 req/min | Gym chain / larger app |
| **Enterprise** | Custom | Custom | Custom | Custom | SLA + DPA + support |

**Unit weighting (illustrative):** `athlete/derive` = 1; `programs/generate` (deterministic) = 5; `weeks/adapt` = 5; `programs/generate` with prose or `sessions/fill` = 20 (covers Haiku + margin). Cache hits still meter (the value is the output, not the compute) but cost you nothing. Base fee anchors revenue; overage captures upside. Follow the **gated approval model** ([TrainingPeaks](https://www.trainingpeaks.com/blog/an-update-on-trainingpeaks-partner-api/)) — curate partners rather than open self-serve, suiting a solo founder.

---

## 8. Domain / Training-Science Basis

The science is the product — this justifies *why the outputs are worth licensing*.

- **Periodization (Base/Build/Peak/Taper).** Structuring a season into phases with distinct physiological aims (aerobic base → race-specific intensity → sharpening → recovery) is the consensus long-term model and maps directly to HYROX seasons ([rb100.fitness](https://rb100.fitness/articles/hyrox/periodisation-for-hyrox-training/); [TrainRox](https://www.trainrox.com/articles/hyrox-periodization/)). Partners get coach-grade structure, not a random workout generator.
- **Zone distribution / polarized-ish intensity.** Concentrating most volume at low intensity with targeted high-intensity work is the widely-used endurance distribution; the engine's zone-distribution + exact volume reconciliation encodes it so partners don't have to ([HyroxDataLab](https://hyroxdatalab.com/articles/hyrox-running-training-structure)).
- **HR-zone personalization.** The fallback chain (custom bands → threshold HR → resting HR reserve → sex-specific %HRmax) reflects that individualized, threshold-/reserve-based zones are more accurate than one-size %HRmax, and that sex differences matter — a concrete personalization edge to sell.
- **ACWR & monotony for adaptation.** The acute:chronic workload ratio and training monotony are established (if debated) load-management signals; keeping ACWR moderate and avoiding high monotony is associated with lower injury/overreaching risk ([ACWR review, PMC](https://pmc.ncbi.nlm.nih.gov/articles/PMC12487117/); [PFM Coaching](https://www.pfmcoaching.co.uk/blog/reduce-injury-risk-with-the-acute-chronic-workload-ratio)). Turning logged sessions + readiness + session-RPE into a data-driven weekly revision (e.g. auto-deload when ACWR>1.3) is exactly what partners can't easily build.
- **HYROX station pacing + strength programming.** HYROX's fixed 8-station format rewards pacing and functional-strength progression; encoding both is domain value a generic fitness API does not provide.

**Positioning:** competitors in the "fitness API" space are mostly **content/data** (exercise-video libraries, device-sync aggregators like Terra/Spike, or gated athlete-data APIs like TrainingPeaks). Almost none sell a **prescriptive, periodized, adaptive programming engine** as an API. That's the whitespace.

---

## 9. Risks & Open Questions

**Risks**
- **Engine coupling (top risk).** If `lib/engine/*` is not DB-free, the extraction (§5.1) could be L+ and could balloon. *Mitigation:* Phase 1 starts with the import audit; the refactor pays off for triathlon + white-label.
- **Connection/latency under serverless.** Per-request Postgres round-trips can exhaust Supabase connections or inflate p99. *Mitigation:* Supavisor transaction pooling; collapse writes; move the rate-limit hot path to Upstash if needed.
- **Metering/billing drift.** Lost meter events → under-billing; double counts → chargebacks. *Mitigation:* local ledger as source of truth + nightly reconciliation + idempotent meter events keyed by `request_id`.
- **Abuse / cost blow-up** (esp. future Haiku path). *Mitigation:* tight rate limits, per-tenant `monthly_unit_cap`, hard kill switch (`status='suspended'`), body-size + array-length caps.
- **Support load on a solo founder.** *Mitigation:* gated approval, no open self-serve, explicit best-effort tier, good docs + error `docsUrl`s, Sentry so you can diagnose without the partner.
- **IP leakage from many input/output pairs.** *Mitigation:* accept it (moat is ongoing science + adaptation, not a static formula); ToS forbidding derivative-model training; watch scraping patterns.
- **Two billing systems in one Stripe account/codebase.** *Mitigation:* separate webhook handler, separate flag (`ENGINE_API_ENABLED`), separate customer namespace; never share code with the consumer webhook.
- **RLS mistake exposes cross-tenant dashboard data.** *Mitigation:* default-deny, member-scoped policies, and a mandatory cross-tenant read test.
- **Vercel function timeout on prose generation.** *Mitigation:* deterministic path is fast; if prose is slow, move it async (Phase 4 webhooks).

**Open questions**
1. Does `lib/engine/*` currently import Supabase / read the session anywhere? (The single biggest estimate driver — resolved by the Phase 1 audit.)
2. Stateless (partners store their end-users' data) vs. stateful (Duravel stores programs, bigger PII/DPA scope)? MVP assumes **stateless**.
3. Pricing unit: per-call vs per-athlete-per-month? Per-call meters simply; per-seat matches how gyms think. Validate with 2–3 design partners.
4. Which entity signs contracts/DPAs — is the LLC (already blocking mobile) also required for B2B enterprise deals? (Legal; may gate enterprise.)
5. Data residency / GDPR if EU gyms integrate — Supabase region and a DPA. Even "stateless," the usage ledger + member emails are PII.
6. Lead MVP with `generate` + `derive` only (simpler support), or include `adapt` at launch? (Recommendation: include `adapt` — it's the differentiator and it's still deterministic/cacheable.)
7. How is the deterministic cache invalidated on an `engineVersion` bump? (Answer baked in: version is part of the cache key, so old entries simply age out — no manual purge.)

---

## 10. Effort Estimate + Phased Build Plan

**T-shirt sizing (solo):** S ≤ ~2 days · M ≈ ~1 week · L ≈ ~2–3 weeks. `next build` green is the real gate; pure logic is vitest-covered.

| Workstream | Size | Notes |
|---|---|---|
| **Phase 0 audit** — grep engine for DB/session/env coupling; scope the extraction | **S** | De-risks the whole project up front |
| Engine extraction to pure, DB-free core + input adapters | **L** | Pivotal; smaller if already clean, larger if coupled |
| Migrations 0019–0024 + RLS policies + cross-tenant test | **M** | Includes trigger, cache, rate tables |
| API-key auth + hashing + resolution + scopes + rotation grace | **M** | |
| Rate limiting (Postgres atomic counters) + unit cap | **S** | |
| Idempotency + deterministic response cache | **M** | |
| Three route handlers + shared pipeline + Zod contracts + error envelope | **M** | Middleware carve-out included |
| Connection pooling + observability (Supavisor, Sentry, request logging) | **S** | Easy to skip, painful to skip |
| Stripe meter setup + push + nightly reconciliation cron + separate tenant webhook | **M–L** | Correctness-critical; the reconciliation loop is where solo devs underestimate |
| Minimal test-mode keys | **S** | Reuses the pipeline minus metering |
| Dashboard (keys/usage/logs) + server actions | **M** | |
| Docs page + OpenAPI-from-Zod + application form + operator approve | **M** | |
| Haiku prose endpoint (`sessions/fill`) | **S** | Phase 3; reuses consumer path |

**Honest total:** the MVP (Phases 1–2) is roughly **6–8 focused solo weeks**, plus **2–3 weeks** of Phase 3 polish — call it **~8–11 weeks**, front-loaded by the engine extraction and back-loaded by billing correctness. Treat any single "L" as a range, not a promise.

### Phase 0 — Audit & de-risk (½–1 week)
- Grep `lib/engine/*` and the reconciliation layer of `lib/generation/*` for `supabase` / `createClient` / `process.env` / `cookies` / `headers`.
- Produce a written list of every I/O touchpoint to hoist into callers. This determines whether extraction is L or L+.
- **Gate:** a one-page extraction plan with a concrete file-by-file change list.

### Phase 1 — Engine boundary + first endpoint (foundation)
*Prove the engine runs statelessly behind one authenticated, metered endpoint.*
- Extract pure engine core; input adapters; reuse Zod validators.
- Migrations 0019–0021 + 0024 (tenants, keys, usage, trigger) + RLS.
- Auth pipeline (hash/resolve, scopes, rotation grace) + `POST /athlete/derive` end-to-end on the pooled connection.
- Local usage ledger writing on every authenticated call; Sentry wired.
- **Gate:** `next build` green; vitest covers key resolution, tenant scoping, and derive correctness; a manual `curl` with a real key returns zones/paces and records a usage row; cross-tenant RLS read test passes.

### Phase 2 — Full API surface + billing (MVP shippable)
- Add `programs/generate` (deterministic) + `weeks/adapt` with idempotency + deterministic cache (0022) and rate limiting + unit cap (0023).
- Stripe meter + metered subscription + push + **nightly reconciliation cron**; separate tenant webhook; `ENGINE_API_ENABLED` flag.
- Minimal test-mode keys.
- Bare-bones dashboard (create/reveal/rotate/revoke key, usage summary, log tail) + application form + operator approve flow.
- **Gate:** end-to-end — apply → approve → provision → key → billable calls → Stripe invoice reflects metered usage; reconciliation matches the ledger; idempotent retry does not double-charge; cross-tenant RLS test still green.

### Phase 3 — Polish, docs, prose (developer-ready)
- Docs site + OpenAPI 3.1 (generated from Zod) + interactive viewer (Scalar/Redoc) + error reference with `docsUrl`s.
- Full sandbox fixtures behind test keys.
- Haiku `sessions/fill` / `includeSessionProse` metered path (Zod-guarded, retry-once, deterministic fallback).
- Usage charts, projected-invoice view, usage-alert emails (**fix `_phase3_draft` `resend` imports first**).
- TS SDK generated from OpenAPI; Postman collection.
- **Gate:** an external design partner integrates in <1 day using only public docs.

### Phase 4 — Scale & enterprise (demand-driven)
- Async batch generation + outbound webhooks.
- Per-tenant config overrides (house strength templates) — the multi-tenant config seam.
- Upstash for distributed rate-limit/cache if Postgres is a hot spot.
- SOC 2 Lite / DPA package; custom enterprise plans + SLAs.
- **Reuse the same engine boundary to launch triathlon/Ironman endpoints** — the strategic tie-in that justified the extraction.

---

### One-paragraph summary
Duravel's deterministic periodization engine is the licensable asset: audit and extract it into a pure, DB-free core, expose it behind three versioned `POST /api/engine/v1/*` route handlers (`athlete/derive`, `programs/generate`, `weeks/adapt`) through one auth/scope/rate/idempotency/cache/meter pipeline, authenticate with hashed prefixed API keys (with rotation grace), isolate tenants with new Supabase tables (migrations 0019–0024) under default-deny RLS, meter every billable call to a local ledger and reconcile nightly into Stripe Billing Meters, and gate access via a curated apply-approve-provision flow. The default path runs zero LLM (deterministic → cacheable → near-free); Haiku is opt-in and pass-through-priced. Ship minimal test-mode keys from day one, run the API on the Supavisor pooled connection with Sentry, and keep B2B billing fully separate from the consumer webhook. Realistic solo effort is ~8–11 weeks, front-loaded by the extraction — which simultaneously unblocks the triathlon/Ironman and white-label bets.

**Sources:** [TrainingPeaks Partner API model](https://www.trainingpeaks.com/blog/an-update-on-trainingpeaks-partner-api/) · [Stripe Meters API](https://docs.stripe.com/api/billing/meter) · [Stripe usage-based pricing plans](https://docs.stripe.com/billing/subscriptions/usage-based/pricing-plans) · [Stripe key best practices](https://docs.stripe.com/keys-best-practices) · [Zuplo API-key auth guide](https://zuplo.com/learning-center/how-to-implement-api-key-authentication) · [REST API design 2026](https://www.digitalapplied.com/blog/rest-api-design-2026-engineering-reference-best-practices) · [API rate-limiting strategies 2026](https://www.digitalapplied.com/blog/api-rate-limiting-strategies-2026-engineering-reference) · [Periodisation for HYROX](https://rb100.fitness/articles/hyrox/periodisation-for-hyrox-training/) · [TrainRox HYROX periodization](https://www.trainrox.com/articles/hyrox-periodization/) · [HYROX running structure](https://hyroxdatalab.com/articles/hyrox-running-training-structure) · [ACWR review (PMC)](https://pmc.ncbi.nlm.nih.gov/articles/PMC12487117/) · [ACWR practical guide](https://www.pfmcoaching.co.uk/blog/reduce-injury-risk-with-the-acute-chronic-workload-ratio)
