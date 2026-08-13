# Duravel Handoff — 2026-08-04 1:56am

## Real bug found + fixed: full-body lifts could still land on consecutive days (push pending)

`f7891c6` **engine: guarantee full-body lifts are never on consecutive days**
— committed to `main` on top of `d1019cd`; **PUSH PENDING (Levi runs `git push origin main`).**

### How it surfaced
While verifying on the live deploy, Levi's "Fall prep" program (HYROX, 10–20h budget,
advanced lifting) showed **two full-body lifts on Tue + Wed** in weeks 1/2/4/5. A
Recalculate did NOT fix it, so it was a genuine engine gap, not a stale program.

### Root cause
With an hours budget + advanced lifting the RESEARCH heavy/power split fires
(`counts.researchLifts`, skeleton.ts). A 3-lift week = `researchLiftSplit(3)` =
`[full, power, full]` → **two full-body lifts**. Two failure paths left them adjacent:
1. The two fulls were dealt onto adjacent lift days (Tue+Wed); `separateLiftDays` could
   only relocate a lift to a FREE day, which fails when every non-lift day is protected
   (long run Sat/Sun, weekend hybrid, key runs) → it gave up (best-effort).
2. `applyPostBRaceRecovery` (runs AFTER assignDays) re-homes the displaced lifts onto the
   emptiest later days without spacing logic → stacked fulls on Fri+Sat in the weeks
   after a B race.
(My earlier verification missed this because those test programs had only ONE full
lift/week — I hadn't set `weeklyHours`, so the research split never fired.)

### Fix — `spreadFullLiftTypes` (lib/engine/sequencing.ts)
Instead of MOVING a lift (needs a free day), it RELABELS which existing lift day carries
the heavy "full" vs the lighter power session — count-preserving, no day move — choosing
the full days to maximize the minimum calendar gap (never consecutive if avoidable, >=2
days apart when possible). No-op when the fulls are already spaced, so already-valid weeks
+ the golden fixtures stay byte-identical. Called (a) at the start of `separateLiftDays`
and (b) after `applyPostBRaceRecovery` re-homes (skeleton.ts) to catch the post-B-race path.

### Verified
- Wide scan (5 hour-bands × 3 lifting-exps × 2 classes × 6 lift-day sets × 3 race sets):
  **2820 two-full weeks, 0 consecutive-full violations** (was 60 before the post-B-race
  call; 4 for the exact Fall-prep config).
- New regression tests in `lib/engine/lift-spacing.test.ts` (single-A + multi-race-with-B
  + "keeps 2 fulls, spreads not deletes"). **830/830 vitest pass**, `tsc` clean.
- `time-budget-skeleton` snapshots updated: verified PURE full<->power relabel (74 full +
  74 power on each side; no `kind` changes, no other field) — composition/volume unchanged.
- md5 `811ff614…` matched device-side.

### Existing programs
This is generation-time, so EXISTING programs keep their old lift layout until
**Recalculate**. Fall prep needs a Recalculate (after this pushes + deploys) to pick up
the spacing.

## TO DO (Levi)
1. **`git push origin main`** (pushes `f7891c6`; also `d1019cd` if not already up).
2. After deploy, **Recalculate "Fall prep"** — Tue+Wed double-full should become Tue-full /
   Wed-power / Fri-full (fulls >=2 days apart).
3. Delete `_to_delete/` when convenient (rm blocked over the bridge; patches moved there).

## Known latent (still NOT fixed, pre-existing)
`applyPostBRaceRecovery` overwrites the first 3 training days of the week after a B race
and re-homes their sessions — a blunt pass. We now re-spread full lifts after it, but the
broader "it rearranges the whole front of the week" behavior remains as before.
