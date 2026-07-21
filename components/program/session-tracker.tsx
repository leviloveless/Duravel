import type { ProgramData, WorkoutLog } from "@/lib/schemas";
import { weekStartDate } from "./format";

/**
 * Program-wide session-completion tracker. Renders every trackable session
 * across the whole program as a status grid (one square per session, grouped by
 * week), plus an overall completion headline. Reads status from the workout
 * logs; sessions with no log are "missed" if their date has passed, else
 * "upcoming". Rest days are not counted.
 */

/** Group logs by week — shared with the weekly-summary tab on the program page. */
export function groupLogsByWeek(logs: WorkoutLog[]): Map<number, WorkoutLog[]> {
  const m = new Map<number, WorkoutLog[]>();
  for (const l of logs) {
    const list = m.get(l.weekNumber) ?? [];
    list.push(l);
    m.set(l.weekNumber, list);
  }
  return m;
}

const DAY_ORDER = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;

const KIND_LABEL: Record<string, string> = {
  run: "Run",
  lift: "Lift",
  hybrid: "Hybrid",
  swim: "Swim",
  bike: "Bike",
  brick: "Brick",
  cardio: "Cardio",
  strength: "Strength",
  race: "Race",
};

type Status = "completed" | "partial" | "skipped" | "missed" | "upcoming";

const STATUS_STYLE: Record<Status, { bg: string; label: string }> = {
  completed: { bg: "#0f766e", label: "Completed" },
  partial: { bg: "#f59e0b", label: "Partial" },
  skipped: { bg: "#a1a1aa", label: "Skipped" },
  missed: { bg: "#fca5a5", label: "Missed" },
  upcoming: { bg: "#e4e4e7", label: "Upcoming" },
};

const PHASE_LABEL: Record<string, string> = {
  base: "Base",
  build: "Build",
  peak: "Peak",
  taper: "Taper",
};

export default function SessionTracker({
  weeks,
  logs,
  startDate,
}: {
  weeks: ProgramData["weeks"];
  logs: WorkoutLog[];
  startDate: string;
}) {
  const logMap = new Map<string, WorkoutLog>();
  for (const l of logs) logMap.set(`${l.weekNumber}:${l.day}:${l.sessionIndex}`, l);
  const now = Date.now();

  let total = 0;
  let done = 0;

  const rows = weeks.map((w) => {
    const cells: { key: string; status: Status; title: string }[] = [];
    for (const dayKey of DAY_ORDER) {
      const day = w.days.find((d) => d.day === dayKey);
      if (!day) continue;
      day.sessions.forEach((s, si) => {
        if (s.kind === "rest") return;
        total++;
        const log = logMap.get(`${w.weekNumber}:${dayKey}:${si}`);
        let status: Status;
        if (log) {
          status =
            log.status === "completed" ? "completed" : log.status === "partial" ? "partial" : "skipped";
          if (log.status === "completed" || log.status === "partial") done++;
        } else {
          const d = weekStartDate(startDate, w.weekNumber);
          d.setDate(d.getDate() + DAY_ORDER.indexOf(dayKey));
          status = d.getTime() < now ? "missed" : "upcoming";
        }
        cells.push({
          key: `${dayKey}-${si}`,
          status,
          title: `${KIND_LABEL[s.kind] ?? s.kind} · ${dayKey.toUpperCase()} · ${STATUS_STYLE[status].label}`,
        });
      });
    }
    return { week: w.weekNumber, phase: w.phase, cells };
  });

  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

  return (
    <section className="flex flex-col gap-5">
      {/* Headline */}
      <div className="rounded-2xl border border-zinc-200 bg-white p-5 sm:p-6">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-400">
            Program completion
          </h2>
          <span className="text-sm text-zinc-500">
            {done} of {total} sessions
          </span>
        </div>
        <div className="mt-2 flex items-baseline gap-3">
          <span className="text-3xl font-semibold tracking-tight text-zinc-900">{pct}%</span>
          <span className="text-sm text-zinc-500">completed</span>
        </div>
        <div className="mt-3 h-2.5 w-full overflow-hidden rounded-full bg-zinc-100">
          <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: "#0f766e" }} />
        </div>
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-500">
          {(Object.keys(STATUS_STYLE) as Status[]).map((k) => (
            <span key={k} className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: STATUS_STYLE[k].bg }} />
              {STATUS_STYLE[k].label}
            </span>
          ))}
        </div>
      </div>

      {/* Per-week grid */}
      <div className="rounded-2xl border border-zinc-200 bg-white p-5 sm:p-6">
        <div className="flex flex-col gap-2.5">
          {rows.map((r) => (
            <div key={r.week} className="flex items-center gap-3">
              <div className="w-24 shrink-0 text-xs text-zinc-500">
                <span className="font-medium text-zinc-700">Wk {r.week}</span>
                <span className="ml-1.5 text-zinc-400">{PHASE_LABEL[r.phase] ?? r.phase}</span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {r.cells.length === 0 ? (
                  <span className="text-xs text-zinc-300">—</span>
                ) : (
                  r.cells.map((c) => (
                    <span
                      key={c.key}
                      title={c.title}
                      className="h-4 w-4 rounded-sm"
                      style={{ backgroundColor: STATUS_STYLE[c.status].bg }}
                    />
                  ))
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
