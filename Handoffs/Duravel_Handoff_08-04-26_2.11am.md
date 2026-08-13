# Duravel Handoff — manual pace overrides (push pending)

`32f1d99` **program: let athletes enter their own easy/threshold/interval/tempo paces**
— committed to `main` on top of `f7891c6`. **PUSH PENDING** — two commits unpushed now:
`f7891c6` (lift-consecutive fix) + `32f1d99` (this). `git push origin main` sends both.

## What it does (Levi's spec: all four paces, min/mile+min/km, override display + math, with disclaimer)
Optional manual pace entry on the onboarding Benchmarks step for easy / threshold / interval /
tempo. A filled pace REPLACES the VDOT-derived value for that run type and drives BOTH the
displayed pace AND the distance<->duration conversion that sizes weekly mileage. An easy override
also moves the long-run pace (Daniels L = E). Blank = keep the calculated value.

## Files / how it's wired
- `lib/engine/paces.ts` — `RaceInput` gains `easyPace/thresholdPace/intervalPace/tempoPace` +
  `paceUnit` ("mi"|"km"); new `applyPaceOverrides(paces, input)` runs at the end of `computePaces`.
  km entries convert to sec/mile (×1.609344). This is the SINGLE place overrides resolve, so every
  consumer (display + reconciler) agrees.
- `lib/generation/assemble.ts` — `assembleArgsFromInput` now threads the override fields into
  `raceTimes`. **This was the key gotcha:** it previously whitelisted only mile/5K/10K, which would
  have stripped the overrides so they'd affect display but NOT the mileage math.
- `lib/schemas.ts` — `BenchmarksSchema` carries the 4 pace strings + `paceUnit` enum.
- `app/onboarding/actions.ts` — reads them from formData into `benchmarksRaw`.
- `app/onboarding/onboarding-form.tsx` — "Know your paces? (optional)" card: 4 inputs, mi/km unit
  toggle (state `paceUnit`, submitted as `name="paceUnit"`), disclaimer that a manual pace overrides
  the model and drives volume. Prefills from saved/initial benchmarks.
- `components/program/vdot-card.tsx` — overridden paces get an amber "manual" badge + a footer
  disclaimer; page.tsx computes `manualPaces` flags from the snapshot benchmarks and passes them.

## Verified
- New unit tests in `lib/engine/paces.test.ts` (override replaces derived; easy moves long; km
  conversion; blank/invalid falls back; all-four at once). **835/835 vitest pass**, `tsc` clean,
  prettier clean. md5 `e7790ed3…` matched device-side.
- Applies to NEW programs (or a Recalculate). Existing programs without manual paces are unchanged.

## TO DO (Levi)
1. **`git push origin main`** (sends `f7891c6` + `32f1d99`).
2. After deploy: on a new program, fill e.g. Easy 10:00/mi (or 4.2 mph ≈ 14:17/mi if you convert —
   note the UI takes PACE min/mi or min/km, not mph) and confirm easy/long runs show that pace and
   the weekly mileage/ durations reflect it; the VDOT tab shows a "manual" badge.
3. Delete `_to_delete/` when convenient (rm blocked over the bridge; patches moved there).

## Note on your 4.2 mph example
You gave Zone 2 as 4.2 mph. The input takes a PACE (min per mile or per km), not mph. 4.2 mph ≈
14:17 min/mile. If you want the field to ALSO accept mph directly, say so — it's a small addition
(convert mph→min/mile on input). Current build: min/mile + min/km only, per your answer.
