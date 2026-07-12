import type { ProgramWeek, Session, WorkoutLog } from "@/lib/schemas";
import { computeWeekSignals } from "@/lib/engine/adapt";
import LogSession from "./log-session";
import {
  DAY_LABEL,
  MICRO_LABEL,
  PHASE_COLORS,
  PHASE_LABEL,
  dayDateLabel,
  elementLine,
  movementLine,
  sessionPace,
  sessionTiming,
  sessionTypeLabel,
  sessionZoneLabel,
  weekRangeLabel,
  zoneEntries,
  type ZoneBands,
} from "./format";

const DAY_ORDER = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;

function ZoneBars({ week }: { week: ProgramWeek }) {
  const entries = zoneEntries(week.summary.zoneDistribution);
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-medium text-zinc-500">Estimated zone distribution</span>
      <div className="flex h-2.5 overflow-hidden rounded-full">
        {entries.map((e) => (
          <div key={e.zone} className={e.barClass} style={{ width: `${e.pct}%` }} title={`${e.label}: ${e.pct}%`} />
        ))}
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-zinc-500">
        {entries.map((e) => (
          <span key={e.zone}>
            {e.label} {e.pct}%
          </span>
        ))}
      </div>
    </div>
  );
}

/** The details cell content for a session (distance / movements / elements). */
function SessionDetail({ session }: { session: Session }) {
  if (session.kind === "run") {
    const miles = Number.isInteger(session.distanceMiles) ? session.distanceMiles : session.distanceMiles.toFixed(1);
    return <span className="text-zinc-500">{miles} mi</span>;
  }
  if (session.kind === "lift") {
    return (
      <ul className="mt-0.5 flex flex-col gap-0.5 text-zinc-500">
        {session.movements.map((m, i) => (
          <li key={i}>{movementLine(m)}</li>
        ))}
      </ul>
    );
  }
  if (session.kind === "hybrid") {
    return (
      <ul className="mt-0.5 flex flex-col gap-0.5 text-zinc-500">
        {session.elements.map((el, i) => (
          <li key={i}>{elementLine(el)}</li>
        ))}
      </ul>
    );
  }
  return null;
}

const TYPE_DOT: Record<Session["kind"], string> = {
  run: "bg-sky-500",
  lift: "bg-zinc-500",
  hybrid: "bg-orange-500",
  race: "bg-red-500",
};

/** Extra props for Phase 2 logging (all optional so the print view stays clean). */
export interface WeekLogging {
  programId: string;
  logs: WorkoutLog[];
  frozen: boolean;
  adapted: boolean;
}

function logFor(logging: WeekLogging | undefined, day: string, sessionIndex: number): WorkoutLog | null {
  return logging?.logs.find((l) => l.day === day && l.sessionIndex === sessionIndex) ?? null;
}

