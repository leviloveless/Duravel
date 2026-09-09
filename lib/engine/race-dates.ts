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

/**
 * How far into the past a start date may sit before it is treated as a typo.
 *
 * Not zero, even though the form advertises `min={today}`. The form's "today"
 * comes from `new Date().toISOString()`, which is a UTC date, while the athlete
 * is picking from a calendar rendered in their own zone — in UTC-8 at 5pm those
 * two disagree by a day, and rejecting the date the picker shows as today would
 * be a bug of our own making. A week of slack is wider than any real offset and
 * far narrower than the mistakes that matter.
 */
export const START_DATE_PAST_GRACE_DAYS = 7;

/**
 * Everything wrong with a program's start date, in the athlete's terms.
 *
 * This is the field the race-date checker CANNOT report on. `checkRaceDates`
 * bails out with "no usable start date; the caller reports that separately" —
 * and until now no caller did. That gap is not academic: the start date sits one
 * control above the race dates, on the same step, in the same kind of native
 * date input, and it carries the same decorative `min` attribute.
 *
 * Measured, on a HYROX program with one A race 11 weeks out:
 *
 *   start `2026-09-09` → 11-week program, A race in week 11.   (correct)
 *   start `0226-09-09` → 24-week program, A race in week 24.   (year typo)
 *   start `1990-01-01` → 24-week program, A race in week 24.   (past)
 *   start `banana`     → RangeError: Invalid array length.     (crash)
 *
 * The last one is not reachable from a date picker, but it is reachable from the
 * edit path and from any caller that is not a browser, and it is an unhandled
 * 500 rather than a message. The middle two are the incident again with a
 * different field: a program of the wrong length, aimed at the wrong week, with
 * nothing on screen pointing at a date.
 *
 * `today` is a parameter rather than a `Date.now()` so this stays pure and the
 * form and the server action can be handed the same clock.
 */
export function checkStartDate(
  startDate: string | undefined | null,
  today: string,
  opts: { allowPast?: boolean } = {},
): string | null {
  // Blank is fine — both callers default an absent start date to today.
  if (!startDate) return null;

  const date = parseIsoDate(startDate);
  if (!date) {
    return `Your start date (${startDate}) isn't a real calendar date. Pick it from the date field.`;
  }

  // Worded like the race-date message on purpose. The remedy is four digits, and
  // an athlete told their start date is "in the past" would go looking at the
  // calendar rather than at the year they mistyped.
  const year = date.getUTCFullYear();
  if (year < 2000 || year > 2100) {
    return `Your start date is ${startDate} — that year looks wrong. Check the four-digit year.`;
  }

  // Editing an existing program means its start date is legitimately behind us.
  if (opts.allowPast) return null;

  const now = parseIsoDate(today);
  if (!now) return null; // no clock to compare against; the year check still stood

  const daysPast = Math.floor((now.getTime() - date.getTime()) / MS_PER_DAY);
  if (daysPast > START_DATE_PAST_GRACE_DAYS) {
    return `Your start date (${startDate}) is ${daysPast} days ago. A new program starts today or later — pick a start date from today on.`;
  }

  return null;
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
