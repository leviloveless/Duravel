/**
 * Weekly adaptation orchestrator (Phase 2 — phase2-spec.md §4d, §6).
 *
 * preview: deterministic and free — signals + rule decision for the review
 * screen. apply: re-runs the decision, refills ONE week via the existing
 * Haiku path (same pipeline as v1, smallest possible chunk), splices it into
 * program_data + the stored skeleton, and writes the adaptations audit row
 * with a snapshot of the replaced week.
 *
 * The AI never decides volume: it receives the engine's revised targets and a
 * digest of last week's logs (so it can react to notes within those targets).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  GenerationInputSchema,
  ProgramDataSchema,
  type GenerationInput,
  type ProgramData,
  type ProgramWeek,
  type WorkoutLog,
} from "@/lib/schemas";
import type { ProgramSkeleton, WeekSkeleton } from "@/lib/engine/types";
import { ProgramSkeletonSchema } from "@/lib/engine/skeleton-schema";
import {
  applyDecisionToWeek,
  computeWeekSignals,
  decideAdaptation,
  type AdaptContext,
  type AdaptDecision,
  type AdaptRuleCode,
  type WeekSignals,
} from "@/lib/engine/adapt";
import { computeLoadMetrics } from "@/lib/engine/load";
import { computeReadiness, type ReadinessCheckin } from "@/lib/engine/readiness";
import { generateChunk } from "@/lib/ai/generate-week";
import { assembleArgsFromInput, assembleProgram } from "./assemble";
import type { GenerationUsage } from "./generate-program";
import { getSport } from "@/lib/engine/sports";
import { toEngineInput } from "@/lib/engine/skeleton";
import { rebuildTriWeek, triAnchorsFromBenchmarks } from "@/lib/engine/sports/triathlon";

// Haiku list rates, matching generate-program.ts.
const INPUT_COST_PER_TOKEN = 1 / 1_000_000;
const OUTPUT_COST_PER_TOKEN = 5 / 1_000_000;

export interface AdaptPreview {
  weekNumber: number;
  targetWeek: number;
  signals: WeekSignals;
  decision: AdaptDecision;
  /** Original targets of the week that would be revised (null = final week). */
  nextOriginal: { targetMileage: number; targetCardioMinutes: number } | null;
}

export interface AdaptError {
  error: string;
  status: number;
}

interface LoadedProgram {
  input: GenerationInput;
  programData: ProgramData;
  skeleton: ProgramSkeleton;
  reviewedWeek: ProgramWeek;
  nextWeekSkeleton: WeekSkeleton | null;
  logs: WorkoutLog[];
  /** Logs across the ACWR window (up to 4 weeks) for load metrics (Review #5). */
  allLogs: WorkoutLog[];
  /** Readiness check-ins up to the reviewed week (Review #7). */
  readinessCheckins: ReadinessCheckin[];
  prevSignals: WeekSignals | null;
  lastRule: AdaptRuleCode | null;
}

/** Map a workout_logs DB row to the client/engine WorkoutLog shape. */
export function toWorkoutLog(row: {
  week_number: number;
  day: string;
  session_index: number;
  status: string;
  rpe: number | null;
  actuals: Record<string, number> | null;
  note: string | null;
}): WorkoutLog {
  return {
    weekNumber: row.week_number,
    day: row.day as WorkoutLog["day"],
    sessionIndex: row.session_index,
    status: row.status as WorkoutLog["status"],
    rpe: row.rpe,
    actuals: row.actuals ?? null,
    note: row.note,
  };
}

