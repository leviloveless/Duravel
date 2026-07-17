# Duravel Multi-Sport Program Builder — 9-Sport Expansion
## Design & Training-Science Spec (for review + discussion)

**Author:** Claude (research + design), for Levi
**Date:** 2026-07-16
**Status:** Design draft — no code / DB / engine changes made yet. This is the "come back and discuss" deliverable.
**Repo:** `C:\dev\duravel` · builds on `docs/future-phases/01-triathlon-engine.md` (approved) and the current HYROX engine.

> **How to read this.** §1 recaps what the current engine already does and how much is reusable. §2 proposes the architecture (three "sport families" over one shared periodization core). §3 is the heart: a per-sport training-science design for each of the 9 choices — philosophy, periodization, experience tiering, key sessions, benchmarks, load model, and the unique challenges each poses. §4 is the unified experience-level matrix. §5 is the concrete engine/DB/UX change plan. §6 lists HYROX engine improvements the research surfaced. §7 is build sequencing + effort. **§8 is the list of in-depth questions I need you to answer before I write code** — that is the actual discussion.

---

## 0. TL;DR

- The 9 choices are **not** 9 engines. They collapse into **three families** that share the deterministic periodization core (Base/Build/Peak/Taper, rebound/increase/deload microcycles, taper math, ACWR/monotony/readiness adaptation, HR-zone model, AI-fills-content boundary):
  1. **Station-hybrid family** — HYROX, DekaFit, DekaMile, DekaStrong, DekaUltra, DekaAtlas. All are "run(s) + functional stations" or "stations only." These reuse ~90% of today's HYROX engine; the differences are a **station catalog swap**, a **run:station ratio**, an **energy-system emphasis**, and (for Atlas/Ultra) a couple of new primitives. **Lowest effort.**
  2. **Triathlon family** — Ironman 70.3, Ironman 140.6. Swim/bike/run with bricks. This is the big one — it needs the `ProgramType` abstraction, a per-discipline **load currency (TSS)**, and multi-discipline volume. **Already fully spec'd** in `01-triathlon-engine.md`; this doc extends the experience-tiering + distance-specific detail. **Highest effort.**
  3. **General fitness** — no race. Same core, but **Peak/Taper are suppressed** and the linear macro-arc is replaced by a **repeating rotation of emphasis blocks** (strength → aerobic → mixed), with periodic benchmark re-tests standing in for "the race." **Medium-low effort.**
- The single architectural change that makes all of this clean — and the one thing that touches HYROX — is the **`ProgramType`/sport-registry refactor** already mandated by the triathlon spec: HYROX becomes *one implementation* of a sport interface, with **byte-identical output** proven by snapshot test. Everything else stacks on that.
- **Recommended sequencing:** (P0) sport-abstraction refactor + HYROX-unchanged proof → (P1) DEKA family (cheapest, proves the abstraction with a second station sport) → (P2) triathlon per the existing spec → (P3) general fitness → hardening. This front-loads the low-risk wins and de-risks the abstraction before the expensive triathlon work.

---

## 1. The current engine, and what carries over

The HYROX engine is a two-layer generator with a strict boundary (full map in the architecture review):

- **Deterministic engine** (`lib/engine/*`) owns *structure and numbers*: mesocycle allocation (`mesocycles.ts`), weekly volume + progression (`volume.ts`, `microcycles.ts`), session counts/placement (`slots.ts`), sequencing guards (`sequencing.ts`), strength periodization (`strength.ts`), HR zones (`zones.ts`), running paces via VDOT (`paces.ts`), HYROX station specs + pacing (`stations.ts`, `pacing.ts`), taper (`taper.ts`), needs analysis (`needs.ts`), and weekly adaptation (`adapt.ts`, `load.ts`, `readiness.ts`).
- **AI layer** (`lib/ai/*`) fills *content only* — which movement patterns land in a lift, which stations fill a hybrid, run/coaching prose — under Zod validation, then the generation layer (`lib/generation/*`) **deterministically overwrites** anything numeric (volume reconciliation, strength schemes, station progression). The engine always wins on numbers.

**What is already sport-agnostic and reused wholesale** (this is the good news):

| Subsystem | Reusable as-is? |
|---|---|
| Mesocycle allocation (base/build/peak/taper week math) | ✅ Yes — pure week-count math |
| Microcycle progression (rebound/increase/deload; masters override) | ✅ Yes — only the *units* are running-flavored |
| Taper math + A/B/C race priority model | ✅ Yes — operates on abstract volume |
| Adaptation engine (ACWR, Foster monotony/strain, readiness, earned-bump/deload rules) | ✅ Yes — operates on abstract load + compliance |
| HR-zone model (max-HR formulas, LTHR/HRR/custom bands, 20/60/10/5/5 target) | ✅ Yes — general endurance physiology |
| Sequencing guards (keep heavy legs off the day before a key run) | ✅ Yes — concurrent-training interference is general |
| The engine-owns-numbers / AI-fills-content boundary + Zod validation + reconciliation | ✅ Yes — the core design pattern |

**What is HYROX-hardcoded and must become sport-parametric:**

