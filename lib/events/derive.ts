import { countdown, type Countdown } from "@/lib/dashboard/derive";
import { daysBetween } from "@/lib/dashboard/fitness";

/**
 * Events — pure derivations (2026-09-14).
 *
 * An event is a race the athlete has recorded, with or without a program built
 * for it. Everything the dashboard and (later) a season plan needs to say about
 * a list of them is worked out here, so no surface has to re-derive it.
 */

export type RacePriority = "A" | "B" | "C";

export interface EventRow {
  id: string;
  user_id: string;
  program_id: string | null;
  /** "YYYY-MM-DD" */
  race_date: string;
  priority: RacePriority;
  name: string | null;
  sport: string | null;
  goal_time: string | null;
  notes: string | null;
  source: "program" | "athlete";
}

/**
 * Two A races closer than this cannot both be peaked for.
 *
 * A taper plus the rebuild behind it is about three weeks either side; eight is
 * the point past which a second peak is a real peak rather than racing through
 * the back of the first one. It is a coaching heuristic, not a measurement, and
 * it produces a WARNING — never a block. An athlete who wants to race twice in a
 * month is allowed to; they just should not be surprised by the second result.
 */
export const CLOSE_A_RACE_WEEKS = 8;

/** Sorted by date, soonest first. Ties broken by priority so an A leads a B. */
export function byDate(events: readonly EventRow[]): EventRow[] {
  const rank: Record<RacePriority, number> = { A: 0, B: 1, C: 2 };
  return [...events].sort(
    (a, b) => a.race_date.localeCompare(b.race_date) || rank[a.priority] - rank[b.priority],
  );
}

/** Events on or after `today`, soonest first. */
export function upcoming(events: readonly EventRow[], today: string): EventRow[] {
  return byDate(events).filter((e) => e.race_date >= today);
}

/**
 * The next A race — what the dashboard counts down to.
 *
 * A season has several A races even though a single block peaks at one, so
 * "the A race" is always "the next one", never "the only one". Falls back to the
 * next event of any priority: an athlete whose only upcoming race is a B still
 * wants a countdown.
 */
export function nextRace(events: readonly EventRow[], today: string): EventRow | null {
  const ahead = upcoming(events, today);
  return ahead.find((e) => e.priority === "A") ?? ahead[0] ?? null;
}

export function countdownTo(event: EventRow | null, from: Date = new Date()): Countdown | null {
  return event ? countdown(event.race_date, from) : null;
}

export interface CloseRaceWarning {
  first: EventRow;
  second: EventRow;
  weeksApart: number;
}

/**
 * Pairs of A races too close together to peak for both.
 *
 * Only adjacent pairs are reported: three A races in a row produce two warnings,
 * not three, because what the athlete has to decide is each gap in turn.
 */
export function closeARaces(events: readonly EventRow[], today: string): CloseRaceWarning[] {
  const aRaces = upcoming(events, today).filter((e) => e.priority === "A");
  const out: CloseRaceWarning[] = [];
  for (let i = 0; i + 1 < aRaces.length; i++) {
    const first = aRaces[i]!;
    const second = aRaces[i + 1]!;
    const days = daysBetween(first.race_date, second.race_date);
    const weeks = Math.floor(days / 7);
    if (weeks < CLOSE_A_RACE_WEEKS) out.push({ first, second, weeksApart: weeks });
  }
  return out;
}

export interface DateDrift {
  event: EventRow;
  /** The date the block was actually periodized for. */
  programDate: string;
  daysApart: number;
}

/**
 * Where an event and the block built for it disagree about the date.
 *
 * ⚠️ NOTHING IS SYNCED AUTOMATICALLY, on purpose. A block's taper, its deload
 * placement and its race week were all computed against a specific date; moving
 * that date silently would rewrite a periodized plan behind the athlete's back,
 * and regeneration is not free. So the event owns "when is my race", the program
 * owns "what this block was built for", and when they disagree the dashboard
 * says so and offers a rebuild. A visible mismatch is a smaller problem than an
 * invisible one.
 */
export function dateDrift(
  events: readonly EventRow[],
  programDateFor: (programId: string) => string | null,
): DateDrift[] {
  const out: DateDrift[] = [];
  for (const e of events) {
    if (!e.program_id) continue;
    const programDate = programDateFor(e.program_id);
    if (!programDate || programDate === e.race_date) continue;
    out.push({ event: e, programDate, daysApart: daysBetween(programDate, e.race_date) });
  }
  return out;
}

/** "HYROX Dallas", or a sensible stand-in when the athlete did not name it. */
export function eventTitle(e: EventRow): string {
  if (e.name && e.name.trim() !== "") return e.name.trim();
  const sport = e.sport && e.sport.trim() !== "" ? e.sport.trim() : "Race";
  return `${sport} — ${e.race_date}`;
}

export const PRIORITY_LABEL: Record<RacePriority, string> = {
  A: "A race",
  B: "B race",
  C: "C race",
};

export const PRIORITY_BLURB: Record<RacePriority, string> = {
  A: "The race the block is built to peak for.",
  B: "Raced hard, but trained through — no full taper.",
  C: "A training day with a number on. Treated as a hard session.",
};