/** Mobile layout: one stacked block per day (no horizontal scroll). */
function MobileDayList({
  week,
  startDate,
  maxHR,
  zoneBands,
  logging,
}: {
  week: ProgramWeek;
  startDate: string;
  maxHR: number;
  zoneBands?: ZoneBands;
  logging?: WeekLogging;
}) {
  const byDay = new Map(week.days.map((d) => [d.day, d.sessions]));
  return (
    <ul className="flex flex-col divide-y divide-zinc-100 md:hidden">
      {DAY_ORDER.map((dayKey) => {
        const sessions = byDay.get(dayKey) ?? [];
        const dateLabel = dayDateLabel(startDate, week.weekNumber, dayKey);
        return (
          <li key={dayKey} className="flex flex-col gap-2 px-4 py-3">
            <div className="flex items-baseline gap-2">
              <span className="text-sm font-semibold">{DAY_LABEL[dayKey]}</span>
              <span className="text-xs text-zinc-400">{dateLabel}</span>
              {sessions.length === 0 && <span className="ml-auto text-xs text-zinc-400">Rest</span>}
            </div>
            {sessions.map((s, si) => {
              const t = sessionTiming(s);
              const isRace = s.kind === "race";
              return (
                <div key={si} className="rounded-lg bg-zinc-50 px-3 py-2 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-1.5 font-medium text-zinc-800">
                      <span className={`h-2 w-2 shrink-0 rounded-full ${TYPE_DOT[s.kind]}`} />
                      {sessionTypeLabel(s)}
                    </span>
                    <span className="flex shrink-0 items-center gap-2">
                      {!isRace && <span className="text-xs tabular-nums text-zinc-500">{t.total}m total</span>}
                      {logging && (
                        <LogSession
                          programId={logging.programId}
                          weekNumber={week.weekNumber}
                          day={dayKey}
                          sessionIndex={si}
                          isRace={isRace}
                          existing={logFor(logging, dayKey, si)}
                          frozen={logging.frozen}
                        />
                      )}
                    </span>
                  </div>
                  <div className="mt-0.5 text-xs">
                    <SessionDetail session={s} />
                  </div>
                  <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-zinc-500">
                    {sessionPace(s) !== "—" && <span>Pace {sessionPace(s)}</span>}
                    {sessionZoneLabel(s, maxHR, zoneBands) !== "—" && <span>{sessionZoneLabel(s, maxHR, zoneBands)}</span>}
                    {!isRace && (
                      <span className="tabular-nums">
                        {t.warmup}/{t.work}/{t.cooldown} warmup·work·cooldown
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </li>
        );
      })}
    </ul>
  );
}

/** One week: summary header + a Monday→Sunday table of that week's sessions. */
export default function WeekCard({
  week,
  startDate,
  maxHR,
  zoneBands,
  logging,
}: {
  week: ProgramWeek;
  startDate: string;
  maxHR: number;
  zoneBands?: ZoneBands;
  logging?: WeekLogging;
}) {
  const colors = PHASE_COLORS[week.phase];
  const byDay = new Map(week.days.map((d) => [d.day, d.sessions]));
  const hasLogs = (logging?.logs.length ?? 0) > 0;
  const actuals = hasLogs && logging ? computeWeekSignals(week, logging.logs) : null;

  return (
    <section id={`week-${week.weekNumber}`} className={`scroll-mt-20 rounded-xl border ${colors.border} bg-white`}>
      {/* Header + summary */}
      <div className="flex flex-col gap-3 border-b border-zinc-100 p-5">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-lg font-semibold">Week {week.weekNumber}</h2>
          <span className="text-sm text-zinc-500">{weekRangeLabel(startDate, week.weekNumber)}</span>
          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${colors.chip}`}>{PHASE_LABEL[week.phase]}</span>
          <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-600">
            {MICRO_LABEL[week.microWeek]}
          </span>
          {week.raceDay && (
            <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-800">
              {week.raceDay.priority} race
            </span>
          )}
          {logging?.adapted && (
            <span
              className="rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-semibold text-indigo-800"
              title="This week was adjusted from your logged performance"
            >
              Adapted
            </span>
          )}
        </div>

        <div className="grid gap-4 sm:grid-cols-[auto_1fr] sm:items-center">
          <div className="flex gap-6 text-sm">
            <span>
              <span className="block text-xs text-zinc-500">Cardio time</span>
              <span className="font-medium">{week.summary.totalCardioMinutes} min</span>
              {actuals && (
                <span className="block text-xs text-emerald-700">Actual: {actuals.actualCardioMinutes} min</span>
              )}
            </span>
            <span>
              <span className="block text-xs text-zinc-500">Running mileage</span>
              <span className="font-medium">{week.summary.totalMileage} mi</span>
              {actuals && (
                <span className="block text-xs text-emerald-700">Actual: {actuals.actualMileage} mi</span>
              )}
            </span>
            {actuals && (
              <span>
                <span className="block text-xs text-zinc-500">Sessions done</span>
                <span className="font-medium">{Math.round(actuals.compliance * 100)}%</span>
              </span>
            )}
          </div>
          <ZoneBars week={week} />
        </div>
      </div>

      {/* Mobile: stacked per-day list (no horizontal scroll) */}
      <MobileDayList week={week} startDate={startDate} maxHR={maxHR} zoneBands={zoneBands} logging={logging} />

      {/* Desktop: Mon→Sun session table */}
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full min-w-[720px] text-sm">
          <thead className="bg-zinc-50 text-xs text-zinc-500">
            <tr>
              <th className="px-4 py-2 text-left font-medium">Day</th>
              <th className="px-3 py-2 text-left font-medium">Workout</th>
              <th className="px-3 py-2 text-left font-medium">Pace</th>
              <th className="px-3 py-2 text-left font-medium">Zone</th>
              <th className="px-2 py-2 text-right font-medium">Warmup</th>
              <th className="px-2 py-2 text-right font-medium">Work</th>
              <th className="px-2 py-2 text-right font-medium">Cooldown</th>
              <th className="px-3 py-2 text-right font-medium">Total</th>
              {logging && <th className="px-3 py-2 text-right font-medium print:hidden">Log</th>}
            </tr>
          </thead>
          <tbody>
            {DAY_ORDER.map((dayKey) => {
              const sessions = byDay.get(dayKey) ?? [];
              const dateLabel = dayDateLabel(startDate, week.weekNumber, dayKey);

              if (sessions.length === 0) {
                return (
                  <tr key={dayKey} className="border-t border-zinc-100">
                    <td className="whitespace-nowrap px-4 py-3 align-top">
                      <span className="font-medium">{DAY_LABEL[dayKey]}</span>
                      <span className="block text-xs text-zinc-400">{dateLabel}</span>
                    </td>
                    <td className="px-3 py-3 text-zinc-400">Rest</td>
                    <td className="px-3 py-3 text-zinc-400">—</td>
                    <td className="px-3 py-3 text-zinc-400">—</td>
                    <td className="px-2 py-3 text-right text-zinc-400">—</td>
                    <td className="px-2 py-3 text-right text-zinc-400">—</td>
                    <td className="px-2 py-3 text-right text-zinc-400">—</td>
                    <td className="px-3 py-3 text-right text-zinc-400">—</td>
                    {logging && <td className="px-3 py-3 text-right text-zinc-400 print:hidden">—</td>}
                  </tr>
                );
              }

              return sessions.map((s, si) => {
                const t = sessionTiming(s);
                const isRace = s.kind === "race";
                return (
                  <tr key={`${dayKey}-${si}`} className={si === 0 ? "border-t border-zinc-100" : ""}>
                    {si === 0 && (
                      <td rowSpan={sessions.length} className="whitespace-nowrap px-4 py-3 align-top">
                        <span className="font-medium">{DAY_LABEL[dayKey]}</span>
                        <span className="block text-xs text-zinc-400">{dateLabel}</span>
                      </td>
                    )}
                    <td className="px-3 py-3 align-top">
                      <span className="flex items-center gap-1.5 font-medium text-zinc-800">
                        <span className={`h-2 w-2 shrink-0 rounded-full ${TYPE_DOT[s.kind]}`} />
                        {sessionTypeLabel(s)}
                      </span>
                      <div className="text-xs">
                        <SessionDetail session={s} />
                      </div>
                    </td>
                    <td className="px-3 py-3 align-top text-zinc-600">{sessionPace(s)}</td>
                    <td className="whitespace-nowrap px-3 py-3 align-top text-zinc-600">{sessionZoneLabel(s, maxHR, zoneBands)}</td>
                    <td className="px-2 py-3 text-right align-top tabular-nums text-zinc-600">{isRace ? "—" : `${t.warmup}m`}</td>
                    <td className="px-2 py-3 text-right align-top tabular-nums text-zinc-600">{isRace ? "—" : `${t.work}m`}</td>
                    <td className="px-2 py-3 text-right align-top tabular-nums text-zinc-600">{isRace ? "—" : `${t.cooldown}m`}</td>
                    <td className="px-3 py-3 text-right align-top font-medium tabular-nums">{isRace ? "—" : `${t.total}m`}</td>
                    {logging && (
                      <td className="px-3 py-3 text-right align-top print:hidden">
                        <LogSession
                          programId={logging.programId}
                          weekNumber={week.weekNumber}
                          day={dayKey}
                          sessionIndex={si}
                          isRace={isRace}
                          existing={logFor(logging, dayKey, si)}
                          frozen={logging.frozen}
                        />
                      </td>
                    )}
                  </tr>
                );
              });
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
