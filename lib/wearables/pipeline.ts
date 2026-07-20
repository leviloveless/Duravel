import type { NormalizedActivity, WearableProvider } from "./types";

/**
 * Shared ingestion pipeline — PURE helpers (no env, no I/O), unit-testable.
 *
 * This is the "build the foundation once" layer from the multi-source health
 * spec (`docs/future-phases/20-multi-source-health-integrations.md` §1 and the
 * iOS Part-5 `Ingestion_Mapping.md` §3–§5). Every provider (Strava, Oura, Apple
 * Health, and Garmin/WHOOP later) normalizes into `NormalizedActivity` and then
 * flows through the SAME dedupe + canonicalization here. The DB writes live in
 * `activity-ingest.ts`; this file has no imports beyond the shared types so it
 * stays trivially testable.
 */

// --- Activity-type normalization (one canonical slug across all sources) -----
//
// Strava emits "Run"/"Ride"/"VirtualRide"/"WeightTraining"/"Swim"; Oura emits
// "running"/"cycling"; Apple Health already emits our slug ("run"/"strength").
// We collapse them all to one shared enum so dedupe (and any downstream
// analytics) can reason across providers.

export type ActivitySlug =
  | "run"
  | "walk"
  | "hike"
  | "ride"
  | "swim"
  | "row"
  | "ski"
  | "strength"
  | "hiit"
  | "elliptical"
  | "stairs"
  | "core"
  | "cross_training"
  | "cardio"
  | "yoga"
  | "mobility"
  | "other";

/** Map a raw provider activity type to a canonical Duravel slug. */
export function normalizeActivityType(raw: string | null | undefined): ActivitySlug {
  const t = (raw ?? "").toLowerCase();
  if (!t) return "other";
  // Order matters: check the most specific substrings first.
  if (t.includes("trail") && t.includes("run")) return "run";
  if (t.includes("run")) return "run";
  if (t.includes("walk")) return "walk";
  if (t.includes("hik")) return "hike";
  if (t.includes("virtualride") || t.includes("ride") || t.includes("cycl") || t.includes("bik"))
    return "ride";
  if (t.includes("swim")) return "swim";
  if (t.includes("row")) return "row";
  if (t.includes("ski") || t.includes("erg")) return "ski";
  if (t.includes("hiit") || t.includes("highintensity") || t.includes("interval")) return "hiit";
  if (t.includes("elliptical")) return "elliptical";
  if (t.includes("stair")) return "stairs";
  if (t.includes("core")) return "core";
  if (t.includes("crosstrain") || t.includes("cross_training") || t.includes("crossfit"))
    return "cross_training";
  if (t.includes("yoga")) return "yoga";
  if (t.includes("flex") || t.includes("mobility") || t.includes("stretch")) return "mobility";
  if (t.includes("weight") || t.includes("strength") || t.includes("lift")) return "strength";
  if (t.includes("cardio") || t.includes("workout") || t.includes("mixed")) return "cardio";
  return "other";
}

/**
 * Coarse family for cross-source dedupe (Ingestion_Mapping §4 rule 4). A run and
 * a ride at the same time are NOT the same session even if the duration matches.
 * Foot-cardio (run/walk/hike) collapse to one family; strength/core/mobility to
 * one; everything else matches on its exact slug.
 */
export function dedupeFamily(slug: ActivitySlug): string {
  if (slug === "run" || slug === "walk" || slug === "hike") return "foot";
  if (slug === "strength" || slug === "core" || slug === "mobility") return "strength";
  return slug;
}

// --- Cross-source dedupe (Ingestion_Mapping §4 / spec §1.4) ------------------

/** Tunable tolerances — kept in one block so they're easy to adjust. */
export const DEDUPE = {
  startTimeToleranceSec: 90,
  durationTolerancePct: 0.03,
  durationToleranceMinSec: 20,
  distanceTolerancePct: 0.02,
  distanceToleranceMinMeters: 50,
} as const;

/**
 * Source priority — which record "wins" as canonical on merge (§5). Direct
 * integrations carry richer streams than a summary; a native Apple Watch HK
 * workout is high quality for HR; Oura workouts are sparse (no HR); manual
 * entries are least trusted. Higher = more authoritative.
 */
export const PROVIDER_PRIORITY: Record<WearableProvider, number> = {
  garmin: 6,
  strava: 5,
  whoop: 4,
  apple_health: 3,
  oura: 2,
};

/** The minimal shape the dedupe needs from an activity (stored or incoming). */
export interface DedupeActivity {
  /** Stable id for this row within its provider (`external_id`), used for tie-breaks. */
  externalId: string;
  provider: WearableProvider;
  /** Canonical slug (from normalizeActivityType). */
  slug: ActivitySlug;
  startTime: string | null; // ISO 8601
  durationS: number | null;
  distanceM: number | null;
  /** Apple Health manual entries are demoted below watch-recorded ones. */
  manualEntry?: boolean;
}

