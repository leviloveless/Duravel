"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { WearableConnectionStatus } from "@/lib/wearables/types";
import { disconnectProvider } from "@/app/settings/connections/actions";

function fmtDate(iso: string | null): string {
  if (!iso) return "never";
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function errorLabel(code: string): string {
  switch (code) {
    case "not_configured":
      return "Strava isn't configured on this deployment yet.";
    case "denied":
      return "Connection was cancelled.";
    case "state":
      return "Connection expired or was invalid — please try again.";
    case "exchange":
      return "Couldn't complete the connection with Strava — please try again.";
    default:
      return "Something went wrong — please try again.";
  }
}

export default function ConnectionsPanel({
  statuses,
  stravaConfigured,
  flashConnected,
  flashError,
}: {
  statuses: WearableConnectionStatus[];
  stravaConfigured: boolean;
  flashConnected: string | null;
  flashError: string | null;
}) {
  const router = useRouter();
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);

  const strava = statuses.find((s) => s.provider === "strava");

  async function syncStrava() {
    setSyncing(true);
    setSyncMsg(null);
    try {
      const res = await fetch("/api/wearables/strava/sync", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Sync failed");
      setSyncMsg(`Imported ${data.imported ?? 0} activities.`);
      router.refresh();
    } catch (e) {
      setSyncMsg(e instanceof Error ? e.message : "Sync failed");
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {flashConnected && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          Connected {flashConnected}. Hit “Sync now” to pull your recent activity.
        </div>
      )}
      {flashError && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {errorLabel(flashError)}
        </div>
      )}

      {/* Strava */}
      <div className="flex flex-col gap-3 rounded-xl border border-zinc-200 p-5">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="font-semibold">Strava</h2>
            <p className="text-xs text-zinc-500">Imports your runs &amp; workouts, with heart rate.</p>
          </div>
          <span
            className={`rounded-full px-2.5 py-1 text-xs font-medium ${
              strava?.connected ? "bg-emerald-100 text-emerald-800" : "bg-zinc-100 text-zinc-600"
            }`}
          >
            {strava?.connected ? "Connected" : "Not connected"}
          </span>
        </div>

        {!stravaConfigured ? (
          <p className="text-sm text-zinc-500">
            Not configured yet — add <code className="text-xs">STRAVA_CLIENT_ID</code> /{" "}
            <code className="text-xs">STRAVA_CLIENT_SECRET</code> to enable.
          </p>
        ) : strava?.connected ? (
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-xs text-zinc-500">Last sync: {fmtDate(strava.last_sync_at)}</span>
            <button
              onClick={syncStrava}
              disabled={syncing}
              className="rounded-full bg-black px-4 py-1.5 text-sm text-white transition-colors hover:bg-zinc-800 disabled:opacity-60"
            >
              {syncing ? "Syncing…" : "Sync now"}
            </button>
            <form action={disconnectProvider}>
              <input type="hidden" name="provider" value="strava" />
              <button
                type="submit"
                className="rounded-full border border-zinc-300 px-4 py-1.5 text-sm text-zinc-700 transition-colors hover:bg-zinc-100"
              >
                Disconnect
              </button>
            </form>
          </div>
        ) : (
          <a
            href="/api/wearables/strava/connect"
            className="self-start rounded-full bg-black px-5 py-2 text-sm text-white transition-colors hover:bg-zinc-800"
          >
            Connect Strava
          </a>
        )}
        {syncMsg && <p className="text-xs text-zinc-500">{syncMsg}</p>}
      </div>

      {/* Garmin — pending approval */}
      <div className="flex flex-col gap-1 rounded-xl border border-zinc-200 p-5 opacity-70">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="font-semibold">Garmin</h2>
            <p className="text-xs text-zinc-500">Resting HR, HRV &amp; sleep → readiness.</p>
          </div>
          <span className="rounded-full bg-zinc-100 px-2.5 py-1 text-xs font-medium text-zinc-600">
            Coming soon
          </span>
        </div>
        <p className="mt-1 text-sm text-zinc-500">Pending Garmin Health API approval.</p>
      </div>
    </div>
  );
}
