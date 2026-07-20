import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { normalizeHealthKitBatch, type IngestionWorkout } from "@/lib/wearables/apple-health";
import { ingestActivities } from "@/lib/wearables/activity-ingest";

/**
 * POST /api/ingest/healthkit
 *
 * Endpoint the native iOS HealthKit plugin posts to (see
 * `Apple/Part5_healthkit/web/healthkit.service.ts` → `defaultIngest`). Accepts a
 * batch of on-device HealthKit workouts, normalizes them, and runs them through
 * the SAME shared ingestion pipeline (idempotent upsert + cross-source dedupe)
 * that Strava and Oura use. Apple Health has no server tokens, so a lightweight
 * `wearable_connections` row (provider 'apple_health', no secrets) is recorded on
 * first ingest so the connection surfaces in settings.
 */
export const maxDuration = 60;

const WorkoutSchema = z.object({
  source: z.literal("healthkit"),
  externalId: z.string().min(1).max(128),
  activityType: z.string().max(64),
  startTime: z.string().max(40),
  endTime: z.string().max(40),
  durationSeconds: z.number().nonnegative().max(86_400),
  distanceMeters: z.number().nonnegative().max(1_000_000).nullable(),
  activeEnergyKcal: z.number().nonnegative().max(50_000).nullable(),
  avgHeartRate: z.number().min(20).max(240).nullable(),
  maxHeartRate: z.number().min(20).max(240).nullable(),
  originAppName: z.string().max(120),
  originBundleId: z.string().max(200).nullable(),
  deviceName: z.string().max(120).nullable(),
  wasManualEntry: z.boolean(),
});

const BodySchema = z.object({ workouts: z.array(WorkoutSchema).max(500) });

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid workouts payload" }, { status: 400 });
  }

  try {
    // Record a tokenless connection row so Apple Health shows as connected.
    const admin = createAdminClient();
    await admin
      .from("wearable_connections")
      .upsert(
        {
          user_id: user.id,
          provider: "apple_health",
          access_token: "",
          last_sync_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id,provider" },
      );

    const normalized = normalizeHealthKitBatch(parsed.data.workouts as IngestionWorkout[]);
    const result = await ingestActivities(user.id, "apple_health", normalized);
    return NextResponse.json({ imported: result.imported, received: parsed.data.workouts.length });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Ingestion failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