/** Two activities are "the same real-world session" (§4 Layer B). */
export function sameSession(a: DedupeActivity, b: DedupeActivity): boolean {
  // Cross-SOURCE only: the same provider never legitimately reports two rows for
  // one session (exact re-syncs are handled by the (user,provider,external_id)
  // unique key). Fuzzy-merging within a provider would wrongly collapse
  // back-to-back sessions.
  if (a.provider === b.provider) return false;

  if (!a.startTime || !b.startTime) return false;
  const at = Date.parse(a.startTime);
  const bt = Date.parse(b.startTime);
  if (!Number.isFinite(at) || !Number.isFinite(bt)) return false;

  // 1. Start time within tolerance.
  if (Math.abs(at - bt) > DEDUPE.startTimeToleranceSec * 1000) return false;

  // 2. Duration within tolerance (when both known).
  if (typeof a.durationS === "number" && typeof b.durationS === "number") {
    const larger = Math.max(a.durationS, b.durationS);
    const tol = Math.max(DEDUPE.durationToleranceMinSec, larger * DEDUPE.durationTolerancePct);
    if (Math.abs(a.durationS - b.durationS) > tol) return false;
  }

  // 3. Distance within tolerance — ONLY when BOTH have a positive distance
  //    (strength etc. has null distance; fall back to 1+2+family).
  if (
    typeof a.distanceM === "number" &&
    a.distanceM > 0 &&
    typeof b.distanceM === "number" &&
    b.distanceM > 0
  ) {
    const larger = Math.max(a.distanceM, b.distanceM);
    const tol = Math.max(DEDUPE.distanceToleranceMinMeters, larger * DEDUPE.distanceTolerancePct);
    if (Math.abs(a.distanceM - b.distanceM) > tol) return false;
  }

  // 4. Activity family compatible.
  return dedupeFamily(a.slug) === dedupeFamily(b.slug);
}

/** Effective priority, demoting manual entries by one full tier. */
function priorityOf(a: DedupeActivity): number {
  const base = PROVIDER_PRIORITY[a.provider] ?? 0;
  return a.manualEntry ? base - 3.5 : base;
}

/** A stable per-activity key. */
function keyOf(a: DedupeActivity): string {
  return `${a.provider}:${a.externalId}`;
}

export interface DedupeResult<T extends DedupeActivity> {
  activity: T;
  /** Cluster id (shared by every source of one real-world session). */
  group: string;
  /** Exactly one activity per group is the canonical/primary record. */
  isPrimary: boolean;
}

/**
 * Cluster activities that are the same real-world session across sources and pick
 * one canonical per cluster by source priority. Deterministic and symmetric —
 * runs over the full set each ingest, so it doesn't matter which source landed
 * first. O(n²) worst case, but n is a single user's activities in a short window.
 *
 * `group` is the smallest member key in the cluster (stable). `isPrimary` is the
 * highest-priority member, tie-broken by key so it never flickers between syncs.
 */
export function dedupeActivities<T extends DedupeActivity>(activities: T[]): DedupeResult<T>[] {
  const n = activities.length;
  const parent = activities.map((_, i) => i);
  const find = (i: number): number => {
    let r = i;
    // parent is densely populated for every index 0..n-1, so the reads are safe;
    // the `!` satisfies noUncheckedIndexedAccess.
    while (parent[r]! !== r) r = parent[r]!;
    let cur = i;
    while (parent[cur]! !== r) {
      const next = parent[cur]!;
      parent[cur] = r;
      cur = next;
    }
    return r;
  };
  const union = (i: number, j: number) => {
    const ri = find(i);
    const rj = find(j);
    if (ri !== rj) parent[ri] = rj;
  };

  // Sort indices by start time so we only compare against a moving window.
  const order = activities
    .map((a, i) => ({ i, t: a.startTime ? Date.parse(a.startTime) : NaN }))
    .sort((x, y) => (Number.isNaN(x.t) ? 1 : Number.isNaN(y.t) ? -1 : x.t - y.t));

  const windowMs = DEDUPE.startTimeToleranceSec * 1000;
  for (let x = 0; x < order.length; x++) {
    const { i, t } = order[x]!;
    if (Number.isNaN(t)) continue;
    for (let y = x + 1; y < order.length; y++) {
      const { i: j, t: t2 } = order[y]!;
      if (Number.isNaN(t2)) continue;
      if (t2 - t > windowMs) break; // outside the start-time window → done for i
      if (sameSession(activities[i]!, activities[j]!)) union(i, j);
    }
  }

  // Collect clusters.
  const clusters = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    const r = find(i);
    const list = clusters.get(r) ?? [];
    list.push(i);
    clusters.set(r, list);
  }

  const out: DedupeResult<T>[] = new Array(n);
  for (const members of clusters.values()) {
    const groupId = members
      .map((i) => keyOf(activities[i]!))
      .sort()
      .at(0)!;
    // Primary = highest priority, tie-broken by key (stable).
    let primaryIdx = members[0]!;
    for (const i of members) {
      const a = activities[i]!;
      const p = priorityOf(a);
      const bp = priorityOf(activities[primaryIdx]!);
      if (p > bp || (p === bp && keyOf(a) < keyOf(activities[primaryIdx]!))) primaryIdx = i;
    }
    for (const i of members) {
      out[i] = { activity: activities[i]!, group: groupId, isPrimary: i === primaryIdx };
    }
  }
  return out;
}

// --- Canonical row mapping ---------------------------------------------------

/**
 * Map a normalized activity to a `wearable_activities` row, now carrying the
 * canonical `activity_type` slug alongside the raw provider `type`. The dedupe
 * columns (`dedupe_group`, `is_primary`) are stamped by the ingest writer after
 * clustering, not here.
 */
export function activityToCanonicalRow(
  userId: string,
  provider: WearableProvider,
  a: NormalizedActivity,
) {
  return {
    user_id: userId,
    provider,
    external_id: a.externalId,
    type: a.type,
    activity_type: normalizeActivityType(a.type),
    start_time: a.startTime,
    duration_s: a.durationS,
    distance_m: a.distanceM,
    avg_hr: a.avgHr,
    max_hr: a.maxHr,
    raw: a.raw,
  };
}
