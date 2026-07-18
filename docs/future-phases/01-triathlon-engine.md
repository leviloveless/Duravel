# Duravel Multi-Sport Expansion — Triathlon / Ironman Program Module

**Design & Build Spec (final, implementation-ready)**
Author: Levi (product + eng lead)
Date: 2026-07-15
Status: Approved design — no code / DB / Stripe changes made yet
Repo: `C:\dev\duravel` · Migrations continue from `0019`

> This is the final build spec. It supersedes the preparatory draft. Material changes from the draft, in one place for traceability:
> 1. **Load currency unit-corrected.** Combined load is a single TSS-scaled unit. Raw Banister TRIMP is *not* summed with TSS (different scale); the missing-anchor fallback is **hrTSS** (TSS-scaled from HR), and TRIMP is kept only as a secondary internal signal. (§5.4, §8)
> 2. **Cold-start ACWR solved.** New athletes have no 28-day history → ACWR is undefined for ~4 weeks. We seed chronic load from prescribed plan load and fall back to ramp-rate caps + RPE/readiness during the baseline window. (§5.4)
> 3. **Discipline enum bug fixed.** The draft's `program_sessions`/`workout_logs` CHECKs omitted `stations`, which would reject existing HYROX rows. Canonical per-table enums defined. (§3, §3.8)
> 4. **`is_current` integrity.** Added a partial unique index + a `SECURITY DEFINER` RPC to flip benchmarks atomically (supabase-js has no client-side transaction). (§3.2, §4.1)
> 5. **Generation is a background job, not a long request.** Vercel function duration is a hard wall (≤300s Pro, ≤800s Fluid) and a 24–36-week × 3-discipline plan blows through it. Concrete `generation_jobs` queue + Vercel Cron worker + idempotent, resumable, mesocycle-chunked fill. Deterministic fallback session template so generation never hard-fails. (§4.2, §5.5, §7, §9)
> 6. **Manual bike entry has no Normalized Power.** NP needs a power stream; manual logs only have avg power. IF/TSS confidence tiering + avg-power proxy defined. Strava field availability spelled out. (§4.4, §5.4, §8)
> 7. **Benchmark-improvement re-periodization sequenced with billing.** Zones update immediately (cheap, deterministic); session re-fill happens only on the next weekly Apply (BILLING-gated), never as a surprise mid-week regeneration. (§5.2)
> 8. **Legacy HYROX logs** have `discipline = null`; combined-load code must treat null-discipline logs gracefully. Backfill policy defined. (§3.4, §3.8)
> 9. **Effort recalibrated.** The honest MVP (P0→P2, sprint/olympic/70.3) is **L**, not M. Only a hard-scoped sprint-only deterministic first cut is **M**. (§10)

---

## 0. TL;DR

Duravel today is a HYROX-only engine: a deterministic periodization core (Base/Build/Peak/Taper, mesocycles, zone distribution, exact volume reconciliation) that produces a "run + stations + strength" skeleton, then fills sessions with Haiku under Zod validation. Actual performance flows back via `workout_logs` and drives weekly adaptation (ACWR, monotony, RPE, readiness).

The triathlon/Ironman module is the flagship diversification the brand name was chosen for. The correct architecture is **not a fork** — it is a **`program_type` / sport-abstraction layer** over the existing engine so that HYROX becomes one `ProgramType` implementation and Triathlon becomes another. Both share periodization, adaptation, reconciliation, generation orchestration, billing gating, and wearable ingestion. What differs is the set of **disciplines** (swim/bike/run vs run/stations/strength), the **benchmark → zone math** per discipline, the **session primitives** (including bricks), and the **combined-load model** across three concurrent disciplines.

Two load-bearing technical insights:

1. **Synced-workout → `workout_log` → adaptation engine already works with zero engine changes** (migrations 0016/0017). Diversification hinges on making the *deterministic skeleton* multi-sport; the adaptation loop generalizes **only if load is expressed in one consistent unit**.
2. That unit must be **a single TSS-scaled currency**. This is the linchpin and also the easiest thing to get subtly wrong (mixing TRIMP and TSS breaks the sum). This spec pins the unit down (§5.4, §8).

Effort: **L overall** (XL if long-course and Garmin depth are pulled forward). Recommended path is 5 phases (P0–P4). A credible MVP — **sprint/olympic/70.3, single A-race, no in-week auto-reshuffle** — is **L**. A hard-scoped **sprint-only deterministic first cut** is **M**.

---

## 1. Goal & Why Now

### 1.1 Goal
Extend Duravel from HYROX-only to **swim/bike/run triathlon** across sprint → Ironman distances: generate personalized, periodized multi-sport programs; log actual vs plan across three disciplines plus bricks; and adapt upcoming weeks from **combined** training load. Ship a defensible MVP **without regressing HYROX** (the non-negotiable constraint that shapes the whole sequence).

### 1.2 Why now
- **Brand thesis realized.** "Duravel" was deliberately sport-agnostic; triathlon is the stated primary diversification bet. Every quarter HYROX-only, the brand promise is unproven.
- **The plumbing already exists.** Periodization, zone personalization, adaptation signals, reconciliation, `workout_logs`, `wearable_activities`, Strava sync, Stripe entitlement, and the deterministic-engine + Haiku split are all built. Triathlon is an *extension of primitives*, not a new product.
- **Wearable data is the moat and it's already flowing.** Triathletes are the most data-instrumented endurance athletes (power meters, HR straps, swim watches). Linking a synced activity is already "write a `workout_log`." Multi-sport is where that pays off most.
- **Differentiation is exactly our architecture.** TriDot, Athletica, Humango, AI Endurance, TrainingPeaks (+plans), TrainerRoad, MOTTIV compete on adaptive AI plans, but most either (a) require a coach, (b) are cycling-first, or (c) use black-box adaptation. Duravel's **deterministic engine owns structure/volume/zones and AI only fills sessions** is genuinely differentiated, auditable, and safer for a solo founder to defend. Pricing anchors: TrainingPeaks Premium ~$19.95/mo (~$119/yr), TrainerRoad ~$21.99/mo, Athletica ~$25–27/mo, AI Endurance/Humango ~$13–15/mo, TriDot tiers $19–149/mo. Duravel's $19.99/mo / $149/yr sits mid-market and holds if plan quality is there.
- **Same buyer, higher willingness to pay, better retention.** Triathlon has a longer, more expensive goal (a $500–900 Ironman entry) and 6–9-month training arcs → far better trial-to-paid and retention economics than HYROX's shorter cycles. The 14-day trial → one long-plan generation → *the weekly Apply that keeps the plan alive is BILLING-gated* is a clean conversion story (§5.2, §6.7).

