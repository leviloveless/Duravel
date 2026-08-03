# Duravel — Consolidated Handoff (through 07-28-26, 5.51pm)

> **Single source of truth** consolidating three work blocks: today's INP/Recalculate
> fix, the C-race day/mileage fixes, and the daily-load guards + lift/cardio fixes.
> Supersedes `Duravel_Handoff_07-28-26_1.14pm.md` and `Duravel_Handoff_daily-load-and-fixes.md`
> (both moved to `_to_delete/`).
>
> **Status:** all three blocks are committed to `main` and deployed to duravel.app unless noted.

## Contents
1. INP / Recalculate confirm fix — 07-28-26, 5.51pm (latest)
2. C-race day + mileage fixes — 07-28-26, 1.14pm
3. Daily-load guards, lift/cardio fixes, green test suite
4. Consolidated open items & follow-ups
5. Process reminders

---

## 1. INP / Recalculate confirm fix — 07-28-26 (latest)

**Problem.** Vercel flagged an INP (Interaction to Next Paint) issue on the program
**Recalculate** button — event handlers blocked UI updates for ~1,545 ms.

**Root cause.** Both Recalculate handlers used the native `window.confirm()`, which is a
**synchronous, main-thread-blocking dialog**. INP measures interaction-to-next-paint, so
the entire time the confirm box sat open (human reaction time) was charged to the click as
blocked UI. Not an engine/compute problem — the recalc itself is an async server action
(`/api/generate`) and never blocks paint.

**Changes.**
- `app/program/[id]/regenerate-button.tsx` (user-facing) — replaced `window.confirm` with
  the two-step inline-confirm pattern already used in `app/dashboard/delete-program.tsx`:
  click Recalculate → inline "Replace current sessions? / Yes, recalculate / Cancel" row.
  Spinner, error text, and `rounded-full` styling preserved.
- `components/admin/admin-program-controls.tsx` (admin recalc-on-behalf) — same treatment;
  kept on `useTransition`.
- Confirmation UX only; recalc behavior unchanged. No `window.confirm(` calls remain in
  `app/` or `components/`.

**Verify / deploy.** `npx tsc --noEmit` clean. Committed to `main` and pushed from Levi's
local terminal — the cloud Cowork sandbox has no git identity and no network route to
GitHub (push returns `403 from proxy`), so git had to run locally:
```
git commit -m "fix(perf): replace blocking window.confirm on Recalculate with inline confirm"
git push origin main
```
Vercel auto-deploys on push; re-click Recalculate on a live program to confirm the INP
number drops on the new deployment.

---

## 2. C-race day + mileage fixes — 07-28-26 1.14pm

Fixed two bugs affecting **C ("tune-up") races** in generated programs. Reported on program
`a446a749-3099-4f31-a0a5-aeefd0c4048c` ("Fall Prep", 16-wk goal event): a C race set for
**Sat 2026-09-19** rendered on **Sun 09-20**, and week 7 showed **21.2 running miles**
(vs ~12.5 in wk 1). A and B races were unaffected.

**Root causes.**
1. **Wrong race day (off-by-one).** `lib/engine/slots.ts` `assignDays()` always placed the
   race on the **last training day** of the week (`days[days.length-1]`), ignoring the real
   `race.date`. Levi trains all 7 days, so a Saturday race landed on Sunday. A/B looked fine
   only because those races fall on his last training day (Sunday).
2. **Inflated mileage.** `lib/generation/reconcile.ts` `reconcileWeekVolume()` did
   `if (hasRace) return;`, skipping mileage normalization for ANY week with a race. A/B are
   near-empty taper weeks so this was harmless, but a C race "trains through" a FULL week
   (`lib/engine/taper.ts` leaves volume untouched) — so the AI's unclamped run distances
   were never sized to the engine target.

**Changes.**
- `lib/engine/slots.ts`: added `raceDayIndex(days, isoDate)` — places the race on the
  training day matching `race.date`'s weekday (parsed LOCAL, like the calendar display).
  Falls back to the last training day when no date is given (engine week-space fixtures) or
  the weekday isn't trained → **golden snapshots stay byte-identical** (their races carry no
  `date`).
- `lib/generation/reconcile.ts`: skip reconciliation only for **A/B** races; **C** races now
  reconcile to the engine target. Race days are protected from added run/cardio blocks
  (`isRaceDay` guard in `leastLoadedDay`/`leastLoadedUnderCap`).
- Tests: new `lib/engine/slots.test.ts` (6) + expanded `lib/generation/reconcile.test.ts`
  (C-race case).

**Verification.** `vitest run lib/engine lib/generation` → **41 files, 457 tests, all pass**
(incl. golden-hyrox + time-budget-skeleton snapshots). Run in a cloud container (device
node_modules are win32; no linux rollup).

**Apply.** Engine changes affect **newly built programs only** — existing programs keep their
saved `program_data`. Hit **Recalculate** on the program to regenerate week 7 with the
correct day + mileage.

---

## 3. Daily-load guards, lift/cardio fixes, green test suite

Followed `Duravel_Handoff_coach-inline-edit.md`. Everything below is committed on `main` and
deployed to duravel.app.

