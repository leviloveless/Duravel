# Duravel — Session Handoff

**Saved:** 2026-07-20 (Mon) 10:25pm ET · **Session type:** #17 HYROX arc — race splits → benchmark import → projected times → mid-program re-forecast
**Continues:** `Duravel_Handoff_07-20-26_4.47pm.md` (backlog #14/#19/#17 initial lookup).

---

## 1. Headline

The **#17 HYROX arc is complete end-to-end and fully pushed**. Four commits this session, all on `main`; migration `0033` applied. Nothing outstanding to deploy. Full plan doc `Duravel_Projected_Times_Plan.md` delivered to chat.

---

## 2. What shipped (all pushed to `main`)

- **`ebf72cd`** — pull **individual run + station splits** from `GET /athletes/{id}/splits`. New parser for the real response shape (`data[]` of `canonical_key/label_original/time_ms/order_index/place`); new auth-gated `POST /api/hyrox-splits`; lookup fetches splits on pick and renders runs + stations + roxzone (splits failure non-fatal).
- **`b7c1e84`** — **import splits into profile benchmarks + builder inputs**. 10 optional `hyrox*` benchmark fields; new "HYROX event splits" grid on the Benchmarks step (HYROX only); lookup onPick maps canonical keys → those inputs; splits surfaced to the AI generator prompt. No migration (stored in the benchmarks JSON).
- **`6218ce8`** — **projected end-of-program times** (research-backed model) + **migration `0033_program_projection.sql`** (`programs.progress_projection` jsonb). Per-event + finish projection card on the program page; baseline persisted at generation.
- **`654133b`** — **§4 mid-program re-forecast**. Projection updates from real training (imported → now → end target); driven by adherence + fresh measurements.

---

## 3. The model (for a future session that wants to tune it)

**Build-time (`lib/engine/progression.ts`):**
`projected = current × (1 − Imax(exp) × trainability(event) × headroom(current vs F/C) × saturation(weeks))`
- `Imax`: beginner .14 / intermediate .07 / advanced .035 (runs use `runningExp`, stations `hybridExp`).
- `saturation(W) = 1 − e^(−W/11)` (front-loaded; 12wk≈.66, 24wk≈.89).
- `headroom = clamp((cur−F)/(C−F), .05, 1)` from per-event fast/slow bands in `lib/engine/hyrox-standards.ts` (**public** HyroxDataLab/Hyroxy/Concept2 data — see §6 reminder).
- `trainability`: runs 1.0, ergs .9, wall balls .85, burpee .8, lunges .75, farmers .7, sled .6, roxzone .5. Floor `F×0.98`. Calibrated to running/erg/VO2max literature.

**Re-forecast (`lib/engine/reforecast.ts`):**
- realized-so-far = `saturation(K)/saturation(W) · adherence^0.7` (adherence = `computeAdherence(program, logs, K).overall.completionRate`).
- end target re-projected trusting plan early / observed adherence late (`futureAdh = (K/W)·aEff + (1−K/W)·1`).
- fresh measurement `m`: `now = 0.65·m + 0.35·model`, re-anchor remainder; floored at `F×0.98`.
- `onTrack` = end ≤ original target × 1.03. `loadTrend` param exists but wired neutral.
- At K=0 it reproduces the build-time projection exactly.

**Doubles caveat:** race type captured on import (`benchmarks.hyroxRaceType` singles/doubles/relay). Doubles/relay = shared-effort station splits, so those project **running only** with a note.

---

## 4. Verification

- Pure suites cloud-verified: HYROX splits parser, `progression` **12 tests**, `reforecast` **7 tests** — all green under the repo's strict tsconfig flags.
- Scoped `tsc` (real config + node_modules, via `tsconfig.hxcheck.json` extends) clean across every touched file each commit.
- **Not run on the bridge:** full `vitest` (device Linux node_modules missing `@rollup/rollup-linux-x64-gnu` + `html2canvas`) and `next build`. **Levi: run `npm test` / build locally** as the final gate (both passed types in isolation).

---

## 5. Files

- Engine: `lib/engine/hyrox-standards.ts`, `lib/engine/progression.ts` (+test), `lib/engine/reforecast.ts` (+test).
- Lookup: `lib/hyrox-results.ts` (+test), `lib/hyrox-results-api.ts`, `app/api/hyrox-lookup/route.ts`, `app/api/hyrox-splits/route.ts`, `components/onboarding/hyrox-lookup.tsx`.
- Wiring: `lib/schemas.ts` (hyrox* + hyroxRaceType), `app/onboarding/actions.ts`, `app/onboarding/onboarding-form.tsx`, `lib/generation/generate-program.ts`, `lib/ai/prompts.ts`, `app/program/[id]/page.tsx`, `components/program/projection-card.tsx`.
- Migration: `supabase/migrations/0033_program_projection.sql` (applied).

---

## 6. Remaining / next increments

- **§4.4 write-back persistence** of the live re-forecast to `progress_projection` — deferred until a consuming surface (dashboard tile, "you're behind" email) needs it. Card computes fresh on view today.
- Optional projection polish: wire `loadTrend` from recovery data; feed projected finish into `computePacingPlan` when no goal set; first-race race-craft bonus on roxzone.
- **⏳ REMINDER (Levi's call):** refit the F/C bands (and ideally Imax/τ) on **Duravel's own user results** once we have enough — currently public benchmark data.
- **Ironman lookup** via Athlinks — pending API approval; wire like HYROX.
- **Equipment/current-days → generation** (from the prior session) — captured but the prompt doesn't act on them yet.

---

## 7. Env / migrations / gotchas

- **Migration `0033` applied.** No new env this session.
- **Git bridge:** commits via `device_bash` work (move ALL `.git/*.lock` incl HEAD.lock aside; set identity inline `-c user.name/email`; filter `unable to unlink`/`tmp_obj`). Push needs Levi. Commits authored as Levi, no AI-vendor references.
- **⚠️ Stale-read trap hit this session:** `device_stage_files` / cloud mount reads returned an OLD `lib/schemas.ts` (missing `equipment`). Fix: edit on-device with Python + verify vs `git show HEAD:<file> | md5sum`; `device_bash` worktree reads are accurate. Full-repo `tsc` can't finish in the 45s device cap — use a scoped `tsconfig` that extends the real one. See memory `duravel-device-bridge-write-failure` / `duravel-repo-git-ops`.
- Scratch parked in `_to_delete/` (rm is blocked on the mount) — Levi can empty it.
