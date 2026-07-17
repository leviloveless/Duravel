/**
 * Prompt builder for the Session Generator (architecture-plan.md §5 step 3).
 *
 * One prompt is built per mesocycle chunk. The system prompt carries the
 * coaching philosophy + strict output contract; the user prompt carries the
 * athlete profile and the engine's per-week skeleton for that mesocycle. The
 * AI returns JSON content only for the run/lift/hybrid slots the engine has
 * already placed — it never invents structure, volume, or zones.
 */

import type { GenerationInput } from "@/lib/schemas";
import type { PhaseName, WeekSkeleton } from "@/lib/engine/types";
import { getSport, type SportConfig } from "@/lib/engine/sports";
import { analyzeNeeds } from "@/lib/engine/needs";
import { resolveHrModel } from "@/lib/zones";

const OUTPUT_CONTRACT = `OUTPUT FORMAT — respond with a single JSON object and nothing else (no prose, no markdown fences):

{
  "weeks": [
    {
      "weekNumber": <int>,
      "days": [
        {
          "day": "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun",
          "sessions": [ <Session>, ... ]
        }
      ]
    }
  ]
}

A <Session> is exactly one of:
- Run:    { "kind": "run", "runType": "easy|fartlek|progression|long|tempo|threshold|interval|hybrid_run", "durationMin": <number>, "paceMinMile": "m:ss", "distanceMiles": <number>, "goalZone": <1-5> }
- Lift:   { "kind": "lift", "liftType": "upper|lower|full", "movements": [ { "pattern": "squat|hip_hinge|lunge|horizontal_press|vertical_press|horizontal_pull|vertical_pull", "sets": <int>, "repRange": "string" } ] }  (the engine sets sets/reps/intensity/RIR and any plyometric element deterministically — just choose which patterns go in each session)
- Hybrid: { "kind": "hybrid", "goalZone": <1-5>, "elements": [ { "exercise": "row erg", "prescription": "500m" }, { "exercise": "run", "prescription": "400m @ 7:30 min/mile (threshold)" } ] }

Rules:
- Return one "days" entry for every training day that the skeleton marks with a run/lift/hybrid slot. Do NOT return entries for rest days or race days — those are handled separately.
- The sessions you return for a day MUST match, in kind and order, the slots the skeleton lists for that day. Fill in content only.
- Match each run's runType and each session's goalZone to what the skeleton specifies for that slot.
- Every full training week (weeks with 3 lift slots) must include all 7 movement patterns across its lift sessions.
- Keep numbers realistic and internally consistent (durationMin ≈ distanceMiles × paceMinMile).`;

// Framing around the sport's coach persona (was philosophy.philosophyRules()).
const COACH_LINE_PREFIX = "You are an ";
const COACH_LINE_SUFFIX =
  " filling in the concrete session content for a program whose structure and volume have already been decided by a periodization engine. Never change the prescribed volume, session counts, zones, or which days have which session kinds — only fill in the content.";
const ZONE_TARGET_LINE =
  "Target overall cardio-time zone split across the whole program: ~20% Z1, 60% Z2, 10% Z3, 5% Z4, 5% Z5 (weightlifting excluded).";

/** Qualitative philosophy block for a sport (coach persona + guidance blocks). */
export function buildPhilosophyRules(cfg: SportConfig): string {
  const coachLine = `${COACH_LINE_PREFIX}${cfg.philosophy.coach}${COACH_LINE_SUFFIX}`;
  return [coachLine, ...cfg.philosophy.guidance, ZONE_TARGET_LINE].join("\n\n");
}

export function buildSystemPrompt(cfg: SportConfig = getSport(undefined)): string {
  return [buildPhilosophyRules(cfg), "", OUTPUT_CONTRACT].join("\n");
}

function profileBlock(input: GenerationInput): string {
  const p = input.profile;
  // HR zones use the best-available anchoring (Review #3): threshold HR (LTHR) ->
  // resting HR (HRR) -> sex-specific %HRmax. Give the model the resolved max HR,
  // the method, and any resting/threshold HR so its goal-HR guidance is realistic.
  const hr = resolveHrModel({
    age: p.age,
    sex: p.sex,
    maxHr: p.maxHr,
    restingHr: p.restingHr,
    thresholdHr: p.thresholdHr,
    customBands: p.hrZones
      ? {
          1: { low: p.hrZones.z1.low / 100, high: p.hrZones.z1.high / 100 },
          2: { low: p.hrZones.z2.low / 100, high: p.hrZones.z2.high / 100 },
          3: { low: p.hrZones.z3.low / 100, high: p.hrZones.z3.high / 100 },
          4: { low: p.hrZones.z4.low / 100, high: p.hrZones.z4.high / 100 },
          5: { low: p.hrZones.z5.low / 100, high: p.hrZones.z5.high / 100 },
        }
      : undefined,
  });
  const hrExtras = [
    hr.restingHr ? `resting HR ${hr.restingHr}` : null,
    hr.thresholdHr ? `threshold HR ${hr.thresholdHr}` : null,
  ]
    .filter(Boolean)
    .join(", ");
  const hrNote = `max HR ~ ${hr.maxHR} bpm; zones anchored to ${hr.label}${hrExtras ? ` (${hrExtras})` : ""}`;
  const lines = [
    `First name: ${p.firstName}`,
    `Age: ${p.age}${p.sex ? `, sex: ${p.sex}` : ""}`,
    `Heart rate: ${hrNote}`,
    `Body weight: ${p.bodyWeight} ${p.weightUnit}`,
    `Experience — running: ${p.runningExp}, hybrid: ${p.hybridExp}, lifting: ${p.liftingExp}`,
    `Training classification: ${p.trainingClass}`,
    `Training days: ${p.trainingDays.join(", ")}`,
  ];
  const b = p.benchmarks;
  if (b) {
    const bench: string[] = [];
    if (b.mileTime) bench.push(`1-mile ${b.mileTime}`);
    if (b.fiveKTime) bench.push(`5K ${b.fiveKTime}`);
    if (b.tenKTime) bench.push(`10K ${b.tenKTime}`);
    if (b.fiveRmSquat) bench.push(`5RM squat ${b.fiveRmSquat}`);
    if (b.fiveRmBench) bench.push(`5RM bench ${b.fiveRmBench}`);
    if (b.fiveRmDeadlift) bench.push(`5RM deadlift ${b.fiveRmDeadlift}`);
    if (b.ski2kTime) bench.push(`2k ski ${b.ski2kTime}`);
    if (b.row2kTime) bench.push(`2k row ${b.row2kTime}`);
    if (b.bike20MinCals) bench.push(`20-min bike ${b.bike20MinCals} cal`);
    if (bench.length) lines.push(`Benchmarks: ${bench.join(", ")}`);
  } else {
    lines.push("Benchmarks: none provided — prescribe by zone/effort with reasonable pace estimates.");
  }
  return lines.join("\n");
}

