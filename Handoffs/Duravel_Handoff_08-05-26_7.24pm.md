# Duravel Handoff — 2026-08-05 7:24pm CT

## STATUS: patch 20 APPLIED to the worktree, md5-verified (5/5), **NOT committed**. Base `fd4b58b`.

**950/950 vitest · `tsc` clean · `next build` clean.**
`.git/index.lock` absent.

```
_to_delete/session20-0806.patch   assignDays caps upstream — separateLifts is cap-aware by construction
```

```
cd C:\dev\duravel
git add lib
git commit -m "engine: no pass ever puts a third session on a day (separateLifts swaps instead of stacking)"
git push
```

⚠️ This commit **moves the golden-HYROX oracle** (approved this session). See §3.

---

## 0. Patch 19 was already committed + pushed

`fd4b58b` — *"strava: the auto-post uses the same title and workout description as the manual
button"* — is on `main`. The worktree was clean when this session started.

**Still unverified:** log a workout on the live site and confirm the auto-created Strava activity
comes through as `Week N - Day - Workout Name`. That is the last untested path in the Strava feature
and it did not get done this session.

## 1. 🔬 The audit: `separateLifts` was the ONLY pass that broke the 2-a-day rule

Open since Aug 4: *"`assignDays` places sessions without consulting the caps — correct today by
downstream cleanup, not by construction."* Nobody had ever measured WHICH pass.

Instrumented `assignDays` with a probe fired after every pass, then swept
**4 sports × 5 bands (incl. legacy no-band) × 3 experience levels × 7 day-sets × 7 preference
shapes = 2,940 programs / 47,040 weeks**:

```
worst day at ANY stage: 3 sessions, first seen after separateLifts

--- over-cap days INTRODUCED, by pass ---
  10675  separateLifts
      0  everything else
```

Every other mover — `forceSessionOn`, `placeSessionOn`, `dealLiftsOnto`, `applySequencingGuards`,
`spaceHardRunAfterLongRun`, `pairLegLiftWithCardio`, `spreadRuns`, `separateLiftDays`,
`fillEmptyDays`, the round-robin itself — was **already** cap-safe. They all swap or check load
before pushing. `separateLifts` alone called `days[target].sessions.push(lift)` with no load check,
and left `capSessionsPerDay` to sweep up.

Two passes run in between (`pairLegLiftWithCardio`, `spreadRuns`), so they were making their
decisions against a week that was illegal at that moment.

## 2. ✅ The fix — one pass, by construction

`lib/engine/sequencing.ts`:

- **`giveBackIndex(days, srcIdx, destIdx, incomingIsLegLift)`** — what the destination hands BACK to
  the source day when it is already at two. Never a rest slot, never a race, never the long run,
  **never a lift** (the source is keeping a lift of its own — sending one back rebuilds the very
  two-lift day we are breaking up), and **never the destination's last cardio** when a hard-leg lift
  is moving in (`pairLegLiftWithCardio` runs next and needs it). Ties break to `sessionMovability`,
  with penalties so a quality run isn't stacked onto a source day that already has one, or dropped
  the day after heavy legs.
- **`pickNoLiftDay`** — a full day is now a candidate **only if `giveBackIndex` finds something**,
  and full days are scored below days with room (a swap is churn).
- **`separateLifts`** — trades instead of stacking; when nothing legal can come back, the day simply
  isn't a destination.

After: **worst day at any stage = 2, across all 47,040 weeks.** Sessions created/dropped: 0.

New test `lib/engine/separate-lifts-cap.test.ts` (5 cases). **3 of the 5 fail on `main`** — verified.

## 3. ⚠️ The golden oracle moved (Levi approved)

24 of the 100 fixture weeks re-arrange. **No week changes its session COUNT** — only which session
sits on which day. `-u` applied; `lib/ai/__snapshots__/prompts.test.ts.snap` moved with it (one
prompt line).

