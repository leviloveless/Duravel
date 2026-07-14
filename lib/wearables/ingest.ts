import type { NormalizedActivity, WearableProvider } from "./types";

/**
 * Ingestion — PURE mapping/heuristic helpers (no env, no I/O), unit-testable.
 * The DB writes live in the sync modules.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Epoch-seconds cutoff to pass to Strava's `after` param. From the last sync we
 * back up one day of overlap (to catch edited/late-uploaded activities); with no
 * prior sync we look back `fallbackDays`.
 */
export function afterEpochFromLastSync(
  lastSyncIso: string | null,
  fallbackDays = 30,
  now: number = Date.now(),
): number {
  if (lastSyncIso) {
    const ms = new Date(lastSyncIso).getTime();
    if (Number.isFinite(ms)) return Math.floor((ms - DAY_MS) / 1000);
  }
  return Math.floor((now - fallbackDays * DAY_MS) / 1000);
}

/** Map a normalized activity to a `wearable_activities` row. */
export function activityToRow(userId: string, provider: WearableProvider, a: NormalizedActivity) {
  return {
    user_id: userId,
    provider,
    external_id: a.externalId,
    type: a.type,
    start_time: a.startTime,
    duration_s: a.durationS,
    distance_m: a.distanceM,
    avg_hr: a.avgHr,
    max_hr: a.maxHr,
    raw: a.raw,
  };
}

/** Ids in `incoming` that aren't already present (belt-and-suspenders to the DB unique). */
export function newActivityIds(existingIds: Iterable<string>, incoming: NormalizedActivity[]): string[] {
  const seen = new Set(existingIds);
  return incoming.map((a) => a.externalId).filter((id) => id.length > 0 && !seen.has(id));
}

export type DailyRow = { date: string; resting_hr: number | null; hrv: number | null };

/**
 * Pick the most recent daily row that carries a resting-HR or HRV value, to
 * prefill a readiness check-in. Returns null when there's nothing usable.
 */
export function readinessFromDaily(
  rows: DailyRow[],
): { date: string; restingHr: number | null; hrv: number | null } | null {
  const usable = rows
    .filter((r) => r.resting_hr != null || r.hrv != null)
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  const top = usable[0];
  if (!top) return null;
  return { date: top.date, restingHr: top.resting_hr, hrv: top.hrv };
}

// --- Activity → planned-session matching (SCAFFOLD; not wired to auto-write) ---
//
// Matching a raw wearable activity to a specific PLANNED session slot is fuzzy
// (date + type + duration). This heuristic is intentionally NOT auto-writing to
// workout_logs — Levi should review/tune it and decide the auto-log policy. It's
// pure + tested so it's ready to wire behind a review flag.

export type PlannedSessionRef = {
  weekNumber: number;
  day: string; // mon..sun
  sessionIndex: number;
  kind: string; // engine session kind, e.g. "run_easy" | "hybrid" | "lift_full"
  dateIso: string; // calendar date this session falls on (YYYY-MM-DD)
};

type Family = "run" | "bike" | "row_ski" | "strength" | "hybrid" | "other";

/** Map a raw activity `type` to a coarse family. */
export function activityFamily(type: string | null): Family {
  const t = (type ?? "").toLowerCase();
  if (t.includes("run")) return "run";
  if (t.includes("ride") || t.includes("bike") || t.includes("cycl")) return "bike";
  if (t.includes("row") || t.includes("ski") || t.includes("erg")) return "row_ski";
  if (t.includes("weight") || t.includes("strength") || t.includes("lift")) return "strength";
  if (t.includes("hyrox") || t.includes("workout") || t.includes("crossfit")) return "hybrid";
  return "other";
}

/** Map an engine session `kind` to the families that activity could satisfy. */
function familiesForKind(kind: string): Family[] {
  const k = kind.toLowerCase();
  if (k.startsWith("run")) return ["run"];
  if (k.startsWith("lift") || k.includes("strength")) return ["strength"];
  if (k.includes("hybrid") || k.includes("station") || k.includes("sim")) return ["hybrid", "row_ski", "run"];
  return ["other"];
}

/**
 * Best-effort match of an activity to one planned session on the SAME calendar
 * date whose kind is compatible with the activity's family. Returns null if none.
 * Heuristic only — review before trusting for auto-logging.
 */
export function matchActivityToSession(
  activity: { type: string | null; startTime: string | null },
  sessions: PlannedSessionRef[],
): PlannedSessionRef | null {
  if (!activity.startTime) return null;
  const date = activity.startTime.slice(0, 10); // YYYY-MM-DD
  const fam = activityFamily(activity.type);
  const sameDay = sessions.filter((s) => s.dateIso.slice(0, 10) === date);
  const compatible = sameDay.filter((s) => familiesForKind(s.kind).includes(fam));
  const pool = compatible.length > 0 ? compatible : sameDay.length === 1 ? sameDay : [];
  return pool[0] ?? null;
}
