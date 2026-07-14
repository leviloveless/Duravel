# HyroxAI — Principal-Level Engineering & UX Review
**Date:** 2026-07-13 · **Reviewer:** Claude (Cowork) · **Scope:** full stack — engine, generation, data/API/security, UI/UX, tooling/DevEx
**Method:** read of ~80 source files (all of `lib/`, `app/`, `components/`, `supabase/migrations/`, configs), reviewed across four independent expert passes and reconciled.

---

## 0. Bottom line

This is a **genuinely strong, domain-literate codebase** — well above typical app-code quality. The deterministic-engine / AI split is real and principled ("engine owns structure and volume, the model only fills content"), the domain modeling (Daniels VDOT, ACWR/Foster load, sex-specific anchors, Karvonen/Friel zones) is research-grade, RLS is on every table with **no service-role key anywhere**, and the React layer follows correct server/client-component discipline with a clean pure-function presentation layer (`format.ts`).

So this review is about **hardening an already-good design**, not rescuing a bad one. The highest-value work clusters in four places:

1. **The adaptation path leaks the invariants the rest of the engine works hard to guarantee** (newest layer, reuses the pipeline with a *reduced* argument set).
2. **The LLM cost controls are bypassable** — the rate limit has a TOCTOU race and the cost-tracking `UPDATE` is silently blocked by RLS, so you're flying blind on spend.
3. **The custom modal/toggle widgets are not accessible**, and one-click Delete can destroy an expensive program with no confirm.
4. **The toolchain is `create-next-app` defaults with no CI, no ESLint, no formatter, no observability** — on a bleeding-edge Next 16 / React 19.2 stack, so *you* are the regression detector.

None of this requires a rewrite. A focused two-sprint effort lands the whole high-impact set.

### A note on scope accuracy
Three items an automated pass flagged as "missing" are **false positives from how I staged files** — they exist in your repo, I just didn't copy them into the sandbox: the **test suite** (257 passing tests per your handoff), the **`package-lock.json`** (105 KB, present), and **`postcss.config.mjs`** (present). I've removed those from the findings. Also corrected: the stack is **Next 16.2.10 / React 19.2.4** (not Next 15), and `proxy.ts` is the correct Next 16 middleware convention — no action needed there.

---

## 1. Layer scorecard

| Layer | Grade | One-line verdict |
|---|---|---|
| Engine & generation | **A−** | Research-grade domain logic; risks concentrated in the adaptation path and a few unenforced invariants. |
| Data / API / security | **B+** | RLS-solid, no service-role key; real cost-abuse races and an open-redirect to close. |
| UI / UX / accessibility | **B+** | Excellent RSC discipline; accessibility of custom widgets is the weak spot + a data-loss Delete. |
| Tooling / DevEx / observability | **C** | Strong code conventions sitting on an ungoverned toolchain — no CI, lint, formatter, or error tracking. |

The gradient is the story: **the code is A-grade, the process around it is C-grade.** The single most cost-effective investment is a CI pipeline that makes the A-grade code stay A-grade.

---

## 2. Prioritized roadmap

Ranked by impact ÷ effort. Each item cites the detailed finding in §3.

### Tier 0 — Correctness & security must-fix (do first)

| # | Item | Why | Effort | Ref |
|---|---|---|---|---|
| 0.1 | **Thread full benchmarks/division/sex/weightUnit through the adapted-week assemble call** | Any adapted week silently regresses: VDOT paces fall back to 5K-only, working weights vanish, and a female/Pro athlete's hybrids revert to male/Open loads. | Low | E-H7 |
| 0.2 | **Make the generate/adapt rate limit atomic in the DB** | Count-then-insert is a TOCTOU race; N concurrent POSTs all pass the cap → uncapped paid-LLM spend. | Med | S-H2 |
| 0.3 | **Add the missing `generation_events` UPDATE RLS policy (or stamp tokens at insert)** | Cost-tracking `UPDATE`s hit 0 rows silently; `cost_usd` is `NULL` forever — no spend visibility to even detect 0.2. | Low | S-H1 |
| 0.4 | **Zod-parse stored `program_data` / `skeleton` in `loadForAdaptation`** | `input_snapshot` is validated but the program blob is a raw cast → schema drift flows straight into adaptation math. | Low | E-H4 |
| 0.5 | **Validate the `next` redirect param in `/auth/confirm`** | Open redirect after OTP verify = phishing primitive. | Low | S-M4 |
| 0.6 | **Cap all free-text input lengths** (`firstName`, `goalFinishTime`, benchmark strings) | Unbounded `firstName` is embedded in *every* prompt → token-cost amplification + prompt-injection channel. | Low | S-M1 |

