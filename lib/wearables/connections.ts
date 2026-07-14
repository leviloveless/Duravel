import { createAdminClient } from "@/lib/supabase/admin";
import {
  WEARABLE_PROVIDERS,
  type WearableConnection,
  type WearableConnectionStatus,
  type WearableProvider,
} from "./types";

/**
 * Server-only access to `wearable_connections`. That table has NO authenticated
 * RLS policies (it holds OAuth tokens), so every read/write goes through the
 * service-role admin client here, always scoped by user_id. Never import this
 * into a Client Component.
 */

/** Full connection incl. tokens for a provider, or null. SERVER ONLY. */
export async function getConnection(
  userId: string,
  provider: WearableProvider,
): Promise<WearableConnection | null> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("wearable_connections")
    .select("*")
    .eq("user_id", userId)
    .eq("provider", provider)
    .maybeSingle();
  return (data as WearableConnection | null) ?? null;
}

/** Non-secret connection statuses for every provider (safe for UI rendering). */
export async function getConnectionStatuses(userId: string): Promise<WearableConnectionStatus[]> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("wearable_connections")
    .select("provider, last_sync_at, created_at")
    .eq("user_id", userId);
  const rows =
    (data as { provider: WearableProvider; last_sync_at: string | null; created_at: string | null }[] | null) ??
    [];
  return WEARABLE_PROVIDERS.map((provider) => {
    const row = rows.find((r) => r.provider === provider);
    return {
      provider,
      connected: !!row,
      last_sync_at: row?.last_sync_at ?? null,
      created_at: row?.created_at ?? null,
    };
  });
}

export async function upsertConnection(row: {
  userId: string;
  provider: WearableProvider;
  accessToken: string;
  refreshToken?: string | null;
  expiresAt?: string | null;
  scope?: string | null;
  providerAthleteId?: string | null;
}): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin.from("wearable_connections").upsert(
    {
      user_id: row.userId,
      provider: row.provider,
      access_token: row.accessToken,
      refresh_token: row.refreshToken ?? null,
      expires_at: row.expiresAt ?? null,
      scope: row.scope ?? null,
      provider_athlete_id: row.providerAthleteId ?? null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id,provider" },
  );
  if (error) throw new Error(`Failed to save wearable connection: ${error.message}`);
}

export async function deleteConnection(userId: string, provider: WearableProvider): Promise<void> {
  const admin = createAdminClient();
  await admin.from("wearable_connections").delete().eq("user_id", userId).eq("provider", provider);
}

export async function setLastSync(
  userId: string,
  provider: WearableProvider,
  whenIso: string,
): Promise<void> {
  const admin = createAdminClient();
  await admin
    .from("wearable_connections")
    .update({ last_sync_at: whenIso, updated_at: new Date().toISOString() })
    .eq("user_id", userId)
    .eq("provider", provider);
}
