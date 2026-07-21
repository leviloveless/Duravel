/**
 * Safety guardrails (workplan §5) — a PURE analysis layer over a generated
 * program. It never changes the program; it surfaces the injury / overtraining
 * patterns the research flags, so the athlete (and, later, an auto-adjust step)
 * can act on them. Golden-HYROX-safe by construction (read-only).
 *
 * Checks:
 *  - run_jump       single long-run jump vs. the recent longest (Nielsen 2024)
 *  - volume_spike   weekly volume jump vs. the recent baseline (acute:chronic)
 *  - concurrent     heavy strength stacked with lots of hard endurance (interference)
 *  - impact         high weekly running mileage → route some to low-impact
 */
import type { ProgramData, Session } from "@/lib/schemas";

export type GuardrailSeverity = "warn" | "info";
export type GuardrailId = "run_jump" | "volume_spike" | "concurrent" | "impact";

export interface GuardrailFlag {
  id: GuardrailId;
  severity: GuardrailSeverity;
  week: number;
  title: string;
  detail: string;
}

export interface GuardrailReport {
  flags: GuardrailFlag[];
  clear: boolean;
}

// --- tunable thresholds -----------------------------------------------------
const RUN_JUMP_WARN = 1.5; // >50% over recent longest run
const RUN_JUMP_INFO = 1.3; // >30% over recent longest run
const RUN_JUMP_FLOOR_MI = 3; // ignore tiny early runs
const VOLUME_SPIKE = 1.5; // weekly cardio-minutes vs. trailing mean
const CONCURRENT_HEAVY_LIFTS = 2; // heavy strength sessions in a week
const CONCURRENT_HARD_ENDURANCE = 3; // + hard endurance/hybrid sessions
const IMPACT_WARN_MI = 70;
const IMPACT_INFO_MI = 55;
const TRAILING = 4; // weeks of history for the rolling baselines

const HARD_RUN = new Set(["tempo", "threshold", "interval", "fartlek"]);
const HARD_BIKE = new Set(["threshold", "vo2", "sweet_spot"]);
const HARD_SWIM = new Set(["threshold", "css"]);

function longestRunMiles(sessions: Session[]): number {
  let max = 0;
  for (const s of sessions) if (s.kind === "run" && s.distanceMiles > max) max = s.distanceMiles;
  return max;
}

function isHardEndurance(s: Session): boolean {
  if (s.kind === "run") return HARD_RUN.has(s.runType);
  if (s.kind === "bike") return HARD_BIKE.has(s.sessionType);
  if (s.kind === "swim") return HARD_SWIM.has(s.sessionType);
  if (s.kind === "hybrid") return true;
  if ("goalZone" in s && typeof s.goalZone === "number") return s.goalZone >= 4;
  return false;
}

function isHeavyLift(s: Session): boolean {
  return (
    s.kind === "lift" &&
    s.movements.some((m) => m.emphasis === "max_strength" || (m.intensityPct ?? 0) >= 85)
  );
}

const pct = (ratio: number) => Math.round((ratio - 1) * 100);

/** Analyze a generated program for the safety guardrails. Read-only. */
export function analyzeGuardrails(data: ProgramData | null): GuardrailReport {
  const flags: GuardrailFlag[] = [];
  if (!data || !data.weeks || data.weeks.length === 0) return { flags, clear: true };

  const weeks = [...data.weeks].sort((a, b) => a.weekNumber - b.weekNumber);
  const longRun: number[] = [];
  const cardioMin: number[] = [];

  weeks.forEach((w, i) => {
    const allSessions = w.days.flatMap((d) => d.sessions);
    const wkLongRun = longestRunMiles(allSessions);
    const wkCardio = w.summary.totalCardioMinutes ?? 0;
    const wkMiles = w.summary.totalMileage ?? 0;

    // 1) Single long-run jump vs. the recent longest.
    const priorMaxRun = Math.max(0, ...longRun.slice(-TRAILING));
    if (priorMaxRun >= RUN_JUMP_FLOOR_MI && wkLongRun >= RUN_JUMP_FLOOR_MI) {
      const ratio = wkLongRun / priorMaxRun;
      if (ratio >= RUN_JUMP_INFO) {
        flags.push({
          id: "run_jump",
          severity: ratio >= RUN_JUMP_WARN ? "warn" : "info",
          week: w.weekNumber,
          title: `Long-run jump (+${pct(ratio)}%)`,
          detail: `Week ${w.weekNumber}'s longest run (${wkLongRun.toFixed(1)} mi) is ${pct(ratio)}% over your recent longest (${priorMaxRun.toFixed(1)} mi). Single-run jumps above ~30% raise injury risk (Nielsen 2024) — consider capping the step or adding an easy week first.`,
        });
      }
    }

    // 2) Weekly volume spike vs. the trailing baseline.
    const base = cardioMin.slice(-TRAILING).filter((v) => v > 0);
    if (i >= 2 && base.length > 0) {
      const mean = base.reduce((a, b) => a + b, 0) / base.length;
      if (mean > 0 && wkCardio / mean >= VOLUME_SPIKE) {
        flags.push({
          id: "volume_spike",
          severity: "warn",
          week: w.weekNumber,
          title: `Volume spike (+${pct(wkCardio / mean)}%)`,
          detail: `Week ${w.weekNumber}'s ${Math.round(wkCardio / 60)} h is ${pct(wkCardio / mean)}% over the prior weeks' average. Large single-week jumps drive the acute:chronic spike linked to injury — ramp more gradually.`,
        });
      }
    }

    // 3) Concurrent heavy strength + lots of hard endurance (interference).
    const heavyLifts = allSessions.filter(isHeavyLift).length;
    const hardEndurance = allSessions.filter(isHardEndurance).length;
    if (heavyLifts >= CONCURRENT_HEAVY_LIFTS && hardEndurance >= CONCURRENT_HARD_ENDURANCE) {
      flags.push({
        id: "concurrent",
        severity: "info",
        week: w.weekNumber,
        title: "Heavy strength + hard endurance stacked",
        detail: `Week ${w.weekNumber} pairs ${heavyLifts} heavy lifts with ${hardEndurance} hard endurance sessions. Concurrent-training research links this to blunted power and recovery — separate hard strength and hard endurance by a day where you can.`,
      });
    }

    // 4) High running mileage → route some volume to low-impact.
    if (wkMiles >= IMPACT_INFO_MI) {
      flags.push({
        id: "impact",
        severity: wkMiles >= IMPACT_WARN_MI ? "warn" : "info",
        week: w.weekNumber,
        title: `High running impact (${Math.round(wkMiles)} mi)`,
        detail: `Week ${w.weekNumber} carries ${Math.round(wkMiles)} mi of running. Above ~${IMPACT_INFO_MI} mi, connective tissue is the limiter — route some easy volume to low-impact cardio (bike / row / SkiErg) to keep building aerobically with less joint load.`,
      });
    }

    longRun.push(wkLongRun);
    cardioMin.push(wkCardio);
  });

  return { flags, clear: flags.length === 0 };
}

/** Convenience: the highest severity present (for a summary badge). */
export function worstSeverity(report: GuardrailReport): GuardrailSeverity | null {
  if (report.flags.some((f) => f.severity === "warn")) return "warn";
  if (report.flags.some((f) => f.severity === "info")) return "info";
  return null;
}
