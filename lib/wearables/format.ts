/** Wearable activity display helpers — PURE (no env/IO), unit-testable. */

const METERS_PER_MILE = 1609.344;

/** Duration in seconds → "45 min" / "1h 12m" / "2h". */
export function formatDurationS(s: number | null): string {
  if (s == null || !Number.isFinite(s) || s <= 0) return "—";
  const totalMin = Math.round(s / 60);
  if (totalMin < 60) return `${totalMin} min`;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

export function metersToMiles(m: number | null): number | null {
  if (m == null || !Number.isFinite(m)) return null;
  return m / METERS_PER_MILE;
}

/** Distance in meters → "3.11 mi" (— below ~80m / non-distance activities). */
export function formatDistanceMiles(m: number | null): string {
  const mi = metersToMiles(m);
  if (mi == null || mi < 0.05) return "—";
  return `${mi.toFixed(2)} mi`;
}

/** Strava sport types are CamelCase ("TrailRun") → "Trail Run". */
export function formatActivityType(t: string | null): string {
  if (!t) return "Activity";
  return t.replace(/([a-z0-9])([A-Z])/g, "$1 $2");
}
