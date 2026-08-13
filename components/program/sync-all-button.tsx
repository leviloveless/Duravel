"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { summarizeSyncAll, type SyncAllResult } from "@/lib/wearables/sync-all";
import { formatInstant } from "@/lib/timezone";

/**
 * "Sync workouts" control in the program header — pulls from EVERY connected
 * API source at once (POST /api/wearables/sync), then refreshes the page so
 * newly imported activities show up in the same-day link suggestions banner
 * without a manual reload.
 *
 * Rendered only when at least one source is connected; with nothing connected
 * the athlete gets a Settings link instead of a button that can't do anything.
 * The status line names each provider and its count, so a source that imported
 * nothing is visibly distinct from one that failed.
 */
export default function SyncAllButton({
  connectedCount,
  lastSync,
  timeZone,
}: {
  /** How many wearable sources the athlete has connected. */
  connectedCount: number;
  /** Most recent last_sync_at across all connections, ISO or null. */
  lastSync: string | null;
  /** The athlete's IANA zone (profiles.timezone). Passed in rather than read
   *  from the browser so the server and client render the SAME string — an
   *  ambient-timezone timestamp here is what threw React #418 on every load of
   *  this page. See `formatInstant`. */
  timeZone: string | null;
}) {
  const router = useRouter();
  const [syncing, setSyncing] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  if (connectedCount === 0) {
    return (
      <a
        href="/settings/connections"
        className="rounded-full border border-zinc-300 px-4 py-1.5 text-sm text-zinc-700 transition-colors hover:bg-zinc-50 print:hidden"
      >
        Connect a workout source
      </a>
    );
  }

  async function sync() {
    setSyncing(true);
    setMsg(null);
    setFailed(false);
    try {
      const res = await fetch("/api/wearables/sync", { method: "POST" });
      const data = (await res.json().catch(() => ({}))) as Partial<SyncAllResult> & {
        error?: string;
      };
      if (!res.ok) throw new Error(data.error ?? "Sync failed");
      const result: SyncAllResult = {
        results: data.results ?? [],
        imported: data.imported ?? 0,
        noConnections: data.noConnections ?? false,
      };
      setMsg(summarizeSyncAll(result));
      setFailed(result.results.some((r) => !r.ok));
      router.refresh();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Sync failed");
      setFailed(true);
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div className="flex flex-col items-start gap-1 print:hidden sm:items-end">
      <button
        type="button"
        onClick={sync}
        disabled={syncing}
        title="Pull your latest workouts from every connected source"
        className="rounded-full border border-zinc-300 px-4 py-1.5 text-sm text-zinc-700 transition-colors hover:bg-zinc-50 disabled:opacity-60"
      >
        {syncing ? "Syncing…" : "Sync workouts"}
      </button>
      <span className={`text-xs ${failed ? "text-amber-700" : "text-zinc-400"}`}>
        {msg ?? `Last sync: ${formatInstant(lastSync, timeZone)}`}
      </span>
    </div>
  );
}