### Tier 1 — High-leverage quick wins

| # | Item | Effort | Ref |
|---|---|---|---|
| 1.1 | **Add confirmation/undo to program Delete** (one-click permanent today; inconsistent with Recalculate which *does* confirm) | Low | U-1 |
| 1.2 | **Make the log/readiness modal an accessible dialog** — `role="dialog"`, `aria-modal`, focus trap/restore, Esc-to-close | Med | U-2 |
| 1.3 | **Turn on `noUncheckedIndexedAccess`** in tsconfig — directly targets the array-indexing bug class the engine is built on | Low | T-1 |
| 1.4 | **CI pipeline** (GitHub Actions: `typecheck → lint → test → build` on PR) — converts "one engineer's discipline" into an enforced gate | Med | T-2 |
| 1.5 | **Restore ESLint** (`eslint-config-next` flat config + `lint` script) — recovers the RSC/hooks/a11y rules you currently get zero of | Low | T-3 |
| 1.6 | **Zod-validated env module** (`lib/env.ts`) + `.env.example` — reuses existing Zod; converts runtime env failures into boot failures | Low | T-4 |
| 1.7 | **Fix races `key={i}`** → stable id — index keys + mid-list removal corrupts controlled-input state | Low | U-5 |
| 1.8 | **Explicit Anthropic SDK timeout < `maxDuration`** + a sweeper for stuck-`generating` programs | Med | S-M3 |
| 1.9 | **Lock-before-LLM on adapt apply** (insert the row before the Haiku call, let the unique constraint reject the duplicate) | Med | S-M2 |
| 1.10 | **Remove developer/Milestone copy from the Profile page** (internal roadmap language shipping to users) | Trivial | U-3 |

### Tier 2 — Structural / maintainability

| # | Item | Effort | Ref |
|---|---|---|---|
| 2.1 | **Enforce AI-returned session *kinds* against the skeleton slots** in `daySessions` (the one real gap between "engine owns structure" and the implementation) | High | E-H1 |
| 2.2 | **Optimistic UI on session logging** (`useOptimistic`) — the stated "under 10 seconds on a phone" core loop currently waits on a full-tree `router.refresh()` | Med | U-6 |
| 2.3 | **Extract `<Button>` / `<Input>` primitives + a `usePostAction` hook** — kills ~10× class duplication and 5 hand-rolled fetch/429 clients | Med | U-9, U-11 |
| 2.4 | **Centralize duplicated math** (`round1/2/5`, `clamp`, `METERS_PER_MILE`, Epley, `FIVE_K_MILES`) into `lib/engine/math.ts` — ~10 copies today | Low | E-L13 |
| 2.5 | **Derive TS types from Zod enums** (kill the `LiftPattern`/`MovementPattern` twin and copied union lists) | Med | E-M6 |
| 2.6 | **Split `slots.ts` sequencing sub-system** into `sequencing.ts`; peel load metrics out of `adapt.ts` | Med | E-M2 |
| 2.7 | **Decompose `onboarding-form.tsx`** (737 lines) into step components + a `<DayPills>` (duplicated 5×) | Med | U-14 |
| 2.8 | **Resolve the dark-mode contradiction** — `globals.css` flips to dark but every component hardcodes `bg-white` → broken half-dark UI. Either implement `dark:` variants or remove the dead block. | Low (remove) / High (implement) | U-7 |

### Tier 3 — Rigor & polish

| # | Item | Effort | Ref |
|---|---|---|---|
| 3.1 | Prettier + `format:check`; Husky + lint-staged pre-commit | Low–Med | T-5 |
| 3.2 | Sentry (`@sentry/nextjs`) — cheapest path to production visibility; currently blind to server/route errors | Low | T-6 |
| 3.3 | Vitest coverage thresholds on `lib/engine`; add API-route tests around the Zod contracts + AI-response boundary; consider Playwright for auth→generate→program | Med | T-7 |
| 3.4 | Pin `@anthropic-ai/sdk` (0.x on the critical path); add Dependabot/Renovate + `npm audit` in CI | Low | T-8 |
| 3.5 | Bump tsconfig `target` to ES2022; add `exactOptionalPropertyTypes`, `noFallthroughCasesInSwitch`, `noUnusedLocals/Parameters` | Low | T-9 |
| 3.6 | `aria-pressed`/`aria-selected` on toggle-buttons; bump `text-zinc-400` info text to `zinc-500/600` for AA contrast; zone-bar `aria-label`s | Low | U-8, U-10 |
| 3.7 | `loading.tsx` / `error.tsx` for dashboard & program routes; onboarding draft persistence + warn-on-exit | Low–Med | U-12, U-16 |
| 3.8 | DB DevEx scripts (`db:migrate`, `db:reset`, `db:types`), `README`, `engines`/`.nvmrc`; `maxDuration` + security headers in `next.config.ts` | Low–Med | T-10 |