async function loadForAdaptation(
  supabase: SupabaseClient,
  programId: string,
  weekNumber: number,
): Promise<LoadedProgram | AdaptError> {
  const { data: row, error } = await supabase
    .from("programs")
    .select("id, status, input_snapshot, program_data, skeleton")
    .eq("id", programId)
    .single();
  if (error || !row) return { error: "Program not found", status: 404 };
  if (row.status !== "ready") return { error: "Program is not ready", status: 409 };

  const parsedInput = GenerationInputSchema.safeParse(row.input_snapshot);
  if (!parsedInput.success) return { error: "Stored input snapshot is invalid", status: 500 };

  if (!row.program_data || !row.skeleton) {
    return { error: "Program has no generated data", status: 409 };
  }
  // Validate the persisted JSON on the way in rather than trusting a raw cast —
  // a corrupted or schema-drifted program/skeleton must fail cleanly, not flow
  // silently into the adaptation math and the mini-refill.
  const parsedData = ProgramDataSchema.safeParse(row.program_data);
  if (!parsedData.success) return { error: "Stored program data is invalid", status: 500 };
  const parsedSkeleton = ProgramSkeletonSchema.safeParse(row.skeleton);
  if (!parsedSkeleton.success) return { error: "Stored skeleton is invalid", status: 500 };
  const programData: ProgramData = parsedData.data;
  const skeleton: ProgramSkeleton = parsedSkeleton.data;

  const reviewedWeek = programData.weeks.find((w) => w.weekNumber === weekNumber);
  if (!reviewedWeek) return { error: `Week ${weekNumber} not found in program`, status: 400 };
  const nextWeekSkeleton = skeleton.weeks.find((w) => w.weekNumber === weekNumber + 1) ?? null;

  // Logs for the reviewed week + the one before (compliance/strain trends).
  const { data: logRows } = await supabase
    .from("workout_logs")
    .select("week_number, day, session_index, status, rpe, actuals, note")
    .eq("program_id", programId)
    .gte("week_number", Math.max(1, weekNumber - 3))
    .lte("week_number", weekNumber);
  const logs = (logRows ?? []).map(toWorkoutLog);

  let prevSignals: WeekSignals | null = null;
  const prevWeek = programData.weeks.find((w) => w.weekNumber === weekNumber - 1);
  if (prevWeek) {
    const prevLogs = logs.filter((l) => l.weekNumber === weekNumber - 1);
    if (prevLogs.length > 0) prevSignals = computeWeekSignals(prevWeek, prevLogs);
  }

  // Weekly readiness check-ins up to this week, for the forward signal (Review #7).
  const { data: readinessRows } = await supabase
    .from("readiness_checkins")
    .select("week_number, sleep, fatigue, stress, soreness, resting_hr, hrv")
    .eq("program_id", programId)
    .lte("week_number", weekNumber);
  const readinessCheckins: ReadinessCheckin[] = (readinessRows ?? []).map((r) => ({
    weekNumber: r.week_number,
    sleep: r.sleep,
    fatigue: r.fatigue,
    stress: r.stress,
    soreness: r.soreness,
    restingHr: r.resting_hr,
    hrv: r.hrv,
  }));

  // Most recent applied rule (the earned bump can't fire twice in a row).
  const { data: lastAdaptation } = await supabase
    .from("adaptations")
    .select("rule_applied")
    .eq("program_id", programId)
    .eq("decision", "applied")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return {
    input: parsedInput.data,
    programData,
    skeleton,
    reviewedWeek,
    nextWeekSkeleton,
    logs: logs.filter((l) => l.weekNumber === weekNumber),
    allLogs: logs,
    readinessCheckins,
    prevSignals,
    lastRule: (lastAdaptation?.rule_applied as AdaptRuleCode | undefined) ?? null,
  };
}

function decide(loaded: LoadedProgram, weekNumber: number): { signals: WeekSignals; decision: AdaptDecision } {
  const signals = computeWeekSignals(loaded.reviewedWeek, loaded.logs);
  const reviewedSkeleton = loaded.skeleton.weeks.find((w) => w.weekNumber === weekNumber);
  // ACWR + monotony across the loaded window (Review #5).
  const load = computeLoadMetrics(loaded.programData.weeks, loaded.allLogs, weekNumber);
  // Forward readiness (Review #7): the reviewed week's check-in vs personal baseline.
  const currentReadiness = loaded.readinessCheckins.find((c) => c.weekNumber === weekNumber) ?? null;
  const priorReadiness = loaded.readinessCheckins.filter((c) => c.weekNumber < weekNumber);
  const readiness = currentReadiness ? computeReadiness(currentReadiness, priorReadiness) : null;
  const ctx: AdaptContext = {
    reviewedTargets: {
      targetMileage: reviewedSkeleton?.targetMileage ?? loaded.reviewedWeek.summary.totalMileage,
      targetCardioMinutes:
        reviewedSkeleton?.targetCardioMinutes ?? loaded.reviewedWeek.summary.totalCardioMinutes,
    },
    nextWeek: loaded.nextWeekSkeleton,
    prevCompliance: loaded.prevSignals?.compliance ?? null,
    prevStrain: loaded.prevSignals?.strain ?? null,
    lastRule: loaded.lastRule,
    acwr: load.acwr,
    monotony: signals.monotony,
    readiness: readiness ? { score: readiness.score, category: readiness.category } : null,
  };
  return { signals, decision: decideAdaptation(signals, ctx) };
}

