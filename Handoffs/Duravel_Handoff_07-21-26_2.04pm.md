# Duravel Handoff — 07-21-26 2.04pm

## Session focus
Shipped **Phase 0** of the volume-vs-intensity engine work + the **public Science page/white paper** + a **comprehensive nav**. All written to the repo working tree (not yet git-committed; not pushed). **Must be verified on-computer** — the cloud device VM can't run the Windows-installed test binaries (missing `@rollup/rollup-linux-x64-gnu`).

## ⚠️ Before pushing — run locally
```
npm run typecheck
npm test            # MUST stay green incl. golden-hyrox (byte-identical)
npm run build       # exercises the new /science routes
```
If golden-hyrox drifts, something in the engine path changed unexpectedly — investigate before committing.

## What changed (all in working tree)

### Phase 0 — weekly-hours input plumbed (golden-safe, opt-in)
- `lib/schemas.ts` — added `tri_olympic` to `Sport`; added `WeeklyHours` enum (`h0_5|h5_10|h10_20|h20_30|h30_40`) + `WeeklyHoursBand` + `WEEKLY_HOURS_MIDPOINT`; added **optional** `weeklyHours` to `ProfileSchema` (optional = existing snapshots parse + golden path unaffected).
- `lib/engine/types.ts` — added optional `weeklyHours?: WeeklyHoursBand` to `EngineInput`.
- `lib/engine/skeleton.ts` — `toEngineInput` now carries `weeklyHours` through. **`buildSkeleton` does NOT consume it yet** → HYROX output byte-identical (verified against `golden-hyrox.test.ts`, which snapshots `buildSkeleton` and builds `EngineInput` without the field).
- **Required for NEW programs at the UI/action layer** (not the schema): `app/onboarding/actions.ts` rejects submit if `weeklyHours` missing; `app/onboarding/onboarding-form.tsx` adds the required question on Step 3 ("Schedule & goal") with per-sport athlete-level + tradeoff copy (report §6.3–6.7) and a validation gate.
- Engine consumption of the band (volume + intensity-distribution scaling) is **Phase 1+** — deliberately NOT done here.

### tri_olympic — new sport (fully wired)
- `lib/engine/sports/triathlon.ts` — `tri_olympic` SportConfig (Olympic distances, per-discipline volume keyed `olympic:level` [4–8/6–10/8–12 h], short-course zone mix, added to `TRI_SPORTS`).
- `lib/engine/sports/index.ts` — imported/exported/registered in `SPORTS`.
- `lib/engine/ironman/index.ts` — `distanceKey` maps `tri_olympic → "olympic"`; added `RACE_BIKE_MILES.olympic = 24.8` and `LONG_RUN_CAP.olympic`.
- `onboarding-form.tsx` — added to `SPORT_OPTIONS` + `isTriathlon`.
- **Verify on-computer:** run the triathlon test suite; add a `tri_olympic` case if desired. DEKA ATLAS/ULTRA intentionally NOT given bespoke time-budget tables (fall back to generic copy) per Levi.

### Website
- `components/nav-bar.tsx` — comprehensive nav. Public: Science, Tools, Coaching, Impact, Pricing (+ Log in). Signed-in: Dashboard, New program, Activity, Science, Settings (+ Sign out). Mobile `<details>` disclosure (still a server component, no client JS).
- `app/science/page.tsx` — public methodology page (benefit-framed: 3 findings, "how Duravel uses this," honesty/limits) + embedded explorer + CTAs.
- `app/science/volume-intensity/page.tsx` — full **public** white paper (7 sections + references). NO engine spec, NO proprietary parameter tables (moat kept private).
- `components/science/time-budget-explorer.tsx` — client widget: pick sport + hours band → athlete level + tradeoff + qualitative intensity emphasis.
- `public/duravel-training-science.pdf` — downloadable public methodology (linked from both science pages at `/duravel-training-science.pdf`).

## Design/architecture notes
- 5-zone engine model (`z1..z5`); report uses Seiler 3-zone. Mapping for Phase 1: Seiler-Z1→z1+z2, Z2→z3+z4, Z3→z5. Recommend a monotone transform on existing `phaseZoneTargets`, not per-band tables.
- Email-gating of the PDF was NOT built (would need a lead-capture route/Resend wiring + testing); PDF is a direct public download for now. Fast-follow: mirror the DekaFit capture to gate it.
- Reference docs from prior session live in `docs/research/` (also untracked).

## Open follow-ups
- Phase 1: build `lib/engine/time-budget.ts` (band→volume + zone transform) + unit tests, then wire consumption sport-by-sport with new per-(sport,band) golden fixtures.
- Consider adding a `tri_olympic` snapshot/test.
- Optionally prefill `weeklyHours` in edit mode from `input_snapshot` (currently the edit form requires re-selecting it).
- Add a "Load/Intensity Time-Budget" lane to `Duravel_Roadmap_Planned_vs_Actuals.html`.