### 1.3 Non-goals for this module
- Native mobile (blocked on LLC → Apple Developer registration). Web-first.
- Live/structured-workout streaming to a head unit (Zwift/TrainerRoad territory). We prescribe; we don't drive the trainer.
- Coaching marketplace / human-coach collaboration (that's the separate B2B / white-label track).
- Swim *technique* video analysis (MySwimPro territory).
- Concurrent multi-sport athletes (a user doing HYROX **and** triathlon at once with a single unified load budget). MVP treats each program independently; cross-program combined load is an explicit open question (§9).

---

## 2. User-Facing Scope

### 2.1 MVP (Phases P0–P2)
1. **Program type at creation.** Onboarding asks "What are you training for?" → HYROX (existing) or Triathlon. **Zero behavior change for existing HYROX users** — HYROX is just the default `program_type`.
2. **Distances:** Sprint and Olympic first, then 70.3. Full Ironman (140.6) deferred to P3 (duty-of-care + fueling complexity — §2.2, §9).
3. **Three-discipline onboarding & benchmarks:**
   - **Swim:** CSS from a 400m + 200m time trial, or manual pace/100m; pool vs open-water preference; pool-access days.
   - **Bike:** FTP (20-min test ×0.95, ramp test, or self-report) + power-meter/trainer flags; no power → HR-based (needs bike LTHR).
   - **Run:** threshold pace / recent 5–10k time (reuses existing HYROX run-pace machinery).
   - Weekly availability per discipline, equipment (pool access, trainer/turbo, power meter), and A-race date + distance.
4. **Generated periodized plan** spanning Base/Build/Peak/Taper with swim/bike/run sessions, **brick workouts** (bike→run primarily), a weekly long ride, and a weekly long run. Deterministic engine sets volume/zones/discipline balance; Haiku fills session detail (intervals, drills) under Zod, with a deterministic fallback template if AI validation fails.
5. **Per-discipline zones** shown to the user (swim CSS zones, bike power+HR zones, run pace+HR zones).
6. **Logging actual vs plan** for all three disciplines + bricks — manual or via **Strava link-to-planned-session** (already built; extend the matcher to disciplines).
7. **Weekly review + Apply adaptation** (BILLING-gated, as today) using **combined** multi-sport load, not per-discipline in isolation.
8. **Trial + billing unchanged** — triathlon program generation and Apply sit behind the existing `BILLING_ENABLED` gate and Stripe entitlement.

### 2.2 Later (Phases P3–P4)
- **Full Ironman (140.6) & 70.3 hardening:** long-course fueling guidance, very long rides, big-week/recovery-week mesostructure, heat/durability sessions. (Deferred because 5–6 hr sessions + fueling raise duty-of-care and reconciliation complexity.)
- **Open-water & brick variants:** run→bike, swim→bike, race-simulation days; open-water pacing offset from pool CSS.
- **In-week auto-reshuffle:** missed-session redistribution within the current week (not just next-week revision). Higher risk; needs guardrails.
- **Multi-race season planning:** B/C races, back-to-back A-races, priority tags.
- **Aerodynamic/terrain-aware pacing & race-day plan** (target power/HR/pace splits + fueling schedule for the specific course).
- **Garmin ingestion** once Health API is approved (swim/bike/run + HRV/sleep readiness). Then Wahoo/COROS.
- **Strength for triathletes** (reuse strength engine; injury-prevention + durability focus).
- **Environmental modeling:** heat acclimation blocks, altitude, wetsuit-legal logic.

---

## 3. Data Model / Schema Changes

Guiding principles: **additive, backward-compatible, RLS-first, HYROX untouched.** New migrations `0019+`. Supabase client is untyped → queries cast with `as`; keep column names snake_case and stable. Every new table gets RLS `owner = auth.uid()` policies mirroring existing tables. The service-role admin client is used only for privileged writes (webhooks, backfills, generation-worker writes), consistent with current conventions.

### 3.0 Canonical discipline vocabulary (define once, reuse everywhere)
One canonical set, with per-table valid subsets (this is where the draft had a latent bug — HYROX uses `stations`, which the draft's CHECKs omitted):

| Value | Meaning | Valid in `programs.disciplines` | `program_sessions.discipline` | `workout_logs.discipline` | `wearable_activities.discipline` |
|---|---|:--:|:--:|:--:|:--:|
| `swim` | pool/open-water swim | ✅ | ✅ | ✅ | ✅ |
| `bike` | ride (indoor/outdoor) | ✅ | ✅ | ✅ | ✅ |
| `run` | run | ✅ | ✅ | ✅ | ✅ |
| `brick` | ordered multi-segment | ✅ | ✅ | ✅ | ✅* |
| `strength` | strength session | ✅ | ✅ | ✅ | ✅ |
| `stations` | **HYROX** stations | ✅ | ✅ | ✅ | ✅ |
| `rest` | scheduled rest | ✅ | ✅ | — | — |
| `other` | unclassified | — | — | ✅ | ✅ |

\* Providers never emit `brick`; a wearable activity is classified as a single discipline on ingest and only *becomes* part of a brick at link time (§4.4). Keep the allowed set identical across `workout_logs` and `wearable_activities` for matcher simplicity. Represent as `text` + `CHECK`, not a Postgres `enum` (enums are painful to `ALTER`; the app-layer Zod parser is the real gatekeeper). Centralize the allowed arrays in one TS module (`lib/domain/disciplines.ts`) so code and CHECKs never drift.

### 3.1 `programs` — add discipline/type metadata (0019)
The engine must branch on program type without reading session rows.

```sql
-- 0019_program_type.sql
alter table public.programs
  add column if not exists program_type text not null default 'hyrox'
    check (program_type in ('hyrox','triathlon')),
  add column if not exists race_distance text
    check (race_distance in ('sprint','olympic','half','full')),
  add column if not exists disciplines text[] not null
    default array['run','stations','strength'];

comment on column public.programs.disciplines is
  'ordered set of engine disciplines this program schedules; triathlon = {swim,bike,run,brick}';
```

Backfill is a no-op: default `'hyrox'` + the default `disciplines` array preserve existing behavior. `program_type` is the coarse switch used by the engine factory (§5.1) and by BILLING gating (unchanged). `disciplines` keeps the engine generic (it iterates disciplines rather than hardcoding sports).

### 3.2 Discipline benchmarks (0020)
HYROX zones derive from run threshold + HR. Triathlon needs **three independent benchmark sets** with provenance so adaptation can trust/refresh them. Benchmarks are **athlete-level** (fitness is a property of the person, not one program); `program_id` is informational (which program the test was taken for), nullable, `on delete set null`.

```sql
-- 0020_discipline_benchmarks.sql
create table public.discipline_benchmarks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  program_id uuid references public.programs(id) on delete set null,
  discipline text not null check (discipline in ('swim','bike','run')),

  -- discipline-specific anchors (nullable; only the relevant ones are set)
  css_pace_sec_per_100m numeric,          -- swim: critical swim speed (sec/100m)
  ftp_watts integer,                      -- bike: functional threshold power
  bike_threshold_hr integer,              -- bike LTHR: fallback when no power meter
  run_threshold_pace_sec_per_km numeric,  -- run: reuses existing run engine
  threshold_hr integer,                   -- generic threshold HR for the discipline
  max_hr integer,
  resting_hr integer,

  source text not null default 'self_report'
    check (source in ('field_test','self_report','estimated','wearable_derived')),
  measured_at timestamptz not null default now(),
  is_current boolean not null default true,
  created_at timestamptz not null default now()
);

-- exactly one current benchmark per (user, discipline)
create unique index discipline_benchmarks_one_current
  on public.discipline_benchmarks (user_id, discipline)
  where is_current;

create index on public.discipline_benchmarks (user_id, discipline, measured_at desc);

alter table public.discipline_benchmarks enable row level security;
create policy "own benchmarks" on public.discipline_benchmarks
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
```

Design notes:
- **History-preserving:** never overwrite; insert a new row and flip the old `is_current` to false. Lets the engine re-periodize when FTP/CSS improves and lets adaptation detect fitness change. The partial unique index guarantees a single current row.
- **Atomic flip is required.** supabase-js does not expose client-side transactions, so "flip old + insert new" as two statements can transiently violate the unique index (or leave zero/two current rows on failure). Do it in **one `SECURITY DEFINER` RPC** — `set_current_benchmark(...)` — that runs the update+insert in a single server-side transaction (§4.1).
- **Provenance (`source`) drives trust:** an `estimated` FTP widens zone tolerance and triggers a retest prompt; a `field_test` FTP is trusted and can be used at full confidence for TSS.
- **HR is discipline-specific.** Bike HRmax is typically ~5–10 bpm below run; swim HR is unreliable. Storing per-discipline HR anchors avoids a well-known source of bad zones.

### 3.3 Session discipline & brick modeling (0021)
**Open question to resolve in code before writing this migration:** do sessions live in a relational child table (`program_sessions` / `workouts`) or embedded as JSON inside `programs`? (`grep` the persistence layer.) The two paths:

- **If relational** → apply the migration below.
- **If embedded JSON** → **skip 0021 entirely**; the equivalent fields (`discipline`, `is_brick`, `brick_segments`) go into the session object's TypeScript type + Zod schema, and this section becomes a type change only. No migration.

```sql
-- 0021_session_discipline.sql   (APPLY ONLY IF sessions are a relational table)
alter table public.program_sessions
  add column if not exists discipline text
    check (discipline in ('swim','bike','run','brick','strength','stations','rest')),
  add column if not exists is_brick boolean not null default false,
  add column if not exists brick_segments jsonb;  -- ordered [{discipline,duration_sec,zone,target,notes}]

comment on column public.program_sessions.brick_segments is
  'ordered discipline segments for a brick; null for single-discipline sessions';
```

Note the CHECK **includes `stations`** so existing HYROX session rows validate. `brick_segments` as ordered JSON keeps a brick as **one schedulable, one-loggable unit** while each segment carries its own zone/duration for reconciliation and TSS.

### 3.4 Extend logging to carry discipline metrics (0022)
`workout_logs` (0005) already receives Strava-linked activities. Triathlon needs discipline-specific actuals so adaptation can compute per-discipline and combined load. **Additive, nullable columns; do not create a parallel log table** (that would fork the adaptation engine).

```sql
-- 0022_workout_log_multisport.sql
alter table public.workout_logs
  add column if not exists discipline text
    check (discipline in ('swim','bike','run','brick','strength','stations','other')),
  add column if not exists distance_m numeric,
  add column if not exists moving_time_sec integer,
  add column if not exists avg_power_watts integer,
  add column if not exists normalized_power_watts integer,       -- null unless a power stream existed
  add column if not exists avg_hr integer,
  add column if not exists avg_pace_sec_per_km numeric,          -- run/bike
  add column if not exists avg_swim_pace_sec_per_100m numeric,   -- swim
  add column if not exists elevation_gain_m numeric,
  add column if not exists load_tss numeric,        -- UNIFIED load currency (TSS-scaled), per session
  add column if not exists load_source text         -- how load_tss was derived (see below)
    check (load_source in ('power','pace','swim_css','hr','manual_rpe','estimated')),
  add column if not exists trimp numeric,           -- secondary HR signal ONLY; never summed with load_tss
  add column if not exists intensity_factor numeric;

create index on public.workout_logs (user_id, discipline, performed_at);
```

`load_tss` is a **single TSS-scaled currency on every log** — the linchpin that lets the existing ACWR/monotony math generalize (§5.4, §8). Swim (sTSS via CSS), bike (via power/FTP), run (rTSS via threshold pace), and the HR fallback (hrTSS) **all resolve to the same scale**. `load_source` records which formula produced it (for confidence weighting and UI). `trimp` is stored for diagnostics/graphs but is **not** part of the combined-load sum — it is on a different scale.

**Legacy HYROX logs** predate these columns: `discipline`, `load_tss`, etc. are `null`. Policy: **do not backfill in bulk.** Combined-load code must treat `discipline = null` as "legacy/unclassified" and `load_tss = null` as "compute lazily on read if benchmarks exist, else skip with a low-confidence flag." A one-time optional backfill (service-role) can populate `discipline` for HYROX logs from their existing type field and compute `load_tss` where a run threshold exists; treat it as a nice-to-have, gated behind a manual script, not a migration.

### 3.5 Wearable activity mapping (0023)
`wearable_activities` (0016) + link table (0017) already exist. Add discipline classification so the matcher can match by discipline and multi-sport Strava activities map correctly.

```sql
-- 0023_wearable_discipline.sql
alter table public.wearable_activities
  add column if not exists discipline text
    check (discipline in ('swim','bike','run','brick','strength','stations','other')),
  add column if not exists sport_type_raw text;  -- provider's native type, e.g. Strava 'VirtualRide'
```

A pure mapping function (code, not DB) normalizes provider `sport_type` → Duravel `discipline`:

| Strava `sport_type` | Duravel `discipline` |
|---|---|
| `Swim`, `OpenWaterSwim` | `swim` |
| `Ride`, `VirtualRide`, `GravelRide`, `MountainBikeRide`, `EBikeRide` | `bike` |
| `Run`, `TrailRun`, `VirtualRun` | `run` |
| `WeightTraining`, `Workout`, `Crossfit` | `strength` |
| everything else | `other` |

Store the raw provider type in `sport_type_raw` so we can re-map without a re-sync if the mapping evolves.

### 3.6 Adaptation & readiness — generalize, don't duplicate (0024)
- `adaptations` (0006) and `readiness_checkins` (0010) stay structurally the same. Readiness is whole-athlete (sleep/soreness/stress), not per-discipline → no schema change for MVP. Per-discipline soreness ("legs cooked, shoulders fresh") is deferred (add nullable `discipline` to `readiness_checkins` later).
- Adaptation records should say which disciplines a revision touched, so the weekly-review UI can explain "cut bike volume, kept swim."

```sql
-- 0024_adaptation_disciplines.sql
alter table public.adaptations
  add column if not exists affected_disciplines text[];
```

### 3.7 Generation job queue (0025)
Generating a 12–36-week × 3-discipline plan cannot complete inside a single Vercel function invocation (§4.2, §7). A durable, resumable, **idempotent** job is required.

```sql
-- 0025_generation_jobs.sql
create table public.generation_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  program_id uuid not null references public.programs(id) on delete cascade,
  status text not null default 'queued'
    check (status in ('queued','running','partial','complete','failed','canceled')),
  total_mesocycles integer,
  completed_mesocycles integer not null default 0,
  cursor jsonb,                    -- {mesocycle_index, week_index} — resume point
  error text,
  haiku_input_tokens bigint not null default 0,   -- cost/observability
  haiku_output_tokens bigint not null default 0,
  attempts integer not null default 0,
  locked_at timestamptz,           -- worker lease, to avoid double-processing
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index on public.generation_jobs (status, created_at);
alter table public.generation_jobs enable row level security;
create policy "own jobs read" on public.generation_jobs
  for select using (auth.uid() = user_id);
-- writes are service-role only (the worker); no user write policy.
```

Idempotency: the worker keys generated sessions by `(program_id, mesocycle_index, week_index, day_index, discipline)` so a retried chunk upserts rather than duplicates. `locked_at` is a short lease so two overlapping Cron invocations don't process the same job.

### 3.8 Migration summary
| Migration | Purpose | Risk |
|---|---|---|
| 0019 | `programs.program_type/race_distance/disciplines` | Low (defaults preserve HYROX) |
| 0020 | `discipline_benchmarks` table + partial unique index | Low (new table) |
| 0021 | session `discipline`/brick segments — **conditional** on relational storage | Low–med (may be a type change, not a migration) |
| 0022 | `workout_logs` multisport + `load_tss`/`load_source`/`trimp` | Low (additive, nullable). CHECK includes `stations` so HYROX logs pass |
| 0023 | `wearable_activities.discipline` + `sport_type_raw` | Low |
| 0024 | `adaptations.affected_disciplines` | Low |
| 0025 | `generation_jobs` queue | Low (new table; enables background gen) |

Every new indexed / JSON / `text[]` read must be guarded because of `noUncheckedIndexedAccess`; centralize row parsing in Zod row-parsers (§4.6). Every cast on the untyped client stays `as`.

---

## 4. API / Route + Server-Action Changes

Next.js 16 App Router. **Server actions** for UI-tied mutations; **route handlers** for webhooks/external callbacks and for the generation worker. Everything privileged runs server-side with the service-role client; RLS enforced for user-context reads.

### 4.1 Onboarding & benchmarks
- **`app/(app)/onboarding/triathlon/…`** — new server-component wizard (§6). Server actions:
  - `saveTriathlonProfile(formData)` — writes `programs.program_type='triathlon'`, `race_distance`, `disciplines`, availability + equipment (store availability/equipment as a `program_config` JSON on `programs` or on `profiles`; JSON avoids a wide column set for MVP).
  - `setCurrentBenchmark({discipline, ...})` — thin wrapper that calls the **`set_current_benchmark` RPC** (atomic flip+insert, §3.2). Never do the flip client-side.
  - `estimateBenchmarksFromTests({swim400, swim200, bike20minPower | rampMap, run5k})` — pure server function computing CSS / FTP / threshold pace (formulas §8). Deterministic, unit-tested, **input-validated** (reject `t400 <= t200`, implausible values; see §8 guards).

### 4.2 Program generation (background job, not a long request)
The current synchronous flow (BILLING gate → build skeleton → fill via Haiku → reconcile → persist) works for short HYROX plans but **will time out** on triathlon (§7). New flow:

1. **`startProgramGeneration` server action** — BILLING gate → build the **entire deterministic skeleton** (fast, no AI): macrocycle, phases, per-discipline weekly volume + zones, session slots incl. bricks. Persist skeleton + create a `generation_jobs` row (`status='queued'`, `total_mesocycles`). Return immediately; the UI shows a progress state and polls (or subscribes via Supabase Realtime).
2. **Worker route handler `app/api/generation/worker/route.ts`**, invoked by **Vercel Cron** (e.g. every minute) and/or kicked immediately after enqueue. Each invocation: lease one `queued`/`partial` job, fill **one mesocycle** of sessions via Haiku (validate → reconcile → upsert idempotently), advance `cursor` + `completed_mesocycles`, update token counters, then either mark `complete` or leave `partial` for the next tick. One mesocycle per invocation keeps each run well under the function-duration wall.
3. **Idempotent, resumable:** a timeout or crash mid-plan loses at most one mesocycle's fill, which the next tick redoes via upsert. `attempts` + `error` capture repeated failures; after N attempts → `failed`, and the deterministic fallback template (§5.5) fills the remaining sessions so the athlete always gets a usable plan.

Note: neither streaming responses nor Fluid compute changes the fundamental need to chunk — they only raise the ceiling. The job queue is the robust answer and it doubles as the cost/observability ledger.

### 4.3 Weekly review / Apply
- **`applyWeeklyRevision` server action** (BILLING-gated, as today):
  - Aggregate **combined** load across disciplines for ACWR/monotony (§5.4).
  - Produce a revision that may touch multiple disciplines; write `adaptations.affected_disciplines`.
  - Return a per-discipline diff for the UI.
  - Re-filling only the *changed* sessions (not the whole week) keeps Haiku cost down; unchanged sessions are untouched.

### 4.4 Logging & wearable link
- **`logWorkout` server action** — accepts `discipline` + discipline metrics; **computes `load_tss`/`load_source`/`intensity_factor` server-side from current benchmarks** (never trust the client). Sets `load_source` per the resolution ladder in §5.4.
- **Strava link matcher** (existing `link-to-planned-session`) — extend to:
  1. normalize `sport_type` → `discipline` (§3.5);
  2. prefer a planned session of the **same discipline** within a date window;
  3. handle a multi-sport Strava day (two activities same day → two candidate links);
  4. handle **bricks**: a brick may arrive as one Strava file or two (bike then run). Allow linking one activity to a whole brick, or two activities to the two brick segments. Ambiguous cases prompt user confirmation rather than guessing.
- **Bike power data reality:** Strava's activity API returns `average_watts` always (when a power source exists) but `weighted_average_watts` (the NP-equivalent) **only for power-meter activities**, and `device_watts=true` distinguishes true power from estimated. Store `weighted_average_watts` → `normalized_power_watts` when present. **Manual logs have no NP** — only avg power; handle in the load ladder (§5.4).
- **Strava webhook route handler** — unchanged transport; add discipline classification on ingest.
- **Garmin** (P4) — new route handler under `app/api/wearables/garmin/*` mirroring Strava's OAuth + activity pull; the existing `lib/wearables/garmin*.ts` scaffold is the home. Do not build until Health API approval lands.

### 4.5 Read routes / server components
Program view, week view, session detail, benchmarks page — new server components that branch on `program_type`. Reuse existing HYROX components where shape matches (run session cards); add swim/bike/brick cards.

### 4.6 Type & validation surface
- New **Zod schemas** for triathlon session content (swim set structure, bike interval structure, brick segments), validating Haiku output exactly as today.
- **Zod row-parsers** for every new/changed table so `noUncheckedIndexedAccess` guards live in one place instead of scattered `as` casts. All `text[]`/`jsonb` reads flow through these parsers.
- The canonical discipline arrays live in `lib/domain/disciplines.ts` and are imported by both Zod schemas and any client-side validation, so app code and DB CHECKs cannot drift.

---

## 5. Engine / AI Implications

The core of the work: move the engine from "HYROX-shaped" to "sport-parametric" while the deterministic guarantees (structure, volume, zones, reconciliation) stay authoritative and AI stays confined to session *content*.

### 5.1 Program-type abstraction (the central refactor)
Introduce a `ProgramType` interface in `lib/engine/` that current HYROX logic implements; add a `Triathlon` implementation; a factory maps `program_type` → implementation.

```ts
interface ProgramType {
  disciplines: Discipline[];                                    // {swim,bike,run,brick} | {run,stations,strength}
  buildMacrocycle(input): PhasePlan;                            // Base/Build/Peak/Taper from race date/distance
  weeklyVolumeTargets(phase, week, input): DisciplineVolume[];  // per-discipline hours/distance
  distributeIntensity(volume): ZoneDistribution;               // polarized/pyramidal per discipline
  scheduleSessions(week): PlannedSession[];                     // includes bricks, long day, recovery
  reconcile(target, filled): PlannedSession[];                  // exact volume/zone reconciliation per discipline
  loadModel: LoadModel;                                         // session → unified load_tss
}
```

HYROX's existing periodization/zone/reconciliation code is refactored **behind** this interface with **zero behavioral change** — proven by a snapshot regression test of a canonical HYROX program, byte-identical before/after (§5.6). Shared primitives (mesocycle math, taper curves, zone-distribution helpers, load model) move to `lib/engine/shared/`; Triathlon reuses them.

**Sequencing rule (non-negotiable):** land P0 (this refactor + HYROX-unchanged proof) **completely** before writing any triathlon code. It is the highest-leverage and highest-regression-risk step; everything else stacks on it.

### 5.2 Multi-sport periodization (deterministic)
Per discipline the engine sets:
- **Phase structure** from race date + distance: sprint ~8–12 wk, olympic ~12–16, 70.3 ~16–24, full ~24–36. Standard 3:1 (or 2:1) build:recovery mesocycles.
- **Discipline balance** (share of training *time*) shifts by phase and distance. Long course is bike-heavy by time (bike is the largest race segment); swim is frequency/technique-driven early (frequency > volume). Encode distance-specific default splits (e.g. Olympic ≈ bike 45–50% / run 25–30% / swim 20–25% of training time), then adjust for the athlete's stated **limiter** and **availability/equipment**.
- **Intensity distribution:** polarized/pyramidal by phase — mostly Z2 aerobic in Base, more threshold/VO2 in Build/Peak, sharpened + reduced volume in Taper. Each discipline gets its own distribution (swimming tolerates more threshold work than running because of lower impact).
- **Key weekly slots (deterministic):** one long ride, one long run, one swim-endurance + one swim-technique/CSS session, one bike quality, one run quality, and **1–2 bricks** (frequency rises in Build/Peak). Recovery weeks cut volume ~30–40% and drop intensity.
- **Availability & equipment constraints:** pool-access days constrain swim scheduling; no power → bike prescribed by HR/RPE; no trainer → outdoor-only ride guidance.
- **Ramp-rate guardrails baked into volume targets** (also the cold-start safety net, §5.4): weekly total load increase capped (~5–8% on build weeks), **run volume the most conservative (≤~10%/wk)** because it's the highest-injury discipline; recovery weeks −30–40%.

**Benchmark improvement mid-program — re-periodization policy (billing-aware):**
- Zones recompute **immediately and deterministically** when a new `is_current` benchmark lands (cheap, no AI, no billing gate — it's just math the user sees on their zones page).
- **Session re-fill of remaining weeks happens only on the next weekly Apply** (BILLING-gated). We never silently regenerate mid-week (surprising, and it burns Haiku tokens). The zones page shows "benchmarks improved — your plan will re-periodize at your next weekly review."

### 5.3 Bricks (new session primitive)
A brick = ordered discipline segments in one session (bike→run dominant; run→bike, swim→bike later). Engine responsibilities:
- Place bricks on appropriate days (often the weekend around the long ride); scale segment durations by phase/distance.
- Each segment carries its own zone/duration → contributes to reconciliation and to session load (`load_tss` = sum of segment loads). The "off-the-bike" transition-run opening is prescribed at controlled effort (first-km HR/pace drift is a coaching point Haiku articulates).
- Logged as a unit, but a Strava day may deliver 1–2 files → matcher handles both (§4.4).

### 5.4 Adaptation across three disciplines + combined load
The existing signals generalize **only with a single, unit-consistent load currency**. This is the most important correctness detail in the module.

**Load resolution ladder (per logged session, server-side, best available first):**
1. **Bike w/ power stream** → `load_source='power'`, IF = NP/FTP (NP from `weighted_average_watts`).
2. **Bike, avg power only (manual/no stream)** → `load_source='power'` (lower confidence): use avg power as an NP proxy, IF = avgP/FTP. Mark confidence lower; steady rides make this accurate, variable rides underestimate.
3. **Run/bike w/ pace, no power** → `load_source='pace'`: rTSS from normalized/graded pace vs threshold pace (existing run machinery extends).
4. **Swim w/ pace** → `load_source='swim_css'`: sTSS from swim speed vs CSS.
5. **Any discipline, only HR** → `load_source='hr'`: **hrTSS** (TSS-scaled from HR vs threshold HR) — **not** raw TRIMP.
6. **Only RPE/duration** → `load_source='manual_rpe'`: session-RPE load (RPE × duration), mapped onto the TSS scale via a calibration constant.

**Unified formula** (§8): `load_tss = 100 × duration_hours × IF²`, with a discipline-specific `IF`. Because every rung resolves to the same 100-at-threshold-for-one-hour scale, **combined weekly load is a simple sum**. This is exactly why the fallback is hrTSS, not Banister TRIMP: TRIMP is on a different scale and summing it with TSS silently corrupts ACWR/monotony. TRIMP is still computed and stored (`trimp` column) as a **secondary** overtraining signal and for HR-trend graphs — never mixed into the sum.

**ACWR:**
- Compute on **combined daily/weekly `load_tss`** (acute 7-day : chronic 28-day, EWMA form preferred). This is the primary safety signal — a triathlete can have safe run load but dangerous *total* load; per-discipline ACWR alone misses it.
- Also compute **per-discipline ACWR** to localize where a spike came from (usually run).
- **Cold-start (first ~4 weeks) — the draft's gap:** a new athlete has no 28-day history, so chronic load is undefined and ACWR is meaningless/unstable. Handling: **seed chronic load from the plan's prescribed load** for the ramp-in window (the engine knows what it prescribed), flag the first 3–4 weeks as "establishing baseline," and during that window rely primarily on **ramp-rate caps (§5.2) + session-RPE + readiness** rather than ACWR. ACWR becomes the primary trigger once ≥28 days of actuals exist.

**Monotony & strain (Foster):** monotony = mean daily load ÷ SD of daily load over the week; strain = weekly load × monotony. Computed on combined daily load. High monotony (every day "medium") is a real 3-sport overtraining trap even at moderate volume.

**Session RPE & readiness:** unchanged inputs; readiness stays whole-athlete. Weekly revision reasons over combined load + per-discipline ACWR to decide *which* discipline to cut/add: **run is protected first** (injury), **swim volume is cheapest to trim**, **bike absorbs endurance load**. Revision may adjust multiple disciplines, records `affected_disciplines`, and stays BILLING-gated.

### 5.5 AI (Haiku) role — unchanged boundary, new content schemas + a hard fallback
- Deterministic engine owns **structure, volume, zones, discipline balance, brick placement, reconciliation.** Haiku only **fills session content:** swim set construction (warmup/drills/main/CSS intervals/cooldown to a target distance & zone), bike interval detail, run detail, brick segment detail, coaching notes.
- New **Zod schemas per discipline** constrain output (e.g. a swim set must sum to the engine's target distance within tolerance; reconciliation then snaps to exact).
- **Deterministic fallback template (new — closes a hard-fail gap):** if Haiku output fails Zod after N retries (or the athlete hits a repeated generation failure, or we're cost-capping), the engine emits a **deterministic, rule-based session** hitting the exact target duration/distance/zone with a generic-but-safe structure. Generation therefore **never hard-fails**; worst case the athlete gets a correct, if less flavorful, session. This is essential for a background job that must always converge.
- **Prompt grounding:** prompts include the athlete's zones, the session's engine target (duration/distance/zone/purpose), and discipline vocabulary (swim: catch-up, single-arm, pull buoy; bike: sweet-spot, over-unders, VO2). Cheap Haiku, deterministic-seeded where possible.
- **Cost control:** generate a **mesocycle at a time** (matches the job worker), reuse session templates across similar weeks, cache validated skeletons, and on Apply **regenerate only changed sessions.** Batch/parallelize fills within a mesocycle but respect the Anthropic tier rate limit. Full-plan Haiku cost stays cents-scale (§7); token counts are logged on the `generation_jobs` row for real cost visibility.

### 5.6 Testing / guardrails
- **HYROX regression snapshot** of a canonical program before/after the `ProgramType` refactor — must be byte-identical. This is the P0 exit gate.
- **Vitest** pure-logic tests: CSS/FTP/threshold math (incl. input-guard rejections), unified `load_tss` per discipline + hrTSS + RPE fallback, phase-length derivation, discipline-balance splits, reconciliation-to-target, combined + per-discipline ACWR, monotony/strain, **cold-start chronic-load seeding**, ramp-rate caps.
- **Reconciliation tested against fixture AI outputs, not live Haiku** (Haiku is nondeterministic → snapshotting its raw output is flaky). Include adversarial fixtures: over-target, under-target, malformed, empty → assert reconciliation + fallback behave.
- `next build` remains the real gate; strict TS (`noUnusedLocals`, `noUncheckedIndexedAccess`) forces guards on all new indexed reads.

---

## 6. UX Outline

Web-first (native blocked on LLC). Server components + server actions.

1. **Program-type chooser** (new first step): HYROX | Triathlon. Triathlon → distance picker (Sprint/Olympic/70.3; Full marked "coming soon" in MVP) + A-race date.
2. **Three-discipline benchmark wizard:**
   - Swim: "Do a 400m then 200m time trial" → auto-CSS (with validation feedback if the entries are implausible), or enter pace/100m; pool-access days; OWS toggle (later).
   - Bike: FTP via three paths (20-min helper, ramp result, self-report); power-meter/trainer toggles; no power → explain HR-based prescription and collect bike LTHR.
   - Run: recent 5–10k or threshold pace (reuses HYROX flow).
   - Availability grid (days/hours per discipline) + equipment.
   - Each step shows **derived zones immediately** (trust-building; TrainingPeaks/TriDot do this).
3. **Generation progress:** because generation is a background job, show a progress state ("building your 16-week plan… mesocycle 2 of 4") driven by `generation_jobs` polling / Realtime, with the deterministic skeleton viewable before AI fill completes.
4. **Plan overview:** macro timeline (Base/Build/Peak/Taper bars), weekly hours by discipline (stacked), A-race countdown, current benchmarks with "retest due" nudges.
5. **Week view:** 7-day grid; discipline-colored session cards (swim/bike/run/brick/strength/rest); brick cards show segments; long day highlighted; planned-vs-actual badges.
6. **Session detail:** target (duration/distance/zone/purpose), Haiku-authored structure (sets/intervals/drills), zones reference, "log" and "link Strava activity" actions. Brick detail shows ordered segments with per-segment targets.
7. **Logging:** manual per-discipline entry (distance/time/power/HR/pace) or Strava link; computed load + a small confidence/`load_source` hint shown. Brick logging supports one or two source activities.
8. **Weekly review + Apply:** combined-load summary (ACWR gauge — with a "baseline building" state for the first ~4 weeks, monotony, readiness), per-discipline load bars, and a plain-language explanation of the proposed revision keyed off `affected_disciplines` ("↓ bike 20%, hold run, add a swim technique session"). Apply is BILLING-gated.
9. **Benchmarks/zones page:** current CSS/FTP/threshold with history sparkline, provenance badge (tested vs estimated), retest prompts, and the "will re-periodize at next weekly review" note when benchmarks improve.

Design consistency (follow the Duravel design system / dataviz conventions): reuse the existing component library; add three discipline accent colors + a brick treatment from a **single categorical palette** so every chart reads as one system in light and dark.

---

## 7. Third-Party Services + Rough Costs

| Service | Role | Rough cost | Notes |
|---|---|---|---|
| **Anthropic Haiku** | Fills session content, Zod-validated | Cents per full plan; low-single-digit $/1M tokens | More sessions/plan than HYROX → generate per-mesocycle, cache templates, regenerate only changed sessions on Apply, respect tier rate limits. Token counts logged per job for real cost visibility. Deterministic fallback caps worst-case spend. |
| **Supabase** | Postgres + Auth + RLS, service-role | Existing plan; additive tables/columns negligible | Long plans = more session rows + `generation_jobs`; trivial at solo scale. |
| **Vercel** | Hosting; server actions + route handlers + **Cron** | Existing | **Function duration is the hard constraint** (≤300s Pro, ≤800s Fluid). Solved by the `generation_jobs` queue + one-mesocycle-per-invocation Cron worker (§4.2). No new paid dep required. |
| **Stripe** | Billing, entitlement via webhook (sole writer) | Existing; unchanged | Triathlon gated by existing `BILLING_ENABLED` + entitlement. No new prices for MVP (same $19.99/$149). Optional future "long-course" tier is a pricing decision, not a tech one. |
| **Strava API** | OAuth + sync + link (live) | Free tier; **rate/athlete limits** | Extend to sport_type→discipline mapping + brick. `weighted_average_watts` only present for power-meter activities — drives the load ladder. Watch per-app rate limits as users grow. |
| **Garmin Health/Activity API** | P4 ingestion | Free but **approval-gated** | Scaffold exists; pending approval. Adds HRV/sleep for readiness. |
| **(Optional later) COROS / Wahoo** | Extra sync | Free/approval | Big in triathlon; defer. |
| **(Optional) Weather/geo API** | Race-day heat/course modeling (later) | Low/free tiers | P4 race-day plan only. |

No new *mandatory* paid dependency for MVP. The two real cost/complexity risks — **Vercel function duration** and **Haiku token volume on long plans** — are both absorbed by the mesocycle-chunked background job.

---

## 8. Domain / Training-Science Basis

Concrete, auditable, unit-tested formulas the deterministic engine encodes:

- **Swim — Critical Swim Speed (CSS):** from a 400m and 200m TT, `CSS_speed = (400 − 200) / (t400 − t200)` m/s, expressed as sec/100m. CSS ≈ functional swim threshold; zones = %CSS pace bands (easy > CSS+~10s/100m, threshold ≈ CSS, VO2 < CSS). **Input guards:** require `t400 > t200`, both positive, and a plausible resulting pace (reject e.g. <45s or >180s /100m) — bad TT entry is a common source of nonsense zones. Frequency/technique dominate early; swim is often the smallest time-share but highest-frequency discipline.
- **Bike — FTP:** 20-min test × 0.95, **or** ramp test (≈ 75% of 1-min peak / MAP — note this is a *different* formula from the 20-min ×0.95, handle both explicitly), or self-report. Power zones as %FTP (Coggan): Z1 <55, Z2 56–75, Z3 76–90 (sweet-spot ~88–94), Z4 91–105 (threshold), Z5 106–120 (VO2), Z6 >120. No power → bike LTHR + HR zones. Bike carries the largest endurance time-share in long course.
- **Run — threshold pace:** reuse Duravel's existing formula-based run paces / threshold; rTSS from normalized/graded pace vs threshold. Run is **highest injury-risk** → protected first in adaptation, ramps most conservatively (≤~10%/wk).
- **Unified load currency (TSS-scaled):** `TSS = 100 × duration_hours × IF²`, IF discipline-specific:
  - Bike (power): `IF = NP / FTP` (NP from stream; avg-power proxy when manual, lower confidence).
  - Run: `IF = threshold_pace_speed / actual_pace_speed` (rTSS).
  - Swim: `IF = swim_speed / CSS_speed` (sTSS).
  - **hrTSS fallback** (no power/pace): `IF` derived from HR relative to threshold HR, TSS-scaled — keeps the unit consistent so combined load is a valid sum.
  - **RPE fallback** (no HR either): session-RPE load (RPE×duration) mapped onto the TSS scale by a calibration constant.
  - **Banister TRIMP** is computed/stored as a *secondary* HR signal only (men `k≈0.64·e^{1.92·x}`, women `k≈0.86·e^{1.67·x}`, `x = HR reserve ratio`); **never summed with TSS** — different scale. (This is the draft's unit bug, fixed.)
- **HR is discipline-specific:** cycling HRmax typically a few bpm below running; swim HR unreliable → per-discipline HR anchors (§3.2), zones by threshold-HR + sex-specific %HRmax (Duravel already personalizes HR for HYROX).
- **ACWR:** acute (7-day) ÷ chronic (28-day), EWMA form preferred; "sweet spot" ~0.8–1.3, elevated risk beyond ~1.5. Computed on **combined** load (primary) and **per-discipline** (localize spikes). Treated as one signal among several, **undefined until ~28 days of actuals** → cold-start seeding + ramp-rate caps cover the baseline window (§5.4).
- **Monotony & strain (Foster):** monotony = mean daily load ÷ SD; strain = weekly load × monotony. High monotony flags overtraining even at moderate volume — very relevant to 3-sport athletes who make every day "medium."
- **Periodization:** Base→Build→Peak→Taper with 3:1 (or 2:1) loading mesocycles; polarized/pyramidal intensity shifting toward race-specific in Build/Peak; taper cuts volume while preserving intensity/frequency; distance-scaled total weeks and long-session durations.
- **Bricks:** train the bike→run transition ("jelly legs"); controlled opening-km effort; frequency/duration scale into Peak. A clear differentiator vs single-sport plans.
- **Provenance-aware trust:** `estimated` benchmarks widen zone tolerance + trigger retest; improving benchmarks re-periodize remaining weeks at the next Apply (§5.2).

Sources: [Transition — best triathlon apps 2026](https://www.transition.fun/blog/best-triathlon-training-apps-2026/), [Triathlete — AI triathlon training apps](https://www.triathlete.com/gear/tech-wearables/ai-triathlon-training-apps/), [MyProCoach CSS calculator](https://www.myprocoach.net/calculators/critical-swim-speed/), [trainingzones.io swim zones](https://www.trainingzones.io/en/swim-zones), [Scientific Triathlon — data-driven training](https://scientifictriathlon.com/data-driven-triathlon-training/), [Firstbeat — TRIMP](https://www.firstbeat.com/en/blog/what-is-trimp/), [umit.net — monotony & strain](https://umit.net/training-monotony-calculation-guide/), [ACWR review (PMC)](https://pmc.ncbi.nlm.nih.gov/articles/PMC12487117/), [Training load in triathlon (ResearchGate)](https://www.researchgate.net/publication/237032400_Training_load_quantification_in_triathlon), [TrainingPeaks pricing 2026](https://www.trainingpeaks.com/blog/trainingpeaks-pricing/).

---

## 9. Risks & Open Questions

**Technical**
1. **`ProgramType` refactor regressing HYROX.** Mitigation: byte-identical snapshot test of a canonical HYROX plan before/after; refactor behind the interface with zero behavior change first, add triathlon second. **P0 exit gate.**
2. **Session storage shape (relational vs embedded JSON).** Determines whether 0021 is a migration or a type/Zod change. **Answer in code before building P1** (`grep` the persistence layer for how sessions are written).
3. **Vercel function duration on long-plan generation.** Resolved by the `generation_jobs` queue + Cron worker, one mesocycle per invocation, idempotent + resumable (§4.2, §3.7).
4. **Load-unit consistency.** The single biggest correctness risk. Combined load must be one TSS-scale; hrTSS fallback (not TRIMP) enforces it. Unit-tested across all `load_source` paths.
5. **Cold-start ACWR** (no 28-day history). Resolved by chronic-load seeding + ramp-rate caps + RPE/readiness during the baseline window (§5.4).
6. **Reconciliation across three disciplines + a combined-load target** is an over-constrainable system. Mitigation: **prioritize per-discipline volume; treat combined load as a tolerance check, not a hard equality.**
7. **Manual bike load without NP** underestimates variable rides. Mitigation: avg-power proxy with a confidence flag; prefer HR/pace when the ride was very variable.
8. **Strava multi-sport & brick matching** ambiguity. Mitigation: discipline-aware matcher with user confirmation on ambiguous links (§4.4).
9. **Untyped Supabase client + strict TS** on new JSON/`text[]` columns → many guards. Mitigation: centralized Zod row-parsers (§4.6).
10. **`is_current` benchmark integrity.** Mitigation: partial unique index + atomic `set_current_benchmark` RPC (§3.2).
11. **Generation never hard-failing.** Mitigation: deterministic fallback session template + job `attempts`/`failed` handling (§5.5, §4.2).

**Product / domain**
12. **Benchmark quality** (athletes over/under-state FTP/CSS). Mitigation: provenance field, test helpers, input guards, conservative defaults, retest prompts.
13. **Duty of care at long course** (full IM fueling, 5–6 hr sessions). Mitigation: **defer full-distance to P3**; MVP is sprint/olympic/70.3.
14. **Scope creep** (open water, strength, race-day nutrition, multi-race seasons). Mitigation: hard MVP line in §2.

**Open questions**
- **Pricing:** does long-course justify a higher tier, or stay at $19.99/$149? (Business decision; tech supports either.)
- **Per-discipline vs whole-athlete readiness** for MVP? (Start whole-athlete.)
- **Garmin approval timeline** gates P4 richness (HRV/sleep readiness).
- **Combined vs per-discipline ACWR as the *primary* Apply trigger?** (Proposal: combined primary, per-discipline for localization.)
- **Concurrent programs across sports** (HYROX + tri at once): should combined load span both programs? MVP: no — each program is independent. Revisit if users actually do it.
- **Backfill legacy HYROX logs** with `discipline`/`load_tss`? MVP: no bulk backfill; null-tolerant combined-load code + optional manual script (§3.4).

---

## 10. Effort Estimate + Phased Build Plan

Overall: **L** (XL if long-course + Garmin depth are pulled into the first release). Honest MVP (P0→P2, sprint/olympic/70.3): **L**. A hard-scoped **sprint-only deterministic first cut** (P0 + a trimmed P1, minimal AI): **M**.

| Phase | Scope | Effort | Exit gate |
|---|---|---|---|
| **P0 — Abstraction refactor** | Extract `ProgramType` interface; move shared periodization to `lib/engine/shared/`; HYROX becomes an implementation; snapshot regression test. **No user-visible change.** | **M** | HYROX plan **byte-identical**; `next build` green |
| **P1 — Triathlon skeleton (deterministic)** | 0019–0021 (+0025 job queue) migrations; triathlon macrocycle/phase math; per-discipline volume + zone distribution; brick scheduling; benchmark math (CSS/FTP/threshold) + `discipline_benchmarks` + atomic RPC; ramp-rate caps; onboarding wizard; zones display; **background generation job + Cron worker + deterministic fallback**. Sprint/Olympic. **Deterministic plan, minimal AI.** | **L** | Generates a valid periodized sprint/olympic skeleton via the job queue; vitest on all math; no timeout |
| **P2 — AI fill + logging + adaptation** | Haiku session-content schemas (swim/bike/brick) + Zod + fallback; per-discipline reconciliation; 0022–0024 migrations; multisport logging with server-side load ladder; Strava discipline mapping + brick matching; unified `load_tss` + hrTSS + cold-start seeding; combined + per-discipline ACWR/monotony; weekly review + Apply (BILLING-gated). Add 70.3. | **L** | End-to-end: generate → log via Strava → weekly Apply revises **combined** load; regression suite green |
| **P3 — Hardening & long course** | Full Ironman (140.6): long rides, fueling guidance, big-week/recovery structure, heat/durability; in-week reshuffle; season/multi-race planning; triathlon strength; open-water pacing offset. | **L** | Duty-of-care review; long-course plan validated |
| **P4 — Wearable depth** | Garmin ingestion (on approval) incl. HRV/sleep readiness; COROS/Wahoo; race-day pacing/fueling plan; environmental modeling. | **M–L** | Garmin API approved |

**Recommended first cut to ship:** **P0 → P1 → P2 for sprint/olympic/70.3.** It is the smallest thing that proves the brand thesis, reuses ~80% of existing infrastructure (adaptation, Strava, Stripe, generation orchestration), and de-risks the hardest step (the `ProgramType` abstraction) first without touching HYROX behavior.

**Sequencing rule:** finish P0 and prove HYROX is unchanged **before** writing any triathlon code. The abstraction refactor is the single highest-leverage, highest-regression-risk step, and everything else stacks cleanly on top of it.

**Critical-path dependencies to resolve on day one of build:**
1. Confirm session storage shape (§9.2) → decides 0021.
2. Confirm Vercel plan/function-duration ceiling and Cron availability → validates the job-worker cadence.
3. Snapshot a canonical HYROX plan now, before touching the engine → your P0 oracle.
