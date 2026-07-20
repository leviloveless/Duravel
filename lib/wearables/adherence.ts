import type { ProgramData, Session, WorkoutLog } from "@/lib/schemas";

/**
 * Program adherence (PURE, unit-testable) — planned vs completed sessions and
 * logged volume, per week and overall. Feeds the athlete's progress view and the
 * adaptation engine's context (how much of the plan is actually getting done).
 *
 * A "planned session" is any non-race session slot (races aren't logged — same
 * convention as `link.ts`/`flattenProgramSessions`). A log matches a slot by its
 * (weekNumber, day, sessionIndex) position.
 */

export interface WeekAdherence {
  weekNumber: number;
  planned: number;
  completed: number;
  partial: number;
  skipped: number;
  /** Sessions with any log (completed + partial); the "did something" count. */
  logged: number;
  /** Planned sessions with no log at all. */
  missed: number;
  /** completed + 0.5·partial, over planned (0–1). 1 when nothing was planned. */
  completionRate: number;
  /** Sum of logged actual minutes for the week (informational). */
  loggedMinutes: number;
}

export interface ProgramAdherence {
  weeks: WeekAdherence[];
  overall: {
    planned: number;
    completed: number;
    partial: number;
    skipped: number;
    missed: number;
    completionRate: number;
    loggedMinutes: number;
  };
  /** Completion by session kind across the whole program. */
  byKind: Record<string, { planned: number; completed: number }>;
}

function isPlannable(s: Session): boolean {
  return s.kind !== "race";
}

function rate(completed: number, partial: number, planned: number): number {
  if (planned <= 0) return 1;
  return Math.min(1, (completed + 0.5 * partial) / planned);
}

/**
 * Compute adherence for a program. If `throughWeek` is given, only weeks ≤ it are
 * counted (so an in-progress program isn't penalized for weeks not yet reached).
 */
export function computeAdherence(
  program: ProgramData,
  logs: WorkoutLog[],
  throughWeek?: number,
): ProgramAdherence {
  // Index logs by position for O(1) lookup.
  const logByPos = new Map<string, WorkoutLog>();
  for (const l of logs) logByPos.set(`${l.weekNumber}:${l.day}:${l.sessionIndex}`, l);

  const weeks: WeekAdherence[] = [];
  const byKind: Record<string, { planned: number; completed: number }> = {};

  for (const week of program.weeks) {
    if (throughWeek != null && week.weekNumber > throughWeek) continue;
    let planned = 0;
    let completed = 0;
    let partial = 0;
    let skipped = 0;
    let loggedMinutes = 0;

    for (const day of week.days) {
      day.sessions.forEach((session, index) => {
        if (!isPlannable(session)) return;
        planned += 1;
        const k = byKind[session.kind] ?? { planned: 0, completed: 0 };
        k.planned += 1;

        const log = logByPos.get(`${week.weekNumber}:${day.day}:${index}`);
        if (log) {
          if (log.status === "completed") {
            completed += 1;
            k.completed += 1;
          } else if (log.status === "partial") {
            partial += 1;
          } else if (log.status === "skipped") {
            skipped += 1;
          }
          const mins = log.actuals?.durationMin;
          if (typeof mins === "number" && Number.isFinite(mins)) loggedMinutes += mins;
        }
        byKind[session.kind] = k;
      });
    }

    const logged = completed + partial;
    weeks.push({
      weekNumber: week.weekNumber,
      planned,
      completed,
      partial,
      skipped,
      logged,
      missed: Math.max(0, planned - logged - skipped),
      completionRate: rate(completed, partial, planned),
      loggedMinutes: Math.round(loggedMinutes),
    });
  }

  const overall = weeks.reduce(
    (acc, w) => {
      acc.planned += w.planned;
      acc.completed += w.completed;
      acc.partial += w.partial;
      acc.skipped += w.skipped;
      acc.missed += w.missed;
      acc.loggedMinutes += w.loggedMinutes;
      return acc;
    },
    { planned: 0, completed: 0, partial: 0, skipped: 0, missed: 0, loggedMinutes: 0, completionRate: 0 },
  );
  overall.completionRate = rate(overall.completed, overall.partial, overall.planned);

  return { weeks, overall, byKind };
}
