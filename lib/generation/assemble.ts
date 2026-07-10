/**
 * Assemble + verify (architecture-plan.md §5 step 4).
 *
 * Merges the deterministic engine skeleton with the AI-filled session content
 * into the final ProgramData. Two guarantees are enforced here, independent of
 * what the AI returned:
 *
 *  1. Weekly summaries (cardio minutes, mileage, zone %) come straight from the
 *     engine's numeric targets — never from AI output — so summary blocks are
 *     always arithmetically correct (spec §7).
 *  2. Every full training week (3 lift sessions) contains all 7 non-negotiable
 *     movement patterns (spec §5b). Missing patterns are patched in.
 */

import {
  ProgramDataSchema,
  REQUIRED_MOVEMENT_PATTERNS,
  type AiChunk,
  type AiWeek,
  type ProgramData,
  type ProgramDay,
  type ProgramWeek,
  type Session,
} from "@/lib/schemas";
import type { ProgramSkeleton, WeekSkeleton } from "@/lib/engine/types";

type MovementPattern = (typeof REQUIRED_MOVEMENT_PATTERNS)[number];

/** Preferred lift split for a pattern, used when patching a missing one in. */
const PATTERN_HOME: Record<MovementPattern, "upper" | "lower" | "full"> = {
  squat: "lower",
  hip_hinge: "lower",
  lunge: "lower",
  horizontal_press: "upper",
  vertical_press: "upper",
  horizontal_pull: "upper",
  vertical_pull: "upper",
};

export interface AssembleResult {
  program: ProgramData;
  /** Non-fatal notes (missing AI days, patched patterns) for logging/audit. */
  issues: string[];
}

function indexAiWeeks(chunks: AiChunk[]): Map<number, AiWeek> {
  const map = new Map<number, AiWeek>();
  for (const chunk of chunks) {
    for (const w of chunk.weeks) map.set(w.weekNumber, w);
  }
  return map;
}

function daySessions(
  skelDay: WeekSkeleton["days"][number],
  aiWeek: AiWeek | undefined,
  issues: string[],
  weekNumber: number,
): Session[] {
  const kinds = skelDay.sessions.map((s) => s.kind);

  // Engine owns race + rest days.
  const race = skelDay.sessions.find((s) => s.kind === "race");
  if (race && race.kind === "race") return [{ kind: "race", priority: race.priority }];
  if (kinds.every((k) => k === "rest")) return [];

  const aiDay = aiWeek?.days.find((d) => d.day === skelDay.day);
  if (!aiDay || aiDay.sessions.length === 0) {
    issues.push(`week ${weekNumber} ${skelDay.day}: no AI content for ${kinds.join("+")} — left empty`);
    return [];
  }
  return aiDay.sessions;
}

function buildWeek(skel: WeekSkeleton, aiWeek: AiWeek | undefined, issues: string[]): ProgramWeek {
  const days: ProgramDay[] = skel.days.map((d) => ({
    day: d.day,
    sessions: daySessions(d, aiWeek, issues, skel.weekNumber),
  }));

  return {
    weekNumber: skel.weekNumber,
    phase: skel.phase,
    microWeek: skel.microWeek,
    summary: {
      totalCardioMinutes: skel.targetCardioMinutes,
      totalMileage: skel.targetMileage,
      zoneDistribution: { ...skel.zoneTargets },
    },
    days,
    raceDay: skel.raceDay ? { priority: skel.raceDay.priority, date: skel.raceDay.date } : undefined,
  };
}

/** Movement patterns present across a week's lift sessions. */
export function weekPatterns(week: ProgramWeek): Set<string> {
  const present = new Set<string>();
  for (const day of week.days) {
    for (const s of day.sessions) {
      if (s.kind === "lift") for (const m of s.movements) present.add(m.pattern);
    }
  }
  return present;
}

/** Count lift sessions in a week (a "full" training week has 3). */
function liftCount(week: ProgramWeek): number {
  return week.days.reduce((n, d) => n + d.sessions.filter((s) => s.kind === "lift").length, 0);
}

/**
 * Ensure a full training week carries all 7 movement patterns; inject any that
 * are missing into an appropriate lift session. Returns the patterns injected.
 */
export function patchMovementPatterns(week: ProgramWeek): MovementPattern[] {
  if (liftCount(week) < 3) return []; // reduced weeks (deload/taper) aren't required to hit all 7
  const present = weekPatterns(week);
  const missing = REQUIRED_MOVEMENT_PATTERNS.filter((p) => !present.has(p));
  if (missing.length === 0) return [];

  const liftSessions = week.days.flatMap((d) => d.sessions).filter((s) => s.kind === "lift");

  for (const pattern of missing) {
    const home = PATTERN_HOME[pattern];
    const target =
      liftSessions.find((s) => s.kind === "lift" && s.liftType === home) ??
      liftSessions.find((s) => s.kind === "lift" && s.liftType === "full") ??
      liftSessions[0];
    if (target && target.kind === "lift") {
      const repRange = target.liftType === "full" ? "5-7" : "12-15";
      target.movements.push({ pattern, sets: 3, repRange });
    }
  }
  return [...missing];
}

/** Build ProgramData from the skeleton + AI chunks, patching pattern gaps. */
export function assembleProgram(skeleton: ProgramSkeleton, chunks: AiChunk[]): AssembleResult {
  const issues: string[] = [];
  const aiByWeek = indexAiWeeks(chunks);

  const weeks = skeleton.weeks.map((skel) => {
    const week = buildWeek(skel, aiByWeek.get(skel.weekNumber), issues);
    const patched = patchMovementPatterns(week);
    if (patched.length) issues.push(`week ${week.weekNumber}: patched missing patterns ${patched.join(", ")}`);
    return week;
  });

  const program: ProgramData = { generatedAt: new Date().toISOString(), weeks };

  // Final schema gate.
  const parsed = ProgramDataSchema.safeParse(program);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    throw new Error(`Assembled program failed schema validation: ${first?.path.join(".")} — ${first?.message}`);
  }
  return { program: parsed.data, issues };
}

export interface VerifyResult {
  ok: boolean;
  issues: string[];
}

/**
 * Verify a finished program (architecture-plan.md §5 step 4 exit test):
 * schema-valid and every full training week has all 7 movement patterns.
 */
export function verifyProgram(program: ProgramData): VerifyResult {
  const issues: string[] = [];

  const parsed = ProgramDataSchema.safeParse(program);
  if (!parsed.success) {
    issues.push(`schema: ${parsed.error.issues[0]?.message ?? "invalid"}`);
    return { ok: false, issues };
  }

  for (const week of program.weeks) {
    if (liftCount(week) < 3) continue; // reduced weeks exempt
    const present = weekPatterns(week);
    const missing = REQUIRED_MOVEMENT_PATTERNS.filter((p) => !present.has(p));
    if (missing.length) issues.push(`week ${week.weekNumber}: missing movement patterns ${missing.join(", ")}`);
  }

  return { ok: issues.length === 0, issues };
}
