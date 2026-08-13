# Duravel Handoff — 2026-08-06 7:46pm ET

## STATUS: patch 26 PUSHED (`c946d63`) + VERIFIED LIVE. Patch 27 APPLIED, md5-verified 3/3, **NOT committed**.

**1016/1016 vitest · `tsc` clean · `next build` clean · GOLDEN-HYROX SNAPSHOT UNMOVED.**

```
_to_delete/session27-mileage-floor.patch
```

```
cd C:\dev\duravel
git add lib
git commit -m "reconcile: no session below its own minimum, and the stated mileage is the mileage delivered"
git push
```

**No migration.** Three modified files, no new ones, so a plain `git apply` was enough this time.

---

## 1. ✅ Patch 26 verified — banner back to (2)

Migration 0042 + the ingest hook landed; the two Duravel-posted runs are no longer offered as link
candidates. Only the two genuine third-party activities remain.

## 2. 🔴 THE 17% FINDING WAS NOT WHAT IT LOOKED LIKE

Levi's standing item was "90 of 540 weeks land over their stated mileage". Measured properly across
**675 non-race weeks** (5 bands × 3 experience × 3 day-sets × 16 weeks), the over-target number is a
SYMPTOM. The disease:

> **196 runs — 8.3% of every run the engine writes — shipped BELOW their own documented minimum, in
> 29% of weeks. 160 of them were the LONG RUN. The worst was a "long run" of 0.3 mi / 13 minutes**,
> repeated across every day-set at h0_5 beginner.

That violated two rules Levi shipped himself: the 45-minute Zone 1–2 cardio floor (2026-08-04) and
`EASY_LONG_MIN_MI = 3`.

### Mechanism — THREE places dropped below the floor, not one

