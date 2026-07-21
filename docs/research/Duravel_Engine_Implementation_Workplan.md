# Duravel Engine Implementation Workplan

## Wiring the Volume-vs-Intensity Research + a Weekly-Time-Budget Input into the Program Builder

*Companion to `Duravel_Volume-Intensity_Research_Report`. Prepared July 2026. Audience: engineering (you / future Cowork sessions in this repo).*

---

## 0. TL;DR and the one architectural recommendation

You asked whether this "may require substantially different engines for each type of program." **It does not, and it shouldn't.** The repo already has exactly the right shape to absorb this work:

- A **single parametric periodization core** (`lib/engine/`) that works in "week space" and emits a deterministic `ProgramSkeleton`.
- A **`SportConfig` data registry** (`lib/engine/sports/`) where each of the 9 sports is *data* — session counts, zone targets, volume currency, experience axes, needs domains — over that one core.
- Two **`ProgramType` behaviors** (`race_peaking`, `general_fitness`) and one already-deterministic **Ironman module** (`lib/engine/ironman/`) that triathlon re-exports.
- An existing **load model** (`lib/engine/load.ts`) that already computes weekly **session-RPE load** and **ACWR** — i.e. Part I of the research report is *already partially implemented*.

So the plan is **not** "build 5 engines." It is: **add a weekly-time-budget input, and teach the existing `SportConfig` + volume/zone layer to scale volume and intensity-distribution from that budget**, sport-by-sport, behind the golden-HYROX gate. One new concept (`TimeBudget`), threaded through the places that already own volume and zones.

The single biggest constraint that shapes everything below: **`engine/golden-hyrox.test.ts` freezes HYROX output byte-for-byte** (CLAUDE.md: "Never break the golden-HYROX byte-identical test"). Therefore the time-budget feature must be **opt-in and backward-compatible** — when no budget is supplied, the engine behaves exactly as today.

---

## 1. What already exists (so we build, not rebuild)

| Research concept (report) | Already in the repo | File |
|---|---|---|
| Session-RPE load as the currency | ✅ `weekLoad()` = session-RPE load | `lib/engine/load.ts`, `lib/engine/adapt.ts` |
| Acute:Chronic Workload Ratio guardrail | ✅ `computeLoadMetrics()` (acute/chronic/ACWR, cold-start safe) | `lib/engine/load.ts` |
| 5-zone intensity distribution per phase | ✅ `ZoneDistribution {z1..z5}`, `PHASE_ZONE_TARGETS`, `TRI_ZONES` | `lib/engine/volume.ts`, `sports/triathlon.ts` |
| Volume progression + deload + taper + masters | ✅ increase/deload/taper factors, `MASTERS_AGE` | `lib/engine/volume.ts` |
| Per-discipline hours (triathlon) | ✅ `VolumeConfigMulti.hoursPerWeekByLevel` | `sports/triathlon.ts` |
| Needs analysis (Seiler "hierarchy of needs") | ✅ `needs.ts` + `needsDomains` per sport | `lib/engine/needs.ts` |
| Concurrent-training / strength handling | ✅ dedicated strength module + A/B rotation | `lib/engine/strength.ts` |
| Experience bands with human criteria (for onboarding copy) | ✅ `experienceAxes[].bands[].criterion` | each `sports/*.ts` |

**Gaps the report exposes:**

1. **No weekly-time-budget input.** Volume is derived from *experience* (`STARTING_MILEAGE[runningExp]`) for single-currency sports and `hoursPerWeekByLevel[level]` for triathlon. Nothing lets the athlete say "I have 8 hours."
2. **Zone distribution is fixed per phase, not scaled by volume.** The report's core operational insight — *the share of hard work must fall as volume rises* — is not yet expressed.
3. **No athlete-level / tradeoff copy per time budget.** Tables 6.3–6.7 don't exist in the config yet.
4. **"Olympic-distance triathlon" (report 6.5) is not a registered sport** — only `tri_70_3` and `tri_140_6` exist. DEKA has 5 variants (`fit/mile/strong/atlas/ultra`); the report covers FIT/MILE/STRONG. `general_fitness` isn't in the report. (See §7 for the mapping.)

---

## 2. Core design: `TimeBudget` as a first-class input

### 2.1 The new schema field (`lib/schemas.ts`)