/** Deterministic preview for the review screen. No AI, no writes. */
export async function previewAdaptation(
  supabase: SupabaseClient,
  programId: string,
  weekNumber: number,
): Promise<AdaptPreview | AdaptError> {
  const loaded = await loadForAdaptation(supabase, programId, weekNumber);
  if ("error" in loaded) return loaded;
  const { signals, decision } = decide(loaded, weekNumber);
  return {
    weekNumber,
    targetWeek: weekNumber + 1,
    signals,
    decision,
    nextOriginal: loaded.nextWeekSkeleton
      ? {
          targetMileage: loaded.nextWeekSkeleton.targetMileage,
          targetCardioMinutes: loaded.nextWeekSkeleton.targetCardioMinutes,
        }
      : null,
  };
}

/** Per-session log digest fed to the refill prompt (notes verbatim). */
export function buildAdaptationContext(
  reviewedWeek: ProgramWeek,
  logs: WorkoutLog[],
  signals: WeekSignals,
  decision: AdaptDecision,
): string {
  const byKey = new Map(logs.map((l) => [`${l.day}:${l.sessionIndex}`, l]));
  const lines: string[] = [
    `Last week (week ${reviewedWeek.weekNumber}): ${Math.round(signals.compliance * 100)}% of sessions completed` +
      (signals.strain !== null ? `, average effort RPE ${signals.strain}` : "") +
      ".",
    `Adjustment applied: ${decision.rule} — ${decision.reason}`,
  ];
  for (const day of reviewedWeek.days) {
    day.sessions.forEach((s, i) => {
      if (s.kind === "race") return;
      const log = byKey.get(`${day.day}:${i}`);
      const label =
        s.kind === "run"
          ? `${s.runType} run`
          : s.kind === "lift"
            ? `${s.liftType} lift`
            : s.kind === "cardio"
              ? "zone 1–2 cardio"
              : "hybrid";
      const status = log?.status ?? "not logged";
      const rpe = log?.rpe != null ? `, RPE ${log.rpe}` : "";
      const note = log?.note ? ` — note: "${log.note}"` : "";
      lines.push(`  ${day.day} ${label}: ${status}${rpe}${note}`);
    });
  }
  if (decision.constraints.longRunMaxMiles !== undefined) {
    lines.push(
      `CONSTRAINT: cap this week's long run at ${decision.constraints.longRunMaxMiles} miles (the athlete missed last week's long run — no progression on it).`,
    );
  }
  return lines.join("\n");
}

export interface ApplyResult {
  rule: AdaptRuleCode;
  reason: string;
  targetWeek: number;
  refilled: boolean;
  usage?: GenerationUsage;
}

/**
 * Apply the adaptation: decide → refill the target week (when targets moved)
 * → splice into program_data + stored skeleton → write the audit row.
 * The caller has already authorized the user and enforced the rate limit.
 */
