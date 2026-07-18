# Duravel — Multi-Sport Strength Architecture Spec (v4)

**Status:** Draft for review · **Date:** 2026-07-18 · **Owner:** Levi
**Scope:** How the weightlifting/strength side of the program engine scales
across Duravel's **race-based program types** — the DEKA family, HYROX, and the
triathlon family — while reusing the *existing* Base → Build → Peak → Taper
mesocycle skeleton and the `lib/engine/strength.ts` model.

> **v4 change:** the à-la-carte **General-Fitness modality mode** (swim/bike/run/
> weightlifting/hybrid, pick-any) has been **removed from scope and archived**
> (see **Appendix A**). Duravel focuses on **specific race types**, not general
> fitness. The archived design is kept for reference only and is **not to be
> implemented.**

> **This spec changes no periodization structure.** It does not alter mesocycle
> allocation (`mesocycles.ts`), the microcycle patterns (`microcycles.ts`), the
> taper logic (`taper.ts`), or the "engine owns the math, AI fills content"
> contract. It adds a **sport/program-type** input plus a bounded
> **StrengthProfile** that re-tunes the numbers `strength.ts` already produces.

### Changelog

- **v4** — à-la-carte general-fitness mode removed & archived (Appendix A);
  sport picker is now a **race-type picker only**; taxonomy trimmed to race
  events; companion cardio-composition spec delivered.
- **v3** — ATLAS ships; DEKA Ultra confirmed ultra-endurance.
- **v2** — DEKA Strong+Mile unified; Ironman Peak 1×/wk; DEKA extra session =
  hybrid zone-sim; triathlon split into Olympic / 70.3 / 140.6.

Resolved decisions carried forward: DEKA Strong+Mile share one profile; Ironman
keeps 1×/wk heavy maintenance in Peak; DEKA extra weekly session is a **hybrid
zone-sim slot** (not a 4th lift); DEKA splits by running load (Strong/Mile/ATLAS
lifting-dominant; Fit/Ultra conditioning-first); ATLAS ships; Ultra is
ultra-endurance.

---

## 1. The question this answers

Every race athlete should run the **same engine, the same phases, and largely the
same exercises** — with the dials set for their event. This spec defines those
dials: how **exercise selection, volume, and intensity** change (a) mesocycle to
mesocycle and (b) sport to sport, so each athlete progresses in strength — and in
hypertrophy only to the extent it helps their race.

It also settles the standing question — *full-body day or upper/lower days
heavy?* — the way the code already answers it: **the full-body day is the heavy,
low-rep max-strength driver; upper/lower days run a moderate strength scheme.**
Heavy/low-rep strength + plyometrics improves economy and delays fatigue with
minimal added mass (Rønnestad & Mujika 2014; Blagrove 2018; Beattie 2017). That
is now a **cross-sport invariant.**

---

## 2. Invariants — what does NOT change

1. **Mesocycles:** Base → Build → Peak → Taper, Base largest (`mesocycles.ts`).
2. **Microcycles:** 3-week (rebound/increase/deload) or 4-week (…/increase/…);
   masters → 3-week (`microcycles.ts`).
3. **Intensity autoregulation is global:** per-microcycle `%1RM` deltas
   (increase +2, rebound 0, deload −6, taper −3, race −3) and emphasis caps
   (max_strength 90, strength 85, endurance 60, floor 45) apply to every sport.
   **Sport changes the base scheme, not the autoregulation math.**
4. **The 7 movement patterns** — squat, hip_hinge, lunge, horizontal_press,
   vertical_press, horizontal_pull, vertical_pull — are the vocabulary for every
   sport.
5. **Engine owns numbers; AI fills content.**
6. **Backward compatibility:** `sport = hyrox` reproduces today's output exactly.

*Note: "program type" (a dated goal race vs. a fixed-duration block with no dated
race) is orthogonal to **sport**. A no-dated-race athlete still trains for a
specific race type — e.g. "HYROX, 12-week block, no race booked." There is no
sport-agnostic general-fitness path (removed in v4).*

---

## 3. Core principle — one engine, many gears

Three dials on one movement library:

| Dial | Controls | Lives in |
|---|---|---|
| **Intensity** | %1RM, rep range, RIR | scheme tables + micro deltas |
| **Volume** | hard sets/pattern/week; lift frequency | `sets`; slot assignment |
| **Selection** | which *variation*; which pattern carries which *emphasis* | `patternEmphasis()` + AI choice |

---

