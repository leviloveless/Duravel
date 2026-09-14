import Link from "next/link";
import type { AdaptationRow } from "@/lib/supabase/queries";
import type { ActivityRow } from "@/lib/wearables/activities";

/**
 * Two cards cut from the first dashboard and now wired to real data (2026-09-13).
 *
 * Neither needed a migration — `adaptations` and `wearable_activities` have both
 * been written since long before this page existed. They were missing only
 * because the first pass would have had to invent the reading code, and
 * inventing it while the athlete was asleep was the wrong trade.
 */

/** What each adaptation rule actually did, in the athlete's language. */
const RULE_LABEL: Record<string, { title: string; why: string }> = {
  early_deload: {
    title: "Pulled a deload forward",
    why: "Accumulated fatigue reached the point where another build week would have cost more than it bought",
  },
  readiness_deload: {
    title: "Cut the week back",
    why: "Your readiness check-ins stayed low for long enough to act on",
  },
  readiness_hold: {
    title: "Held volume flat",
    why: "Readiness was down, but not far enough to warrant cutting",
  },
  load_spike: {
    title: "Reduced load after a spike",
    why: "Weekly load jumped far enough above your recent average to raise injury risk",
  },
  load_caution: {
    title: "Eased the ramp",
    why: "Load was climbing faster than the four-week average supports",
  },
  earned_bump: {
    title: "Added volume",
    why: "You completed the block as prescribed and recovered well — so the engine spent that",
  },
  protect_long_run: {
    title: "Protected the long run",
    why: "Volume had to come out somewhere, and the long run is the last session to touch",
  },
  re_anchor: {
    title: "Re-anchored your paces",
    why: "A logged session implied different fitness from the one your paces were computed against",
  },
  hold: { title: "Held the plan", why: "Nothing in your logs argued for changing it" },
};

export function EngineChangesCard({ adaptations }: { adaptations: readonly AdaptationRow[] }) {
  const applied = adaptations
    .filter((a) => a.decision === "applied" && a.rule_applied !== "none")
    .slice(-5)
    .reverse();

  if (applied.length === 0) {
    return (
      <p className="text-sm text-zinc-500">
        Nothing changed yet. Once you have logged a couple of weeks, the engine starts adjusting the
        block and every adjustment shows up here with its reason.
      </p>
    );
  }

  return (
    <div className="flex flex-col">
      {applied.map((a) => {
        const label = RULE_LABEL[a.rule_applied] ?? {
          title: a.rule_applied.replace(/_/g, " "),
          why: "Applied from your logged sessions",
        };
        return (
          <div
            key={a.id}
            className="border-line flex items-start gap-3 border-b py-2.5 last:border-b-0"
          >
            <span className="flex flex-col">
              <span className="text-[13.5px] font-medium">{label.title}</span>
              <span className="text-[11.5px] text-zinc-500">{label.why}</span>
            </span>
            <span className="ml-auto flex shrink-0 flex-col items-end gap-1">
              <span className="bg-accent-wash text-accent rounded-full px-2 py-0.5 text-[11px] font-semibold">
                Auto
              </span>
              <span className="font-mono text-[10px] text-zinc-400">wk {a.target_week}</span>
            </span>
          </div>
        );
      })}
    </div>
  );
}

const fmtDuration = (s: number | null): string => {
  if (!s) return "—";
  const m = Math.round(s / 60);
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m} min`;
};

const fmtDistance = (m: number | null): string =>
  m ? `${Math.round((m / 1609.344) * 10) / 10} mi` : "";

export function RecentActivityCard({ activities }: { activities: readonly ActivityRow[] }) {
  // Duravel's own Strava posts are the PLAN, not a record of training — they are
  // never link candidates elsewhere in the app and must not read as sessions here.
  const rows = activities.filter((a) => !a.self_posted).slice(0, 5);

  if (rows.length === 0) {
    return (
      <p className="text-sm text-zinc-500">
        Nothing synced yet.{" "}
        <Link href="/settings/connections" className="text-accent underline">
          Connect Strava or Oura
        </Link>{" "}
        and your sessions land here automatically.
      </p>
    );
  }

  return (
    <div className="flex flex-col">
      {rows.map((a) => (
        <div
          key={a.id}
          className="border-line flex items-start gap-3 border-b py-2.5 last:border-b-0"
        >
          <span className="flex min-w-0 flex-col">
            <span className="truncate text-[13.5px] font-medium">
              {a.type ?? "Session"}
              {a.linked && <span className="text-accent ml-1.5 text-[11px]">· matched</span>}
            </span>
            <span className="text-[11.5px] text-zinc-500">
              {a.start_time ? a.start_time.slice(0, 10) : "—"} · {a.provider}
              {a.avg_hr ? ` · ${a.avg_hr} bpm` : ""}
            </span>
          </span>
          <span className="ml-auto shrink-0 text-right">
            <span className="block font-mono text-[13px]">{fmtDuration(a.duration_s)}</span>
            <span className="block font-mono text-[11px] text-zinc-500">
              {fmtDistance(a.distance_m)}
            </span>
          </span>
        </div>
      ))}
    </div>
  );
}
