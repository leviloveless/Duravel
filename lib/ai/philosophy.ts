/**
 * Coaching philosophy → prompt rules (architecture-plan.md §5 "Philosophy injection").
 *
 * These are the programming-relevant answers (Q13–24) from
 * requirements-questionnaire.md, distilled into the qualitative guidance the
 * Session Generator needs. The engine (Milestone 3) already owns all the
 * *math* — mesocycle allocation, microcycle volume, zone %, taper cuts — so
 * the AI is told only what *fills* each prescribed slot: run character and
 * pacing, lift rep ranges + movement patterns, and hybrid composition.
 *
 * Updating requirements-questionnaire.md and mirroring the change here changes
 * every future program. `PHILOSOPHY_VERSION` is stamped on each generation so
 * programs remain reproducible/auditable across philosophy edits.
 */

export const PHILOSOPHY_VERSION = "questionnaire-2026-07-09";

/** HR zones (spec §3). Intensity is always prescribed as a zone. */
export const ZONE_DEFINITIONS = `Heart-rate zones (max HR = 220 − age):
- Zone 1 (<60% max HR): recovery / very easy
- Zone 2 (60–70%): easy aerobic / base building
- Zone 3 (70–80%): moderate aerobic / tempo
- Zone 4 (80–90%): threshold / lactate threshold
- Zone 5 (90–100%): max effort / VO2 max`;

/** Run-type character + pace guidance (spec §5a, Q14/Q17). */
export const RUN_GUIDANCE = `Run types and how to prescribe them:
- easy: Zone 1–2, conversational pace, aerobic base.
- fartlek / progression: Zone 2 with a natural pace pickup over the final 10–15 min; the dominant quality run in the Base phase (no structured tempo in Base).
- long: Zone 2, extended duration, aerobic development. Every week has exactly one long run.
- tempo: Zone 3–4, 20–35 min continuous at ~80–90% max HR (≈ half-marathon pace); introduced in the Build phase, one per week.
- threshold: Zone 4, true lactate threshold, "comfortably hard," ~20–30 sec/mile slower than 5K pace; the primary quality run in the Peak phase.
- interval: Zone 4–5, short hard repeats with rest.
- hybrid_run: Zone 4 (threshold pace); these are the runs inside hybrid sessions and already count toward the weekly run total.

Pace: if the athlete provided benchmarks (mile / 5K / 10K), derive paces from them. Threshold ≈ 20–30 s/mile slower than 5K pace; tempo ≈ half-marathon pace; easy ≈ 1.5–2.5 min/mile slower than 5K pace. If no benchmarks are given, prescribe by zone/effort and give a reasonable pace estimate in min/mile.`;

/** Lifting rules (spec §5b, Q16/Q23). */
export const LIFT_GUIDANCE = `Weightlifting: exactly 3 sessions in a full training week — 1 upper, 1 lower, 1 full body.
Rep ranges: full-body sessions 5–7 reps (strength); upper- and lower-body sessions 12–15 reps (hypertrophy/endurance).
Every full training week MUST include all 7 non-negotiable movement patterns across its lift sessions:
squat, hip_hinge, lunge, horizontal_press, vertical_press, horizontal_pull, vertical_pull.
For each movement give: pattern, number of sets, and rep range. If a 5-rep-max benchmark was provided, you may suggest a starting weight (~75–80% of 5RM) for that lift.`;

/** Hybrid (HYROX-specific) rules (spec §5c, Q18). */
export const HYBRID_GUIDANCE = `Hybrid sessions simulate the HYROX format: threshold-pace runs interleaved with non-running cardio/strength stations. Compose each hybrid session from the station library for its mesocycle plus threshold runs. Prescribe each element as reps / distance / calories / time, and give the run pace. Assign a goal HR zone (typically Zone 4). Each hybrid session should total between 25 and 60 minutes of WORK time (excluding warmup/cooldown) — size the number of elements and their prescriptions to land in that range. Keep a small, repeatable set of hybrid workouts within a mesocycle; rotate/replace them between mesocycles rather than inventing a unique one every week.`;

/** Rotating hybrid station library, biased by mesocycle (spec §5c, Q24). */
export const HYBRID_LIBRARY: Record<"base" | "build" | "peak" | "taper", string[]> = {
  base: ["ski erg", "row erg", "assault bike", "wall balls", "farmers carry"],
  build: ["ski erg", "row erg", "sled push", "sandbag lunges", "wall balls", "burpee broad jumps"],
  peak: ["ski erg", "row erg", "sled push", "sled pull", "sandbag lunges", "wall balls", "burpee broad jumps", "farmers carry"],
  taper: ["ski erg", "row erg", "wall balls"],
};

/** A/B/C race taper philosophy — how to fill sessions in a taper/race week. */
export const TAPER_GUIDANCE = `Race tapers (the engine already sets the reduced volume; you fill the sessions to match its intent):
- A race (peak priority): a 2-week taper for maximum freshness. Week 1 sits around 60–70% of the peak week; race week around 40–50%, with long workouts cut 50–70%. Keep intensity high but drop duration and frequency — do NOT remove hard efforts or speed work, that preserves sharpness. In race week cut heavy lifting/strength work, and include short "opener" sessions (e.g. 2 days out): brief, high-RPM bursts or quick strides so the legs feel snappy without fatigue.
- B race (secondary): a mini-taper that protects training rhythm — the race week's planned duration is cut ~40–50%. Keep hard efforts in place but reduce the number of reps / time at high zones. Avoid deep, exhausting efforts 2–3 days before the race.
- C race (tune-up): NO formal taper — train right through it. The day before can be off or a very short easy jog/spin, but don't sacrifice the training block. Treat the C race itself as a high-quality hard workout.`;

/** Phase character (spec §4a, Q14/Q15). */
export const PHASE_CHARACTER: Record<"base" | "build" | "peak" | "taper", string> = {
  base: "High volume, low intensity, aerobic foundation. Easy running dominant; runs are fartleks/progression runs. Strength base in lifting; minimal hybrid.",
  build: "Increasing specificity. Introduce one structured tempo run per week; more threshold and hybrid work at moderate volume.",
  peak: "High intensity, HYROX-specific simulation, volume drops. One tempo/threshold session per week at true lactate threshold; maximum hybrid specificity.",
  taper: "Reduced volume, intensity maintained until the final days. Minimal lifting and hybrid; keep some sharpening pace work.",
};

/**
 * The full philosophy block for the system prompt. Qualitative only — the
 * numeric targets (mileage, cardio minutes, zone %, session counts) are
 * supplied per week by the engine skeleton in the user prompt.
 */
export function philosophyRules(): string {
  return [
    "You are an expert HYROX coach filling in the concrete session content for a program whose structure and volume have already been decided by a periodization engine. Never change the prescribed volume, session counts, zones, or which days have which session kinds — only fill in the content.",
    "",
    ZONE_DEFINITIONS,
    "",
    RUN_GUIDANCE,
    "",
    LIFT_GUIDANCE,
    "",
    HYBRID_GUIDANCE,
    "",
    TAPER_GUIDANCE,
    "",
    "Target overall cardio-time zone split across the whole program: ~20% Z1, 60% Z2, 10% Z3, 5% Z4, 5% Z5 (weightlifting excluded).",
  ].join("\n");
}
