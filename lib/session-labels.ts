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

/**
 * The GOAL a lift session is training, as one label for the whole session
 * (Levi, 2026-08-25: "put the workout goal in the title rather than on each line
 * of the workout").
 *
 * A session can carry more than one — a heavy full-body day runs max strength
 * throughout except the lunge and the chest fly, which are muscular endurance by
 * design. Measured across 196 generated lift sessions, 10% mix two goals and the
 * rest are uniform. The title names the DOMINANT goal (most movements; ties broken
 * by which goal defines the day) and `movementLine` marks only the lines that
 * depart from it — so the exception stays visible without every line repeating
 * what the title already said.
 */
const EMPHASIS_RANK: Record<string, number> = {
  power: 0,
  max_strength: 1,
  strength: 2,
  endurance: 3,
};

export function sessionEmphasis(session: Session): string | undefined {
  if (session.kind !== "lift") return undefined;
  const counts = new Map<string, number>();
  for (const m of session.movements) {
    if (!m.emphasis) continue;
    counts.set(m.emphasis, (counts.get(m.emphasis) ?? 0) + 1);
  }
  if (counts.size === 0) return undefined;
  return [...counts.entries()].sort(
    (a, b) => b[1] - a[1] || (EMPHASIS_RANK[a[0]] ?? 9) - (EMPHASIS_RANK[b[0]] ?? 9),
  )[0]![0];
}

/** The words a goal goes by in the UI. */
export const EMPHASIS_LABEL: Record<string, string> = {
  max_strength: "Max strength",
  strength: "Strength",
  endurance: "Muscular endurance",
  power: "Power",
};

/** Short workout-type label, e.g. "Threshold run", "Full body lift · Max strength". */
export function sessionTypeLabel(session: Session): string {
  if (session.kind === "run") return RUN_TYPE_LABEL[session.runType];
  if (session.kind === "lift") {
    const base = `${LIFT_TYPE_LABEL[session.liftType]} lift`;
    const goal = sessionEmphasis(session);
    // "Power / explosive lift · Power" says it twice — the lift type IS the goal
    // on that day.
    if (!goal || goal === "power") return base;
    return `${base} · ${EMPHASIS_LABEL[goal] ?? goal}`;
  }
  if (session.kind === "hybrid") return session.simulation ? "Race Simulation" : "Hybrid (HYROX)";
  if (session.kind === "cardio") return "Zone 1–2 cardio";
  if (session.kind === "swim") return `${session.sessionType.replace(/_/g, " ")} swim`;
  if (session.kind === "bike") return `${session.sessionType.replace(/_/g, " ")} ride`;
  if (session.kind === "brick") return "Brick (bike→run)";
  return `${session.priority} race`;
}
