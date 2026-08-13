# Duravel Handoff — 2026-08-04 8:33pm CT

## STATUS: patch 13 APPLIED to the worktree, md5-verified (11/11 files), **NOT committed**. Base `2da2e7f`.

**919/919 vitest · `tsc` clean · `next build` clean · golden-HYROX skeleton byte-identical.**
`.git/index.lock` absent (never created — no git command was run on the device beyond `git apply`).

```
_to_delete/session13-0805.patch    patch 13  equipment-aware exercises + currentDaysPerWeek → starting volume
```

```
cd C:\dev\duravel
git add lib app
git commit -m "engine: prescribe only lifts the athlete can do; pitch starting volume to their real training frequency"
git push
```

⚠️ **Generation-time. Existing programs need a RECALCULATE to pick either of these up.**

---

## What this session shipped — backlog #4, both halves

Two onboarding fields — `equipment` and `currentDaysPerWeek` — were **collected, Zod-validated,
persisted to Supabase, and read by absolutely nothing.** Onboarding made a promise under each one and
the engine never kept it. Both now do.

### A. Equipment-aware exercise selection

`pickExercise(pattern, weekNumber, equipment?)` in `lib/engine/strength.ts` replaces the raw
`EXERCISE_AB` lookup in `applyStrengthSchemes`.

- `EXERCISE_EQUIPMENT` — what each movement requires.
- `EXERCISE_FALLBACKS` — an ordered ladder per pattern, **every one of which ends in a bodyweight
  movement**, so there is no equipment profile that produces an unfillable slot.
- `canPerform()` / `isBodyweight()` / `usesBarbellBenchmark()`.
- The **A/B week rotation is preserved** — it now rotates among the variants the athlete can
  actually perform, rather than being abandoned as soon as a substitution happens.
- **No-op when `equipment` is absent or empty**, which is every existing program.

Two load bugs fell out of building it and are fixed:

- **Goblet Squat — 285 lbs.** `suggestedWeight` projected the athlete's *barbell* 5RM onto a dumbbell
  variant. `usesBarbellBenchmark()` now gates that; a non-barbell movement gets a percentage-free
  prescription instead of a fantasy number.
- **Bodyweight-only athletes were prescribed "Barbell Bent-Over Row"** — the horizontal-pull ladder
  had no bodyweight terminus at all. Added *Prone Y-T-W Raise*.

Verified across three profiles: full gym unchanged (byte-identical); dumbbells+bench → Goblet Squat /
Dumbbell Bench Press / Band Lat Pulldown; bodyweight-only → all bodyweight, no loads printed.

### B. `currentDaysPerWeek` → starting volume

`startVolumeReadiness(currentDaysPerWeek, targetDays)` in `time-budget.ts`, consumed by a new shared
`seedStartVolume()` in skeleton.ts (which also **de-duplicates** the start-volume block that had been
copy-pasted between the race-block and general-fitness paths) and by the triathlon builder's `baseH`.

```
factor = 0.8 + 0.2 x (current / target)      0 of 6 -> 0.80    3 of 6 -> 0.90    6 of 6 -> 1.00
```

- **Never scales UP.** Training more days than you committed to does not buy extra week-1 volume.
- **No-op when the field is blank** — which is what keeps the golden-HYROX oracle byte-identical.
- **An explicitly typed `startMileage` / `startCardioMinutes` is never adjusted.** The athlete's own
  number is a measurement, not an estimate.

| band | ready athlete wk1 → peak | detrained (0 days/wk) wk1 → peak |
|---|---|---|
| h0_5  | 10.0 mi / 180 min → 240  | 8.0 mi / 144 min → 204 |
| h5_10 | 20.0 mi / 360 min → 479  | 16.0 mi / 288 min → 383 |
| h10_20| 37.0 mi / 666 min → 886  | 29.6 mi / 533 min → 709 |
| h20_30| 48.0 mi / 1080 min → 1437| 38.4 mi / 864 min → 1150 |

#### 🔎 The non-obvious part — why the floor is 0.8 and not 0.6

I built this at 0.6 first and it was **wrong**, in a way worth recording because it will bite anyone
who touches this constant.

