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