1. **The `SessionSlot` union** `run | lift | hybrid | rest | race` (in `lib/engine/types.ts`) — the spine everything switches on. Triathlon has no "hybrid"/"lift" analog; it has swim/bike/run/brick.
2. **The `{runs, lifts, hybrids}` weekly triad** (`slots.ts`) and per-phase count tables.
3. **"Hybrid" = the HYROX race format** (`philosophy.ts` HYBRID_GUIDANCE "exactly 4 runs + 4 events"; `stations.ts` `RACE_STATION_ORDER`, `buildSimulationElements`). This is *the* place DEKA diverges.
4. **The station catalog** (`stations.ts` `STATIONS`) — a clean data table (the best existing seam), but its `StationId` type is consumed by pacing + needs.
5. **Needs domains** `run_engine | erg_engine | strength` (`needs.ts`) with HYROX anchors.
6. **Volume currency = running miles + cardio minutes** (`volume.ts`, `reconcile.ts`) — the deepest coupling; triathlon needs a per-discipline ledger (yards/watts/miles → unified TSS).
7. **Three experience axes** running/hybrid/lifting.
8. **Division (open/pro)** + HYROX vocabulary throughout copy.

The triathlon spec's central move — a `ProgramType` interface that HYROX implements — is the right generalization for all 9. The refinement this doc adds: the interface needs to express **both** "station-hybrid" sports (which keep miles+minutes+stations) **and** triathlon (multi-discipline TSS) **and** general fitness (no race), so the abstraction is a **`SportConfig` registry** feeding a small number of `ProgramType` behaviors, not one interface per sport.

---

## 2. Architecture: three families over one core

```
                          ┌──────────────────────────────────────┐
                          │   Shared periodization core (reused)  │
                          │  mesocycles · microcycles · taper ·   │
                          │  adaptation (ACWR/monotony/readiness)·│
                          │  HR zones · sequencing · AI boundary  │
                          └──────────────────────────────────────┘
                                          ▲
              ┌───────────────────────────┼───────────────────────────┐
              │                           │                           │
   ┌──────────────────────┐   ┌──────────────────────┐   ┌──────────────────────┐
   │ FAMILY A             │   │ FAMILY B             │   │ FAMILY C             │
   │ Station-Hybrid       │   │ Triathlon            │   │ General Fitness      │
   │ (run(s)+stations)    │   │ (swim/bike/run+brick)│   │ (no race)            │
   ├──────────────────────┤   ├──────────────────────┤   ├──────────────────────┤
   │ HYROX                │   │ Ironman 70.3         │   │ General Fitness      │
   │ DekaFit              │   │ Ironman 140.6        │   │  (+ optional sub-goal)│
   │ DekaMile             │   │                      │   └──────────────────────┘
   │ DekaStrong           │   │ per-discipline TSS   │
   │ DekaUltra            │   │ load currency;       │
   │ DekaAtlas            │   │ bricks; CSS/FTP zones│
   │                      │   └──────────────────────┘
   │ miles+minutes+station│
   │ catalog swap per event│
   └──────────────────────┘
```

**The registry.** Each of the 9 choices resolves to a `SportConfig` providing: discipline/modality set, station catalog (if any), per-phase session-count tables, run:station ratio, simulation builder, pacing reference table, needs domains + scoring anchors, experience axes + their measurable definitions, energy-system emphasis (which shapes the zone distribution + intensity mix), and copy/philosophy strings. The engine resolves `SportConfig[sport]` instead of importing HYROX constants inline.

**Why three families, not one flat registry:** Families A and C share the miles+minutes volume currency and the run/lift/station primitives; only their catalogs and phase logic differ, so they're config variations of the existing engine. Family B breaks the volume currency and session primitives, so it needs the deeper `ProgramType` behavior. Grouping keeps the shared code shared and isolates the genuinely different math.

---

## 3. Per-sport design

Each section gives: **(a) format & demands**, **(b) philosophy & periodization**, **(c) experience tiering**, **(d) key sessions**, **(e) benchmarks / needs analysis**, **(f) load model**, **(g) unique challenges / engine deltas.** Reps/loads are 2025 standards — the DEKA Rules PDF is versioned and changes; the engine should keep these in a single editable table and show a "verify against your event's current standards" note.

### 3.1 HYROX (baseline — item 1)

The engine already does this. Recap for contrast: **8 × 1 km runs alternating with 8 functional stations** (ski erg 1000 m, sled push 50 m, sled pull 50 m, burpee broad jumps 80 m, row 1000 m, farmers carry 200 m, sandbag lunges 100 m, wall balls 100/75 reps), ~60–90 min, ~50% running. Aerobic-endurance + strength-endurance ("half-marathon + CrossFit"). Open/Pro divisions, sex-scaled loads. Experience axes running/hybrid/lifting. Proposed improvements in §6.

### 3.2 DekaFit (item 2)

