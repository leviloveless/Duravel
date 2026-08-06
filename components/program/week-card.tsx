import type { ProgramWeek, Session, WorkoutLog } from "@/lib/schemas";
import { computeWeekSignals } from "@/lib/engine/adapt";
import LogSession from "./log-session";
import SessionLink from "./session-link";
import { AddExtraWorkout, ExtraWorkoutList } from "@/components/program/extra-workout";
import { extraSummaryLabel, extrasForDay, extrasForWeek } from "@/lib/extra-workouts";
import type { ExtraWorkout } from "@/lib/schemas";
import CoachSessionEdit from "./coach-session-edit";
import SessionShare from "./session-share";
import { sessionSummary } from "@/lib/program/session-summary";
import { sessionKey, type SyncActivitySummary } from "@/lib/wearables/suggest-data";
import { sessionMiles, weekTimeByCategory } from "@/lib/session-volume";
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
          <div
            key={e.zone}
            className={e.barClass}
            style={{ width: `${e.pct}%` }}
            title={`${e.label}: ${e.pct}%`}
          />
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

/** The details cell content for a session (distance / movements / elements + how-to description). */
function SessionDetail({ session }: { session: Session }) {
  if (session.kind === "run") {
    // Show TOTAL on-feet distance (work + warmup/cooldown + between-rep recovery),
    // the same figure the weekly "Running mileage" sums to — so a run's headline
    // matches what the athlete actually runs, not just the main-set reps.
    const total = sessionMiles(session);
    const miles = Number.isInteger(total) ? total : total.toFixed(1);
    return (
      <div className="flex flex-col gap-1">
        <span className="text-zinc-500">{miles} mi</span>
        {session.description && (
          <p className="max-w-md whitespace-pre-line leading-snug text-zinc-500">
            {session.description}
          </p>
        )}
      </div>
    );
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
      <div className="flex flex-col gap-1">
        {/* The warm-up jog is prescribed work and counts toward the week's
            mileage, so it reads in the table like a run's does. */}
        {session.warmup && <p className="mt-0.5 text-zinc-500">{session.warmup}</p>}
        <ul className="mt-0.5 flex flex-col gap-0.5 text-zinc-500">
          {session.elements.map((el, i) => (
            <li key={i}>{elementLine(el)}</li>
          ))}
        </ul>
        {session.cooldown && <p className="text-zinc-500">{session.cooldown}</p>}
        {session.description && (
          <p className="max-w-md whitespace-pre-line leading-snug text-zinc-500">
            {session.description}
          </p>
        )}
      </div>
    );
  }
  if (session.kind === "cardio") {
    return <span className="text-zinc-500">{session.modality ?? "Zone 1–2 cross-training"}</span>;
  }
  return null;
}

const TYPE_DOT: Record<Session["kind"], string> = {
  run: "bg-sky-500",
  lift: "bg-zinc-500",
  hybrid: "bg-orange-500",
  race: "bg-red-500",
  cardio: "bg-teal-500",
  swim: "bg-cyan-500",
  bike: "bg-indigo-500",
  brick: "bg-amber-500",
};

/** Extra props for Phase 2 logging (all optional so the print view stays clean). */
export interface WeekLogging {
  programId: string;
  logs: WorkoutLog[];
  frozen: boolean;
  adapted: boolean;
  /** Unlinked synced workouts attachable to any session (in-view linking). */
  linkableActivities?: SyncActivitySummary[];
  /** Synced activity linked to each session, keyed `${week}:${day}:${index}`. */
  linkedBySession?: Record<string, SyncActivitySummary>;
  /** Unplanned workouts the athlete recorded on top of the plan. */
  extras?: ExtraWorkout[];
}

function logFor(
  logging: WeekLogging | undefined,
  day: string,
  sessionIndex: number,
): WorkoutLog | null {
  return logging?.logs.find((l) => l.day === day && l.sessionIndex === sessionIndex) ?? null;
}

function linkFor(
  logging: WeekLogging | undefined,
  weekNumber: number,
  day: string,
  sessionIndex: number,
): SyncActivitySummary | null {
  return logging?.linkedBySession?.[sessionKey(weekNumber, day, sessionIndex)] ?? null;
}