/** Compact per-day slot description the AI must fill. */
function daySlotsBlock(week: WeekSkeleton): string {
  const parts = week.days.map((d) => {
    const slots = d.sessions
      .map((s) => {
        if (s.kind === "run") return `run:${s.runType}(Z${s.goalZone})`;
        if (s.kind === "lift") return `lift:${s.liftType}`;
        if (s.kind === "hybrid") return `hybrid(Z${s.goalZone})`;
        if (s.kind === "race") return `RACE(${s.priority})`;
        return "rest";
      })
      .join(", ");
    return `    ${d.day}: ${slots}`;
  });
  return parts.join("\n");
}

function weekBlock(week: WeekSkeleton): string {
  const z = week.zoneTargets;
  return [
    `Week ${week.weekNumber} — phase ${week.phase}, microcycle ${week.microWeek}`,
    `  Targets: ${week.targetMileage} miles, ${week.targetCardioMinutes} cardio min; zones Z1 ${z.z1}% Z2 ${z.z2}% Z3 ${z.z3}% Z4 ${z.z4}% Z5 ${z.z5}%`,
    `  Day slots to fill (match kind + order; skip rest/RACE):`,
    daySlotsBlock(week),
  ].join("\n");
}

/**
 * Build the user prompt for one mesocycle chunk.
 * `phase` labels the chunk; `weeks` are the engine skeleton weeks in it.
 *
 * `adaptationContext` (Phase 2) carries last week's log digest + any
 * constraints when re-filling a single adapted week. It gives the AI context
 * to react to (e.g. a note about a sore knee) strictly WITHIN the volume the
 * engine prescribed — the AI never gains authority over volume.
 */
export function buildUserPrompt(
  input: GenerationInput,
  phase: PhaseName,
  weeks: WeekSkeleton[],
  adaptationContext?: string,
  cfg: SportConfig = getSport(undefined),
): string {
  // Review #1: bias the station library toward the athlete's limiter. Stations
  // the needs analysis prioritizes (and that exist in this mesocycle's library)
  // are listed first; the AI still fills the same 4-run/4-event structure.
  const needs = analyzeNeeds(input.profile, {
    ergStations: cfg.needsStations?.erg,
    strengthStations: cfg.needsStations?.strength,
  });
  const emphasis = needs.bias.stationEmphasis;
  const phaseLib = cfg.philosophy.stationLibrary?.[phase] ?? [];
  const prioritized = emphasis.filter((st) => phaseLib.includes(st));
  const orderedLib = [...prioritized, ...phaseLib.filter((st) => !prioritized.includes(st))];
  const library = orderedLib.join(", ");

  const parts = [
    "ATHLETE PROFILE",
    profileBlock(input),
    "",
    `MESOCYCLE: ${phase.toUpperCase()}`,
    cfg.philosophy.phaseCharacter?.[phase] ?? "",
  ];
  // Station-hybrid sports list a station library; sports without stations (e.g.
  // general fitness) skip it.
  if (phaseLib.length > 0) {
    parts.push(`Hybrid station library for this mesocycle: ${library}.`);
  }
  if (needs.informative) {
    parts.push(`Athlete needs focus: ${needs.summary}`);
    if (prioritized.length) {
      parts.push(
        `When choosing this week's hybrid stations, prioritize the athlete's limiter stations first: ${prioritized.join(", ")}. Still cover the week's HYROX stations across sessions, but weight selection and volume toward these.`,
      );
    }
  }
  if (adaptationContext) {
    parts.push(
      "",
      "ADAPTATION CONTEXT (this is a re-fill of one upcoming week after reviewing the athlete's logged performance)",
      adaptationContext,
      "The weekly volume targets below already reflect the adjustment — do NOT change volume further. Respect any session constraints listed above. You may swap exercise selection in response to the athlete's notes, within the same session kinds and zones.",
    );
  }
  parts.push(
    "",
    "WEEKS TO FILL",
    weeks.map(weekBlock).join("\n\n"),
    "",
    "Return the JSON object described in the system prompt, with one entry in \"weeks\" for each week above.",
  );
  return parts.join("\n");
}
