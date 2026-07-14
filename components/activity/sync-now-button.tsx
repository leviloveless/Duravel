"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

function fmtSync(iso: string | null): string {
  if (!iso) return "never";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "never";
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * "Sync now" control on the Activity page — pulls recent Strava activity via the
 * same endpoint the Connections panel uses (POST /api/wearables/strava/sync),
 * then refreshes the page so newly imported workouts (and their same-day
 * suggestions) appear. Shown only when Strava is connected.
 */
export default function SyncNowButton({ lastSync }: { lastSync: string | null }) {
  const router = useRouter();
  const [syncing, setSyncing] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function sync() {
    setSyncing(true);
    setMsg(null);
    try {
      const res = await fetch("/api/wearables/strava/sync", { method: "POST" });
      const data = (await res.json().catch(() => ({}))) as { imported?: number; error?: string };
      if (!res.ok) throw new Error(data.error ?? "Sync failed");
      setMsg(`Imported ${data.imported ?? 0} activities.`);
      router.refresh();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Sync failed");
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1 print:hidden">
      <button
        type="button"
        onClick={sync}
        disabled={syncing}
        className="rounded-full bg-black px-4 py-1.5 text-sm text-white transition-colors hover:bg-zinc-800 disabled:opacity-60"
      >
        {syncing ? "Syncing…" : "Sync now"}
      </button>
      <span className="text-xs text-zinc-400">{msg ?? `Last sync: ${fmtSync(lastSync)}`}</span>
    </div>
  );
}
