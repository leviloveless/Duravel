/**
 * "Did DURAVEL write this activity?" — recognising our own posts on arrival.
 *
 * The primary mechanism is `markSelfPosted`: the auto-post claims an activity the
 * moment it creates it, before any sync can import it. That covers everything
 * posted from patch 23 onward.
 *
 * This is the SECOND line, and it exists because of a real gap found live on
 * 2026-08-06. Migration 0040 backfilled `self_posted` for auto-posts that already
 * existed — but a backfill is a ONE-TIME `UPDATE`. Two activities Duravel had
 * posted that morning were only imported into `wearable_activities` AFTER 0040
 * ran, so nothing ever flagged them, and the program page went straight back to:
 *
 *     Synced workouts ready to link (4)
 *       Run · Thu, Aug 6 · 2.55 mi · 30 min
 *       Matches your Zone 1–2 cardio on Thursday · Week 1.   [Confirm match]
 *
 * — the exact plan-as-its-own-evidence loop 0040 was written to close. Re-running
 * the backfill clears today's rows; applying the same test at INGEST is what
 * stops it recurring for any pre-patch-23 post imported later.
 *
 * The rule mirrors the 0040 SQL exactly, and is deliberately narrow:
 *
 *   * `manual` is true — Duravel always creates activities via Strava's manual
 *     endpoint; a watch-recorded activity is never manual.
 *   * the NAME matches one of Duravel's own two title formats.
 *
 * Both must hold. An athlete's own manual Strava entry stays linkable unless they
 * happen to have titled it `Week 3 - …`, which is the same small risk 0040 took
 * knowingly.
 */

/** `Week 1 - Thursday - Threshold Run` — current, since `fd4b58b`. */
const CURRENT_TITLE = /^Week \d+ - /;
/** `Duravel Run — Week 1` — the format it replaced. Note the em dash. */
const LEGACY_TITLE = /^Duravel /;

/**
 * PURE. Given a provider and the raw payload the sync stored, decide whether this
 * activity is one Duravel posted.
 *
 * Strava only: no other provider has an endpoint we post to, and applying a
 * name-shaped heuristic to Oura or Apple Health could only ever produce false
 * positives.
 */
export function looksSelfPosted(provider: string, raw: unknown): boolean {
  if (provider !== "strava") return false;
  if (!raw || typeof raw !== "object") return false;
  const a = raw as { manual?: unknown; name?: unknown };
  if (a.manual !== true) return false;
  const name = typeof a.name === "string" ? a.name : "";
  return CURRENT_TITLE.test(name) || LEGACY_TITLE.test(name);
}
