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
import { philosophyRules, PHASE_CHARACTER, HYBRID_LIBRARY } from "./philosophy";

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
- Run:    { "kind": "run", "runType": "easy|fartlek|long|tempo|threshold|interval|hybrid_run", "durationMin": <number>, "paceMinMile": "m:ss", "distanceMiles": <number>, "goalZone": <1-5> }
- Lift:   { "kind": "lift", "liftType": "upper|lower|full", "movements": [ { "pattern": "squat|hip_hinge|lunge|horizontal_press|vertical_press|horizontal_pull|vertical_pull", "sets": <int>, "repRange": "5-7", "suggestedWeight": "optional string" } ] }
- Hybrid: { "kind": "hybrid", "goalZone": <1-5>, "elements": [ { "exercise": "row erg", "prescription": "500m" }, { "exercise": "run", "prescription": "400m @ 7:30 min/mile (threshold)" } ] }

Rules:
- Return one "days" entry for every training day that the skeleton marks with a run/lift/hybrid slot. Do NOT return entries for rest days or race days — those are handled separately.
- The sessions you return for a day MUST match, in kind and order, the slots the skeleton lists for that day. Fill in content only.
- Match each run's runType and each session's goalZone to what the skeleton specifies for that slot.
- Every full training week (weeks with 3 lift slots) must include all 7 movement patterns across its lift sessions.
- Keep numbers realistic and internally consistent (durationMin ≈ distanceMiles × paceMinMile).`;

export function buildSystemPrompt(): string {
  return [philosophyRules(), "", OUTPUT_CONTRACT].join("\n");
}

function profileBlock(input: GenerationInput): string {
  const p = input.profile;
  const maxHr = p.maxHr ?? 220 - p.age;
  const maxHrNote = p.maxHr ? `custom max HR ${p.maxHr}` : `max HR ≈ ${maxHr}`;
  const lines = [
    `First name: ${p.firstName}`,
    `Age: ${p.age} (${maxHrNote})`,
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
): string {
  const library = HYBRID_LIBRARY[phase].join(", ");
  const parts = [
    "ATHLETE PROFILE",
    profileBlock(input),
    "",
    `MESOCYCLE: ${phase.toUpperCase()}`,
    PHASE_CHARACTER[phase],
    `Hybrid station library for this mesocycle: ${library}.`,
  ];
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
