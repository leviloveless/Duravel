/**
 * Display labels for sessions and movement patterns.
 *
 * Lives in `lib` rather than `components` so non-UI consumers can use it — the
 * Strava description generator (`lib/program/session-summary.ts`) needs the same
 * words the program table shows, and a shared source is the only way those two
 * can't drift. `components/program/format.ts` re-exports these, so every existing
 * import keeps working.
 */

import type { Session } from "@/lib/schemas";

type RunSession = Extract<Session, { kind: "run" }>;
type LiftSession = Extract<Session, { kind: "lift" }>;

export const RUN_TYPE_LABEL: Record<RunSession["runType"], string> = {
  easy: "Easy run",
  fartlek: "Fartlek run",
  progression: "Progression run",
  long: "Long run",
  tempo: "Tempo run",
  threshold: "Threshold run",
  interval: "Interval run",
  hybrid_run: "Hybrid run",
};

export const LIFT_TYPE_LABEL: Record<LiftSession["liftType"], string> = {
  upper: "Upper body",
  lower: "Lower body",
  full: "Full body",
  power: "Power / explosive",
};

/** "horizontal_press" → "Horizontal press" */
export function patternLabel(pattern: string): string {
  const spaced = pattern.replace(/_/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** Short workout-type label, e.g. "Threshold run", "Full body lift". */
export function sessionTypeLabel(session: Session): string {
  if (session.kind === "run") return RUN_TYPE_LABEL[session.runType];
  if (session.kind === "lift") return `${LIFT_TYPE_LABEL[session.liftType]} lift`;
  if (session.kind === "hybrid") return session.simulation ? "Race Simulation" : "Hybrid (HYROX)";
  if (session.kind === "cardio") return "Zone 1–2 cardio";
  if (session.kind === "swim") return `${session.sessionType.replace(/_/g, " ")} swim`;
  if (session.kind === "bike") return `${session.sessionType.replace(/_/g, " ")} ride`;
  if (session.kind === "brick") return "Brick (bike→run)";
  return `${session.priority} race`;
}