The evidence that made this safe, from re-running the whole sweep restricted to combos an athlete
can **actually onboard today** (band set AND the band's minimum training days honoured):

| metric (72,576 days / 12,096 weeks) | main | patched |
|---|---|---|
| days over 2 sessions | 0 | 0 |
| days with 2 lifts | 0 | 0 |
| days with 2 quality runs | 0 | 0 |
| leg lift before a key run | 5,411 | 5,411 |
| leg-lift day with no cardio | 15,407 | 15,407 |
| empty days | 9,926 | 9,926 |
| total sessions | 67,445 | 67,445 |

**Byte-identical for every athlete who can sign up today.** All drift lives in the legacy path.
Across ALL combos including legacy the only movement is **+28 days carrying two quality runs, out of
201,600** (0.014%); everything else identical.

Every golden fixture predates `weeklyHours`, so all six take the legacy no-band path — which is
exactly the path that plans a week denser than the day count can hold. That is why the fixtures moved
and live athletes did not. Rationale is written into the header of `golden-hyrox.test.ts` (2nd
deliberate move; the first was 2026-08-05 for the 2-a-day trim).

## 4. 🟡 Found on the way: 504 two-lift days that survive — and why

Across the widest sweep, 504 days ship with two weight sessions. **Every one is a `h20_30` band with
a 4-day week** — a combination `BAND_MIN_TRAINING_DAYS` forbids (10–20/20–30 h requires 7 days).
The band minimum is enforced in the onboarding form and in `app/onboarding/actions.ts`, but
**`toEngineInput` does not clamp the day count** the way it clamps the band for
`MAX_BAND_BY_FAMILY`. So a program saved before that rule regenerates an impossible week on
recalculate: more lifts than lift-free days exist.

Patch 20 does not change this (504 before, 504 after) — it just stops the engine thrashing over it.

**Levi's call, same class as the legacy-band back-fill you deferred on Aug 4:** clamp
`trainingDays` up to `bandMinTrainingDays(band)` in `toEngineInput`, which silently changes existing
athletes' programs on their next recalculate — or leave legacy programs frozen. Both are one-liners
in the same function; neither should be done unilaterally.

## ▶️ NEXT
1. Commit + push patch 20, then **log a workout** and confirm the Strava auto-post title format —
   still the last unverified path in the Strava feature (carried over from patch 19).
2. Decide §4: clamp legacy day counts, or leave frozen.
3. `applyPostBRaceRecovery` bluntly rearranges the front of the week.

## 🟡 STILL OPEN
- Legacy day-count clamp (§4) + the legacy band back-fill — both need Levi.
- `applyPostBRaceRecovery` ignores day preferences when it rearranges.
- Triathlon h30_40 delivery audit.
- iOS parked — no Xcode project, needs a Mac + Apple enrollment, MANIFESTs point at a dead `hyroxai/`.
- Lifecycle email: code ready, needs `EMAIL_ENABLED` + `RESEND_API_KEY` + DNS.
- `BILLING_ENABLED` still uses the old strict env parser — move it onto `envFlag()`.
- hyresult: price hyroxresultapi.com / the Apify scraper before building one.

## Process notes
- **The probe-every-pass audit is the technique worth keeping.** Adding a `__setCapProbe` hook to
  `assignDays` and diffing the violation count between passes turned a vague year-old backlog item
  ("caps aren't consulted upstream") into one named function and an exact count in about ten minutes.
  Metric sweeps over `buildSkeleton` are cheap — 47,040 weeks runs in under a second.
- **Run the sweep twice: all combos, and onboarding-legal combos only.** That split is what turned an
  unreviewable golden diff into an approvable one. Without it the change looks like a broad
  regression; with it, it is provably zero-impact for real athletes.
- Cloud clone `git clone https://github.com/leviloveless/Duravel.git` + `npm install` ≈ 2 min, no
  auth. `/tmp/base` = pristine `main`, `/tmp/dv` = patched — run the same metric test in both.
- Never run `prettier --write lib/` — format edited files BY NAME.
- `git apply` on the device is still the only git command safe from the cloud; its
  `unable to unlink … Operation not permitted` warnings are harmless and no lock was left.
