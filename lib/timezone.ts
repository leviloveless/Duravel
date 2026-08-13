/**
 * IANA time-zone helpers (Levi, 2026-08-06).
 *
 * PURE — no `Date.now()`, no network, no DB. `profiles.timezone` (migration 0039)
 * is the stored value; everything here treats a missing or unusable zone as UTC,
 * which is exactly the behaviour that shipped before the column existed.
 */

export const UTC = "UTC";

/**
 * Is this a time zone the runtime actually knows?
 *
 * A stored zone can be stale (`Europe/Kiev`), mistyped, or from a browser this
 * Node build doesn't share an ICU database with. `Intl` throws a RangeError on an
 * unknown zone, and that must never take down a workout log or a program build —
 * so every caller goes through here first.
 */
export function isValidTimeZone(tz: string | null | undefined): tz is string {
  if (!tz || typeof tz !== "string") return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** The stored zone if usable, else UTC. */
export function resolveTimeZone(tz: string | null | undefined): string {
  return isValidTimeZone(tz) ? tz : UTC;
}

/**
 * The WALL CLOCK in `tz` at instant `date`, as `YYYY-MM-DDTHH:mm:ssZ`.
 *
 * The trailing `Z` is deliberate and is NOT a claim that this is UTC. Strava's
 * `start_date_local` is a local wall-clock time carrying a `Z` suffix — that is
 * the shape Strava itself returns — so this matches the field it feeds. The bug
 * it replaces sent `new Date().toISOString()`, i.e. the right SHAPE with UTC
 * NUMBERS, which is why an 8:12am CDT workout appeared on Strava at 1:12 PM.
 *
 * Uses `formatToParts` rather than arithmetic on `getTimezoneOffset` so DST is
 * the platform's problem, not ours.
 */
export function localWallClockIso(date: Date, tz: string | null | undefined): string {
  const zone = resolveTimeZone(tz);
  if (Number.isNaN(date.getTime())) return new Date(0).toISOString();
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(date);

  const get = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((p) => p.type === type)?.value ?? "00";

  // `hour12: false` yields "24" for midnight in some ICU versions; normalize.
  const hour = get("hour") === "24" ? "00" : get("hour");
  return `${get("year")}-${get("month")}-${get("day")}T${hour}:${get("minute")}:${get("second")}Z`;
}

/**
 * Render an INSTANT for display, identically on the server and in the browser.
 *
 * ## Why this exists
 *
 * `new Date(iso).toLocaleString(undefined, { … hour, minute })` is a hydration
 * bug. Both arguments are ambient: `undefined` picks the runtime's locale, and
 * the absent `timeZone` picks the runtime's zone. The server renders in UTC and
 * the browser in the athlete's zone, so the two produce different TEXT and React
 * bails out of hydrating that subtree — **`Minified React error #418`**, which
 * the program page threw on every single load until 2026-08-13.
 *
 * That is not a cosmetic warning. A hydration bailout makes React discard and
 * re-render the subtree client-side, and on 2026-08-06 that is what made the
 * link-suggestions banner appear to vanish and sent a whole session hunting a
 * regression that did not exist.
 *
 * Both knobs are therefore pinned: a fixed `en-US` locale (matching the rest of
 * this module) and an EXPLICIT time zone. Same input, same string, everywhere.
 *
 * ## Note on calendar dates
 *
 * This is for instants — a `last_sync_at`, a `created_at`. It is NOT needed for
 * calendar labels built from a `YYYY-MM-DD` string: `components/program/format.ts`
 * parses those with `new Date(y, m-1, d)`, i.e. LOCAL midnight, so both runtimes
 * already name the same calendar day. Don't "fix" those by routing them here —
 * that would shift them by a zone offset and introduce the bug this prevents.
 */
export function formatInstant(
  iso: string | null | undefined,
  tz: string | null | undefined,
  opts: Intl.DateTimeFormatOptions = {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  },
  fallback = "never",
): string {
  if (!iso) return fallback;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return fallback;
  return new Intl.DateTimeFormat("en-US", { ...opts, timeZone: resolveTimeZone(tz) }).format(d);
}
