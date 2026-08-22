/**
 * How far the long run may jump in one week (Levi, 2026-08-19).
 *
 * ## Why this is the lever, and not weekly mileage
 *
 * The weekly-total progression rules everyone quotes have thin evidence behind
 * them: Buist 2008 randomised 486 novices to a 13-week graded 10% program versus
 * a conventional 8-week one and found 21% vs 20% injury — no difference. What
 * DOES show up is a cohort of 5,205 runners across ~500,000 logged runs, where
 * change in weekly volume had little predictive value, and the thing that
 * predicted injury was a single run jumping past what that runner had recently
 * done: **+10–30% over their longest run of the previous 30 days carried 64%
 * higher injury risk.** One ambitious Sunday, not the weekly sum.
 *
 * So the engine caps the long run's growth against its OWN trailing maximum.
 *
 * ## Why the reference is a trailing MAX, not last week
 *
 * A deload cuts the long run by 40%. Against "last week" the rebound that
 * follows reads as a 67% jump and would be throttled every single microcycle —
 * which is nonsense: returning to a distance you ran three weeks ago is not a
 * jump, and that is exactly why the research measured against the longest run of
 * the previous 30 days rather than the previous one. Four weeks is that window.
 *
 * PURE — no I/O, no dates. The caller keeps the history in week order.
 */

/** ~30 days of training weeks. */
export const LONG_RUN_TRAILING_WEEKS = 4;

/**
 * Growth allowed over the trailing max, as a fraction.
 *
 * 10% is the bottom of the risky band in the cohort above (10–30%), so this
 * keeps every prescribed jump below the range where the signal appears. It is a
 * ceiling on a plan the engine writes, not advice to an athlete deciding what to
 * do today — the engine can afford the cautious end of the range because nothing
 * is lost by getting there a week later.
 */
export const LONG_RUN_MAX_JUMP_PCT = 0.1;

/**
 * The longest run of the trailing window, in total miles. `0` when the window
 * holds nothing — the start of a program, or a stretch with no long run at all.
 *
 * Zeros are skipped rather than counted: a race week carries no long run, and
 * treating that as "the athlete's longest recent run was zero miles" would cap
 * the following week at zero.
 */
export function trailingLongRunMax(
  history: readonly number[],
  weeks: number = LONG_RUN_TRAILING_WEEKS,
): number {
  let max = 0;
  for (const miles of history.slice(-weeks)) {
    if (Number.isFinite(miles) && miles > max) max = miles;
  }
  return max;
}

/**
 * The most this week's long run may be, in TOTAL miles (warm-up and cool-down
 * included — that is the distance the athlete actually covers, and the number
 * `sessionMiles` reports).
 *
 * `null` means "no cap": there is no trailing history to measure against, so
 * there is no jump to protect from. A program's opening long run is set by the
 * week's mileage target like everything else.
 */
export function longRunCapMiles(
  history: readonly number[],
  weeks: number = LONG_RUN_TRAILING_WEEKS,
  jumpPct: number = LONG_RUN_MAX_JUMP_PCT,
): number | null {
  const max = trailingLongRunMax(history, weeks);
  return max > 0 ? max * (1 + jumpPct) : null;
}