## 4. How the three dials move **mesocycle to mesocycle** (all sports)

### 4.1 Intensity — rises across the macrocycle (HYROX baseline; other sports §6)

| Emphasis | Base | Build | Peak | Taper |
|---|---|---|---|---|
| Full-body **max_strength** | ~78% · 5–6 · RIR3 | ~83% · 4–5 · RIR2 | ~88% · 3 · RIR1 | ~85% · 3 · RIR2 |
| Upper/lower **strength** | ~70% · 8–10 · RIR3 | ~75% · 6–8 · RIR2 | ~80% · 5–6 · RIR2 | ~78% · 5–6 · RIR2 |
| **endurance** tier | ~55% · 15 · RIR3 | ~55% · 18 · RIR2 | ~50% · 20 · RIR2 | ~50% · 12 · RIR3 |

Within a mesocycle the microcycle deltas wave load week to week (increase +2%,
deload −6%), bounded by the emphasis cap.

### 4.2 Volume — peaks Base/early-Build, drops through Peak as intensity climbs.
The sport dial's biggest lever is the volume ceiling (§5).

### 4.3 Selection — stable *primary*, rotating *variation*

- **Primary lift (fixed all macrocycle):** back squat, trap-bar deadlift, bench,
  weighted pull-up — persist every mesocycle for PR tracking + 5RM
  autoregulation (`benchmarkForPattern()`).
- **Variation/accessory (rotates each mesocycle):** changes angle/emphasis, not
  pattern. Base → joint-friendly/higher-rep; Peak → power/velocity + race-specific
  (§7 library).

---

## 5. Sport taxonomy & the strength-demand ladder

Ranked by **how much barbell (max-strength + hypertrophy) volume** the sport
wants, highest → lowest. A separate **strength-endurance** axis is called out
because the DEKA family is high there regardless of running load.

| Program type | Event shape | Strength (barbell) demand | Strength-endurance demand | Profile key |
|---|---|---|---|---|
| **DEKA Strong** | 10 zones, no run | **Highest** | High | `deka_strength` |
| **DEKA Mile** | 10 zones, 1 mi | **Highest** | High | `deka_strength` |
| **DEKA ATLAS** | 10 heavy zones, 30-min cap, no run stated | **Highest (power)** | High | `deka_strength` (power-capped) |
| **HYROX** | 8×1 km + 8 stations | Medium | Medium–High | `hyrox` |
| **DEKA Fit** | 10 zones, 5K | Medium (conditioning precedence) | High | `deka_fit` |
| **DEKA Ultra** | **50 zones, 25K** | Low–Medium (conditioning precedence) | **Very High** (50 zones) | `deka_ultra` |
| **Triathlon — Olympic** | 1.5/40/10 | Low–Medium | Low | `tri_olympic` |
| **Ironman 70.3** | 1.9/90/21.1 | Low | Low | `tri_70_3` |
| **Ironman 140.6** | 3.8/180/42.2 | **Lowest** | Low | `tri_140_6` |

**DEKA precedence rule:** *Strong / Mile / ATLAS* — lifting is equal to or above
conditioning → top of the barbell ladder. *Fit / Ultra* — conditioning takes
precedence → barbell dialed down, but the **zone-sim** and **endurance tier** stay
high because the zones are still loaded work. Ultra's 25K running pushes it toward
the mass-averse, economy-first end even though its 50 zones make its
*strength-endurance* volume the highest of any event.

---

## 6. The sport dial — resolved knobs & schemes

### 6.1 StrengthProfile knobs

```ts
interface StrengthProfile {
  liftSessionsByPhase: Record<PhaseName, number>;
  zoneSimHybrid: boolean;                 // DEKA extra session = hybrid zone-sim
  primeMoverSetDelta: Partial<Record<PhaseName, number>>;
  upperLowerRepBias: "hypertrophy" | "strength" | "low_rep";
  enduranceEmphasisPatterns: LiftPattern[];
  hypertrophyBlock: "long" | "moderate" | "none";
  plyoProfile: "power_forward" | "baseline" | "reactive_only";
  massAvoidance: boolean;
  needsStrengthWeight: "high" | "medium" | "low";
}
```

### 6.2 Knob settings by profile