---

## 3. Detailed findings

### 3A. Engine & generation (`lib/engine`, `lib/generation`)

**Strengths worth preserving.** Clean unidirectional dataflow (`toEngineInput → buildSkeleton → planChunks → generateChunk(AI) → assembleProgram → reconcileWeekVolume → verifyProgram`); pure, AI-free engine; every numeric invariant re-asserted deterministically after the model returns; centralized thresholds in `adapt-config.ts`; near-every constant carries a rationale + spec citation. Proper `z.discriminatedUnion("kind", …)` with correct narrowing throughout; `any` is essentially absent.

- **E-H7 (High/Low) — Adapted weeks lose benchmark individualization.** `adapt-week.ts:313-318` calls `assembleProgram(..., profile.runningExp, benchmarks?.fiveKTime)` — passing *only* `fiveKTime` and omitting `mileTime`/`tenKTime`, the strength `benchmarks`, `weightUnit`, `division`, and `sex` that the initial `generate-program.ts:141-155` passes. Consequences on any adapted week: VDOT reverts to 5K-only (regresses your Review #2), working weights disappear (shows "%1RM · RIR" while every other week shows kg/lbs), and `applyStationProgression` reverts to `division:"open"`, `sex:"male"` — a female Pro athlete's adapted hybrids silently get male Open loads. **Fix:** a shared `assembleArgsFromInput(input)` helper used by both call sites.
- **E-H4 (High/Low) — Inconsistent trust boundary on persisted JSON.** `adapt-week.ts:108-110` casts `row.program_data as ProgramData` / `row.skeleton as ProgramSkeleton` raw, three lines after `input_snapshot` is `safeParse`d. `ProgramDataSchema` already exists — parse these too (add a skeleton schema or guard the read fields).
- **E-H1 (High/High) — The AI effectively owns the session *kind* mix.** `daySessions` (`assemble.ts:65-84`) returns `aiDay.sessions` verbatim after only a race/rest guard; it never reconciles returned kinds against the engine's planned slots. The schema comment *claims* this is "validated during assembly" (`schemas.ts:259-261`) but no such validation exists. If Haiku returns a lift where a run was planned, the week silently diverges from the periodization. **Fix:** coerce each day's kinds to skeleton slots, or at minimum assert per-kind counts in `verifyProgram`.
- **E-M2 (Med/Med) — `slots.ts` (552 lines) and `adapt.ts` (538) are borderline god-modules.** `slots.ts` carries session-count policy, run-type selection, slot construction, day placement, *and* the self-contained concurrent-training sequencing sub-system (interference/AMPK-vs-mTOR) that belongs in `sequencing.ts`. Peel `weekLoad`/`computeLoadMetrics` out of `adapt.ts` into `load.ts`.
- **E-M6 (Med/Med) — Parallel type/enum definitions.** `RunType`, `PhaseName`, `MicroWeekType`, etc. are hand-declared unions in `types.ts` *and* independently as Zod enums in `schemas.ts` (the 8 run types are copied in both). `LiftPattern` (`strength.ts`) and Zod `MovementPattern` (`schemas.ts`) are two independent 7-value enums that happen to match. **Fix:** define the Zod enum once, derive the TS type via `z.infer`.
- **E-M8/M9/M10/M11 (Med) — Correctness edges.** Stale A-taper docstring says "−30% then −30% (≈−51%)" but the code is −20% then −40% non-compounded (`taper.ts:5-6` vs `volume.ts:113-114`). `reconcileWeekVolume` bails on the whole week for *any* race, but C-races "train through" → their summary volume is un-reconciled AI output (`reconcile.ts:107-108`). Hybrid duration is 45 min to the adaptation engine but up to 75 min to the reconciler (`ADAPT.DEFAULT_HYBRID_MINUTES` vs `sessionTiming`) — skews ACWR/monotony vs displayed volume. Summary `zoneDistribution` is the phase *target* copied in, not measured from sessions, so it under-represents the Z1–Z2 cardio the reconciler injects.
- **E-L12/L13/L14/L15 (Low) — Smells.** `scoreDurability` picks mile–5K then overwrites with 5K–10K, so the genuinely-widest mile–10K pair is only used when 5K is absent. `round1/2/clamp` re-declared in 9 files; `EPLEY`, `METERS_PER_MILE`, `FIVE_K_MILES` duplicated. `patchMovementPatterns` sets `sets/repRange` that `applyStrengthSchemes` immediately overwrites (dead assignments). Two+ zone representations (`ZONE_RANGES` duplicates `ZONE_BANDS_HRMAX`).
- **Testing.** Highly testable (pure functions, rich export surface). Watch snapshot-brittleness on the long natural-language `reason` strings in `decideAdaptation` — assert on structured `rule`/`revisedTargets`, not prose. The seams unit tests won't catch (E-H1 kind-mismatch, E-M9 C-race, E-H7 adapted-week) want *integration* tests: feed a kind-mismatched chunk and a female/Pro athlete through `applyAdaptation`, and property tests ("session count preserved", "mileage == target ±0.1", "no hard-leg lift the day before a key run").

### 3B. Data / API / security (`lib/supabase`, `app/api`, actions, migrations)

**Strengths worth preserving.** **No service-role key anywhere** (grep-confirmed) — all access is user-JWT + RLS, the single most important thing a Supabase app can get right. RLS enabled on *every* user table with correct `auth.uid()` predicates and `with check` on writable ones; append-only tables correctly omit update/delete. Good schema hygiene: `on delete cascade` FKs, `check` constraints mirroring the Zod enums, unique constraints matching upsert `onConflict` targets, hot-path indexes. AI boundary well-designed: output Zod-validated (`AiChunkSchema`), model pinned (`claude-haiku-4-5-20251001`), bounded single-retry.

**No CRITICAL findings** — no cross-tenant IDOR or missing-RLS leak. Passing another user's `programId` yields 404/empty.

- **S-H1 (High) — Cost tracking is dead.** `generation_events` has only SELECT+INSERT policies; migration `0004` adds token/cost columns but no UPDATE policy. Both `generate/route.ts:106` and `adapt/apply/route.ts:105` `.update({...})` → **0 rows affected, no error checked** → `cost_usd` stays `NULL` forever. Add the UPDATE policy or stamp at insert.
- **S-H2 (High) — Rate limit is a TOCTOU race.** `generate/route.ts:70-95` does `select count` *then* insert, non-atomically. N parallel POSTs all read `count < 3` and all run the expensive pipeline. The in-code comment claiming concurrency safety is false. Same in `adapt/apply`. **Fix:** enforce atomically in Postgres (RPC with `insert … where (select count …) < limit`, partial unique index, or `SELECT … FOR UPDATE` on a counter row).
- **S-M1 (Med) — Unbounded free-text → cost DoS + injection.** `firstName` is `z.string().min(1)` with no max (`schemas.ts:64`), embedded verbatim in every prompt (`prompts.ts:78`), re-sent every mesocycle + adaptation. A ~1 MB `firstName` multiplies token cost on every generation; also an injection channel (as is the log `note` echoed in `adapt-week.ts:249`). `note` is already capped at 280 — apply the same everywhere.
- **S-M2 (Med) — Adapt double-review race.** The "already reviewed" check (`adapt/apply/route.ts:49`) precedes the audit-row insert at the *end* of `applyAdaptation` (`adapt-week.ts:344`). Two concurrent applies both spend a Haiku call and both write `program_data`; the unique constraint then 500s the second *after* the money's spent. Insert a lock row before the LLM call.
- **S-M3 (Med) — No Anthropic timeout under a 60s cap.** `generate-week.ts` sets no SDK `timeout` while `maxDuration=60` and `generateProgram` fans out with `Promise.all`. A platform kill at 60s skips the `catch` that sets `status:'failed'` → program stuck `generating` forever, quota already burned. Set an explicit timeout + a stuck-status sweeper.
- **S-M4 (Med) — Open redirect.** `/auth/confirm/route.ts:14,20` passes query-string `next` straight to `redirect(next)`. Accept only same-origin relative paths (`startsWith("/") && !startsWith("//")`).
- **S-L1/L2/L3/L4/L5 (Low).** Raw DB `error.message` returned to clients (`logs`/`readiness` routes) — leaks Postgres detail. Generate/adapt hand-roll body parsing instead of Zod, and `programId` isn't UUID-validated. Read paths rely solely on RLS (delete/rename already add belt-and-suspenders `.eq("user_id", …)` — apply to reads too). `submitOnboarding` and `updateProgramInputs` are non-transactional multi-row writes. `signUp` `emailRedirectTo` falls back to a relative URL if `NEXT_PUBLIC_SITE_URL` is unset — make it required.

### 3C. UI / UX / accessibility (`app`, `components`)

**Strengths worth preserving.** Server/client boundary is exemplary — data fetching in async server components, `"use client"` only on leaf interactive widgets. `format.ts` is principal-grade (pure, single source of truth, shared with the reconciler so display and math always agree). `program-view.tsx` pre-buckets logs into a Map (no O(n²) per-week filter). Real mobile layout for the program table (stacked cards vs desktop `<table>`), deliberate `print:hidden`. Onboarding's accidental-generation guards (300 ms double-click guard before the costly LLM call) and LLM-latency staging messages are above-average product care.

- **U-1 (Low/High) — One-click Delete = data loss.** Dashboard Delete is a bare `<form action={deleteProgram}>` — one click permanently destroys a generated program (an expensive LLM artifact), no confirm, no undo — while Recalculate *does* confirm. Inconsistent and dangerous. Add confirm or undo toast.
- **U-2 (Med/High) — Log modal isn't an accessible dialog.** `log-session.tsx` renders a `fixed inset-0` overlay with no `role="dialog"`, no `aria-modal`, no focus trap, no focus-on-open, no Esc-to-close, no focus restoration. Highest-impact a11y fix — use Radix `Dialog` or add the semantics manually.
- **U-3 (Trivial/Med) — Dev copy in prod.** `profile/page.tsx:18-22` ships "This basic form covers Milestone 2 … lands in Milestone 4" to users.
- **U-5 (Low/Med) — Races `key={i}` bug.** `removeRace(i)` splices, so index keys associate the wrong controlled `<input>` with the wrong race after a middle removal. Give races a stable `crypto.randomUUID()`.
- **U-6 (Med/High) — No optimistic UI; the "10-second" loop waits on a full refresh.** Every mutation is `fetch → router.refresh()`, re-rendering the entire program tree (the program page does 4 awaited queries + pacing compute) for a single checkmark. `useOptimistic` on the log badge + migrating the log/readiness/adapt flows from API routes to server actions (unlocking `revalidatePath`) fixes both.
- **U-7 (Low–High/Med) — Dark mode is half-implemented.** `globals.css` flips `--background`/`--foreground` under `prefers-color-scheme: dark`, but every component hardcodes `bg-white`/`text-zinc-800` with no `dark:` variants → body goes dark while cards stay white. Remove the dead block (light-only, honest) or commit to `dark:` across the system.
- **U-9/U-11 (Med/Med) — Duplication that wants a primitive layer.** The primary-button class string appears in ~10 files with drifting padding; `inputClass` lives only inside onboarding while profile/login re-inline it. Five near-identical hand-rolled `fetch → 429 → setError → router.refresh()` clients. Extract `<Button variant>` / `<Input>` and a `usePostAction(url)` hook.
- **U-8/U-10 (Low/Med) — a11y polish.** Toggle-buttons (RPE grid, status buttons, login tabs, day pills) convey selection by color only — add `aria-pressed`/`aria-selected` and `aria-current="step"` on the active onboarding step. `text-zinc-400` on white is ~2.6:1 (below AA 4.5:1) for the small informational text it's used on — bump to `zinc-500/600`. Zone bars/race dots are color-only with mouse-only `title` tooltips — add `aria-label`.
- **U-12/U-14/U-16 (Low–Med) — Structure & flow.** No `loading.tsx`/`error.tsx` in the tree → a failed Supabase call blanks the app. `onboarding-form.tsx` (737 lines) holds ~15 state slices, 4 steps, and repeats the day-pill block 5× — decompose into step components + `<DayPills>`. Long onboarding has no draft persistence → refresh loses everything; "Exit to dashboard" silently discards.
- **Performance.** Correctly *not* over-memoized (server components don't re-render). `session-card.tsx` is dead code (never imported) and a duplicate rendering path that will drift from `WeekCard`'s inline `SessionDetail` — delete or consolidate.

### 3D. Tooling / DevEx / observability (configs)

**Strengths.** `strict: true` is on. `schemas.ts` and the engine barrel show disciplined Zod-first design. Vitest is scoped sensibly to the pure engine (`lib/**/*.test.ts`, node env). `proxy.ts` is the correct Next 16 convention.

- **T-1 (Low/High) — `noUncheckedIndexedAccess` is off.** The single highest-value missing flag for a codebase whose correctness model is heavy array/index access (`weeks[i]`, `days[j].sessions[k]`, `sessionIndex 0..9`). Without it, off-by-one / empty-week bugs typecheck clean. Expect it to surface real issues — that's the point.
- **T-2 (Med/High) — No CI.** No `.github/`. Nothing prevents merging/deploying a type error, broken test, or unformatted code; Vercel builds whatever compiles. A `typecheck → lint → test → build` Action is the missing backbone that makes every other gate *enforced*.
- **T-3 (Low/High) — No ESLint.** No `eslint.config.*` and no `lint` script — even the `create-next-app` scaffold ships `eslint-config-next` (RSC/hooks/a11y rules) and it's absent here. You currently get zero static lint coverage on a bleeding-edge stack.
- **T-4 (Low/High) — No validated env.** No `.env.example`, no schema-validated env module. A missing/renamed `NEXT_PUBLIC_SUPABASE_URL` / `ANTHROPIC_API_KEY` fails inside a Vercel function at runtime instead of at boot. A `zod`-parsed `lib/env.ts` is trivial (Zod is already a dep) and high-value.
- **T-5 (Low–Med/Med) — No formatter or hooks.** No Prettier, no Husky/lint-staged → style is human-enforced and PRs churn on whitespace; nothing blocks a bad local commit.
- **T-6 (Low/Med) — No observability.** No Sentry, no structured logging (Vercel `console.*` is ephemeral), no analytics/Web Vitals, no operational AI-latency/cost instrumentation (the `generation_usage` table is billing data, not ops visibility). For a paid-LLM app mutating user data, you're blind to production errors.
- **T-7 (Med) — Test layers missing.** No coverage thresholds; no component tests (needs jsdom + Testing Library), no API-route tests around the Zod contracts, no E2E (Playwright) on auth→onboarding→generate→program, no tests around malformed AI responses (`AiChunkSchema` is a critical trust boundary).
- **T-8/T-9 (Low) — Rigor.** Pin `@anthropic-ai/sdk` (a 0.x on the critical path where minors can break); add Dependabot + `npm audit`. Bump tsconfig `target` from stale `ES2017` to `ES2022`; add `exactOptionalPropertyTypes` (the schema is saturated with `.optional()`), `noFallthroughCasesInSwitch` (discriminated-union switches), `noUnusedLocals/Parameters`.
- **T-10 (Low–Med) — DevEx.** Add `typecheck`/`lint`/`format` scripts and DB scripts (`db:migrate`, `db:reset`, `db:types` — 10 migrations run by memory today, and generated DB types must stay in sync with `schemas.ts`); a `README`; `engines`/`.nvmrc` pinning Node; `maxDuration` for the generate route + security headers in the empty `next.config.ts`.

---

## 4. Suggested sequencing

**Sprint 1 (correctness + cost safety).** Tier 0 in full — it's mostly low-effort and closes the real money/data-integrity leaks (0.1, 0.3, 0.4 are each ~an hour; 0.2 needs a small Postgres RPC). Land 1.3 (`noUncheckedIndexedAccess`) and 1.4 (CI) alongside so the fixes are protected going forward. Pair each with a regression test — the adaptation-path bugs (0.1) specifically want an integration test through `applyAdaptation` with a female/Pro athlete.

**Sprint 2 (UX + guardrails).** 1.1/1.2/1.10 (Delete confirm, accessible modal, dev-copy removal — fast, user-visible), 1.5/1.6 (ESLint + env module), 1.7/1.8/1.9 (races key, LLM timeout+sweeper, adapt lock). This is the "make it feel finished and safe" sprint.

**Then Tier 2/3** opportunistically as you touch those files — the primitive-layer extraction (2.3) and `math.ts` (2.4) pay off every subsequent edit, and E-H1 (2.1) is the one genuinely-larger architectural item worth scheduling deliberately.

*This continues the disciplined one-item-at-a-time cadence from your training-science roadmap; the impact/effort columns in §2 are sized for exactly that workflow.*
