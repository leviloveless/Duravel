/**
 * Acute:Chronic Workload Ratio, on the athlete's screen (Levi, 2026-09-20).
 *
 * *"The app should also show ACWR on a daily and weekly basis."*
 *
 * ACWR is the oldest question in load management: **is this week bigger than
 * what you are used to?** Acute (the last 7 days) over chronic (what the last 4
 * weeks averaged). Around 1.0 you are training at the level you are adapted to;
 * well above it you are asking for more than your body has been prepared for,
 * and the injury literature — Gabbett 2016 and the work around it — puts the
 * inflection near 1.5.
 *
 * ## The metric it is computed FROM, and the one it is not
 *
 * ⚠️ DURAVEL ALREADY HAD AN ACWR, AND THIS IS NOT IT. `lib/engine/load.ts`
 * computes one from **session-RPE load** (`RPE × minutes`) and feeds it to
 * `decideAdaptation`, where it gates `load_spike`, `load_caution` and
 * `earned_bump`. That one is invisible: it has never been displayed anywhere.
 *
 * The two differ in a way that matters. The engine's counts a session **only if
 * the athlete logged an RPE** — no RPE, no load, and a diligently logged week
 * with blank RPE fields contributes exactly zero. This one uses the same
 * ZONE-WEIGHTED MINUTES as the Fitness/Fatigue/Form chart (`fitness.ts`), which
 * every logged session has whether or not the athlete rated it.
 *
 * Levi's call, 2026-09-20: the DISPLAYED ratio uses zone-weighted minutes, so
 * that everything on the dashboard reconciles with everything else on the
 * dashboard. The cost is stated plainly rather than hidden — the number the
 * athlete reads is not, today, the number that triggers their deload. Unifying
 * the two is a real piece of work with a measurable blast radius (the last
 * comparable change to the engine's load moved the applied rule in 6.6% of
 * scenarios) and it is not smuggled in behind a display feature.
 *
 * What the two DO share is the thresholds: `ACWR_CAUTION` and `ACWR_SPIKE` are
 * imported from `adapt-config`, not restated. If Levi retunes the engine's
 * lines, the bands on screen move with them.
 *
 * ## Rolling, not EWMA
 *
 * Levi's call: the rolling 7 ÷ 28 form. It is the version the 1.3 / 1.5
 * thresholds in `adapt-config` were set against, and the one an athlete who has
 * read anything about ACWR will recognise. The EWMA variant (Williams 2017) is
 * better supported and reacts faster after a layoff; it would also need its own
 * thresholds, which is the reason it is not here.
 *
 * ## The cold start, which is where naive ACWR lies
 *
 * A 28-day window on day 10 of a program contains 18 days of zeros. The chronic
 * baseline collapses, the ratio explodes, and the athlete is told they are
 * spiking during the easiest fortnight of their block. So:
 *
 *   - nothing is reported until `ACWR_MIN_WEEKS` of program history exist — the
 *     same guard `computeLoadMetrics` applies, for the same reason;
 *   - and the chronic divisor is the window ACTUALLY AVAILABLE, not a flat 4
 *     weeks, so weeks 3 and 4 of a program are measured against the 21 or 25
 *     days that exist rather than against 28 days of which several never
 *     happened.
 *
 * PURE — no I/O, no framework, no clock of its own.
 */

import { ADAPT } from "@/lib/engine/adapt-config";
import { addDays, daysBetween } from "./fitness";

/** Days in the acute window — "the last week", the numerator. */
export const ACUTE_DAYS = 7;
/** Days in the chronic window — "what you are used to", the denominator. */
export const CHRONIC_DAYS = 28;

/**
 * Where a ratio sits.
 *
 * Four states rather than three: below 0.8 is its own answer, and it is the one
 * athletes never hear. A ratio that low means the last week was well under what
 * the body is adapted to — fine in a taper, a warning sign in week 6 of a build,
 * and invisible on any display that only colours the top end.
 */
export type AcwrBand = "low" | "optimal" | "caution" | "high";

/** Below this the last week is well under what the athlete is adapted to. */
export const ACWR_LOW = 0.8;

export function acwrBand(acwr: number): AcwrBand {
  if (acwr >= ADAPT.ACWR_SPIKE) return "high";
  if (acwr >= ADAPT.ACWR_CAUTION) return "caution";
  if (acwr < ACWR_LOW) return "low";
  return "optimal";
}

export const ACWR_BAND_LABEL: Record<AcwrBand, string> = {
  low: "Detraining",
  optimal: "Sweet spot",
  caution: "Ramping fast",
  high: "Spike",
};

