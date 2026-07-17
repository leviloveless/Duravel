# Duravel Multi-Sport — Handoff

_Last updated: 2026-07-17_

This document hands off the multi-sport expansion of the Duravel program builder:
what shipped, how the architecture works, the one safety rule that keeps it from
regressing, and how to pick up the next round of work.

---

## 1. What this was

The program builder started as **HYROX-only**. It's now a **sport-parametric
engine** with a selector of **9 sports** across three families:

| Family | Sports | Generation path |
| --- | --- | --- |
| `station_hybrid` | HYROX · DEKA Fit · DEKA Mile · DEKA Strong · DEKA Atlas · DEKA Ultra | Deterministic skeleton + AI session fill (Haiku) |
| `triathlon` | Ironman 70.3 · Ironman 140.6 | Fully deterministic (no AI) |
| `general_fitness` | General Fitness (optional sub-goal) | Deterministic rotating-emphasis skeleton |

The non-negotiable constraint throughout: **HYROX output is byte-identical** to
what it was before the refactor. That is enforced by tests (see §4).

---

## 2. Current state

- **`main`** contains the full 9-sport build (PR #13) plus the round-2
  refinements (PR #14, merged). This is live.
- **`fix/build-env-nonfatal`** is pushed and awaiting a PR + merge — makes the
  build-time env validation non-fatal so production deploys stop failing
  intermittently (see §5).
- Design docs, sport research, and per-sport specs are versioned in
  [`docs/sports/`](./docs/sports/) with a README index.

### Opening a PR from this environment

The Cloud session can `git push` but **cannot open PRs via the GitHub API** — it
hits an `add_repo` access gate. Every PR so far was opened manually:

1. Push the branch (works).
2. Open `https://github.com/leviloveless/Duravel/compare/main...<branch>?expand=1`.
3. Paste the prepared description, create, wait for checks, merge.

---

## 3. Architecture (the P0 sport-abstraction layer)

Everything sport-specific lives behind a registry so the core engine stays
generic. Key files:

- **`lib/engine/sports/types.ts`** — the `SportConfig` + `ProgramType` contract
  (modalities, session counts, phase zone targets, volume model, experience
  axes, station catalogs, needs domains, duty-of-care).
- **`lib/engine/sports/index.ts`** — the `SPORTS` registry and
  `getSport(id)` (defaults to HYROX for unknown/undefined).
- **`lib/engine/sports/hyrox.ts`** — HYROX as one `SportConfig`, importing the
  live engine constants so there's zero drift.
- **`lib/engine/sports/deka.ts`** — all 5 DEKA formats: 10-zone catalogs, run
  geometry, energy-system zone targets, needs stations.
- **`lib/engine/sports/triathlon.ts`** — tri configs + the deterministic
  skeleton builder, per-discipline volume tiering, and the deterministic
  session-content builders.
- **`lib/engine/sports/general-fitness.ts`** — the rotating-emphasis config.

How a sport flows through generation:

1. Onboarding writes `sport` (+ `subGoal`) into the program's **`input_snapshot`
   JSON**. **No DB migration** — sport rides in JSON.
2. `toEngineInput` (`lib/engine/skeleton.ts`) resolves `getSport(input.sport)`
   and derives the `EngineInput`.
3. `buildSkeleton` branches by family: general-fitness →
   `buildRotationSkeleton`; triathlon → `buildTriathlonSkeleton`; everything
   else → the shared station/run skeleton.
4. Triathlon assembles `ProgramData` deterministically
   (`buildTriProgramData`); the station-hybrid sports fan out to the AI session
   fill exactly as HYROX always did.

Because sport lives in `input_snapshot` JSON, **old programs keep their stored
`program_data`** and are unaffected by engine changes. To get newer logic into
an existing program, **re-run generation** on it (or create a fresh one).

---

## 4. The safety rule — the golden HYROX oracle

**`lib/engine/golden-hyrox.test.ts`** freezes the deterministic HYROX skeleton
(and `lib/ai/prompts.test.ts` freezes the prompt) with snapshots generated from
the pre-refactor engine. They cover allocation, microcycle progression, peak
drop, tapers, needs biasing, masters, and general fitness.

**If a change to shared engine code (skeleton, slots, needs, mesocycles,
microcycles, volume, prompts) alters HYROX output, these tests fail on
purpose.** That is the signal to keep the change sport-scoped. Every feature in
this project was built to keep them green. Do **not** update these snapshots to
make a refactor pass — a diff there means the change leaked into HYROX.

The one legitimate exception: if you _intend_ to change HYROX behavior globally
(e.g. a periodization fix that should apply to all sports), then updating the
snapshot is correct — but that's a deliberate product decision, not a way to
silence a failing test.

---

## 5. Build, test, and gates

Run these three before every commit. All must pass:

```
npx tsc --noEmit          # types (strict: noUnusedLocals/Params, noUncheckedIndexedAccess)
npx vitest run            # 431 tests incl. the golden oracles
npx next build            # production build
```

Notes / gotchas:

- **eslint is broken in the repo, independent of this work.** We gate on
  tsc + vitest + build, not lint. Fix lint separately if desired.
- **`next build` no longer requires env vars** (as of the `fix/build-env-nonfatal`
  branch). `lib/env.ts` validates env at import; it used to `throw` at build
  time, which made **production deploys fail intermittently** — a Next 16 /
  turbopack build race where a static-collection worker occasionally didn't see
  the (correctly configured) runtime env, so `next build` crashed with
  "Failed to collect page data for /_not-found". The fix downgrades that throw to
  a **warning during the build phase** (`NEXT_PHASE === "phase-production-build"`);
  at real runtime (server request / client) validation stays strict and still
  throws. Net effect: builds are deterministic and don't need env vars, while the
  runtime fail-fast guarantee is preserved. You no longer need the placeholder
  `.env.local` trick to build locally.
  - Required at **runtime**: `NEXT_PUBLIC_SUPABASE_URL`,
    `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `ANTHROPIC_API_KEY` (server). Everything else
    in `lib/env.ts` is optional. Set the three in Vercel for **all** target
    environments (Production included — a Preview-only scope was part of the
    original confusion).
- **Fresh clone needs `npm install`** — `main` added an email system
  (`@react-email/*`, `resend`) whose absence shows as `lib/email/*` tsc errors
  until installed.
- Commit trailers used throughout:
  `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>` and the
  `Claude-Session:` line.

---

## 6. Per-sport feature status

**HYROX** — unchanged. Race pacing plan, needs biasing, all prior behavior intact.

**DEKA (all 5)** — selectable and generating. Race **pacing plan**
(`lib/engine/deka-pacing.ts`) reads each format's geometry (run distance, laps)
off its `SportConfig`, so one module covers Fit/Mile (running), Strong/Atlas
(station-only), and Ultra (5 laps). **Atlas-specific needs scorers**
(`lib/engine/needs-atlas.ts`): absolute strength / overhead-pressing endurance /
glycolytic capacity, with two Atlas-only benchmark inputs.

**Triathlon** — deterministic end-to-end. Per-discipline **zones**
(`lib/engine/tri-zones.ts`: CSS→swim pace, FTP→bike power, VDOT→run). Per-
discipline **volume tiering** (explicit swim/bike experience selectors, else
derived from CSS/FTP). Deterministic **weekly adaptation** (rebuilds the revised
week from the adapted target — no AI). **Individualized session content** (real
sets/watts from CSS/FTP). Held-level **rebound/increase/deload** volume model
(round-2 fix).

**General Fitness** — rotating-emphasis blocks, optional sub-goal, no-race
`ProgramType`, no taper.

---

## 7. Round-2 refinements (branch `feat/refinements-round-2`)

1. **5K required only for HYROX + DEKA Fit** — every other sport treats all
   benchmarks as optional (onboarding label + server-side gate).
2. **Benchmark-page guidance** — conservative-estimate note added.
3. **Experience page tailored to program** — triathlon asks running / swim /
   bike / lifting (no hybrid); others ask running / hybrid / lifting. Hidden
   schema-required fields get a neutral default.
4. **Triathlon rebound-volume fix** — `buildTriathlonSkeleton` used a continuous
   ramp, so rebound weeks kept climbing. Now uses the same held-level microcycle
   model as the run/station engine: volume steps up only on _increase_ weeks, a
   _rebound_ holds the prior increase level, a _deload_ dips without lowering the
   held level. (HYROX/DEKA/general-fitness were already correct — this was
   triathlon-only.)
5. **"Cycle" column** in the weekly summary table
   (`components/program/week-summary-table.tsx`) showing Rebound / Increase /
   Deload (and Taper / Race), color-coded, from each week's `microWeek`.

> **Action after merging round 2:** the rebound fix changes how _new_ triathlon
> programs generate. A triathlon program created before the fix still has its old
> week volumes stored in `program_data` — **re-run generation** on it (or create
> a fresh one) to pick up the corrected rebound behavior.

---

## 8. Known follow-ups (not yet done)

- **Live QA per sport.** Deterministic paths are unit-tested; the DEKA/Atlas
  **AI-fill** path reuses the proven HYROX pipeline but hasn't been exercised
  against real Supabase + Anthropic keys in a session. Generate one program per
  sport through the UI (the Vercel preview is a good place) before relying on it.
- **DEKA time-trial benchmarks** (500 m row / ski / sled) to individualize more
  DEKA pacing zones — currently derived from 2 k erg proxies. _(Explicitly
  deprioritized by product.)_
- **eslint** is broken repo-wide and should be fixed independently of features.
- Coaching **reference times / anchors** in the pacing and needs modules are
  deliberately coarse and centralized for one-file tuning — worth calibrating
  against real field data over time. DEKA loads are kg (engine convention) but
  DEKA standards are lb; verify against the versioned Rules PDF per season.

---

## 9. Quick map — where things live

```
lib/engine/sports/         SportConfig registry + per-sport configs & builders
lib/engine/skeleton.ts     buildSkeleton (family branch) + toEngineInput
lib/engine/microcycles.ts  rebound/increase/deload held-level volume model
lib/engine/deka-pacing.ts  DEKA race pacing plan
lib/engine/tri-zones.ts    triathlon per-discipline zones
lib/engine/needs.ts        HYROX/DEKA needs analysis (limiter + bias)
lib/engine/needs-atlas.ts  Atlas needs analysis + analyzeNeedsForSport dispatcher
lib/engine/golden-hyrox.test.ts   THE byte-identical HYROX gate
lib/generation/generate-program.ts   generation entry (tri deterministic branch)
lib/generation/adapt-week.ts         weekly adaptation (tri deterministic branch)
app/onboarding/                      sport picker, experience, benchmarks, actions
app/program/[id]/page.tsx            program view (pacing/zones cards, review loop)
components/program/                   week table, session/week cards, pacing cards
docs/sports/                          design + research + per-sport specs
```