| Knob | deka_strength | hyrox | deka_fit | deka_ultra | tri_olympic | tri_70_3 | tri_140_6 |
|---|---|---|---|---|---|---|---|
| Lift sess — Base/Build | 3 + zone-sim | 3 | 3 + zone-sim | 2 + zone-sim | 2 | 2 | 2 |
| Lift sess — Peak | 3 | 3 | 3 | 1–2 | 1–2 | 1 | 1 |
| Lift sess — Taper | 2 | 1–2 | 2 | 1 | 1 | 1 | 1 |
| Prime-mover set Δ (B/Bd) | +1 | 0 | 0 | −1 | 0 | −1 | −1 |
| Upper/lower rep bias (Base) | hypertrophy | strength | strength | low_rep | strength(low) | low_rep | low_rep |
| Endurance-emphasis patterns | lunge, h.press, +carry/hinge | lunge | lunge, h.press | lunge, h.press, carry | — | — | — |
| Hypertrophy block | long | moderate | moderate | none | none | none | none |
| Plyo profile | power_forward | baseline | baseline | reactive_only | baseline(power) | reactive_only | reactive_only |
| Mass-avoidance cap | off | off | off | on | on (light) | on | on (strict) |
| Zone-sim hybrid | yes (B/Bd/Pk) | no | yes (B/Bd/Pk) | yes (endurance-biased) | no | no | no |
| Needs: strength weight | high | medium | medium | low | low | low | low |

*ATLAS runs `deka_strength` with the plyo pool tilted to heavy power moves and a
time-cap-specific zone-sim (30-min density work).*

### 6.3 Resolved full-body max_strength scheme (the heavy driver, every profile)

| Profile | Base | Build | Peak | Taper |
|---|---|---|---|---|
| deka_strength | 5×5–6 @78 R3 | 5×4–5 @83 R2 | 5×3 @88 R1 | 3×3 @85 R2 |
| hyrox / deka_fit | 4×5–6 @78 R3 | 4×4–5 @83 R2 | 5×3 @88 R1 | 3×3 @85 R2 |
| deka_ultra | 3×5 @78 R3 | 3×4–5 @82 R2 | 2×3 @86 R1 | 2×3 @84 R2 |
| tri_olympic | 3×5 @80 R3 | 3×4 @85 R2 | 2×3 @88 R1 | 2×3 @85 R2 |
| tri_70_3 / tri_140_6 | 3×5 @80 R3 | 3×4 @85 R2 | **2×3 @88 R1 (maintain)** | 2×3 @85 R2 |

### 6.4 Resolved upper/lower strength scheme

| Profile | Base | Build | Peak | Taper |
|---|---|---|---|---|
| deka_strength | 4×10–12 @68 R3 | 4×8–10 @73 R2 | 3×6 @80 R2 | 2×6 @78 R2 |
| hyrox / deka_fit | 3×8–10 @70 R3 | 3×6–8 @75 R2 | 3×5–6 @80 R2 | 2×5–6 @78 R2 |
| deka_ultra | 2×6–8 @72 R3 | 2×6 @77 R2 | 2×5 @80 R2 | 1–2×5 @78 R2 |
| tri_olympic | 2×6–8 @75 R3 | 2×5–6 @80 R2 | 2×5 @82 R2 | 1–2×5 @80 R2 |
| tri_70_3 / tri_140_6 | 2×6–8 @75 R3 | 2×5–6 @80 R2 | 2×5 @82 R2 | 1–2×5 @80 R2 |

### 6.5 Muscular-endurance tier (barbell high-rep; the zone-sim hybrid is separate)

| Profile | Patterns | Base | Build | Peak | Taper |
|---|---|---|---|---|---|
| deka_strength | lunge, h.press, +carry/hinge | 3×15–20 @55 | 3×20–25 @55 | 3×25–30 @50 | 2×15 @50 |
| hyrox | lunge | 3×15 @55 | 3×18 @55 | 3×20 @50 | 2×12 @50 |
| deka_fit | lunge, h.press | 3×15 @55 | 3×18–20 @55 | 3×22 @50 | 2×12 @50 |
| deka_ultra | lunge, h.press, carry | 3×20 @52 | 3×25 @52 | 3×30 @48 | 2×15 @48 |
| tri_* | — (single-leg runs as **strength** for durability) | — | — | — | — |

### 6.6 Emphasis mapping (`patternEmphasis` becomes sport-aware)

| Pattern | deka_* | hyrox | tri_* |
|---|---|---|---|
| squat/hinge (full-body day) | max_strength | max_strength | max_strength |
| squat/hinge/press/pull (upper/lower) | strength (hypertrophy-rep in Base for deka_strength) | strength | strength (low-rep) |
| lunge | **endurance** | endurance | **strength** (single-leg durability) |
| horizontal_press | **endurance** (wall-ball/thruster capacity) | strength | strength |

