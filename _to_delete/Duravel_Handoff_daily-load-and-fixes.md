# Duravel Handoff — daily-load guards, lift/cardio fixes, green test suite

Covers the most recent block of work (after `Duravel_Handoff_coach-inline-edit.md`).
Everything below is committed on `main` and deployed to duravel.app.

---

## 1. Daily-load guards (engine)

Two structural rules added to `lib/engine/sequencing.ts`, called from the
`if (counts.researchLifts)` block in `lib/engine/slots.ts` (so they apply to
band HYROX/DEKA programs and the golden oracle stays byte-identical):

- **Rule #1 — max 2 workouts/day.** `capSessionsPerDay(days, protectedDays, max=2)`
  relocates any 3rd+ session on a day to the emptiest eligible day (moves cardio
  / easy runs first; keeps lifts and the long run put; never lands a 2nd lift on
  a day; never uses a preferred rest day).
- **Rule #2 — runs spread before doubling.** `spreadRuns(days, protectedDays)`
  moves a stacked run onto a run-less training day until every day has one, so
  runs never double up while some days have none.

Order in the block: `separateLifts → pairLegLiftWithCardio → spreadRuns →
capSessionsPerDay`.

## 2. Program view — training-time tiles

`components/program/week-card.tsx` header now shows **Strength time** and **Total
training** alongside Cardio time / Running mileage, via `weekTimeByCategory(week)`
in `lib/session-volume.ts` (strength = lift minutes @ flat 60/session; total =
strength + running + hybrid + non-running cardio). Display-only; updates live with
coach edits.

## 3. Fixes that followed (important)

- **Build fix — `sessionMovability`** referenced `s.kind === "cardio"`, but the
  engine's `SessionSlot` union has no `cardio` kind (cardio is added later by the
  reconciler). `tsc` rejected it on Vercel. Removed that branch.
- **Lift-doubling fix (the big one).** Two "Full body lift" sessions were landing
  on the same day in dense Peak weeks. Root cause: `pickNoLiftDay` treated
  "keep a hard-leg lift off / not-before a key run" as a HARD veto — in a Peak
  week nearly every day is key-run-adjacent, so the extra lift found no home and
  stayed. Fixed: key-run adjacency is now a **penalty in the score**, not a veto,
  so the no-two-lifts rule always wins and the extra lift always relocates.
  Regression test added (`sequencing-guards.test.ts`).
- **Cardio cap-aware placement.** `lib/generation/reconcile.ts` placed added
  cardio / easy-run blocks on `leastLoadedDay`, which could stack a 3rd session
  onto a day once every day had 2. New `leastLoadedUnderCap(days, cap=2)` places
  them on the least-loaded day *with room under the cap*, only exceeding 2 when
  every day is already full (unavoidable). Count-preserving — weekly mileage /
  cardio totals unchanged, reconcile tests still hold.
- **Test suite green — `lib/admin.test.ts`.** It imports `./admin`, which imports
  the strict `lib/env.ts` validator that throws on missing required env outside
  the build phase — Vitest didn't set them. Added placeholder env to
  `vitest.config.ts` (`test.env`: dummy SUPABASE URL/anon key + ANTHROPIC key).
  No production code touched; no test makes real network calls. That was the last
  failing test — the suite is fully green now.

## Files touched (this block)
- `lib/engine/sequencing.ts` — spreadRuns, capSessionsPerDay, softened pickNoLiftDay.
- `lib/engine/slots.ts` — wire the two new guards.
- `lib/engine/sequencing-guards.test.ts` — guard + dense-peak regression tests.
- `lib/generation/reconcile.ts` — leastLoadedUnderCap for added runs + cardio.
- `components/program/week-card.tsx` — Strength time + Total training tiles.
- `vitest.config.ts` — test env placeholders.

## Verify / deploy
    npm run build            # runs tsc — the ONLY step that type-checks (npm test does not)
    npm test -- -u           # -u regenerates band snapshots; golden stays green
    git add -A && git commit -m "..." && git push
    # then redeploy on Vercel

**Engine changes only affect newly built programs** — existing programs keep
their saved `program_data`. Hit **Recalculate** on a program (or generate fresh)
to pick up the lift/cardio day-cap fixes.

## Known edge / not-a-bug
With more lifts than available non-rest days (e.g. 4 lifts across 3 training
days), one day still holds two — mathematically unavoidable. Normal 5–7 day weeks
always spread.

## Optional follow-ups on the shelf (not built)
- **Coach-mode toggle** so the inline Edit chips only show when turned on (they
  currently appear on any program opened as an admin).
- Extend the daily-load guards to station-only **DEKA STRONG/ATLAS** (currently
  scoped to run-based HYROX / DEKA FIT-MILE-ULTRA).
- Reverse sync in the session editor (edit duration → back-calculate distance).

## Process reminders (bit us this session)
- Run `npm run build` locally before pushing — `npm test` (Vitest/esbuild) does
  not type-check, so type errors slip through to the Vercel build.
- After build passes, it's `git push` **and a redeploy** that make changes live —
  a local build alone doesn't ship.
