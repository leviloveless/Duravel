import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getUserActivities } from "@/lib/wearables/activities";
import {
  formatDurationS,
  formatDistanceMiles,
  formatActivityType,
} from "@/lib/wearables/format";

const DAY_LABEL: Record<string, string> = {
  mon: "Mon", tue: "Tue", wed: "Wed", thu: "Thu", fri: "Fri", sat: "Sat", sun: "Sun",
};

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

  const activities = await getUserActivities();

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-6 px-6 py-16">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">Activity</h1>
        <p className="text-sm text-zinc-500">
          Workouts synced from your connected wearables. Link them to planned sessions from your
          program view.
        </p>
      </div>

      {activities.length === 0 ? (
        <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-6 text-sm text-zinc-600">
          No synced workouts yet. Connect a wearable in{" "}
          <Link href="/settings/connections" className="underline">
            Settings → Connections
          </Link>{" "}
          and hit “Sync now.”
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {activities.map((a) => (
            <li
              key={a.id}
              className="flex items-center justify-between gap-3 rounded-lg border border-zinc-200 px-4 py-3"
            >
              <span className="flex flex-col">
                <span className="font-medium">{formatActivityType(a.type)}</span>
                <span className="text-xs text-zinc-500">
                  {formatDate(a.start_time)} · {formatDurationS(a.duration_s)}
                  {a.distance_m ? ` · ${formatDistanceMiles(a.distance_m)}` : ""}
                  {a.avg_hr ? ` · ${Math.round(a.avg_hr)} bpm` : ""} · {a.provider}
                </span>
              </span>
              {a.linked && a.link ? (
                <span className="shrink-0 rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-medium text-emerald-800">
                  Linked · Wk {a.link.week_number} {DAY_LABEL[a.link.day] ?? a.link.day}
                </span>
              ) : (
                <span className="shrink-0 rounded-full bg-zinc-100 px-2.5 py-1 text-xs font-medium text-zinc-600">
                  Unlinked
                </span>
              )}
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
