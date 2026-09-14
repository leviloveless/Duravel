import type { ExtraWorkout, ProgramWeek, Session, WorkoutLog } from "@/lib/schemas";
import { sessionTiming, sessionMiles } from "@/lib/session-volume";
import { addDays, daysBetween } from "./fitness";

/**
 * The month grid (2026-09-13).
 *
 * Duravel had no calendar at all. A program page shows one week at a time, which
 * is the right shape for doing today's session and the wrong shape for the two
 * questions an athlete asks constantly: what does the shape of this block look
 * like, and where did last month actually go.
 *
 * Everything here is pure so the page stays a server component and the numbers
 * cannot drift from the dashboard's — both read the same `sessionTiming().total`.
 */

const DAY_INDEX: Record<string, number> = {
  mon: 0,
  tue: 1,
  wed: 2,
  thu: 3,
  fri: 4,
  sat: 5,
  sun: 6,
};

export interface CalendarSession {
  session: Session;
  programId: string;
  weekNumber: number;
  day: string;
  index: number;
  minutes: number;
  miles: number;
  status: WorkoutLog["status"] | null;
}

export interface CalendarExtra {
  title: string;
  minutes: number;
  kind: string;
}

export interface CalendarDay {
  /** "YYYY-MM-DD" */
  date: string;
  /** False for the leading/trailing days that pad the grid to whole weeks. */
  inMonth: boolean;
  isToday: boolean;
  sessions: CalendarSession[];
  extras: CalendarExtra[];
}

export interface CalendarWeek {
  days: CalendarDay[];
  /** Monday of this row, "YYYY-MM-DD". */
  startDate: string;
  plannedMin: number;
  completedMin: number;
  miles: number;
  /** Program week number when this row sits inside the program, else null. */
  weekNumber: number | null;
}

/** First day of the month, "YYYY-MM-01". */
export function monthStart(year: number, month1: number): string {
  return `${year}-${String(month1).padStart(2, "0")}-01`;
}

/** Days in a month, honouring leap years. */
export function daysInMonth(year: number, month1: number): number {
  return new Date(Date.UTC(year, month1, 0)).getUTCDate();
}

/**
 * The Monday on or before a date.
 *
 * Weeks start Monday here because the engine's own weeks do — a calendar whose
 * rows disagreed with the program's weeks would make the weekly summary column
 * meaningless, which is the column most worth having.
 */
export function mondayOnOrBefore(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = Sunday
  const backUp = dow === 0 ? 6 : dow - 1;
  return addDays(iso, -backUp);
}

/**
 * Build the grid for one month.
 *
 * `programs` may be empty, may be one, or may be several — an athlete running a
 * HYROX block and a tune-up plan at once should see both, so sessions carry
 * their own `programId` rather than the grid assuming a single source.
 */
export function buildMonth(
  year: number,
  month1: number,
  todayISO: string,
  programs: readonly {
    id: string;
    weeks: readonly ProgramWeek[];
    logs: readonly WorkoutLog[];
    extras: readonly ExtraWorkout[];
    weekStartISO: (weekNumber: number) => string;
  }[],
): CalendarWeek[] {
  const first = monthStart(year, month1);
  const last = addDays(first, daysInMonth(year, month1) - 1);
  const gridStart = mondayOnOrBefore(first);
  // Always whole weeks, and always at least six rows so the grid does not change
  // height from month to month — a calendar that jumps as you page through it
  // reads as broken even though every cell is right.
  const rows = Math.max(6, Math.ceil((daysBetween(gridStart, last) + 1) / 7));

  const byDate = new Map<string, { sessions: CalendarSession[]; extras: CalendarExtra[] }>();
  const bucket = (date: string) => {
    let b = byDate.get(date);
    if (!b) {
      b = { sessions: [], extras: [] };
      byDate.set(date, b);
    }
    return b;
  };

  for (const p of programs) {
    for (const week of p.weeks) {
      const start = p.weekStartISO(week.weekNumber);
      for (const day of week.days) {
        const offset = DAY_INDEX[day.day];
        if (offset === undefined) continue;
        const date = addDays(start, offset);
        day.sessions.forEach((s, i) => {
          const log = p.logs.find(
            (l) => l.weekNumber === week.weekNumber && l.day === day.day && l.sessionIndex === i,
          );
          bucket(date).sessions.push({
            session: s,
            programId: p.id,
            weekNumber: week.weekNumber,
            day: day.day,
            index: i,
            minutes: Math.round(sessionTiming(s).total),
            miles: Math.round(sessionMiles(s) * 10) / 10,
            status: log?.status ?? null,
          });
        });
      }
    }
    for (const e of p.extras) {
      const offset = DAY_INDEX[e.day];
      if (offset === undefined) continue;
      const date = addDays(p.weekStartISO(e.weekNumber), offset);
      bucket(date).extras.push({
        title: e.title ?? "Extra session",
        minutes: e.durationMin ?? 0,
        kind: e.kind,
      });
    }
  }

  // Program week number for a row, when the row's Monday is a program Monday.
  const weekNumberAt = new Map<string, number>();
  for (const p of programs) {
    for (const w of p.weeks) weekNumberAt.set(p.weekStartISO(w.weekNumber), w.weekNumber);
  }

  const out: CalendarWeek[] = [];
  for (let r = 0; r < rows; r++) {
    const startDate = addDays(gridStart, r * 7);
    const days: CalendarDay[] = [];
    let plannedMin = 0;
    let completedMin = 0;
    let miles = 0;

    for (let d = 0; d < 7; d++) {
      const date = addDays(startDate, d);
      const b = byDate.get(date) ?? { sessions: [], extras: [] };
      for (const s of b.sessions) {
        plannedMin += s.minutes;
        if (s.status === "completed") completedMin += s.minutes;
        else if (s.status === "partial") completedMin += s.minutes / 2;
        if (s.status === "completed") miles += s.miles;
      }
      for (const e of b.extras) completedMin += e.minutes;

      days.push({
        date,
        inMonth: date >= first && date <= last,
        isToday: date === todayISO,
        sessions: b.sessions,
        extras: b.extras,
      });
    }

    out.push({
      days,
      startDate,
      plannedMin: Math.round(plannedMin),
      completedMin: Math.round(completedMin),
      miles: Math.round(miles * 10) / 10,
      weekNumber: weekNumberAt.get(startDate) ?? null,
    });
  }
  return out;
}

/** "September 2026" */
export function monthLabel(year: number, month1: number): string {
  const names = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ];
  return `${names[month1 - 1]} ${year}`;
}

/** Step a year/month pair by n months, keeping month in 1–12. */
export function shiftMonth(
  year: number,
  month1: number,
  n: number,
): { year: number; month: number } {
  const zero = year * 12 + (month1 - 1) + n;
  return { year: Math.floor(zero / 12), month: (zero % 12) + 1 };
}