**The microcycle progression is MULTIPLICATIVE.** `increaseCardioStep` grows the *current* value by
10%. So a discount applied at week 1 is still there, proportionally, at the peak. It is not a ramp
that heals — it is a haircut on the entire block. At 0.6, an athlete who selected **5–10 hours** and
declared 0 current training days peaked at **287 min/wk = 4.8 hours** — *outside the band they chose,
below its floor.* They'd have paid for 5–10 hours and been sold 0–5.

The constraint that fixes the number: **a fully-detrained athlete must still finish the block
training more than the band's own week-1 prescription** — 12 weeks of work has to leave them fitter
than the band's starting point, in every band. 0.75 misses that line at h5_10 by **one minute**
(359 vs 360). 0.8 is the nearest clean number that clears it everywhere. This is pinned by a test
(`start-readiness.test.ts`, "leaves a fully-detrained athlete peaking above their band's starting
volume") so the next person to tune the constant gets a failure, not a silent under-delivery.

Onboarding copy for both fields was rewritten from placeholder ("we'll factor it in as this feature
rolls out") to what actually happens now.

---

## ▶️ BACKLOG — everything still open, in the order I'd take it

### 1. 🟡 Legacy bandless programs land short — **needs Levi's call**
63% of weeks on programs generated before `weeklyHours` existed land ≥15 min under prescribed cardio,
because they bypass every band rule on recalculate (`weeklyHours` is required for new programs but
optional in the schema so old snapshots still parse). The fix is to **back-fill a band from the stored
volume** on load. I did not do it unilaterally: it silently changes existing athletes' programs the
next time they recalculate. **Your call — back-fill, or leave legacy programs frozen as-is?**

### 2. 🟡 `assignDays` still places sessions without consulting the caps
The 2/day rule is enforced downstream (`capSessionsPerDay`) rather than at assignment. It is correct
today — 0 violations across the audits — but it is correct by cleanup, not by construction. Moving the
cap upstream into assignment is the durable version.

### 3. 🟡 `applyPostBRaceRecovery` bluntly rearranges the front of the week after a B race
Pre-existing, untouched all session. Low blast radius, but it ignores day preferences when it does it.

### 4. 🟠 iOS Parts 1–7 — generated, never integrated
They sit in `C:\dev\duravel\Apple\` and have never been wired or built. The folder is also messy —
there's a nested `Apple\Apple\`. This is the largest single piece of unshipped work in the repo and it
needs a decision about whether it's the next real push or gets parked.

### 5. 🟠 Lifecycle email system — built, gated off
Complete and tested behind `EMAIL_ENABLED`, which is unset. Turning it on is a product decision (and a
deliverability setup), not an engineering one.
⚠️ **Same env-var hazard as `STRAVA_WRITE_ENABLED`:** `BILLING_ENABLED` is still read with the old
strict parser. `STRAVA_WRITE_ENABLED=TRUE` read as *off* for a full deploy cycle before Levi's
screenshot caught it. `envFlag()` exists now — **`BILLING_ENABLED` should be moved onto it before it
costs a billing incident.**

### 6. 🔵 Backlog #17 remainder
- **hyresult.com scraping** — blocked on a legal/ToS read. Levi's call, not an engineering one.
- **Push notifications** — infrastructure decision: native iOS lane vs. web-push. Gated on #4.

### 7. 🔵 h30_40 delivery for triathlon
Station-hybrid no longer offers 30–40h, so this is now triathlon-only, and the tri builder's
`fitTriSlotsToTarget` handles it. Worth one audit pass to confirm the top tri band lands on target
before anyone sells it.

---

## Process notes

- **NEVER run `git add`/`commit`/`status` on the device from a cloud session.** Each leaves a
  `.git/index.lock` the bridge cannot unlink. `git apply` is the exception worth making; its
  `unable to unlink … Operation not permitted` warnings are harmless (files land correctly). This
  session created no lock at all.
- Always md5-compare **both sides** after applying. 11/11 matched here.
- Deterministic audits — `buildSkeleton(input)` / `assembleProgram(skeleton, [], …)` with empty
  chunks — produced every number above in under a second each. It is still the fastest bug-finder in
  the repo, and it is what caught the multiplicative-discount error before it shipped.
- Run `prettier --write` on touched files **before** generating the patch, or the next patch carries
  reflow noise from unrelated code.
- `_to_delete/` now also holds `session13-0805.patch`.
