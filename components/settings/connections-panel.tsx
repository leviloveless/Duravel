"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { WearableConnectionStatus, WearableProvider } from "@/lib/wearables/types";
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
      return "That integration isn't configured on this deployment yet.";
    case "denied":
      return "Connection was cancelled.";
    case "state":
      return "Connection expired or was invalid — please try again.";
    case "exchange":
      return "Couldn't complete the connection — please try again.";
    default:
      return "Something went wrong — please try again.";
  }
}

/** A connected/connectable OAuth wearable card (Strava, Oura). */
function ProviderCard({
  provider,
  name,
  blurb,
  configured,
  status,
  configHint,
  onSync,
  syncing,
  syncMsg,
}: {
  provider: WearableProvider;
  name: string;
  blurb: string;
  configured: boolean;
  status?: WearableConnectionStatus;
  configHint: string;
  onSync: () => void;
  syncing: boolean;
  syncMsg: string | null;
}) {
  const connected = !!status?.connected;
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-zinc-200 p-5">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="font-semibold">{name}</h2>
          <p className="text-xs text-zinc-500">{blurb}</p>
        </div>
        <span
          className={`rounded-full px-2.5 py-1 text-xs font-medium ${
            connected ? "bg-emerald-100 text-emerald-800" : "bg-zinc-100 text-zinc-600"
          }`}
        >
          {connected ? "Connected" : "Not connected"}
        </span>
      </div>

      {!configured ? (
        <p className="text-sm text-zinc-500">{configHint}</p>
      ) : connected ? (
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-xs text-zinc-500">Last sync: {fmtDate(status?.last_sync_at ?? null)}</span>
          <button
            onClick={onSync}
            disabled={syncing}
            className="rounded-full bg-black px-4 py-1.5 text-sm text-white transition-colors hover:bg-zinc-800 disabled:opacity-60"
          >
            {syncing ? "Syncing…" : "Sync now"}
          </button>
          <form action={disconnectProvider}>
            <input type="hidden" name="provider" value={provider} />
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
          href={`/api/wearables/${provider}/connect`}
          className="self-start rounded-full bg-black px-5 py-2 text-sm text-white transition-colors hover:bg-zinc-800"
        >
          Connect {name}
        </a>
      )}
      {syncMsg && <p className="text-xs text-zinc-500">{syncMsg}</p>}
    </div>
  );
}

export default function ConnectionsPanel({
  statuses,
  stravaConfigured,
  ouraConfigured,
  flashConnected,
  flashError,
}: {
  statuses: WearableConnectionStatus[];
  stravaConfigured: boolean;
  ouraConfigured: boolean;
  flashConnected: string | null;
  flashError: string | null;
}) {
  const router = useRouter();
  const [syncingProvider, setSyncingProvider] = useState<WearableProvider | null>(null);
  const [syncMsgs, setSyncMsgs] = useState<Partial<Record<WearableProvider, string>>>({});

  const statusFor = (p: WearableProvider) => statuses.find((s) => s.provider === p);

  async function sync(provider: WearableProvider) {
    setSyncingProvider(provider);
    setSyncMsgs((m) => ({ ...m, [provider]: undefined }));
    try {
      const res = await fetch(`/api/wearables/${provider}/sync`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Sync failed");
      setSyncMsgs((m) => ({ ...m, [provider]: `Imported ${data.imported ?? 0} activities.` }));
      router.refresh();
    } catch (e) {
      setSyncMsgs((m) => ({ ...m, [provider]: e instanceof Error ? e.message : "Sync failed" }));
    } finally {
      setSyncingProvider(null);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {flashConnected && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          Connected {flashConnected}. Hit “Sync now” to pull your recent data.
        </div>
      )}
      {flashError && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {errorLabel(flashError)}
        </div>
      )}

      <ProviderCard
        provider="oura"
        name="Oura"
        blurb="Sleep, HRV, resting HR & readiness → your weekly readiness."
        configured={ouraConfigured}
        status={statusFor("oura")}
        configHint="Not configured yet — add OURA_CLIENT_ID / OURA_CLIENT_SECRET to enable."
        onSync={() => sync("oura")}
        syncing={syncingProvider === "oura"}
        syncMsg={syncMsgs.oura ?? null}
      />

      <ProviderCard
        provider="strava"
        name="Strava"
        blurb="Imports your runs & workouts, with heart rate."
        configured={stravaConfigured}
        status={statusFor("strava")}
        configHint="Not configured yet — add STRAVA_CLIENT_ID / STRAVA_CLIENT_SECRET to enable."
        onSync={() => sync("strava")}
        syncing={syncingProvider === "strava"}
        syncMsg={syncMsgs.strava ?? null}
      />

      {/* Garmin — parked (Developer Program paused to new apps) */}
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