/**
 * The id STRAVA understands for a linked activity.
 *
 * `SyncActivitySummary.activityId` is DURAVEL's row id (a UUID) — right for
 * linking inside Duravel, wrong for Strava's API. Passing it to the branded-write
 * endpoint failed 400 in production: a 36-char UUID against a 32-char field, and
 * Strava would have 404'd it anyway. Strava keys off `external_id`.
 *
 * Returns undefined for a non-Strava activity, so "To Strava" simply doesn't
 * render for, say, an Oura or Garmin import.
 */
function stravaActivityId(linked: SyncActivitySummary | null): string | undefined {
  if (!linked || linked.provider !== "strava") return undefined;
  return linked.externalId ?? undefined;
}

/** Mobile layout: one stacked block per day (no horizontal scroll). */
function MobileDayList({
  week,
  startDate,
  maxHR,
  zoneBands,
  logging,
  athleteName,
  programName,
  stravaWriteEnabled,
  coach,
}: {
  week: ProgramWeek;
  startDate: string;
  maxHR: number;
  zoneBands?: ZoneBands;
  logging?: WeekLogging;
  athleteName?: string;
  /** Program name — shown in the Duravel tag on shared cards / Strava text. */
  programName?: string | null;
  /** Whether the Strava activity-write path is switched on (STRAVA_WRITE_ENABLED). */
  stravaWriteEnabled?: boolean;
  coach?: { programId: string };
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
              {sessions.length > 0 && logging && (
                <a
                  href={`/program/${logging.programId}/workout/${week.weekNumber}/${dayKey}`}
                  className="ml-auto rounded-full bg-black px-2.5 py-1 text-[11px] font-medium text-white"
                >
                  Workout view
                </a>
              )}
            </div>
            {sessions.map((s, si) => {
              const t = sessionTiming(s);
              const isRace = s.kind === "race";
              const log = logFor(logging, dayKey, si);
              // One summary per row: the Share controls AND the post-log card
              // nudge read the same `cardData`, so the image an athlete is
              // offered right after logging is the one the Share link builds.
              const shareSummary = isRace
                ? null
                : sessionSummary(s, {
                    athlete: athleteName ?? "",
                    programName,
                    weekNumber: week.weekNumber,
                    dayKey,
                    log,
                  });
              return (
                <div key={si} className="rounded-lg bg-zinc-50 px-3 py-2 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-1.5 font-medium text-zinc-800">
                      <span className={`h-2 w-2 shrink-0 rounded-full ${TYPE_DOT[s.kind]}`} />
                      {sessionTypeLabel(s)}
                    </span>
                    <span className="flex shrink-0 items-center gap-2">
                      {coach && (
                        <CoachSessionEdit
                          programId={coach.programId}
                          weekNumber={week.weekNumber}
                          day={dayKey}
                          sessionIndex={si}
                          session={s}
                        />
                      )}
                      {!isRace && (
                        <span className="text-xs tabular-nums text-zinc-500">{t.total}m total</span>
                      )}
                      {logging && !isRace && (
                        <SessionLink
                          programId={logging.programId}
                          weekNumber={week.weekNumber}
                          day={dayKey}
                          sessionIndex={si}
                          linked={linkFor(logging, week.weekNumber, dayKey, si)}
                          activities={logging.linkableActivities ?? []}
                          frozen={logging.frozen}
                        />
                      )}
                      {logging && (
                        <LogSession
                          programId={logging.programId}
                          weekNumber={week.weekNumber}
                          day={dayKey}
                          sessionIndex={si}
                          isRace={isRace}
                          existing={log}
                          frozen={logging.frozen}
                          cardData={shareSummary?.cardData}
                        />
                      )}
                      {shareSummary && (
                        <SessionShare
                          summary={shareSummary}
                          activityId={stravaActivityId(
                            linkFor(logging, week.weekNumber, dayKey, si),
                          )}
                          programName={programName}
                          weekNumber={week.weekNumber}
                          stravaWriteEnabled={stravaWriteEnabled}
                        />
                      )}
                    </span>
                  </div>
                  <div className="mt-0.5 text-xs">
                    <SessionDetail session={s} />
                  </div>
                  <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-zinc-500">
                    {sessionPace(s) !== "—" && <span>Pace {sessionPace(s)}</span>}
                    {sessionZoneLabel(s, maxHR, zoneBands) !== "—" && (
                      <span>{sessionZoneLabel(s, maxHR, zoneBands)}</span>
                    )}
                    {!isRace && (
                      <span className="tabular-nums">
                        {t.warmup}/{t.work}/{t.cooldown} warmup·work·cooldown
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
            {logging && (
              <ExtraWorkoutList
                programId={logging.programId}
                extras={extrasForDay(logging.extras ?? [], week.weekNumber, dayKey)}
                frozen={logging.frozen}
              />
            )}
            {logging && !logging.frozen && (
              <AddExtraWorkout
                programId={logging.programId}
                weekNumber={week.weekNumber}
                day={dayKey}
                activities={logging.linkableActivities ?? []}
              />
            )}
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
  athleteName,
  programName,
  stravaWriteEnabled,
  coach,
}: {
  week: ProgramWeek;
  startDate: string;
  maxHR: number;
  zoneBands?: ZoneBands;
  logging?: WeekLogging;
  athleteName?: string;
  programName?: string | null;
  stravaWriteEnabled?: boolean;
  coach?: { programId: string };
}) {
  const colors = PHASE_COLORS[week.phase];
  const byDay = new Map(week.days.map((d) => [d.day, d.sessions]));
  const hasLogs = (logging?.logs.length ?? 0) > 0;
  const actuals = hasLogs && logging ? computeWeekSignals(week, logging.logs) : null;
  const time = weekTimeByCategory(week);
  const weekExtrasLabel = extraSummaryLabel(extrasForWeek(logging?.extras ?? [], week.weekNumber));

  return (
    <section
      id={`week-${week.weekNumber}`}
      className={`scroll-mt-20 rounded-xl border ${colors.border} bg-white`}
    >
      {/* Header + summary */}
      <div className="flex flex-col gap-3 border-b border-zinc-100 p-5">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-lg font-semibold">Week {week.weekNumber}</h2>
          <span className="text-sm text-zinc-500">
            {weekRangeLabel(startDate, week.weekNumber)}
          </span>
          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${colors.chip}`}>
            {PHASE_LABEL[week.phase]}
          </span>
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
                <span className="block text-xs text-emerald-700">
                  Actual: {actuals.actualCardioMinutes} min
                </span>
              )}
            </span>
            <span>
              <span className="block text-xs text-zinc-500">Running mileage</span>
              <span className="font-medium">{week.summary.totalMileage} mi</span>
              {actuals && (
                <span className="block text-xs text-emerald-700">
                  Actual: {actuals.actualMileage} mi
                </span>
              )}
            </span>
            <span>
              <span className="block text-xs text-zinc-500">Strength time</span>
              <span className="font-medium">{time.strength} min</span>
            </span>
            <span>
              <span className="block text-xs text-zinc-500">Total training</span>
              <span className="font-medium">{time.total} min</span>
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

        {/* Off-plan work, reported alongside the prescribed volume rather than folded into it. */}
        {weekExtrasLabel && (
          <p className="text-xs text-zinc-500">
            <span className="rounded-full bg-zinc-100 px-1.5 py-0.5 font-medium text-zinc-600">
              extra
            </span>{" "}
            {weekExtrasLabel} — not counted in the totals above
          </p>
        )}
      </div>

      {/* Mobile: stacked per-day list (no horizontal scroll) */}
      <MobileDayList
        week={week}
        startDate={startDate}
        maxHR={maxHR}
        zoneBands={zoneBands}
        logging={logging}
        athleteName={athleteName}
        programName={programName}
        stravaWriteEnabled={stravaWriteEnabled}
        coach={coach}
      />

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
              const dayExtras = extrasForDay(logging?.extras ?? [], week.weekNumber, dayKey);
              // Extras get their own full-width row under the day's sessions, so the
              // day cell has to span it too.
              const extraRow = logging ? 1 : 0;

              if (sessions.length === 0) {
                return (
                  <tr key={dayKey} className="border-t border-zinc-100">
                    <td className="whitespace-nowrap px-4 py-3 align-top">
                      <span className="font-medium">{DAY_LABEL[dayKey]}</span>
                      <span className="block text-xs text-zinc-400">{dateLabel}</span>
                    </td>
                    <td className="px-3 py-3 align-top text-zinc-400">
                      <span>Rest</span>
                      {logging && (
                        <div className="mt-2 flex flex-col gap-2">
                          <ExtraWorkoutList
                            programId={logging.programId}
                            extras={dayExtras}
                            frozen={logging.frozen}
                          />
                          {!logging.frozen && (
                            <AddExtraWorkout
                              programId={logging.programId}
                              weekNumber={week.weekNumber}
                              day={dayKey}
                              activities={logging.linkableActivities ?? []}
                            />
                          )}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-3 text-zinc-400">—</td>
                    <td className="px-3 py-3 text-zinc-400">—</td>
                    <td className="px-2 py-3 text-right text-zinc-400">—</td>
                    <td className="px-2 py-3 text-right text-zinc-400">—</td>
                    <td className="px-2 py-3 text-right text-zinc-400">—</td>
                    <td className="px-3 py-3 text-right text-zinc-400">—</td>
                    {logging && (
                      <td className="px-3 py-3 text-right text-zinc-400 print:hidden">—</td>
                    )}
                  </tr>
                );
              }

              const sessionRows = sessions.map((s, si) => {
                const t = sessionTiming(s);
                const isRace = s.kind === "race";
                const log = logFor(logging, dayKey, si);
                // Same summary for the Share controls and the post-log nudge.
                const shareSummary = isRace
                  ? null
                  : sessionSummary(s, {
                      athlete: athleteName ?? "",
                      programName,
                      weekNumber: week.weekNumber,
                      dayKey,
                      log,
                    });
                return (
                  <tr
                    key={`${dayKey}-${si}`}
                    className={si === 0 ? "border-t border-zinc-100" : ""}
                  >
                    {si === 0 && (
                      <td
                        rowSpan={sessions.length + extraRow}
                        className="whitespace-nowrap px-4 py-3 align-top"
                      >
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
                      {coach && (
                        <div className="mt-1">
                          <CoachSessionEdit
                            programId={coach.programId}
                            weekNumber={week.weekNumber}
                            day={dayKey}
                            sessionIndex={si}
                            session={s}
                          />
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-3 align-top text-zinc-600">{sessionPace(s)}</td>
                    <td className="whitespace-nowrap px-3 py-3 align-top text-zinc-600">
                      {sessionZoneLabel(s, maxHR, zoneBands)}
                    </td>
                    <td className="px-2 py-3 text-right align-top tabular-nums text-zinc-600">
                      {isRace ? "—" : `${t.warmup}m`}
                    </td>
                    <td className="px-2 py-3 text-right align-top tabular-nums text-zinc-600">
                      {isRace ? "—" : `${t.work}m`}
                    </td>
                    <td className="px-2 py-3 text-right align-top tabular-nums text-zinc-600">
                      {isRace ? "—" : `${t.cooldown}m`}
                    </td>
                    <td className="px-3 py-3 text-right align-top font-medium tabular-nums">
                      {isRace ? "—" : `${t.total}m`}
                    </td>
                    {logging && (
                      <td className="px-3 py-3 text-right align-top print:hidden">
                        <div className="flex flex-col items-end gap-1">
                          <LogSession
                            programId={logging.programId}
                            weekNumber={week.weekNumber}
                            day={dayKey}
                            sessionIndex={si}
                            isRace={isRace}
                            existing={log}
                            frozen={logging.frozen}
                            cardData={shareSummary?.cardData}
                          />
                          {!isRace && (
                            <SessionLink
                              programId={logging.programId}
                              weekNumber={week.weekNumber}
                              day={dayKey}
                              sessionIndex={si}
                              linked={linkFor(logging, week.weekNumber, dayKey, si)}
                              activities={logging.linkableActivities ?? []}
                              frozen={logging.frozen}
                            />
                          )}
                          {shareSummary && (
                            <SessionShare
                              summary={shareSummary}
                              activityId={stravaActivityId(
                                linkFor(logging, week.weekNumber, dayKey, si),
                              )}
                              programName={programName}
                              weekNumber={week.weekNumber}
                              stravaWriteEnabled={stravaWriteEnabled}
                            />
                          )}
                        </div>
                      </td>
                    )}
                  </tr>
                );
              });

              if (!logging) return sessionRows;
              // One row per day for anything the plan didn't ask for, plus the way in.
              return [
                ...sessionRows,
                <tr key={`${dayKey}-extras`}>
                  <td colSpan={8} className="px-3 pb-3 align-top">
                    <div className="flex flex-col gap-2">
                      <ExtraWorkoutList
                        programId={logging.programId}
                        extras={dayExtras}
                        frozen={logging.frozen}
                      />
                      {!logging.frozen && (
                        <AddExtraWorkout
                          programId={logging.programId}
                          weekNumber={week.weekNumber}
                          day={dayKey}
                          activities={logging.linkableActivities ?? []}
                          compact={dayExtras.length === 0}
                        />
                      )}
                    </div>
                  </td>
                </tr>,
              ];
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
