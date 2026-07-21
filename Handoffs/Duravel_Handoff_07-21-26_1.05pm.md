# Duravel Handoff — 07-21-26 1.05pm

## Session focus
Volume-vs-intensity training-science research → engine implementation workplan + reference docs committed to the repo.

## What shipped this session

1. **Research report (PhD-level, ~11k words, 40+ sources):** volume vs. intensity training load for HYROX, DEKA, Olympic triathlon, 70.3, Ironman. Core thesis: training load is non-linearly intensity-weighted and NOT a single fungible number; intensity substitutes for volume for fast-adapting central traits (VO₂max/mitochondrial) but NOT for volume-gated traits (capillarization, fat oxidation, cardiac remodeling, economy, connective tissue, durability); substitution severity scales with event duration + training age. Includes 5-sport × 5-time-budget (5/10/20/30/40h) prescription matrices (tables 6.3–6.7) and an engine-integration spec (Part VII).
   - Delivered as `.md` (source), `.docx` (29pp), `.html` (interactive). Desktop artifact: `duravel-volume-intensity-research`.

2. **Engine Implementation Workplan** (`Duravel_Engine_Implementation_Workplan.md`) — code-grounded to THIS repo. Key conclusions:
   - **Do NOT build separate engines per sport.** The parametric `SportConfig` registry (`lib/engine/sports/`) + shared core + existing `ironman/` deterministic module is the right shape. Extend it.
   - **Add a `WeeklyHours` band input** (`h0_5|h5_10|h10_20|h20_30|h30_40`) → `ProfileSchema` (optional, back-compat) → `EngineInput` → `toEngineInput`. Drives volume (band→hours→mileage/cardio via existing `avgMinPerMile`; or triathlon per-discipline hours directly) and an intensity-distribution transform.
   - **Add `SportConfig.timeBudget: Record<band, TimeBudgetProfile>`** carrying peakHours, strengthShare, Seiler 3-zone target, athleteLevel + tradeoff copy (tables 6.3–6.7), advisable flag.
   - **Zone mapping:** report uses Seiler 3-zone; engine uses 5-zone `ZoneDistribution`. Mapper: Seiler-Z1→z1+z2, Z2→z3+z4, Z3→z5. Recommend a monotone transform on the existing `phaseZoneTargets` (hard-share falls as volume rises), NOT hand-authored per-band tables.
   - **Load model already exists:** `lib/engine/load.ts` computes session-RPE load + ACWR (report Part I already partly implemented). Consider uncoupled/EWMA chronic window.
   - **Golden-HYROX gate is the invariant:** feature is opt-in; no band = byte-identical legacy path. New per-(sport,band) golden fixtures for the new path.
   - **6-phase rollout:** 0 plumb input → 1 pure mapping module + tests → 2 sport config tables → 3 wire consumption sport-by-sport → 4 intake UI → 5 guardrails + "informed trade" surfacing → 6 website science page.

3. **Reference docs committed to repo:** `docs/research/` now holds the report (.md/.docx/.html) + the workplan. **Verified landed in native working tree** (git shows `?? docs/research/` — untracked, NOT yet committed). Bridge write reached Windows this time.

## Open decisions for Levi (from workplan §10)
1. Tune HYROX mid-band for output continuity vs. clean re-derive?
2. Add `tri_olympic` as a real sport? (report 6.5 ready; only tri_70_3/tri_140_6 exist today)
3. Make `weeklyHours` required for new programs (optional in schema)?
4. DEKA ATLAS/ULTRA bands = accept extrapolated (lower-confidence) or commission follow-up research?
5. Website: methodology page public + full report email-gated lead magnet?

## Next actions
- `git add docs/research && git commit` (push needs Levi — cloud egress blocked).
- If greenlit, start Phase 0 (schema + input plumbing, golden stays green).
- Consider adding a "Load/Intensity Time-Budget" lane to `Duravel_Roadmap_Planned_vs_Actuals.html`.

## Notes
- Intake wiring points confirmed: `app/onboarding/onboarding-form.tsx` (49KB single form) + `app/onboarding/actions.ts` (form→GenerationInput→buildSkeleton). Schema in `lib/schemas.ts`.
- Report "Olympic triathlon" is NOT a registered engine sport; general_fitness has no report table (use health-guideline floors).