Add a canonical enum and thread it through `ProfileSchema` (it's an athlete attribute, like `trainingDays`). Optional, so every existing input/program stays valid and the golden test stays green.

```ts
// lib/schemas.ts
export const WeeklyHours = z.enum(["h0_5", "h5_10", "h10_20", "h20_30", "h30_40"]);
export type WeeklyHoursBand = z.infer<typeof WeeklyHours>;

// midpoint hours used by the volume math (see §2.4)
export const WEEKLY_HOURS_MIDPOINT: Record<WeeklyHoursBand, number> = {
  h0_5: 4, h5_10: 8, h10_20: 15, h20_30: 25, h30_40: 35,
};

// in ProfileSchema, add:
weeklyHours: WeeklyHours.optional(),   // omitted → legacy experience-derived volume
```

> Design note: use **hours**, not days, as the volume driver. `trainingDays` (which days) and `currentDaysPerWeek` (context) stay as-is; `weeklyHours` is the new *magnitude* input. The band maps to a midpoint hours target that the volume layer converts to each sport's currency.

### 2.2 Thread it into the engine (`lib/engine/types.ts`, `skeleton.ts`)

```ts
// EngineInput (lib/engine/types.ts)
weeklyHours?: WeeklyHoursBand;   // omitted → today's behavior
```

`toEngineInput()` in `skeleton.ts` copies `profile.weeklyHours` onto the `EngineInput`. `app/onboarding/actions.ts` already maps the form → `GenerationInputSchema`; it just carries the new field through. **No other call site changes in Phase 0** — the field is plumbed but unconsumed, so output is identical and the golden test passes.

### 2.3 Extend the `SportConfig` contract (`lib/engine/sports/types.ts`)

This is where tables 6.3–6.7 live — as data, per sport. Add one optional block:

```ts
export interface TimeBudgetProfile {
  /** Peak weekly hours this band targets (the volume anchor). */
  peakHours: number;
  /** Fraction of weekly hours allocated to strength/power (rest → sport currency). */
  strengthShare: number;
  /** Seiler 3-zone target for this band's endurance work (easy/threshold/hard %). */
  triZone: { easy: number; threshold: number; hard: number };
  /** Onboarding copy — the athlete-level label (report tables 6.3–6.7). */
  athleteLevel: string;
  /** Onboarding copy — one-line "what this budget optimizes / sacrifices". */
  tradeoff: string;
  /** Is this band advisable for this sport? false → show a caution in the UI
   *  (e.g. Ironman at 0–5h). Never hard-blocks; informs, per report's "informed trade". */
  advisable: boolean;
  /** Extra duty-of-care flags surfaced for this band (durability/finishing risk). */
  flags?: string[];
}

export interface SportConfig {
  // ...existing...
  /** Time-budget → volume + intensity + copy. Optional so un-migrated sports
   *  fall back to legacy experience-derived volume (keeps golden HYROX frozen). */
  timeBudget?: Record<WeeklyHoursBand, TimeBudgetProfile>;
}
```

### 2.4 Volume mapping — band → each sport's currency

Two currencies exist; the band feeds both:

**Single-currency sports (HYROX, DEKA, general-fitness)** — currency is running mileage + cardio minutes. Convert the band's `peakHours` and `strengthShare`:

```
enduranceHours = peakHours * (1 - strengthShare)
runShare       = config-driven (HYROX ~0.55, DEKA-FIT ~0.45, DEKA-STRONG ~0.2 …)
runMinutes     = enduranceHours * 60 * runShare
peakMileage    = runMinutes / avgMinPerMile           // avgMinPerMile already exists
peakCardioMin  = enduranceHours * 60                  // total aerobic minutes
```

These become the engine's **peak** volume; the existing microcycle math (base→build→peak, +7.5%/deload/taper) works *backwards/forwards* from there instead of from `STARTING_MILEAGE[exp]`. Concretely: when `weeklyHours` is present, `volume.ts` derives the starting/target volume from the band; when absent, it uses `STARTING_MILEAGE[exp]` exactly as today.

**Per-discipline sports (triathlon / Ironman)** — currency is already hours. The band's `peakHours` **replaces the lookup** in `hoursPerWeekByLevel`; `disciplineBalanceByPhase` still splits it across swim/bike/run. (Experience still sets *paces/zones per discipline*; the band sets *total hours*.)

> The two are consistent: hours is the common unit. Single-currency sports just convert hours→mileage via the existing `avgMinPerMile`.

### 2.5 Zone mapping — Seiler 3-zone (report) ↔ engine 5-zone

The report prescribes in Seiler's 3-zone model; the engine runs a 5-zone `ZoneDistribution`. Their correspondence:

| Report (Seiler) | Engine zones | Meaning |
|---|---|---|
| **Z1** (below LT1, easy) | `z1 + z2` | recovery + aerobic base |
| **Z2** (LT1–LT2, threshold/"gray") | `z3 + z4` | tempo + threshold |
| **Z3** (above LT2, hard) | `z5` (+ top of `z4`) | VO₂ / race-pace |

Recommended deterministic mapper (pure function, unit-tested):

```ts
// easy/threshold/hard are percentages summing to 100 (Seiler 3-zone)
function toFiveZone({easy, threshold, hard}): ZoneDistribution {
  const z1 = Math.round(easy * 0.25);          // recovery ≈ 1/4 of easy
  const z2 = easy - z1;                          // aerobic base = remainder
  const z3 = Math.round(threshold * 0.6);        // tempo ≈ 60% of threshold band
  const z4 = threshold - z3;                     // threshold = remainder
  const z5 = hard;                               // VO2 / hard
  return { z1, z2, z3, z4, z5 };                 // sums to 100 by construction
}
```

**Recommended implementation choice (important):** don't *replace* the existing per-phase `phaseZoneTargets` with band tables. Instead, keep the phase base and apply the band as a **monotone transform** that moves intensity share between the easy pool (`z1+z2`) and the hard pool (`z3+z4+z5`) — because the research's actual mechanism is "*absolute* hard-work capacity is ~fixed; its *share* falls as volume rises." A transform (a) composes cleanly with the existing base→build→peak periodization, (b) is far easier to keep golden-safe, and (c) needs one function + a per-band scalar rather than 5×4 hand-authored zone tables per sport. Use the explicit `triZone` targets in §4 as the tuning oracle the transform is fit to, and as the values shown in unit-test assertions.

### 2.6 Backward-compatibility / golden-HYROX strategy

- `weeklyHours` **absent** → every new code path is skipped; `STARTING_MILEAGE`/`PHASE_ZONE_TARGETS` used exactly as today → **golden HYROX byte-identical**. This is the invariant CI enforces.
- `weeklyHours` **present** → new volume + zone-transform path runs. Add **new** golden fixtures per `(sport × band)` (see §8) rather than editing the existing HYROX snapshot.
- The new onboarding UI always sends a band. To avoid regressing *existing* users, migration is additive: old programs (no band) keep generating identically; only newly-built programs use the band.
- Decision for Levi (§10): whether the HYROX band whose volume ≈ today's default should reproduce today's programs closely (nice for continuity) — achievable by tuning that band's `peakHours` to the current implied volume.

---

## 3. Load-model alignment (report Part I → engine)

The report's Part VII load spec is largely already live. Concrete deltas:

- **Keep** session-RPE load (`weekLoad`) as the internal currency — already implemented and modality-agnostic. ✔
- **Keep** ACWR (`computeLoadMetrics`) as a soft guardrail. Consider switching the chronic window to an **uncoupled / exponentially-weighted** form (report §1.3, Lolli/Impellizzeri critique) — a small change in `load.ts`, additive and testable.
- **Add** the "three adaptation buckets" idea (central / peripheral / durability) as *metadata on the needs analysis + band*, used to drive the UI's "what this budget under-serves" message. This is display/telemetry, not a change to skeleton math — low risk, high explanatory value.
- **Expose** the estimated weekly load per band in the program summary (we already compute the pieces) so the UI can show "this plan ≈ X load units, ~Y% of a 20-hour build."

---

## 4. The intake question + per-sport athlete-level tables (turnkey)

### 4.1 The question

> **"How much time can you train each week?"**
> Sub-label: *"Your plan's total volume and how it's balanced between easy and hard work scale with this. There's no wrong answer — pick what's realistic and we'll get the most out of it."*

Options (render the **sport-specific** `athleteLevel` + `tradeoff` beneath each, pulled from the selected sport's `timeBudget`):

1. **0–5 hours/week**
2. **5–10 hours/week**
3. **10–20 hours/week**
4. **20–30 hours/week**
5. **30–40 hours/week**

UX: because descriptions differ per sport, place this step **after** sport selection (or re-render its captions when sport changes). For bands with `advisable:false`, show a subtle caution chip (not a block) — e.g. Ironman 0–5h: *"Enough to finish, not to compete — expect back-half fade."*

### 4.2 Per-sport × per-band copy (drop straight into each `SportConfig.timeBudget`)

**HYROX** (`hyrox`)

| Band | athleteLevel | tradeoff |
|---|---|---|
| 0–5h | Recreational; competitive Open finisher | Builds VO₂max, threshold & station efficiency; gives up running durability and aerobic-base depth. |
| 5–10h | Advanced age-grouper; Pro-qualifier attainable | Adds race-specific durability; sacrifices only the last few % of aerobic base. |
| 10–20h | Elite / Pro | Full durability + aerobic base + race simulation; sacrifices little. |
| 20–30h | Full-time Pro only | Maximal durability; returns diminish and impact-injury risk becomes the limiter. |
| 30–40h | Pro peak-block only; not sustainable | No added benefit beyond 20–30h for most; camp/peak use only. |

**DEKA FIT** (`deka_fit`; STRONG/MILE variants adjust per §7)

| Band | athleteLevel | tradeoff |
|---|---|---|
| 0–5h | Recreational → competitive (fully sufficient for STRONG) | Builds glycolytic power, zone efficiency, VO₂max; little lost for FIT, nothing for STRONG. |
| 5–10h | Competitive age-grouper; elite for STRONG/MILE | Race-specific power-endurance + aerobic support; gives up back-end aerobic base for FIT. |
| 10–20h | Elite (beyond STRONG/MILE needs) | Everything DEKA FIT rewards; sacrifices little. |
| 20–30h | Over-prescribed for DEKA; Pro only | Aerobic ceiling well past DEKA's demands; strong diminishing returns. |
| 30–40h | Not recommended for DEKA | Volume exceeds event demand. |

**Olympic-distance triathlon** (report 6.5 — **not yet a registered sport**; add `tri_olympic` or attach to a future config)

| Band | athleteLevel | tradeoff |
|---|---|---|
| 0–5h | Recreational; sprint-focused | VO₂max/threshold/race pace; gives up aerobic base and swim-technique volume. |
| 5–10h | Competitive age-grouper | Competitive readiness; sacrifices only marginal base. |
| 10–20h | Sub-elite / elite | Base, economy, threshold, durability; sacrifices little. |
| 20–30h | Elite / Pro | Elite aerobic depth; diminishing returns for Olympic distance. |
| 30–40h | Pro peak-block only | No Olympic-specific return beyond 20–30h. |

**Half-Ironman / 70.3** (`tri_70_3`)

| Band | athleteLevel | tradeoff |
|---|---|---|
| 0–5h | Survival-only; back-of-pack finisher | Threshold/VO₂max/finishing fitness; gives up durability, fat oxidation, fueling practice, run robustness. |
| 5–10h | Competitive age-grouper | Credible mid-pack 70.3; sacrifices late-race durability depth. |
| 10–20h | Kona-70.3 qualifier / elite | Durability, fat oxidation, GI tolerance, competitive readiness; sacrifices little. |
| 20–30h | Elite / Pro | Elite durability and metabolic depth; approaching diminishing returns. |
| 30–40h | Pro only | Marginal returns over 20–30h; recovery-support dependent. |

**Ironman / 140.6** (`tri_140_6`)

| Band | athleteLevel | tradeoff |
|---|---|---|
| 0–5h | Not advised except experienced athletes seeking to finish | Central fitness only; sacrifices nearly all durability, fueling and structural prep — high blow-up/injury risk. |
| 5–10h | Determined age-grouper; execution-dependent | A realistic finish; sacrifices durability depth, GI robustness, injury margin. |
| 10–20h | Kona qualifier / strong age-grouper | Durability, fat oxidation, GI tolerance — genuine competitiveness; near the amateur optimum. |
| 20–30h | Pro / full-time athlete | Maximal durability and metabolic depth for 8h+ racing; overtraining risk without full-time recovery. |
| 30–40h | Pro peak-block only | Volume-gated ceiling for the longest events; net-negative without pro recovery infrastructure. |

(Full zone/volume/session numbers per band are in report tables 6.3–6.7; those are the tuning oracle for §2.4–2.5.)

---

## 5. Guardrails (report Part VII → concrete rules)

| Guardrail | Rule | Where |
|---|---|---|
| Load-progression | Flag weekly load jumps that push (uncoupled) ACWR > ~1.3–1.5 | extend `load.ts` (present) |
| Single-session jump | Cap any run > ~30% over the prior 30-day longest run (Nielsen) | `volume.ts`/`reconcile.ts` — new check |
| Distribution scales with volume | Hard-work *share* falls as band hours rise (§2.5 transform) | new zone-transform in `volume.ts` |
| Protect intensity when time collapses | If band is low, keep 1–2 quality sessions, cut easy volume first (Hickson) | zone-transform + `sessionCounts` floors |
| Concurrent-power interference | Cap strength/hypertrophy volume as endurance hours rise; keep power low-volume/high-quality; separate hard strength & hard endurance | `strength.ts` + `sequencing.ts` (both present) |
| Impact routing >20h | Route incremental aerobic volume to low-impact cardio (ski/row/bike) not more running | `reconcile.ts` (already adds non-running Z1–2 cardio) |
| Event-duration-weighted deficit warning | Surface `advisable:false` + `flags` per band (Ironman 0–5h etc.) | `dutyOfCare` + new `timeBudget.flags` |

Most of these have a home already — this is extension, not green-field.

---

## 6. Phased implementation plan

Each phase ends **green on `golden-hyrox.test.ts`** unless it deliberately adds new fixtures.

**Phase 0 — Plumb the input (no behavior change).** Add `WeeklyHours` enum + `weeklyHours?` to `ProfileSchema`, `EngineInput`, `toEngineInput`, and carry it through `app/onboarding/actions.ts`. Unconsumed. *Exit:* golden green; type-check clean. *Effort: S.*

**Phase 1 — Pure mapping module + tests.** New `lib/engine/time-budget.ts`: `bandToVolume(sport, band, phase)` and `applyBandZoneShift(base, band)` (the §2.5 transform) + the 3↔5-zone mapper. Unit tests against the report's 6.3–6.7 numbers. No consumer yet. *Exit:* new tests pass; golden untouched. *Effort: M.*

**Phase 2 — Sport config tables.** Populate `timeBudget` on `hyrox` first (values tuned so the mid band ≈ today's HYROX volume), then `deka_*`, `tri_70_3`, `tri_140_6`, `general_fitness`. Copy from §4. *Exit:* configs typecheck; a `timeBudget` presence test per sport. *Effort: M.*

**Phase 3 — Wire consumption, sport-by-sport, behind the input.** In `volume.ts`/`skeleton.ts`: *if `weeklyHours` present*, derive volume from the band and apply the zone transform; *else* legacy path. Roll out HYROX → DEKA → triathlon/Ironman (the ironman module reads band hours in place of `hoursPerWeekByLevel`) → general-fitness. Add a **new** golden fixture for each `(sport, band)` as it lands. *Exit:* legacy golden green; new fixtures snapshotted + reviewed. *Effort: L.*

**Phase 4 — Intake UI.** Add the §4 question to `app/onboarding/onboarding-form.tsx` after sport selection; render sport-specific `athleteLevel`/`tradeoff`; caution chip for `advisable:false`. Validation + default handling. *Exit:* e2e build; form submits band; program reflects it. *Effort: M.*

**Phase 5 — Guardrails + "informed trade" surfacing.** Implement §5 checks; show the per-band tradeoff + estimated weekly load + "what this under-serves" on the program summary. *Exit:* guardrail unit tests; UI shows tradeoff copy. *Effort: M.*

**Phase 6 — Website science page + report hosting (see §9).** *Effort: M.*

**Cross-cutting:** update `Duravel_Roadmap_Planned_vs_Actuals.html` with a "Load/Intensity Time-Budget" lane; write a handoff each session per CLAUDE.md.

---

## 7. Per-sport rollout notes & gaps

- **HYROX** — reference implementation; tune mid band to preserve continuity.
- **DEKA** — `deka_fit` uses the FIT table; `deka_strong`/`deka_mile` shift ~10 zone-points from easy→hard and add a strength session at each band (report §6.4 adjustments); `deka_atlas` behaves like STRONG (strength-endurance), `deka_ultra` like an endurance event (treat closer to HYROX/70.3 volume-dependence). These two variants aren't in the report — extrapolate and flag as lower-confidence.
- **Olympic triathlon (report 6.5) is not a registered sport.** Either add a `tri_olympic` config (recommended — the table is ready in §4) or omit and note it. Decision for Levi (§10).
- **Ironman module** (`lib/engine/ironman/`) — deterministic; the only change is reading band `peakHours` instead of the level lookup. Keep `dutyOfCare.gateBeginners` for 140.6.
- **general_fitness** — not a race, so no report table. Use health-guideline floors (already in `SubGoalConfig.floors`); the band scales total volume, and the rotation stays. Low risk.

---

## 8. Testing strategy

- **Golden-HYROX (existing):** the legacy no-band path must stay byte-identical — this is the CI gate and the definition of "didn't break anything."
- **New per-(sport,band) golden fixtures:** snapshot the skeleton for each sport at each band; review once, then freeze. This catches drift as tuning evolves.
- **Unit tests for the mapping module:** assert `bandToVolume` and the zone transform reproduce the report's 6.3–6.7 proportions within tolerance; assert monotonicity (hard-share decreases as band hours increase; total volume increases).
- **Property tests:** zone distributions always sum to 100; volume is monotone in band; strength share respects concurrent-training caps.
- **Guardrail tests:** single-session-jump and ACWR flags fire on constructed inputs.

---

## 9. Putting the science on the website (my recommendation)

**Strong yes — this is a real differentiator and a conversion asset.** Duravel's whole positioning is "coach-quality, personalized *and* science-based." A public methodology page makes that claim legible and is exactly the kind of evergreen, linkable content that earns trust and organic search. Recommended shape:

- **A `/science` (or `/methodology`) page** — benefit-framed, not academic. Lead with the three findings (load isn't fungible; intensity substitutes for *some* adaptations; the trade scales with event duration), then "how Duravel uses this" (the time-budget question, the volume-scaled intensity distribution, the durability guardrails). Reuse the interactive HTML report's styling/system.
- **Host the full report as a linked "white paper"** — the HTML version we built, at `/science/volume-intensity` (or a PDF download). It's already self-contained and navigable.
- **Make the athlete-level table interactive** — a small "pick your sport + hours" widget that shows the level + tradeoff. This markets the new intake feature *and* demonstrates the science simultaneously — the best kind of content because it's also product.
- **Keep the moat private.** Publish the *science and the framework*; do **not** publish Part VII (the engine spec) or the exact per-band volume/zone parameter tables — those are the competitive edge. Science builds trust; parameters are the product.
- **Hedge the claims.** The report already flags evidence gaps (HYROX = one small study; no DEKA lab data; polarized advantage is narrow). Carry those caveats onto the public page — for a health product, calibrated honesty reads as more credible, not less, and reduces liability.
- **SEO/marketing bonus:** "HYROX training hours per week," "how much should I train for a 70.3," "polarized vs threshold hybrid training" are real queries this page can own; each per-sport athlete-level table is a natural featured-snippet target.

Implementation: it's a static Next.js route + one interactive component — Phase 6, independent of the engine work, and shippable first if you want the marketing win before the engine lands.

---

## 10. Open decisions for Levi

1. **Continuity vs. clean slate for HYROX:** tune the mid band so new HYROX programs closely match today's, or let the band fully re-derive volume? (Recommend: tune for continuity.)
2. **Add `tri_olympic` as a real sport?** The report + table are ready; it's a modest config addition. (Recommend: yes.)
3. **Does the new intake make `weeklyHours` required for new programs**, with legacy programs untouched? (Recommend: yes — required for new, optional in the schema for back-compat.)
4. **DEKA ATLAS/ULTRA bands** — accept extrapolated (lower-confidence) tables, or commission a short follow-up research pass? 
5. **Website depth** — full white-paper public, or gated behind email capture (lead magnet)? (Recommend: methodology page public; full report as an email-gated download to feed the funnel.)

---

## 11. Where the research + this plan live

Committed into the repo for future reference (see accompanying commit):

```
docs/research/
  Duravel_Volume-Intensity_Research_Report.md      (source)
  Duravel_Volume-Intensity_Research_Report.docx     (Word)
  Duravel_Volume-Intensity_Research_Report.html     (interactive)
  Duravel_Engine_Implementation_Workplan.md         (this file)
```

Also mirrored to OneDrive `Training Program App\` and persisted as desktop artifact `duravel-volume-intensity-research`.
