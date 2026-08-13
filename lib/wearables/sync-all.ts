import { getConnectionStatuses } from "./connections";
import { syncStrava } from "./strava-sync";
import { syncOura } from "./oura-sync";
import type { WearableProvider } from "./types";

/**
 * "Sync all connected sources" — one call that pulls from every API source the
 * athlete has connected, instead of making them visit each provider's own
 * "Sync now" button.
 *
 * Two kinds of source live in `wearable_connections`:
 *
 *  - PULL sources (Strava, Oura) expose a server-side sync we can invoke on
 *    demand. Those are listed in `PULL_SYNCS` below; adding WHOOP or Garmin
 *    later is one entry, and both this function and its UI pick it up free.
 *  - PUSH sources (Apple Health) have no server-callable pull at all — the
 *    phone POSTs to `/api/ingest/healthkit` on its own schedule. We report them
 *    rather than skipping them silently, so a connected source is never
 *    mysteriously absent from the result (Levi, 2026-08-12).
 *
 * One provider failing must not take the others down: an expired Oura refresh
 * token should still let Strava import. Every provider is settled independently
 * and its error is reported per-provider.
 *
 * I/O is injected because this repo mocks nothing (`vi.mock` appears nowhere) —
 * a parameter is the only honest seam for a test.
 */

/** Providers we can actively pull from, in the order they're reported. */
export const PULL_SYNCS: Record<string, (userId: string) => Promise<{ imported: number }>> = {
  strava: syncStrava,
  oura: syncOura,
};

/** Connected providers that can only push to us; never pulled, always reported. */
export const PUSH_ONLY_PROVIDERS: WearableProvider[] = ["apple_health"];

export const PROVIDER_LABEL: Record<WearableProvider, string> = {
  strava: "Strava",
  garmin: "Garmin",
  oura: "Oura",
  whoop: "WHOOP",
  apple_health: "Apple Health",
};

export type ProviderSyncResult = {
  provider: WearableProvider;
  label: string;
  /** "pull" ran a sync; "push" is connected but syncs from the device itself. */
  mode: "pull" | "push";
  ok: boolean;
  imported: number;
  error: string | null;
};

export type SyncAllResult = {
  /** Per-provider outcome, pull sources first, then push-only ones. */
  results: ProviderSyncResult[];
  /** Total activities imported across every pull source. */
  imported: number;
  /** True when no source at all is connected. */
  noConnections: boolean;
};

export type SyncAllIo = {
  /** Non-secret connection statuses for the user. */
  statuses: (userId: string) => Promise<{ provider: WearableProvider; connected: boolean }[]>;
  /** Pull-capable providers → their sync function. */
  pullSyncs: Record<string, (userId: string) => Promise<{ imported: number }>>;
  /** Connected-but-push-only providers. */
  pushOnly: WearableProvider[];
};

const defaultIo: SyncAllIo = {
  statuses: getConnectionStatuses,
  pullSyncs: PULL_SYNCS,
  pushOnly: PUSH_ONLY_PROVIDERS,
};

/**
 * Pull from every connected API source. Never throws for a provider-level
 * failure — the caller gets one row per connected provider, some of which may
 * carry `ok: false`.
 */
export async function syncAllConnected(
  userId: string,
  io: SyncAllIo = defaultIo,
): Promise<SyncAllResult> {
  const statuses = await io.statuses(userId);
  const connected = new Set(statuses.filter((s) => s.connected).map((s) => s.provider));

  const pullable = Object.keys(io.pullSyncs).filter((p) =>
    connected.has(p as WearableProvider),
  ) as WearableProvider[];
  const pushable = io.pushOnly.filter((p) => connected.has(p));

  // Providers run concurrently — two independent HTTP round-trips shouldn't be
  // serialized behind each other on a 60s function budget.
  const settled = await Promise.all(
    pullable.map(async (provider): Promise<ProviderSyncResult> => {
      const label = PROVIDER_LABEL[provider] ?? provider;
      try {
        const run = io.pullSyncs[provider]!;
        const { imported } = await run(userId);
        return { provider, label, mode: "pull", ok: true, imported, error: null };
      } catch (e) {
        return {
          provider,
          label,
          mode: "pull",
          ok: false,
          imported: 0,
          error: e instanceof Error ? e.message : "Sync failed",
        };
      }
    }),
  );

  const pushRows: ProviderSyncResult[] = pushable.map((provider) => ({
    provider,
    label: PROVIDER_LABEL[provider] ?? provider,
    mode: "push",
    ok: true,
    imported: 0,
    error: null,
  }));

  const results = [...settled, ...pushRows];
  return {
    results,
    imported: settled.reduce((n, r) => n + r.imported, 0),
    noConnections: results.length === 0,
  };
}

/**
 * One line of plain English for the button's status text. Kept here (not in the
 * component) so it is unit-testable and identical wherever it's shown.
 */
export function summarizeSyncAll(result: SyncAllResult): string {
  if (result.noConnections) {
    return "No sources connected — connect Strava or Oura in Settings.";
  }

  const pulled = result.results.filter((r) => r.mode === "pull");
  const failed = pulled.filter((r) => !r.ok);
  const succeeded = pulled.filter((r) => r.ok);
  const parts: string[] = [];

  if (succeeded.length > 0) {
    const detail = succeeded.map((r) => `${r.label} ${r.imported}`).join(", ");
    parts.push(
      result.imported === 1
        ? `Imported 1 workout (${detail})`
        : `Imported ${result.imported} workouts (${detail})`,
    );
  }
  if (failed.length > 0) {
    parts.push(failed.map((r) => `${r.label} failed: ${r.error ?? "Sync failed"}`).join("; "));
  }
  if (succeeded.length === 0 && failed.length === 0) {
    // Only push-only sources are connected.
    parts.push("Nothing to pull");
  }

  const push = result.results.filter((r) => r.mode === "push");
  if (push.length > 0) {
    parts.push(`${push.map((r) => r.label).join(" & ")} syncs from your phone`);
  }

  return `${parts.join(" · ")}.`;
}