### 6.7 Plyometric / power profile

| Profile | Base | Build | Peak | Pool notes |
|---|---|---|---|---|
| deka_strength (+ATLAS) | 5×3 | 6×3 | 3×3 | + box jump-overs, dead-ball over-shoulder throws, rotational med-ball (explosive zones) |
| hyrox / deka_fit | 4×3 | 5×3 | — | existing pool |
| deka_ultra | 3×3 | 3×3 | 2×2 | reactive/economy only (25K run) |
| tri_olympic | 4×3 | 4×3 | 2×2 | speed/power for the shorter, faster race |
| tri_70_3 / tri_140_6 | 3×3 | 3×3 | 2×2 | reactive only — pogo hops, low bounds; no depth jumps |

### 6.8 The DEKA zone-sim hybrid slot

DEKA's extra weekly session is a **hybrid slot**, filled by the AI like a HYROX
hybrid but drawing on the **DEKA zone library** (ram/med-ball, sled push/pull,
farmers, sandbag/alternating lunge, tank push, dead-ball over-shoulder, box
step-over/jump-over, rope, wall-ball/thruster). It rehearses the event's
strength-endurance-under-fatigue demand and carries DEKA's extra conditioning
volume **without** adding a 4th heavy lift day. It runs in Base/Build/Peak
(endurance-biased for `deka_ultra`), rotates zones across the week, and is owned
by the same reconciler that sizes HYROX hybrids.

---

## 7. Exercise selection & rotation library

Primary fixed (tracked); variation rotates per mesocycle.

| Pattern | Primary (fixed) | Base variation | Build variation | Peak variation |
|---|---|---|---|---|
| squat | back squat | goblet / tempo box squat | front squat | back squat + jump squat |
| hip_hinge | trap-bar / conv. DL | RDL, hip thrust | trap-bar DL | speed pulls / KB swing |
| lunge | walking DB lunge | reverse lunge | walking lunge (load↑) | loaded/sandbag walking lunge |
| horizontal_press | bench press | DB bench, loaded push-up | bench press | bench + med-ball/wall-ball power |
| vertical_press | overhead press | DB shoulder press | push press | push press / thruster |
| horizontal_pull | barbell row | chest-supported row | barbell row | sled row / erg-strength |
| vertical_pull | weighted pull-up | lat pulldown | weighted pull-up | weighted pull-up + loaded carry (grip) |

Sport tilts: **DEKA** → carries, odd-object, wall-ball/thruster. **Triathlon** →
single-leg, posterior chain, anti-rotation/trunk, plus vertical/horizontal-pull
and posterior-shoulder work for the swim leg and shoulder health; no high-rep or
heavy plyo.

---

## 8. Cardio dependency (triathlon)

Triathlon (and any DEKA/HYROX running) needs aerobic volume this strength spec
does not own. Multi-discipline **cardio** composition — swim/bike/run as
first-class disciplines, brick sessions, per-discipline zones/pacing — lives in
the **companion cardio-composition spec** (delivered). This spec owns the barbell
side and the interference rules (§9); it assumes the companion spec supplies each
discipline's aerobic volume. HYROX and DEKA are unaffected by that companion work
(they keep running + cross-training + hybrid as today).

---

## 9. Concurrent-training guardrails (scaled by sport)

Global: ≥6 h between a hard lift and a hard sport session (ideally different
days); never heavy lower-body the day before a key long/interval session; align
the lifting deload with the sport deload.

Interference tolerance scales opposite the barbell dial: **DEKA (Strong/Mile/
ATLAS) high** (the sport *is* lifting) → **HYROX / DEKA Fit medium** → **DEKA
Ultra / Triathlon low** (protect the aerobic sessions above all; drop lift
frequency in Peak). The engine already orders same-day sessions by priority; the
addition is a slot rule enforcing the ≥24 h heavy-lift/key-session separation and
the Peak-phase frequency drop.

---

## 10. Proposed code / data-model changes (additive, backward-compatible)