**(a) Format & demands.** 10 "zones" (stations) in fixed order 1→10, each **preceded by a 500 m run → 5 km total running**. ~30 min (elite) to ~50 min (age-group). The 10 zones: (1) RAM alternating reverse lunge ×30, (2) Row 500 m, (3) box step/jump-over ×20, (4) sit-up throw ×25, (5) Ski 500 m, (6) farmers carry 100 m, (7) air bike 25 cal, (8) dead-ball wall/yoke-over ×20, (9) magnetic sled push+pull 100 m, (10) RAM weighted burpee ×20. Loads are lighter and reps/distances shorter than HYROX. **Energy system: high-end aerobic / threshold intervals** — but with shorter, faster run reps (500 m vs HYROX's 1 km) it skews **more anaerobic/repeat-effort** than HYROX. The sled (zone 9) is the single slowest zone; grip (farmers + dead ball + ergs + burpees) and running economy under fatigue are the limiters.

**(b) Philosophy & periodization.** Same Base→Build→Peak→Taper. Versus HYROX: **shorter, sharper run intervals** (500 m repeats at threshold-to-CVO2 rather than 1 km), **more transition-efficiency work** (fast on/off the erg, quick station entries), and **stations trained at race reps for speed, not just endurance**. Base builds aerobic capacity + general strength; Build shifts to 500 m repeat-run economy + station-circuit specificity; Peak runs full 10-zone simulations; standard taper. Published DEKA plans are commonly 12-week 3-phase — our engine's 4–24-week variable length is a superset.

**(c) Experience tiering** (same 3 axes as HYROX — running / hybrid / lifting — because the sport is run+station):
- *Running:* beginner <15 mi/wk, intermediate 15–30, advanced >30 (reuse HYROX). But weight **500 m repeat ability** in the needs test.
- *Hybrid:* beginner ≤1 HIIT/wk, intermediate 2, advanced ≥3 (reuse).
- *Lifting:* <3 yr / 3–5 / >5 (reuse).
- DekaFit-specific overlay: an isolated **10-zone time trial** (or a partial 5-zone) maps the athlete onto competitive bands (elite ~30 min, competent AG ~40–50 min).

**(d) Key sessions.** 500 m repeat runs (6–10 × 500 m off short rest); erg intervals (row+ski back-to-back to train fatigued pulling); sled push/pull leg-drive endurance; grip circuits (farmers + dead ball); RAM-burpee glycolytic finishers; full/partial zone simulations in Peak.

**(e) Benchmarks / needs.** Reuse HYROX benchmarks (run times, 2k row/ski, bike cals, 5RM lifts) **plus** DEKA-specific zone TTs: 500 m row + 500 m ski back-to-back, 100 m sled at Rx, farmers 100 m unbroken, 20-rep RAM burpee for time. Needs domains: run_engine, erg_engine, strength — reused, but with DEKA anchors (faster/lighter than HYROX).

**(f) Load model.** Miles + cardio minutes (reuse). Running volume is lower than HYROX (5 km race vs 8 km) so starting mileage bands and weekly targets scale down slightly.

**(g) Unique challenges / engine deltas.** New station catalog (`DEKA_STATIONS` with the 10 zones + loads by sex/division), new `RACE_STATION_ORDER` (10, run-before-each), `buildSimulationElements` variant (500 m → zone × 10), pacing table for the 10 zones. **Run:station ratio and run length differ** — hybrid guidance becomes "run 500 m + 1 zone," not "1000 m + 1 event." Everything else reuses.

### 3.3 DekaMile (item 4)

**(a) Format & demands.** Same 10 zones, each **preceded by a 160 m run → 1 mile (1600 m) total**. Elite ~16 min. The 160 m sprints are short enough to run **hard**, so DekaMile is a **VO2max / anaerobic-capacity / repeat-sprint** event — the most intense of the running DEKAs per unit time. Limiter: repeat-sprint ability + lactate tolerance while doing station work.

**(b) Philosophy & periodization.** Shift the run work toward **short, fast repeats** (160–400 m at ~VO2/mile pace) and **lactate-tolerance intervals**; stations trained for speed (race reps unbroken). Base still aerobic; Build heavy on anaerobic capacity + station speed; Peak simulations; short taper. Because total volume is small (~1 mile), this is the DEKA that most rewards top-end power over aerobic base.

**(c) Experience tiering.** Same 3 axes. Running-experience overlay weighted toward **400 m/mile speed** rather than distance base. A strong 5K runner who's never sprinted repeatedly is still a DekaMile intermediate.

**(d) Key sessions.** 160/200/400 m repeats at mile-to-VO2 pace; lactate-tolerance sets (e.g. 8–12 × 200 m hard/short rest with a station between); station speed work; full simulations.

**(e)–(f)** Benchmarks reuse + emphasize 400 m/1-mile time; miles+minutes currency (very low mileage). Needs: same domains, anchor toward speed.

**(g) Engine deltas.** Reuses DekaFit's 10-zone catalog; only the **run segment length (160 m) and total running (1 mile)** differ, plus a shift in the zone-target distribution toward Z4/Z5. A clean parameterization of DekaFit.

### 3.4 DekaStrong (item 3)

**(a) Format & demands.** Same 10 zones, **no running, no cardio transitions** — stations back-to-back. Elite ~10:33; competent ~15–25 min. **Anaerobic-glycolytic / strength-endurance dominant** — a ~10–20 min grip-and-grind with no running to "recover into." Limiters: the two erg pulls back-to-back (row+ski), the sled, dead-ball shoulder-overs, and grip.

**(b) Philosophy & periodization.** This is the DEKA where **running is secondary**. Periodization tilts toward **strength-endurance + glycolytic capacity + grip**: heavier station-specific work, EMOM/interval circuits, lactate tolerance. Aerobic base still matters (recovery between stations) but as a minimum dose, not the focus. Base = general strength + work capacity; Build = station circuits at race intensity + glycolytic intervals; Peak = full 10-zone sims; short taper. This meaningfully **rebalances the run/hybrid/lift mix toward lift+hybrid**.

**(c) Experience tiering.** Here the **lifting and hybrid axes dominate**; the running axis is de-weighted (used only to size the maintenance aerobic dose). Consider surfacing this to the user: DekaStrong beginners are defined more by work-capacity/strength than by running.

**(d) Key sessions.** Station circuits (all 10 for time, or clusters); erg-pull intervals (row+ski fatigue sets); grip endurance (farmers + dead ball); glycolytic finishers; sled leg-drive; maintenance Z2 cardio 1–2×/wk.

**(e)–(f)** Benchmarks emphasize erg TTs, sled, grip, and station-circuit time; **the running benchmarks become optional/secondary.** Load currency: still trackable as "cardio minutes" (station work is cardio) + a strength-volume signal; running miles near zero.

**(g) Engine deltas.** The biggest station-family divergence: **no run slots by default** (or minimal maintenance runs), so `slots.ts` needs a sport where hybrids/lifts dominate and runs are a floor, not a core. The 10-zone catalog is reused (Strong/Mile variants of zones 4 & 8). Zone-target distribution shifts toward Z4/Z5. Simulation = 10 zones, no runs.

### 3.5 DekaAtlas (item 6)

**(a) Format & demands.** A **distinct, heavier 10-zone set** (NOT the standard zones), **no running**, **30-min cap**. Zones: barbell thruster ×20 (95/65 lb), bar-facing burpee-over-bar ×20, surrender lunge ×20 (50/35), single-arm DB ground-to-overhead ×20 (50/35), DB bear crawl 40 m (50/35 ea.), weighted sit-up ×20, farmers carry 60 m (100/70 ea.), DB shoulder-to-overhead ×20 (50/35 ea.), single-unders ×100, Atlas shoulder-to-carry 100 m (100/70). **Strength-endurance / maximal-strength-leaning** — the heaviest DEKA; overhead-pressing endurance + grip are the make-or-break. Least aerobic. Rx and Foundation (scaled) divisions.

**(b) Philosophy & periodization.** This is the closest DEKA to a **strength-conditioning / barbell-metcon** program. Periodization tilts hardest toward **maximal + strength-endurance**: heavier compound lifting (thruster, press, carry patterns), overhead-pressing volume, loaded carries, with glycolytic conditioning layered on. The engine's `strength.ts` (movement-pattern periodization with intensity %/RIR) is a strong fit here — Atlas is arguably **more of a strength sport than a running sport**.

**(c) Experience tiering.** **Lifting axis dominates**; a real absolute-strength floor matters (95 lb thruster, 100 lb/hand carry). Running axis largely irrelevant. Beginner/intermediate/advanced keyed to lifting training age + relative-strength standards (squat/press/carry).

**(d) Key sessions.** Barbell strength (thruster, press, front squat, clean variants); overhead-pressing endurance (DB S2OH volume); loaded carries (farmers + Atlas carry); barbell metcons / chippers; single-under conditioning; full Atlas simulations.

**(e)–(f)** Benchmarks: 5RM squat/deadlift/press (reuse) **plus** overhead-press endurance, 100 lb/hand carry distance, thruster capacity. Needs domains shift to **strength / press-endurance / glycolytic** rather than run/erg/strength. Load currency: strength volume + cardio minutes; miles ≈ 0.

**(g) Engine deltas.** New heavier station catalog (`ATLAS_STATIONS`); a **new "loaded carry" + "overhead endurance" primitive**; heaviest tilt toward `strength.ts`. This is the DEKA that stretches the station-hybrid family most — it's really a strength sport wearing a station skin. Flag: DekaAtlas standards are the least-verified (community sources) — keep loads editable.

### 3.6 DekaUltra (item 5)

**(a) Format & demands.** **5× consecutive DekaFit courses non-stop** = **50 zones (each zone ×5) + 25 km running**. Multi-hour (elite cut-offs ~3:45 M / 4:15 W; AG cap 9 h). **Aerobic / muscular-endurance** — the one DEKA *more* endurance-heavy than HYROX. Challenge shifts to **fueling, repeated eccentric loading (lunges/box-overs/sled ×5), grip/soft-tissue durability over hours,** and pacing.

**(b) Philosophy & periodization.** Train like an **ultra-hybrid**: big aerobic base, long "durability" sessions (long runs + long station-circuit blocks), fueling rehearsal, eccentric-load tolerance. Longer program length (toward the 24-week cap), bigger Base, more conservative ramp, **fueling flags on long sessions** (borrows the triathlon duty-of-care module). Peak = partial/full multi-lap simulations at controlled effort; standard-to-extended taper.

**(c) Experience tiering.** **Running/aerobic axis dominates** (opposite of Strong/Atlas). Advanced = big aerobic base + durability history; beginners should probably be gated or warned (a 3:45–9 h event is a duty-of-care concern for undertrained athletes).

**(d) Key sessions.** Long runs; long station-circuit "durability" blocks; back-to-back zone laps at controlled effort; fueling-rehearsal long sessions; eccentric-tolerance work; standard DEKA speed work in smaller doses.

**(e)–(f)** Benchmarks: aerobic (10k+ / long-run history) weighted highest; miles+minutes currency with **much higher volume** than DekaFit. Needs: run_engine weighted heavily; durability (Riegel) signal matters.

**(g) Engine deltas.** Reuses DekaFit catalog ×5; needs **long-session progression + fueling flags** (shared with triathlon long-course); higher volume bands; possibly a "big-week/recovery-week" structure like long-course. The endurance end of the station family.

### 3.7 Ironman 70.3 (item 8)

**(a) Format & demands.** 1.9 km swim / 90 km bike / 21.1 km run, ~4–6 h. Predominantly sub-threshold aerobic. Bike is the largest time block; the 13.1 mi run off the bike is proportionally punishing. Fully covered by `01-triathlon-engine.md` (P1/P2). This doc adds the distance-specific + tiering detail below.

**(b) Philosophy & periodization.** Base (aerobic + swim technique) → Build (race-specific bike threshold/sweet-spot + run tempo + bricks) → Peak (race-pace bricks) → 2-week taper. **Program length 12 (advanced) / 16 (intermediate) / 20–24 (beginner) weeks.** 3:1 load:recovery mesocycles (2:1 for masters). Discipline balance ~**25% swim / 48% bike / 27% run** of training time, bike share peaking in Build.

**(c) Experience tiering — per discipline (swim/bike/run independently):**
- *Swim* (metric CSS/100 m): beginner slower than 2:00 or can't swim 1.9 km continuously; intermediate 1:35–2:00 + continuous distance; advanced faster than 1:35, races the swim, OW-comfortable.
- *Bike* (FTP W/kg): beginner <2.9 M / <2.4 F, can't hold aero long; intermediate 2.9–3.6 M / 2.4–3.0 F; advanced >3.6 M / >3.0 F, holds aero at target power.
- *Run* (threshold pace + off-bike ability): beginner >5:30/km or run/walks; intermediate 4:30–5:30/km, runs the distance off the bike; advanced <4:30/km, runs strong off the bike. **"Can you run the race distance off the bike?" is weighted heavily** — a fast open runner who's never run a half off a 90 km ride is still a run-beginner here.

**(d) Key sessions.** Swim: technique/drills, CSS intervals (primary in Build), threshold/endurance, open-water. Bike: long endurance ride, sweet-spot (primary FTP-builder), threshold/FTP intervals, VO2 (more 70.3-relevant than 140.6). Run: easy Z2 (majority), long run, tempo/threshold, intervals, brick runs. Bricks: 2 h ride→1 h run building to 3 h→90 min; 1–2×/wk ramping in the final 6–8 wk.

**(e) Benchmarks / needs.** CSS (400 m + 200 m TT), FTP (20-min ×0.95 / ramp / self-report), run threshold pace. Per-discipline HR anchors. Needs domains become **swim / bike / run** limiters.

**(f) Load model.** **Per-discipline TSS → unified currency** (sTSS via CSS, bike via power/FTP, rTSS via threshold pace, hrTSS fallback). Combined weekly load = simple sum (this is the linchpin — never mix TRIMP scales). Full detail in the triathlon spec §5.4/§8.

**(g) Long-session caps + taper.** Long ride ≤4 h / long run ≤2 h at peak; taper ~2 wk, −40–60% volume, intensity held, cut run volume least.

### 3.8 Ironman 140.6 (item 7)

**(a) Format & demands.** 3.8 km swim / 180 km bike / 42.2 km run, ~9–17 h. Deep aerobic + fueling is a *trained variable*. Deferred to P3 in the triathlon spec for duty-of-care reasons (5–6 h sessions, fueling, EAH risk).

**(b) Philosophy & periodization.** Same phase model, **scaled**: **Base 12+ wk**, program length **24–30 wk** (beginner longer; optimal runway ~a year). Discipline balance ~**20% swim / 50% bike / 30% run** (Friel default). Race intensity is only ~65–76% of threshold → late Build/Peak shifts **away from sweet-spot toward Tempo/Z2 durability**. 2–3 rest/recovery days per week. Peak weekly volume 12–20 h (expose a "traditional high-volume vs time-crunched quality-first" toggle — the biggest legitimate disagreement in the literature).

**(c) Experience tiering.** Same per-discipline axes as 70.3, but the **"can you run/ride the distance" bar is higher** and beginners need the long runway. Consider gating true beginners into 70.3 first (duty of care).

**(d) Key sessions.** As 70.3 but longer: long ride 5–6 h (cap ~6 h), long run 2:30–3:00 & ≤20 mi (**never the full marathon in training**; use walk breaks past 3 h). The **"4–5 h ride → 60–90 min race-pace run" brick is the single most predictive session** — 90 min run is the near-universal ceiling. Big-week/recovery-week structure.

**(e)–(f)** Same benchmarks + load model as 70.3.

**(g) Long-session caps + taper + fueling.** Longest ride ~80–90% of race bike split; longest run only ~55–70% of race marathon. Taper 2–3 wk, ladder ~90→70→50→30% of peak. **Fueling/duty-of-care is a load-bearing feature:** 60–90 g carb/hr (up to 120 gut-trained), individualized fluid/sodium, EAH + bonk + heat warnings, "rehearse race nutrition, never debut it on race day," medical-clearance + bail-out prompts for any >5–6 h session. DekaUltra reuses this module.

### 3.9 General Fitness (item 9)

**(a) Format & demands.** No race, no date. The user wants to be broadly fit — strength + aerobic capacity + body composition + health. Peak and Taper lose their anchor.

**(b) Philosophy & periodization.** **Kill the countdown.** Make **Base the permanent default**; **suppress Peak/Taper** (retain as opt-in if the user later adds an event). Replace the linear macro-arc with a **repeating rotation of ~3–5-week emphasis mesocycles: strength → aerobic/GPP → mixed(power+capacity) → repeat**, each loop starting from a higher baseline. Keep the existing rebound/increase/deload microcycles *inside* each block. Evidence: for non-elite populations no periodization model is superior given progressive overload + variation, so rotating emphasis (which maintains all qualities year-round) beats peaking-for-a-date.

**(c) Experience tiering.** Tier **cardio and lifting independently** by training age / rate-of-adaptation (novice = <~1 yr consistent progressive loading; PR cadence session→week→month distinguishes novice/intermediate/advanced). Beginners get fixed prescriptions + mostly Z1–Z2 + simple linear progression; intermediates get weekly undulation + 1 VO2 + RPE/RIR; advanced get full autoregulation + polarized 80/20 with 2–3 quality sessions. Minimum-effective-dose evidence (single-set / 1–2 sessions/wk holds or builds a quality) powers the "maintain the non-emphasized quality" logic.

**(d) Default weekly dose (health + longevity anchored).** Aerobic 200–300 min/wk (upper guideline band), base-heavy 80/20 with **1 genuine VO2max session/wk** (e.g. Norwegian 4×4) so the ceiling rises — VO2max is the highest-value longevity KPI. Strength 2–3 full-body-equivalent days across all 7 patterns, ~10 hard sets/muscle/wk. **The existing 20/60/10/5/5 distribution already encodes a defensible polarized model** — reuse it as the base state.

**(e) Sub-goal bias (optional question).** "General fitness" is a bundle; offer one optional sub-goal — **body recomp/fat-loss, general strength, general endurance/GPP, or balanced (default)** — applied as a **volume-allocation bias vector** with hard floors on the de-emphasized quality (never drop below health-protective cardio or below 2 strength days). Same engine, different ratios.

**(f) Load model.** Miles + cardio minutes + strength volume (reuse). No race → no taper currency needed.

**(g) Progress mechanism replaces the race.** Institute a **benchmark re-test every 8–12 weeks** at deload boundaries (VO2max estimate / time-trial + estimated 1RMs on main patterns + optional body-comp/work-capacity). **The re-test is the race** — PRs and trend lines supply motivation and let the engine autoregulate the next block's emphasis (e.g. VO2 stalled → bias next loop aerobic). Concurrent-training interference is handled as **scheduling rules** (prioritized quality first; ≥3 h ideally a day between hard-lift and hard-interval; easy cardio pairs with hard lifting; keep intervals off heavy-leg days) — only explosive power is meaningfully at risk.

**Engine deltas:** a `ProgramType` that (i) emits no race/taper, (ii) rotates emphasis instead of building to a peak, (iii) runs the re-test cadence, (iv) applies the sub-goal bias vector. Reuses volume, zones, strength, microcycles, adaptation.

---

## 4. Unified experience-level matrix

Three sports use running/hybrid/lifting; triathlon uses swim/bike/run; Atlas/Strong tilt to lifting; general fitness uses cardio/lifting. The registry should hold, **per sport, the set of experience axes and each axis's measurable definition.** Proposed defaults:

| Axis | Beginner | Intermediate | Advanced | Used by |
|---|---|---|---|---|
| **Running** | <15 mi/wk (6 mo) | 15–30 mi/wk | >30 mi/wk | HYROX, DekaFit/Mile/Ultra, GenFit |
| **Hybrid (HIIT)** | ≤1/wk | 2/wk | ≥3/wk | HYROX, all DEKA |
| **Lifting** | <3 yr | 3–5 yr | >5 yr | HYROX, all DEKA, Atlas(primary), GenFit |
| **Swim** | can't swim race dist. continuously, or CSS >2:00/100m | continuous + CSS 1:35–2:00 | CSS <1:35, races swim, OW-comfortable | 70.3, 140.6 |
| **Bike** | FTP <2.9 M/<2.4 F W/kg | 2.9–3.6 M / 2.4–3.0 F | >3.6 M / >3.0 F | 70.3, 140.6 |
| **Tri-Run** | >5:30/km or run/walk, can't run dist. off bike | 4:30–5:30/km, runs dist. off bike | <4:30/km, runs strong off bike | 70.3, 140.6 |
| **Cardio (GenFit)** | can't run 30 min continuous | 5–10k comfortable, 1–2 quality/wk | established base, polarized 2–3 quality | GenFit |

Each sport's `SportConfig` names which axes apply and how they weight the needs analysis (e.g. DekaStrong de-weights running; DekaUltra weights it heavily; Atlas centers lifting).

---

## 5. Engine / DB / UX change plan

This extends the triathlon spec's plan to cover the station family and general fitness. **Additive, backward-compatible, HYROX untouched behaviorally.**

**5.1 Sport discriminator (entry point).** Add `sport` to `GenerationInput`, `EngineInput`, `ProgramSkeleton`, and the `programs` row (superset of the triathlon spec's `program_type`). Values: `hyrox | deka_fit | deka_mile | deka_strong | deka_atlas | deka_ultra | tri_70_3 | tri_140_6 | general_fitness`. Default `hyrox`; backfill is a no-op. The onboarding form's first step becomes "What are you training for?" → sport picker → sport-specific sub-form.

**5.2 `SportConfig` registry** (`lib/engine/sports/*`). One module per sport (or per family with params) exporting: modality/discipline set, station catalog + race order + simulation builder, per-phase session-count tables, run:station ratio, energy-system → zone-distribution override, needs domains + anchors, experience axes + definitions, pacing reference table, and philosophy/copy strings. `buildSkeleton`, `slots.ts`, `assemble.ts`, `philosophy.ts`, `prompts.ts` resolve `SportConfig[sport]` instead of HYROX constants.

**5.3 Generalize the `SessionSlot` union.** The family-A sports keep `run | lift | hybrid | rest | race` but with a **sport-provided station catalog and run/station geometry**. Family B adds `swim | bike | brick`. Family C adds nothing structural but changes phase logic. Cleanest approach: keep discriminated `kind`s but make the *valid set + counts* sport-provided; every `switch (kind)` site (`slots.ts`, `assemble.ts`, `reconcile.ts`, `session-volume.ts`, `sequencing.ts`, `skeleton-schema.ts`) reads from the config.

**5.4 Volume currency.** Family A + C keep miles + cardio minutes (+ a strength-volume signal for Strong/Atlas). Family B needs the **per-discipline TSS ledger** from the triathlon spec (this is the deep refactor; it's isolated to family B).

**5.5 Station catalogs.** New editable data tables: `DEKA_STATIONS` (10 zones, Fit/Mile/Strong load variants, sex/youth/masters mods), `ATLAS_STATIONS` (10 heavier zones, Rx/Foundation). Keep loads/reps in one file with a "verify vs current event standards" note (the DEKA Rules PDF is versioned).

**5.6 Needs analysis.** `NeedsDomain` becomes per-sport (run/erg/strength for station sports; swim/bike/run for tri; strength/press-endurance/glycolytic for Atlas; cardio/strength for GenFit). The relative-gap limiter logic in `needs.ts` is sport-neutral and reused; only anchors + domain sets change.

**5.7 General-fitness `ProgramType`.** Emits no race/taper; rotates emphasis blocks; runs the 8–12-week re-test cadence; applies sub-goal bias. This is the one place the macro-arc genuinely differs.

**5.8 DB (extends triathlon spec migrations).** `programs.sport` (or reuse `program_type` widened); discipline/station benchmarks; session `discipline`/station metadata; multisport logging + `load_tss` (family B); generation job queue for long plans (140.6/Ultra). Station-family sports mostly need only the `sport` column + catalog code — few/no new tables.

**5.9 UX.** Sport picker → per-sport benchmark wizard (station TTs for DEKA; CSS/FTP/threshold for tri; VO2/1RM for GenFit) showing derived zones immediately; per-sport week/session cards; general-fitness "no race, re-test in N weeks" framing.

---

## 6. Proposed HYROX engine improvements (the "add to the engine if warranted")

The research surfaced a handful of changes worth folding into the HYROX engine — most are **the refactor itself** plus small science updates:

1. **The `ProgramType`/`SportConfig` refactor** (net-neutral to HYROX, proven byte-identical) — makes HYROX one implementation and unlocks everything else. This is the main "change," and it's the triathlon spec's P0.
2. **Expose the intensity-distribution model as phase-dependent polarized↔pyramidal.** The triathlon research (Seiler/Plews/Festa) and general-fitness research both support base-polarized → build/peak-pyramidal. HYROX currently uses fixed per-phase zone targets; making the polarized→pyramidal shift explicit (and configurable) is a small, well-supported upgrade that also serves the other sports.
3. **Guarantee ≥1 true VO2max session/week in appropriate phases.** The general-fitness VO2max/longevity evidence (and DekaMile's VO2 demand) argue for ensuring the top-zone allocation lands as a *structured* VO2 session (e.g. 4×4-style) rather than being diffused. Minor tweak to run-type selection.
4. **Consider a "traditional vs time-crunched" volume philosophy toggle.** Legitimate literature disagreement on peak volume (esp. long course) suggests exposing peak-volume as a philosophy parameter rather than a hardcoded constant — benefits HYROX too (some athletes over-volume).
5. **Fueling/duty-of-care flags for long sessions** — HYROX sessions are short, so low priority for HYROX, but the shared module built for 140.6/Ultra can surface light guidance on the longest HYROX simulations.

None of these change HYROX's core prescriptions; #1 is structural, #2–#5 are small, well-cited refinements. **I would not change HYROX's periodization, station specs, or needs model** — they're sound.

---

## 7. Build sequencing & effort

| Phase | Scope | Effort | Exit gate |
|---|---|---|---|
| **P0 — Abstraction refactor** | `sport` discriminator + `SportConfig` registry + `ProgramType`; HYROX becomes an implementation; move shared periodization to `lib/engine/shared/`. **No user-visible change.** | M | HYROX plan **byte-identical** (snapshot test); `next build` green |
| **P1 — DEKA station family** | DekaFit + DekaMile + DekaStrong first (share the 10-zone catalog); then DekaAtlas (new catalog) + DekaUltra (long-session + fueling). Station catalogs, run:station geometry, per-sport needs anchors, benchmark TTs, onboarding + cards. Reuses miles+minutes currency. | M–L | Valid periodized plans for each DEKA format; vitest on catalogs + geometry; HYROX still byte-identical |
| **P2 — Triathlon** | Per `01-triathlon-engine.md` P0–P2: 70.3 + Olympic/sprint scaffold, per-discipline TSS, bricks, CSS/FTP zones, background generation job, combined-load adaptation. Then 140.6 (P3 in that spec) with fueling/duty-of-care. | L (XL with 140.6) | End-to-end generate→log→weekly Apply on combined load |
| **P3 — General fitness** | Rotating-emphasis `ProgramType`; suppress peak/taper; re-test cadence; sub-goal bias vector. | M | Valid open-ended plan; re-test loop drives next block |
| **P4 — Hardening** | HYROX improvements #2–#5; masters/duty-of-care review; cross-sport polish. | M | — |

**Why DEKA before triathlon** (a change from the triathlon spec's implicit ordering): DEKA is the cheapest second sport (reuses the volume currency + primitives), so it **proves the `SportConfig` abstraction with a real second sport before** the expensive triathlon volume-currency refactor — lower risk, faster visible wins, and it validates the registry design. Triathlon remains the flagship/brand-thesis bet and can run in parallel once P0 lands. (This ordering is one of the open questions — you may want triathlon first for brand reasons.)

---

## 8. In-depth design questions (the discussion)

These are the decisions I need from you before writing engine code. Grouped by theme.

**A. Architecture & scope**
1. Do you agree with the **three-family model** (station-hybrid / triathlon / general-fitness) over one shared core, with HYROX refactored into one `SportConfig` implementation proven byte-identical?
2. **Build order:** DEKA family first (cheapest, de-risks the abstraction) then triathlon, or triathlon first (brand thesis)? Or parallel after P0?
3. Are we building **all 5 DEKA formats**, or a subset first? (DekaFit is the flagship; DekaAtlas has a totally different heavier catalog + is the least-verified standards-wise; DekaUltra is multi-hour with duty-of-care. My instinct: Fit → Mile → Strong → Atlas → Ultra.)

**B. Sport-specific design**
4. **DekaStrong/Atlas de-emphasize or remove running.** Are you comfortable with a station sport where run slots are minimal/zero and lift+hybrid dominate — i.e. the engine producing a fundamentally different weekly shape than HYROX? Any objection to Atlas being treated as "mostly a strength sport"?
5. **DekaUltra + Ironman 140.6 duty-of-care:** should we **gate true beginners** out of the ultra-endurance options (require intermediate+, or route them to a shorter distance first), given 3:45–9 h / 9–17 h events? Or allow anyone with warnings?
6. **General-fitness sub-goal:** ask one optional sub-goal (recomp / strength / endurance / balanced) and bias the volume ratios, or keep general-fitness a single balanced program for v1?
7. **General-fitness structure:** are you on board with **suppressing Peak/Taper** and using **rotating emphasis blocks + periodic re-tests** as "the race" for open-ended users? Any preference on the rotation (e.g. strength→aerobic→mixed vs a different cycle)?

**C. Experience & benchmarks**
8. **Per-sport experience axes** — confirm the matrix in §4. Specifically: for triathlon, are you happy tiering swim/bike/run **independently** (an athlete can be advanced-run / beginner-swim)? For DEKA, keep the HYROX running/hybrid/lifting axes with per-format weighting?
9. **Benchmark burden:** DEKA benefits from isolated **zone time-trials**, triathlon from **CSS/FTP field tests**. How much do we *require* vs. make optional with sensible defaults? (Today HYROX requires only 5K time.) More required benchmarks = better personalization but higher onboarding friction.
10. **DEKA/Atlas loads change with the versioned Rules PDF.** OK to ship a single editable standards table with a "verify against your event's current rules" disclaimer, and update it as standards move?

**D. HYROX changes**
11. Which of the proposed HYROX improvements (§6) do you want folded in: just the structural refactor (#1), or also the polarized→pyramidal intensity model (#2), the guaranteed weekly VO2 session (#3), the volume-philosophy toggle (#4)? I'd default to #1 now, #2–#4 in P4, and leave HYROX's core prescriptions untouched.

**E. Process**
12. **How far do you want me to go before the next check-in?** This doc is the design "work." Actually building 8 sports of engine code + DB + UI is a large, multi-week effort best done after we align on A–D — and, given the scale, it's a strong candidate for **multi-agent orchestration** (parallel per-sport implementation with a shared abstraction and adversarial verification). Do you want me to (i) refine this spec based on your answers, (ii) implement P0 (the abstraction refactor + HYROX byte-identical proof) as the first concrete step, or (iii) something else? If you want the big parallel build, say the word and I'll scope a workflow with a rough token/cost estimate.

---

*Sources for the training science behind every per-sport section are captured in the research appendices (DEKA Rules of Competition PDF + fitnessexperiment.co/competitive.fit; MyProCoach/Friel/TrainingPeaks/Scientific Triathlon/Seiler/Plews/Festa for triathlon; CDC/WHO/Mandsager/Seiler/Barbell Medicine/Stronger-by-Science for general fitness). Full citations available on request or I can inline them into this doc.*
