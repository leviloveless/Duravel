import { createAdminClient } from "@/lib/supabase/admin";
import type { NormalizedActivity, WearableProvider } from "./types";
import {
  activityToCanonicalRow,
  dedupeActivities,
  normalizeActivityType,
  type DedupeActivity,
} from "./pipeline";

/**
 * Shared activity ingest (service role) — the ONE place activities from any
 * provider land in `wearable_activities`, so cross-source dedupe is applied
 * uniformly (spec §1.4; Ingestion_Mapping §4/§5). Strava, Oura, and Apple Health
 * all call this instead of upserting the table themselves.
 *
 * Flow:
 *  1. Idempotent upsert of THIS provider's rows (Layer A: unique
 *     (user,provider,external_id)).
 *  2. Re-cluster the user's activities in the affected time window and stamp
 *     `dedupe_group` + `is_primary` (Layer B: cross-source fuzzy merge). Running
 *     it over the window each ingest keeps it symmetric regardless of which
 *     source arrived first.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

type StoredRow = {
  id: string;
  provider: WearableProvider;
  external_id: string;
  type: string | null;
  activity_type: string | null;
  start_time: string | null;
  duration_s: number | null;
  distance_m: number | null;
  raw: unknown;
  dedupe_group: string | null;
  is_primary: boolean | null;
};

export async function ingestActivities(
  userId: string,
  provider: WearableProvider,
  activities: NormalizedActivity[],
): Promise<{ imported: number }> {
  const withId = activities.filter((a) => a.externalId.length > 0);
  if (withId.length === 0) return { imported: 0 };

  const admin = createAdminClient();

  // 1. Idempotent upsert of this provider's rows.
  const rows = withId.map((a) => activityToCanonicalRow(userId, provider, a));
  const { error: upsertErr } = await admin
    .from("wearable_activities")
    .upsert(rows, { onConflict: "user_id,provider,external_id" });
  if (upsertErr) throw new Error(`Failed to store activities: ${upsertErr.message}`);

  // 2. Re-cluster the affected window. Bound the read to a few days around the
  //    incoming activities so we never scan the user's whole history.
  const times = withId
    .map((a) => (a.startTime ? Date.parse(a.startTime) : NaN))
    .filter((t) => Number.isFinite(t));
  if (times.length > 0) {
    const lo = new Date(Math.min(...times) - 2 * DAY_MS).toISOString();
    const hi = new Date(Math.max(...times) + 2 * DAY_MS).toISOString();

    const { data } = await admin
      .from("wearable_activities")
      .select(
        "id, provider, external_id, type, activity_type, start_time, duration_s, distance_m, dedupe_group, is_primary, raw",
      )
      .eq("user_id", userId)
      .gte("start_time", lo)
      .lte("start_time", hi);

    const stored = (data as StoredRow[] | null) ?? [];
    if (stored.length > 0) {
      const dedupeInput: (DedupeActivity & { row: StoredRow })[] = stored.map((r) => ({
        externalId: r.external_id,
        provider: r.provider,
        slug: (r.activity_type as ReturnType<typeof normalizeActivityType>) ??
          normalizeActivityType(r.type),
        startTime: r.start_time,
        durationS: r.duration_s,
        distanceM: r.distance_m,
        manualEntry: isManual(r.raw),
        row: r,
      }));

      const clustered = dedupeActivities(dedupeInput);
      // Persist only rows whose group/primary changed (avoid needless writes).
      for (const c of clustered) {
        const r = c.activity.row;
        if (r.dedupe_group === c.group && r.is_primary === c.isPrimary) continue;
        await admin
          .from("wearable_activities")
          .update({ dedupe_group: c.group, is_primary: c.isPrimary })
          .eq("id", r.id);
      }
    }
  }

  return { imported: withId.length };
}

/** Apple Health flags manual entries in `raw.wasManualEntry`; others don't. */
function isManual(raw: unknown): boolean {
  return !!(raw && typeof raw === "object" && (raw as { wasManualEntry?: boolean }).wasManualEntry);
}
