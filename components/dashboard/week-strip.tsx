import Link from "next/link";
import type { ProgramWeek, WorkoutLog } from "@/lib/schemas";
import { sessionTypeLabel } from "@/lib/session-labels";
import { sessionTiming } from "@/lib/session-volume";
import { DAY_LABEL } from "@/components/program/format";
import type { Goal } from "@/lib/library/types";
import { GOAL_COLOR_VAR } from "@/lib/library/types";

/**
 * The seven days of the current week, with each session colour-keyed to the
 * GOAL it is training rather than to its session kind.
 *
 * That mapping is the point: an athlete reading the strip should see "two
 * threshold days back to back" at a glance, which the session kind alone never
 * shows — a run and a hybrid can be the same stimulus, and two runs can be
 * completely different ones. Colour is never the only cue; every session also
 * carries its own label.
 */

const DAY_ORDER = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;

/** Session → training goal, using the engine's own vocabulary as the input. */
function goalOf(session: {
  kind: string;
  runType?: string;
  liftType?: string;
  goalZone?: number;
}): Goal {
  if (session.kind === "lift") {
    if (session.liftType === "power") return "max_power";
    return "max_strength";
  }
  if (session.kind === "run") {
    if (session.runType === "threshold" || session.runType === "tempo") return "threshold";
    if (session.runType === "interval" || session.runType === "fartlek") return "vo2";
    if (session.runType === "long" || session.runType === "hybrid_run") return "durability";
    return "aerobic";
  }
  if (session.kind === "hybrid" || session.kind === "brick") return "durability";
  if (session.kind === "race") return "vo2";
  // Swim, bike and plain cardio are aerobic unless the zone says otherwise.
  return (session.goalZone ?? 2) >= 4 ? "vo2" : "aerobic";
}

export default function WeekStrip({
  week,
  logs,
  todayKey,
  programId,
}: {
  week: ProgramWeek;
  logs: readonly WorkoutLog[];
  todayKey: string;
  programId: string;
}) {
  return (
    <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4 lg:grid-cols-7">
      {DAY_ORDER.map((day) => {
        const sessions = week.days.find((d) => d.day === day)?.sessions ?? [];
        const isToday = day === todayKey;
        return (
          <div
            key={day}
            className={`flex min-h-[6.5rem] flex-col gap-1.5 rounded-lg border p-2 ${
              isToday
                ? "border-accent shadow-[inset_0_2px_0_var(--color-accent)] bg-white"
                : "border-line bg-zinc-50"
            }`}
          >
            <span
              className={`font-mono text-[10px] tracking-[0.1em] uppercase ${isToday ? "text-accent" : "text-zinc-500"}`}
            >
              {DAY_LABEL[day] ?? day}
            </span>

            {sessions.length === 0 ? (
              <span className="text-[11px] text-zinc-400 italic">Rest</span>
            ) : (
              sessions.map((s, i) => {
                const log = logs.find(
                  (l) => l.weekNumber === week.weekNumber && l.day === day && l.sessionIndex === i,
                );
                return (
                  <Link
                    key={i}
                    href={`/program/${programId}/workout/${week.weekNumber}/${day}`}
                    className="border-line block rounded border border-l-[3px] bg-white px-1.5 py-1 text-[11px] leading-tight hover:bg-zinc-50"
                    style={{ borderLeftColor: GOAL_COLOR_VAR[goalOf(s)] }}
                  >
                    <span className="block font-semibold break-words">{sessionTypeLabel(s)}</span>
                    <span className="block font-mono text-[10px] text-zinc-500">
                      {Math.round(sessionTiming(s).total)} min
                      {log
                        ? log.status === "completed"
                          ? " · ✓"
                          : log.status === "partial"
                            ? " · ½"
                            : " · ✗"
                        : ""}
                    </span>
                  </Link>
                );
              })
            )}
          </div>
        );
      })}
    </div>
  );
}
