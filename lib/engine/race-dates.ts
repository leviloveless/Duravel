/**
 * Sanity checks on the dates a program is built from.
 *
 * ## Why this file exists
 *
 * On 2026-09-09 Levi built a program and reported three separate bugs: an A race
 * appeared on a day he never picked, his authored week's days were ignored, and
 * a build he expected to run to late November came out four weeks long.
 *
 * All three were one typo. The A race had been stored as `0226-11-21` — year
 * 226, not 2026 — entered through a native date field, which will happily accept
 * a three-digit year without a word.
 *
 * From there the engine did nothing wrong and everything badly:
 *
 *   - the race is ~1,800 years BEFORE the start, so `weekNumber` floors at 1 and
 *     the A race lands in week 1, showing on the start date;
 *   - `durationWeeks` is the furthest race's week, which left only the B race —
 *     four weeks out;
 *   - and an A-race week belongs to the taper protocol, so `assignDaysFromTemplate`
 *     short-circuits and the athlete's authored week is discarded by design.
 *
 * A garbage date should be refused at the door, not turned into a plausible-
 * looking program. The lesson generalises: `<input type="date">` has `min`/`max`
 * attributes and this form deliberately blocks native submit, so those attributes
 * enforce NOTHING. Any form that bypasses native validation owns every check
 * native validation would have done.
 *
 * PURE — no I/O, no framework. Used by the onboarding form as the athlete
 * advances, and again by the server action on submit, so the two cannot drift.
 */

/** The longest program the engine will build (`toEngineInput` clamps to this). */
export const MAX_PROGRAM_WEEKS = 24;

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const MS_PER_WEEK = 7 * MS_PER_DAY;

/**
 * A calendar date, or null.
 *
 * Parsed as UTC midnight rather than through `new Date(v)`, whose behaviour on a
 * bare `yyyy-mm-dd` has changed between engines and once differed by a day
 * depending on the reader's timezone.
 */
export function parseIsoDate(value: string | undefined | null): Date | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const ms = Date.parse(`${value}T00:00:00Z`);
  if (!Number.isFinite(ms)) return null;
  const d = new Date(ms);
  // Round-trip: rejects 2026-02-30 and friends, which `Date.parse` rolls over.
  return d.toISOString().slice(0, 10) === value ? d : null;
}

/** Whole weeks from `start` to `date`, rounded up — the engine's own measure. */
export function weeksBetween(start: Date, date: Date): number {
  return Math.ceil((date.getTime() - start.getTime()) / MS_PER_WEEK);
}

export type RaceDateIssue = { index: number; message: string };

/**
 * Everything wrong with a set of race dates, in the athlete's terms.
 *
 * Returns one message per offending race, each naming the remedy — "move your
 * start date" is usually the fix and is never obvious from "invalid date".
 */
export function checkRaceDates(
  races: { raceDate: string; priority: string }[],
  startDate: string | undefined,
): RaceDateIssue[] {
  const issues: RaceDateIssue[] = [];
  const start = parseIsoDate(startDate);

  races.forEach((r, index) => {
    const at = (message: string) => issues.push({ index, message });
    const date = parseIsoDate(r.raceDate);

    if (!date) {
      at(`Race ${index + 1} needs a real date (year, month and day).`);
      return;
    }

    // THE ONE THAT BIT. A four-digit year is easy to get wrong in a native date
    // field — one keystroke short and you have the year 226 — and every downstream
    // number then looks like a different bug.
    const year = date.getUTCFullYear();
    if (year < 2000 || year > 2100) {
      at(
        `Race ${index + 1} is dated ${r.raceDate} — that year looks wrong. Check the four-digit year.`,
      );
      return;
    }

    if (!start) return; // no usable start date; the caller reports that separately

    if (date.getTime() < start.getTime()) {
      at(
        `Race ${index + 1} (${r.raceDate}) is before your start date (${startDate}). Move the race, or start the program earlier.`,
      );
      return;
    }

    const weeks = weeksBetween(start, date);
    if (weeks > MAX_PROGRAM_WEEKS) {
      at(
        `Race ${index + 1} (${r.raceDate}) is ${weeks} weeks after your start date, and a program runs at most ${MAX_PROGRAM_WEEKS}. Push your start date back, or build toward a nearer race first.`,
      );
    }
  });

  return issues;
}