export const ACWR_BAND_BLURB: Record<AcwrBand, string> = {
  low: "The last week sits well under what you are adapted to. That is exactly right in a taper or a recovery week, and a sign of lost fitness anywhere else.",
  optimal:
    "The last week is in line with what you have built. This is where you want to live for most of a block — enough to progress, not enough to dig a hole.",
  caution:
    "You are adding load faster than you have adapted to it. One week here is how progress happens; three in a row is how it stops.",
  high: "The last week is well beyond your recent normal. This is the range where injury risk climbs steeply — the engine will hold or pull back your next week.",
};

export interface AcwrPoint {
  /** "YYYY-MM-DD" */
  date: string;
  /** Load over the acute window ending today. */
  acute: number;
  /** Weekly-equivalent load over the chronic window ending today. */
  chronic: number;
  /** acute ÷ chronic, or null while history is too short to mean anything. */
  acwr: number | null;
  /** Where that ratio sits; null whenever `acwr` is. */
  band: AcwrBand | null;
}

/** Sum the load map over the `days` calendar days ending on `end` inclusive. */
function windowSum(load: ReadonlyMap<string, number>, end: string, days: number): number {
  let total = 0;
  for (let i = 0; i < days; i++) total += load.get(addDays(end, -i)) ?? 0;
  return total;
}

/**
 * The daily ACWR series, one point per calendar day.
 *
 * `from` is the program's first day: it fixes how much history exists, which is
 * what the cold-start guard above is measured against. Rest days are points too
 * — a ratio that only existed on training days would jump around for reasons
 * that have nothing to do with training.
 */
export function acwrSeries(
  load: ReadonlyMap<string, number>,
  from: string,
  to: string,
): AcwrPoint[] {
  const span = daysBetween(from, to);
  if (span < 0) return [];
  const minDays = ADAPT.ACWR_MIN_WEEKS * 7;
  const out: AcwrPoint[] = [];

  for (let i = 0; i <= span; i++) {
    const date = addDays(from, i);
    const elapsed = i + 1; // days of program history including today
    const acute = windowSum(load, date, ACUTE_DAYS);
    // The chronic window never reaches back before the program started.
    const chronicDays = Math.min(CHRONIC_DAYS, elapsed);
    const chronicTotal = windowSum(load, date, chronicDays);
    const weeks = chronicDays / 7;
    const chronic = weeks > 0 ? chronicTotal / weeks : 0;
    const ready = elapsed >= minDays && chronic > 0;
    const acwr = ready ? Math.round((acute / chronic) * 100) / 100 : null;
    out.push({
      date,
      acute: Math.round(acute),
      chronic: Math.round(chronic),
      acwr,
      band: acwr === null ? null : acwrBand(acwr),
    });
  }
  return out;
}

export interface AcwrWeek {
  weekNumber: number;
  /** "YYYY-MM-DD" — the Monday. */
  start: string;
  /** The last day of the week that has actually happened. */
  end: string;
  acute: number;
  chronic: number;
  acwr: number | null;
  band: AcwrBand | null;
}

/**
 * One ACWR per program week, read on the LAST day of the week.
 *
 * Read at the end rather than averaged across the week, and the difference is
 * the point: ACWR is a question about where you have ARRIVED, and a mean of
 * seven daily ratios would smear a Sunday spike back across the Tuesday that
 * preceded it. A part-finished week is reported at today, so the current week
 * always has a figure rather than waiting until Sunday to appear.
 */
export function weeklyAcwr(
  load: ReadonlyMap<string, number>,
  weekStartISO: (weekNumber: number) => string,
  weekNumbers: readonly number[],
  todayISO: string,
): AcwrWeek[] {
  if (weekNumbers.length === 0) return [];
  const first = weekStartISO(weekNumbers[0]!);
  const byDate = new Map(acwrSeries(load, first, todayISO).map((p) => [p.date, p]));

  const out: AcwrWeek[] = [];
  for (const n of weekNumbers) {
    const start = weekStartISO(n);
    if (daysBetween(start, todayISO) < 0) continue; // the week hasn't started
    const full = addDays(start, 6);
    const end = daysBetween(full, todayISO) >= 0 ? full : todayISO;
    const p = byDate.get(end);
    if (!p) continue;
    out.push({
      weekNumber: n,
      start,
      end,
      acute: p.acute,
      chronic: p.chronic,
      acwr: p.acwr,
      band: p.band,
    });
  }
  return out;
}