**3.1 Daily-load guards (engine).** Two structural rules added to `lib/engine/sequencing.ts`,
called from the `if (counts.researchLifts)` block in `lib/engine/slots.ts` (so they apply to
band HYROX/DEKA programs and the golden oracle stays byte-identical):
- **Rule #1 — max 2 workouts/day.** `capSessionsPerDay(days, protectedDays, max=2)` relocates
  any 3rd+ session on a day to the emptiest eligible day (moves cardio / easy runs first;
  keeps lifts and the long run put; never lands a 2nd lift on a day; never uses a preferred
  rest day).
- **Rule #2 — runs spread before doubling.** `spreadRuns(days, protectedDays)` moves a stacked
  run onto a run-less training day until every day has one.
- Order in the block: `separateLifts → pairLegLiftWithCardio → spreadRuns → capSessionsPerDay`.

**3.2 Program view — training-time tiles.** `components/program/week-card.tsx` header now shows
**Strength time** and **Total training** alongside Cardio time / Running mileage, via
`weekTimeByCategory(week)` in `lib/session-volume.ts` (strength = lift minutes @ flat
60/session; total = strength + running + hybrid + non-running cardio). Display-only; updates
live with coach edits.

**3.3 Fixes that followed (important).**
- **Build fix — `sessionMovability`** referenced `s.kind === "cardio"`, but the engine's
  `SessionSlot` union has no `cardio` kind (cardio is added later by the reconciler). `tsc`
  rejected it on Vercel. Removed that branch.
- **Lift-doubling fix (the big one).** Two "Full body lift" sessions were landing on the same
  day in dense Peak weeks. Root cause: `pickNoLiftDay` treated "keep a hard-leg lift off /
  not-before a key run" as a HARD veto — in a Peak week nearly every day is key-run-adjacent,
  so the extra lift found no home and stayed. Fixed: key-run adjacency is now a **penalty in
  the score**, not a veto, so the no-two-lifts rule always wins and the extra lift always
  relocates. Regression test added (`sequencing-guards.test.ts`).
- **Cardio cap-aware placement.** `lib/generation/reconcile.ts` placed added cardio / easy-run
  blocks on `leastLoadedDay`, which could stack a 3rd session onto a day once every day had 2.
  New `leastLoadedUnderCap(days, cap=2)` places them on the least-loaded day *with room under
  the cap*, only exceeding 2 when every day is already full (unavoidable). Count-preserving —
  weekly mileage / cardio totals unchanged, reconcile tests still hold.
- **Test suite green — `lib/admin.test.ts`.** It imports `./admin`, which imports the strict
  `lib/env.ts` validator that throws on missing required env outside the build phase — Vitest
  didn't set them. Added placeholder env to `vitest.config.ts` (`test.env`: dummy SUPABASE
  URL/anon key + ANTHROPIC key). No production code touched; no test makes real network calls.
  That was the last failing test — the suite is fully green now.

**Files touched (this block).**
- `lib/engine/sequencing.ts` — spreadRuns, capSessionsPerDay, softened pickNoLiftDay.
- `lib/engine/slots.ts` — wire the two new guards.
- `lib/engine/sequencing-guards.test.ts` — guard + dense-peak regression tests.
- `lib/generation/reconcile.ts` — leastLoadedUnderCap for added runs + cardio.
- `components/program/week-card.tsx` — Strength time + Total training tiles.
- `vitest.config.ts` — test env placeholders.

**Known edge / not-a-bug.** With more lifts than available non-rest days (e.g. 4 lifts across 3
training days), one day still holds two — mathematically unavoidable. Normal 5–7 day weeks
always spread.

**Apply.** Engine changes only affect newly built programs — existing programs keep their saved
`program_data`. Hit **Recalculate** (or generate fresh) to pick up the lift/cardio day-cap fixes.

---

## 4. Consolidated open items & follow-ups

**Deploy / apply state.**
- INP fix (§1) — pushed and deploying; Recalculate to confirm INP drop.
- C-race fixes (§2) — committed/deployed; Recalculate affected programs to regenerate with
  the correct race day + mileage.
- Daily-load / lift-cardio (§3) — live on `main`; Recalculate (or generate fresh) to apply.

**On the shelf (not built).**
- **Coach-mode toggle** so inline Edit chips only show when turned on (they currently appear on
  any program opened as an admin).
- Extend the daily-load guards to station-only **DEKA STRONG / ATLAS** (currently scoped to
  run-based HYROX / DEKA FIT-MILE-ULTRA).
- Reverse sync in the session editor (edit duration → back-calculate distance).
- A/B races share the same last-day placement path; they only looked correct because they fall
  on Levi's last training day. The `raceDayIndex` fix corrects them generally — worth a targeted
  confirm.

**Cleanup.** `_to_delete/lib-src.tgz` (scratch tarball from the C-race work) can be deleted.

---

## 5. Process reminders (bit us before)

- Run `npm run build` locally before pushing — `npm test` (Vitest/esbuild) does **not**
  type-check, so type errors slip through to the Vercel build. (`npx tsc --noEmit` also works
  for a quick check.)
- After build passes, it's `git push` **and a Vercel redeploy** that make changes live — a
  local build alone doesn't ship.
- Git can't be pushed from the cloud Cowork session (no network / no GitHub credentials) — run
  commit/push from a local terminal, or start the task "on your computer" in the desktop app.
- Engine changes only affect newly built programs — existing programs keep their saved
  `program_data`; hit **Recalculate** to apply.
