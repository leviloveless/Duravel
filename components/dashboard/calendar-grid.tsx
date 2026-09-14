import Link from "next/link";
import type { CalendarWeek } from "@/lib/dashboard/calendar";
import { asHours } from "@/lib/dashboard/derive";
import { sessionTypeLabel } from "@/lib/session-labels";
import { GOAL_COLOR_VAR, type Goal } from "@/lib/library/types";

/**
 * The month grid, with a weekly summary rail down the right (2026-09-13).
 *
 * The rail is the part worth having. A month of coloured blocks is decoration;
 * a month of coloured blocks with "6.4 of 9.8 h" beside each row is a training
 * log. It reads as a table on a wide screen and collapses to a stack of days on
 * a phone, because a seven-column grid at 400px is unreadable whatever you do to
 * the type.
 */

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

/** Session → training goal, so colour means stimulus rather than session kind. */
function goalOf(s: { kind: string; runType?: string; liftType?: string; goalZone?: number }): Goal {
  if (s.kind === "lift") return s.liftType === "power" ? "max_power" : "max_strength";
  if (s.kind === "run") {
    if (s.runType === "threshold" || s.runType === "tempo") return "threshold";
    if (s.runType === "interval" || s.runType === "fartlek") return "vo2";
    if (s.runType === "long" || s.runType === "hybrid_run") return "durability";
    return "aerobic";
  }
  if (s.kind === "hybrid" || s.kind === "brick") return "durability";
  if (s.kind === "race") return "vo2";
  return (s.goalZone ?? 2) >= 4 ? "vo2" : "aerobic";
}

const STATUS_MARK: Record<string, string> = {
  completed: "✓",
  partial: "½",
  skipped: "✗",
};

export default function CalendarGrid({ weeks }: { weeks: readonly CalendarWeek[] }) {
  return (
    <div className="flex flex-col gap-2">
      {/* Weekday header — only meaningful once the grid is actually a grid. */}
      <div className="hidden lg:grid lg:grid-cols-[repeat(7,minmax(0,1fr))_11rem] lg:gap-1.5">
        {WEEKDAYS.map((d) => (
          <div
            key={d}
            className="px-1 font-mono text-[10px] tracking-[0.12em] text-zinc-500 uppercase"
          >
            {d}
          </div>
        ))}
        <div className="px-1 font-mono text-[10px] tracking-[0.12em] text-zinc-500 uppercase">
          Week
        </div>
      </div>

      {weeks.map((week) => (
        <div
          key={week.startDate}
          className="grid grid-cols-1 gap-1.5 sm:grid-cols-2 lg:grid-cols-[repeat(7,minmax(0,1fr))_11rem]"
        >
          {week.days.map((day) => {
            const dayNum = Number(day.date.slice(8, 10));
            const first = dayNum === 1;
            return (
              <div
                key={day.date}
                className={`flex min-h-[7rem] flex-col gap-1 rounded-lg border p-1.5 ${
                  day.isToday
                    ? "border-accent shadow-[inset_0_2px_0_var(--color-accent)] bg-white"
                    : day.inMonth
                      ? "border-line bg-white"
                      : "border-line/60 bg-zinc-50/60"
                }`}
              >
                <span
                  className={`font-mono text-[11px] ${
                    day.isToday
                      ? "text-accent font-semibold"
                      : day.inMonth
                        ? "text-zinc-600"
                        : "text-zinc-400"
                  }`}
                >
                  {first ? day.date.slice(5, 10).replace("-", "/") : dayNum}
                </span>

                {day.sessions.map((s) => (
                  <Link
                    key={`${s.programId}-${s.weekNumber}-${s.day}-${s.index}`}
                    href={`/program/${s.programId}/workout/${s.weekNumber}/${s.day}`}
                    className="border-line block rounded border border-l-[3px] bg-white px-1.5 py-1 text-[11px] leading-tight hover:bg-zinc-50"
                    style={{ borderLeftColor: GOAL_COLOR_VAR[goalOf(s.session)] }}
                  >
                    <span className="block font-medium break-words">
                      {sessionTypeLabel(s.session)}
                    </span>
                    <span className="block font-mono text-[10px] text-zinc-500">
                      {s.minutes} min
                      {s.status ? ` · ${STATUS_MARK[s.status] ?? ""}` : ""}
                    </span>
                  </Link>
                ))}

                {day.extras.map((e, i) => (
                  <span
                    key={i}
                    className="block rounded border border-dashed border-zinc-300 bg-zinc-50 px-1.5 py-1 text-[11px] leading-tight text-zinc-600"
                    title="Off-plan session"
                  >
                    <span className="block break-words">{e.title}</span>
                    <span className="block font-mono text-[10px] text-zinc-500">
                      {e.minutes} min
                    </span>
                  </span>
                ))}
              </div>
            );
          })}

          {/* The weekly rail. */}
          <div className="border-line flex flex-col justify-center gap-1 rounded-lg border bg-zinc-50 p-2.5 sm:col-span-2 lg:col-span-1">
            {week.weekNumber != null && (
              <span className="font-mono text-[10px] tracking-[0.1em] text-zinc-500 uppercase">
                Week {week.weekNumber}
              </span>
            )}
            <span className="font-mono text-sm font-semibold">
              {asHours(week.completedMin)}
              <span className="text-zinc-500"> / {asHours(week.plannedMin)} h</span>
            </span>
            {week.plannedMin > 0 && (
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-200">
                <div
                  className="bg-accent h-full rounded-full"
                  style={{
                    width: `${Math.min(100, Math.round((week.completedMin / week.plannedMin) * 100))}%`,
                  }}
                />
              </div>
            )}
            {week.miles > 0 && (
              <span className="font-mono text-[11px] text-zinc-500">{week.miles} mi run</span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
