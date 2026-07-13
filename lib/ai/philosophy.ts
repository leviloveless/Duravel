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
export const ZONE_DEFINITIONS = `Heart-rate zones (each athlete's max HR and zone boundaries are personalized — the profile block gives the resolved max HR and the anchoring method, which may be % of max HR, heart-rate reserve, or lactate-threshold HR):
- Zone 1 (<60% max HR): recovery / very easy
- Zone 2 (60–70%): easy aerobic / base building
- Zone 3 (70–80%): moderate aerobic / tempo
- Zone 4 (80–90%): threshold / lactate threshold
- Zone 5 (90–100%): max effort / VO2 max`;

/** Run-type character + pace guidance (spec §5a, Q14/Q17). */
export const RUN_GUIDANCE = `Run types and how to prescribe them (the engine decides WHICH type each day is; you fill in realistic paces/durations that match the protocol):
- easy: Zone 1–2, conversational pace, aerobic base.
- fartlek: Zone 2 average with hard surges; programmed only in the Base and Build phases. Protocol: warm up 1–2 mi easy, then descending run intervals — 8, 7, 6, 5, 4, 3, 2, then 1 minute — at RPE 5 (~10–15K pace), each followed by a 1.5-minute easy jog, then cool down 1–2 mi easy. Set durationMin to cover warmup + the ~36 min of intervals + jogs + cooldown.
- progression: programmed only in the Peak and Taper phases; builds from easy to a hard finish. BEGINNER runners: 10 min easy warm-up, 20–30 min at standard comfortable aerobic pace (1–2 min/mile faster than easy), then a comfortably hard threshold effort for the final 10–15%, 5 min easy cool-down. INTERMEDIATE/ADVANCED runners: 5 min easy warm-up, 20 min easy/warm-up pace, 20 min at marathon/half-marathon race pace, 20 min at comfortably hard tempo (threshold) pace, 5 min easy cool-down. Goal zone ~3.
- long: Zone 2, extended duration, aerobic development. Every week has exactly one long run. Start Zone 1–2 and allow heart-rate drift toward the top of Zone 3 over a 75–90 min effort without entering Zone 4.
- tempo: Zone 3–4, 20–35 min continuous at ~80–90% max HR (≈ half-marathon pace); introduced in the Build phase, one per week.
- threshold: Zone 4, true lactate threshold, "comfortably hard," ~20–30 sec/mile slower than 5K pace; the primary quality run in the Peak phase.
- interval: Zone 4–5; programmed in the 2nd half of Build, throughout Peak, and some Taper weeks. Protocol: 5-min easy jog warm-up, then 6–8 rounds of 800m at goal 5K pace with a 1-minute slow jog recovery between reps, 5-min easy walk cool-down.
- hybrid_run: Zone 4 (threshold pace); these are the runs inside hybrid sessions and already count toward the weekly run total.

Pace: if the athlete provided benchmarks (mile / 5K / 10K), derive paces from them. Threshold ≈ 20–30 s/mile slower than 5K pace; tempo ≈ half-marathon pace; easy ≈ 1.5–2.5 min/mile slower than 5K pace. If no benchmarks are given, prescribe by zone/effort and give a reasonable pace estimate in min/mile.`;

/** Lifting rules (spec §5b, Q16/Q23). */
export const LIFT_GUIDANCE = `Weightlifting: exactly 3 sessions in a full training week — 1 upper, 1 lower, 1 full body.
The engine assigns each movement its sets, rep range, target %1RM, and RIR, and adds any plyometric element — you only choose WHICH of the 7 non-negotiable movement patterns appear in each session (all 7 must appear across the week):
squat, hip_hinge, lunge, horizontal_press, vertical_press, horizontal_pull, vertical_pull.
The strength model (for context; the engine enforces the numbers):
- The FULL-BODY day is heavy, low-rep MAX STRENGTH on the main compounds — this builds running economy and delays fatigue for HYROX, and adds minimal mass.
- UPPER and LOWER days run a MODERATE strength scheme (reps drop toward the race), not high-rep hypertrophy.
- The LUNGE pattern is trained as HIGH-REP muscular endurance — it mirrors the HYROX sandbag-lunge station.
- Load PROGRESSES through the microcycle (heavier on build weeks, lighter on deloads) with an RIR autoregulation cue.
- A PLYOMETRIC / reactive element is added in the Base and Build phases for power and running economy.
Do not output sets/reps/weights yourself — return the pattern list per session and the engine fills the prescription.`;

/** Hybrid (HYROX-specific) rules (spec §5c, Q18). */
export const HYBRID_GUIDANCE = `Hybrid sessions simulate the HYROX format: threshold-pace runs interleaved with non-running cardio/strength stations ("events").
Structure EVERY hybrid session as exactly 4 runs and 4 events, alternating run → event → run → event … Each run is 1000m at threshold pace (give the pace). So the "elements" array for a hybrid should contain 8 entries: 4 run elements each prescribed as "1000m @ <pace> (threshold)" and 4 event elements from the station library, interleaved.
Rotate the events across the week's hybrid sessions: when a week has two hybrid sessions, choose the 4 events for each so that, together, all of the week's HYROX stations are covered at least once (don't repeat the same 4 events in both sessions).
Give each event a placeholder prescription: the engine rewrites station prescriptions to the athlete's HYROX race spec (division/sex loads, phase-progressed distances and reps), so you only pick which stations appear. Assign a goal HR zone (typically Zone 4). Each hybrid session should total between 25 and 60 minutes of WORK time (excluding warmup/cooldown). Keep the set of hybrid workouts repeatable within a mesocycle and rotate/replace them between mesocycles.`;

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
  base: "High volume, low intensity, aerobic foundation. Easy running dominant; the quality run is a fartlek (no structured tempo in Base). Strength base in lifting; minimal hybrid.",
  build: "Increasing specificity. Introduce one structured tempo run per week; fartleks continue, and interval work is added in the 2nd half of the phase. More threshold and hybrid work at moderate volume.",
  peak: "High intensity, HYROX-specific simulation, volume drops. Threshold and interval runs plus a weekly progression run at true race-effort finishes; maximum hybrid specificity.",
  taper: "Reduced volume, intensity maintained until the final days. Progression runs with some interval work keep the legs sharp; minimal lifting and hybrid.",
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
