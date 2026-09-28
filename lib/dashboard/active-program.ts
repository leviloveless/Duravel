import { weekStartDate } from "@/components/program/format";

/**
 * Which program the dashboard is about (2026-09-28).
 *
 * Until now the dashboard silently used "the newest ready program whose dates
 * cover today", and showed its name only in small capitals halfway down the hero.
 * An athlete with two programs could not tell which one the numbers described,
 * and one whose block had not started yet saw no dashboard at all (Levi,
 * 2026-09-28).
 *
 * The athlete now PICKS the active program (`profiles.active_program_id`,
 * migration 0050). The plan-shaped parts of the dashboard — this week, planned vs
 * completed hours, adherence, intensity mix, the race countdown — follow that one
 * program. The history-shaped parts — fitness, fatigue, form and the load ratio —
 * are built from EVERY program's logged sessions, because what the athlete did
 * last block is still in their legs whichever plan they are looking at now.
 *
 * When nothing is picked (or the pick was deleted), the old rule still decides,
 * and after it the next upcoming block, then the most recent finished one — so
 * the dashboard always says which program it is showing and why.
 */

const MS_PER_WEEK = 7 * 24 * 60 * 60 * 1000;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export type ActiveCandidate = {
  id: string;
  start_date: string;
  duration_weeks: number;
  program_data: unknown;
};

export type ProgramWindow =
  | { state: "upcoming"; currentWeek: 1; elapsedWeeks: 0; daysToStart: number }
  | { state: "current"; currentWeek: number; elapsedWeeks: number; daysToStart: 0 }
  | { state: "finished"; currentWeek: number; elapsedWeeks: number; daysToStart: 0 };

/** Where today falls in a program's calendar. */
export function programWindow(
  startDate: string,
  durationWeeks: number,
  nowMs: number,
): ProgramWindow {
  const start = weekStartDate(startDate, 1).getTime();
  if (nowMs < start) {
    return {
      state: "upcoming",
      currentWeek: 1,
      elapsedWeeks: 0,
      daysToStart: Math.ceil((start - nowMs) / MS_PER_DAY),
    };
  }
  const elapsed = Math.floor((nowMs - start) / MS_PER_WEEK);
  if (elapsed >= durationWeeks) {
    return {
      state: "finished",
      currentWeek: durationWeeks,
      elapsedWeeks: durationWeeks,
      daysToStart: 0,
    };
  }
  return { state: "current", currentWeek: elapsed + 1, elapsedWeeks: elapsed, daysToStart: 0 };
}

export type ActivePick<T> = {
  program: T;
  /** "chosen": the athlete picked it. Otherwise the rule that picked it for them. */
  how: "chosen" | "current" | "upcoming" | "latest";
};

/**
 * The dashboard's program. `programs` must be READY programs, newest first.
 * Programs without plan data are never picked — there is nothing to show.
 */
export function pickActiveProgram<T extends ActiveCandidate>(
  programs: readonly T[],
  chosenId: string | null | undefined,
  nowMs: number,
): ActivePick<T> | null {
  const usable = programs.filter((p) => p.program_data);
  if (usable.length === 0) return null;
  const chosen = chosenId ? usable.find((p) => p.id === chosenId) : undefined;
  if (chosen) return { program: chosen, how: "chosen" };

  const windows = usable.map((p) => ({
    p,
    w: programWindow(p.start_date, p.duration_weeks, nowMs),
  }));
  const current = windows.find((x) => x.w.state === "current");
  if (current) return { program: current.p, how: "current" };
  // The soonest upcoming block, not the newest-created one.
  const upcoming = windows
    .filter((x) => x.w.state === "upcoming")
    .sort((a, b) => a.w.daysToStart - b.w.daysToStart)[0];
  if (upcoming) return { program: upcoming.p, how: "upcoming" };
  return { program: usable[0]!, how: "latest" };
}

/** Sum several date → load maps into one. */
export function mergeDailyLoads(maps: readonly Map<string, number>[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const m of maps) {
    for (const [date, load] of m) out.set(date, (out.get(date) ?? 0) + load);
  }
  return out;
}

/** The earliest date carrying any load, or null when nothing has been logged. */
export function firstLoadDate(load: Map<string, number>): string | null {
  let first: string | null = null;
  for (const [date, v] of load) {
    if (v > 0 && (first === null || date < first)) first = date;
  }
  return first;
}