export async function applyAdaptation(
  supabase: SupabaseClient,
  userId: string,
  programId: string,
  weekNumber: number,
): Promise<ApplyResult | AdaptError> {
  const loaded = await loadForAdaptation(supabase, programId, weekNumber);
  if ("error" in loaded) return loaded;
  const { signals, decision } = decide(loaded, weekNumber);

  const targetWeek = weekNumber + 1;

  // Refill when the rule changed targets OR added a session constraint.
  const needsRefill =
    decision.revisedTargets !== null || decision.constraints.longRunMaxMiles !== undefined;

  // Snapshot the week we're about to replace BEFORE any mutation (for undo/audit).
  const previousWeek = loaded.programData.weeks.find((w) => w.weekNumber === targetWeek) ?? null;

  // LOCK BEFORE SPENDING (roadmap #1.9): write the audit row first. The unique
  // (program_id, week_number) constraint makes a concurrent apply for the same
  // week fail HERE — before a second Haiku call is made or the week is written
  // twice. The route's pre-check is best-effort; this insert is the real guard.
  const { error: lockError } = await supabase.from("adaptations").insert({
    user_id: userId,
    program_id: programId,
    week_number: weekNumber,
    target_week: targetWeek,
    decision: "applied",
    rule_applied: decision.rule,
    signals,
    previous_week: needsRefill ? previousWeek : null,
    revised_targets: decision.revisedTargets,
  });
  if (lockError) {
    // Unique-violation (or any insert failure) → this week is already claimed.
    return { error: "This week has already been reviewed", status: 409 };
  }

  let refilled = false;
  let usage: GenerationUsage | undefined;
  const isTriathlon = getSport(loaded.input.sport).family === "triathlon";
  try {
    if (needsRefill && loaded.nextWeekSkeleton && isTriathlon) {
      // Triathlon assembles deterministically (no AI): regenerate the revised
      // week's sessions from the adapted cardio-minute target, splice, persist.
      const revisedWeek = applyDecisionToWeek(loaded.nextWeekSkeleton, decision);
      const engineInput = toEngineInput(loaded.input);
      const cfg = getSport(loaded.input.sport);
      const anchors = triAnchorsFromBenchmarks(loaded.input.profile.benchmarks);
      const { skeletonWeek, programWeek } = rebuildTriWeek(revisedWeek, engineInput, cfg, anchors);
      programWeek.raceDay = loaded.nextWeekSkeleton.raceDay
        ? { priority: loaded.nextWeekSkeleton.raceDay.priority, date: loaded.nextWeekSkeleton.raceDay.date }
        : undefined;

      const weeks = loaded.programData.weeks.map((w) => (w.weekNumber === targetWeek ? programWeek : w));
      const skeletonWeeks = loaded.skeleton.weeks.map((w) =>
        w.weekNumber === targetWeek ? skeletonWeek : w,
      );
      const { error: persistError } = await supabase
        .from("programs")
        .update({
          program_data: { ...loaded.programData, weeks },
          skeleton: { ...loaded.skeleton, weeks: skeletonWeeks },
        })
        .eq("id", programId);
      if (persistError) throw new Error(`Failed to persist adapted week: ${persistError.message}`);
      refilled = true;
    } else if (needsRefill && loaded.nextWeekSkeleton) {
      const revisedWeek = applyDecisionToWeek(loaded.nextWeekSkeleton, decision);
      const context = buildAdaptationContext(loaded.reviewedWeek, loaded.logs, signals, decision);

      const result = await generateChunk(loaded.input, revisedWeek.phase, [revisedWeek], context);
      usage = {
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
        costUsd:
          Math.round(
            (result.usage.inputTokens * INPUT_COST_PER_TOKEN +
              result.usage.outputTokens * OUTPUT_COST_PER_TOKEN) *
              1e6,
          ) / 1e6,
      };
      console.log(
        `[adapt] program=${programId} week=${targetWeek} rule=${decision.rule} in=${usage.inputTokens} out=${usage.outputTokens} cost=$${usage.costUsd.toFixed(4)}`,
      );

      // Assemble just this week through the same summary/pattern guarantees AND
      // the same individualization as the initial generation: full VDOT paces
      // (mile/5K/10K), absolute working weights, and division/sex station loads.
      const miniSkeleton: ProgramSkeleton = { ...loaded.skeleton, weeks: [revisedWeek] };
      const a = assembleArgsFromInput(loaded.input);
      const { program: miniProgram } = assembleProgram(
        miniSkeleton,
        [result.chunk],
        a.runningExp,
        a.raceTimes,
        a.benchmarks,
        a.weightUnit,
        a.division,
        a.sex,
        a.catalog,
      );
      const newWeek = miniProgram.weeks[0];
      if (!newWeek) throw new Error("Refill produced no week");
      // Keep the race-day marker if the original target week had one (it shouldn't —
      // rule 1 — but never lose a race on a data edge case).
      newWeek.raceDay = loaded.nextWeekSkeleton.raceDay
        ? { priority: loaded.nextWeekSkeleton.raceDay.priority, date: loaded.nextWeekSkeleton.raceDay.date }
        : undefined;

      const weeks = loaded.programData.weeks.map((w) => (w.weekNumber === targetWeek ? newWeek : w));
      const skeletonWeeks = loaded.skeleton.weeks.map((w) =>
        w.weekNumber === targetWeek ? revisedWeek : w,
      );

      const { error: persistError } = await supabase
        .from("programs")
        .update({
          program_data: { ...loaded.programData, weeks },
          skeleton: { ...loaded.skeleton, weeks: skeletonWeeks },
        })
        .eq("id", programId);
      if (persistError) throw new Error(`Failed to persist adapted week: ${persistError.message}`);
      refilled = true;
    }
  } catch (err) {
    // The refill failed after we took the lock — roll it back so the user can
    // retry the review (relies on the adaptations DELETE-own policy, migration 0013).
    await supabase
      .from("adaptations")
      .delete()
      .eq("program_id", programId)
      .eq("week_number", weekNumber);
    return { error: `Adaptation failed: ${(err as Error).message}`, status: 502 };
  }

  return { rule: decision.rule, reason: decision.reason, targetWeek, refilled, usage };
}