| File | Change |
|---|---|
| `lib/schemas.ts` | Add `Sport` enum: `hyrox, deka_strong, deka_mile, deka_atlas, deka_fit, deka_ultra, tri_olympic, tri_70_3, tri_140_6`. Add `sport` to `ProfileSchema`/`GenerationInputSchema`, default `hyrox`. (No general-fitness modality field — archived, Appendix A.) |
| `lib/engine/types.ts` | Add `sport` to `EngineInput`. |
| `lib/engine/strength-profiles.ts` *(new)* | `STRENGTH_PROFILES: Record<Sport, StrengthProfile>` — single source of the dials (§6.2). |
| `lib/engine/strength.ts` | Make the three scheme tables profile-aware (`Record<Sport, Record<PhaseName, SchemeBase>>` or baseline+modifier); `patternEmphasis(pattern, liftType, sport)`; `movementScheme(…, sport)`; sport-aware plyo pool/volume incl. DEKA Peak. Micro deltas + caps stay global. |
| `lib/engine/slots.ts` / `sequencing.ts` | Lift frequency per phase from the profile; **zone-sim hybrid** slot for DEKA; tri frequency; interference guard. |
| `lib/engine/mesocycles.ts` | Unchanged — every race type still allocates Base→Build→Peak→Taper identically. |
| `lib/engine/needs.ts` | Optional sport weighting of the strength domain (default neutral). |
| `lib/ai/philosophy.ts` | Sport-specific `LIFT_GUIDANCE`, the exercise-variation library (§7), and sport-specific station/zone libraries: HYROX stations, **DEKA zone library**, tri/brick guidance. |
| *(companion spec)* | Multi-discipline **cardio** volume composition for swim/bike/tri (§8). |

Guarantee: `sport = hyrox`, no other change ⇒ identical output.

---

## 11. Worked example — squat pattern, one macrocycle

| Phase | deka_strength | hyrox | deka_ultra | tri_140_6 |
|---|---|---|---|---|
| Base | back squat 5×5–6 @78 + front squat 4×12 (hypertrophy) | back squat 4×5–6 @78 + goblet 3×10 | back squat 3×5 @78 + high-rep zone carryover | back squat 3×5 @80 |
| Build | back squat 5×4–5 @83 + split squat 4×8 | back squat 4×4–5 @83 + front-squat 3×8 | back squat 3×4–5 @82 | back squat 3×4 @85 |
| Peak | back squat 5×3 @88 + loaded step-over 3×20 (zone) + jump squat | back squat 5×3 @88 + jump squat | back squat 2×3 @86 + zone-sim carries | back squat 2×3 @88 + pogo hops |
| Taper | 3×3 @85, fresh | 3×3 @85 | 2×3 @84 | 2×3 @85 |

---

## 12. Decisions

| # | Decision | Resolution |
|---|---|---|
| 1 | DEKA ATLAS | **Ships** as `deka_atlas` (deka_strength dial, power-tilted plyo, 30-min density zone-sim). |
| 2 | DEKA Ultra volume | **Confirmed ultra-endurance** — economy-first barbell dial; strength-endurance via zone-sim. |
| 3 | À-la-carte general-fitness mode | **Removed & archived** (Appendix A). Not to be implemented. Race-based focus. |
| 4 | Companion cardio-composition spec | **Delivered** (owns tri/swim/bike aerobic volume). |

No open decisions remain for the strength architecture.

---

## 13. Evidence base

Heavy/low-rep strength + plyometrics for endurance economy with minimal mass:
Rønnestad & Mujika 2014; Blagrove et al. 2018; Balsalobre-Fernández et al. 2016;
Beattie et al. 2017; Barnes & Kilding 2015. RIR autoregulation: Helms et al.
2016. Concurrent-training interference & sequencing: Hickson 1980; Coffey &
Hawley 2017; Robineau et al. 2016. DEKA event formats (zones / run distances):
Spartan DEKA official format pages (Strong, Mile, Fit, Ultra, ATLAS).

---

## Appendix A — Archived: General-Fitness à-la-carte mode (NOT implemented)

> **Archived 2026-07-18.** Duravel is race-based; this pick-any-modality mode is
> out of scope and retained only for reference. Do not build without an explicit
> decision to re-scope.

The idea was: a **General Fitness** program type that let the athlete pick one or
more **modalities** (swim / bike / run / weightlifting / hybrid), with the engine
composing volume from the picks — no hard cap, but a recovery warning above 3
modalities and, for non-advanced athletes, an auto-set to the lowest volume band.
Standalone strength dials were sketched per modality (weightlifting-only = a full
strength + hypertrophy program with a balanced strength-power-hypertrophy peak;
run/bike/swim = low-volume economy/durability strength), with composition rules
(union the emphases, recovery ceiling from the most endurance-demanding pick,
interference spacing, frequency capped to training days). All of this is
**superseded** by the race-type-only taxonomy in §5.