1. **`sizeRuns`' consolidation compared apples to oranges.** `RM` is a TOTAL-mile budget
   (`targetMileage` less the hybrid's total, overhead included) but it was tested against **work-only**
   minimums. Overhead is the dominant term: a beginner's interval session carries 25 min of
   warm-up/cool-down/recovery = **2.3 mi at 10:33/mi**; threshold 20 min = 1.9 mi. In the worst week
   **6.6 of 14.6 miles was overhead, against a 10.5-mile target.** So consolidation under-fired and the
   week kept three quality runs it could never pay for.
2. **The `RM <= sumMin` branch scaled BELOW the minimums**, flooring only at `MIN_RUN_MILES = 0.3` —
   the literal source of the 0.3-mile long run.
3. **The residual snap** at the end of `reconcileWeekVolume` added a (negative) residual to the longest
   run with NO floor, and clamped at 0.3 again.

`adjustRunMilesToTotal`, the obvious suspect, was INNOCENT — it already respects `minMiles`.

Also found: `buildEasyRuns` floored a leftover at `MIN_RUN_MILES`, manufacturing
"Easy run — 3 min — 0.3 miles" out of rounding dust.

### ⚠️ The near-miss worth reading

My first cut made `buildEasyRuns` return NOTHING when the leftover was too small to be a session.
That **silently lost up to 2.9 miles of a week's prescription** — the existing "generous targets"
sweep caught it. It now emits a real minimum-length run instead. **Under-target is 0 in the final
sweep, and there is a new assertion pinning exactly that.**

## 3. The fix, and what it costs

| | runs below minimum | weeks over target | weeks under |
|---|---|---|---|
| before | 196 (8.3%) | 99 (15%), worst +4.1 | 0 |
| reconciler fix only | **0** | 66 (10%), worst +4.2 | 0 |
| **+ target adopted (shipped)** | **0** | **0** | **0** |

The remaining 66 weeks were irreducible: **their stated mileage target was smaller than the smallest
real training week the engine can build for them.** So per Levi's call, `reconcileWeekVolume` now
RETURNS the mileage the week actually delivers and `assembleProgram` adopts it as that week's target.

- **Targets raised: 66 of 675 (10%), worst +4.2 mi.** All of it low-band — h0_5 39, h5_10 21,
  h10_20 6, and **zero** at h20_30/h30_40.
- **Plan-vs-calendar mismatch: 0.** The number the plan states is the number the week delivers.
- ⚠️ **The target is only ever RAISED, never lowered** — a week coming in short must stay visible as a
  bug, and there is a test asserting the returned value equals 20 for a roomy week.

### The conclusion that outlives this patch

**It was never a reconciler bug.** A 0–5 h/week athlete is handed the same three-quality-run
architecture as a 30 h/week athlete, and the fixed overhead of that architecture exceeds their entire
weekly mileage. No week breaches its band's MINUTE ceiling, so it is not a time problem — it is a
prescription problem. The engine was hiding it by shipping sessions that were not sessions; this
patch makes it honest. **Cutting quality-run overhead at low bands is still the deeper fix and has
not been done.**

## 4. Two tests changed — read before assuming they were bent

Both asserted the old invariant "weekly mileage is EXACT", which can no longer hold universally.

- **C-race week** now asserts `>= target`, that the returned value equals what is delivered, that the
  overshoot is under one session, and that every run is a real session.
- **"never removes or alters"** moves 14 → 21. That number has now moved twice (12.5 → 14 → 21), each
  time because the accounting got more honest. Its stated intent is "leave a week alone when there IS
  room"; the week costs ~20.1 mi at its minimums, so the target belongs above that. **Two new
  companion tests pin the other side** — one asserting consolidation DOES fire at 12.5 and that every
  survivor is a real session, one asserting the returned target rises but never falls. Neither side
  can drift again without a red test.

## ▶️ NEXT
1. Commit + push patch 27. No migration.
2. Spot-check a low-hours program on the live site — an h0_5 beginner should now show a real long run
   and a weekly mileage that matches its own header.
3. **Cut quality-run overhead at low bands** — the deeper fix (§3). 25 min of warm-up for someone
   training 5 h/week is questionable on its own terms.
4. Look at the Workout activity on Strava and confirm the `— Duravel · duravel.app` footer appears
   exactly once. **Still unverified from patch 25.**
5. Delete the three duplicate Run activities by hand on Strava (no API can).
6. Triathlon h30_40 audit — needs Levi's call.
7. Fix `CLAUDE.md`'s stale `hyroxai/` path; decide what to do about `app.duravel.app`.

## 🟡 STILL OPEN
- Patch 27 uncommitted.
- Quality-run overhead at low bands (the real cause).
- The patch-25 footer unverified on Strava; three orphan duplicates there.
- `app.duravel.app` resolves to no deployment — blocks the iOS shell as specced.
- The legacy BAND back-fill; 120 two-lift days on the bandless path.
- iOS parked; `notification_prefs.sql` declares a rival `timezone` column.
- Lifecycle email needs `EMAIL_ENABLED` + `RESEND_API_KEY` + DNS.
- `BILLING_ENABLED` on the old strict env parser.
- hyresult: price hyroxresultapi.com / the Apify scraper first.

## Process notes
- **A headline number can be the symptom of a worse, unstated bug.** "17% of weeks miss their target"
  sounded like an arithmetic nuisance. Measuring the SESSIONS rather than the totals found a
  13-minute long run on real athletes' calendars. When a metric looks off, audit the thing it is
  computed from, not just the metric.
- **Fix one leak, find the next.** The floor had three independent holes; each was invisible until
  the one before it was closed. Re-measure after every single change — the count went
  196 → 75 → 66 → 0, and each step revealed a different function.
- **A test that fails when you tighten an invariant is worth reading twice.** The "generous targets"
  sweep caught a 2.9-mile silent loss my own fix introduced. It was the only thing standing between
  that and production.
- **Prettier churn caught a SIXTH time**, and the pristine-clone check paid again:
  `reconcile.test.ts` already fails `prettier --check` on `main`, so the warning was not mine and the
  file was left alone.
- The golden-HYROX snapshot never moved because it snapshots `buildSkeleton` ONLY — it never calls
  `assembleProgram`. Worth knowing: engine-assembly changes are NOT covered by that gate.
