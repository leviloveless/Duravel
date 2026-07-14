import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getUserActivities } from "@/lib/wearables/activities";
import { getLinkableSessions } from "@/lib/wearables/link-data";
import { getConnectionStatuses } from "@/lib/wearables/connections";
import {
  formatDurationS,
  formatDistanceMiles,
  formatActivityType,
} from "@/lib/wearables/format";
import ActivityLinker from "@/components/activity/activity-linker";
import SyncNowButton from "@/components/activity/sync-now-button";

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

export default async function ActivityPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [activities, programs, statuses] = await Promise.all([
    getUserActivities(),
    getLinkableSessions(),
    getConnectionStatuses(user.id),
  ]);
  const strava = statuses.find((s) => s.provider === "strava");

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-6 px-6 py-16">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold">Activity</h1>
          <p className="text-sm text-zinc-500">
            Workouts synced from your connected wearables. Link each one to a planned session so it
            counts toward your training and feeds your weekly adjustments.
          </p>
        </div>
        {strava?.connected && <SyncNowButton lastSync={strava.last_sync_at} />}
      </div>

      {activities.length === 0 ? (
        <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-6 text-sm text-zinc-600">
          {strava?.connected ? (
            <>No synced workouts yet. Hit “Sync now” above to pull your recent activity.</>
          ) : (
            <>
              No synced workouts yet. Connect a wearable in{" "}
              <Link href="/settings/connections" className="underline">
                Settings → Connections
              </Link>{" "}
              and hit “Sync now.”
            </>
          )}
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {activities.map((a) => (
            <li
              key={a.id}
              className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-zinc-200 px-4 py-3"
            >
              <span className="flex flex-col">
                <span className="font-medium">{formatActivityType(a.type)}</span>
                <span className="text-xs text-zinc-500">
                  {formatDate(a.start_time)} · {formatDurationS(a.duration_s)}
                  {a.distance_m ? ` · ${formatDistanceMiles(a.distance_m)}` : ""}
                  {a.avg_hr ? ` · ${Math.round(a.avg_hr)} bpm` : ""} · {a.provider}
                </span>
              </span>
              <ActivityLinker activityId={a.id} programs={programs} link={a.link} />
            </li>
          ))}
        </ul>
      )}

      <Link href="/dashboard" className="text-sm underline">
        Back to dashboard
      </Link>
    </main>
  );
}
