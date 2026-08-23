/**
 * What the athlete ACTUALLY did in a week, split the same way the plan is
 * (Levi, 2026-08-22).
 *
 * The weekly summary table has always shown planned Hybrid / Strength / Total
 * time with nothing beside it, and its one actual column — cardio — went blank
 * far more often than it should. Both failures come from the same place: the
 * table read `log.actuals.durationMin`, and that field is OPTIONAL in the log
 * form. Ticking a session complete without typing minutes is the normal way to
 * log, so the normal way to log produced a dash.
 *
 * ## Completed with no minutes means "as prescribed"
 *
 * That is the whole rule here (Levi's call, 2026-08-22). A typed duration always
 * wins — it is the athlete correcting the estimate. Absent one, a `completed`
 * session contributes what it was PRESCRIBED, and a `partial` contributes half,
 * matching `ADAPT.PARTIAL_CREDIT` so this table and the adaptation engine never
 * disagree about what half a session is worth. `skipped` and unlogged contribute
 * nothing.
 *
 * The alternative — count only typed minutes — is defensible on paper and was
 * rejected for a reason worth writing down: a column that is honest and always
 * empty tells the athlete less than one that is estimated and populated. The
 * estimate is not a guess about the athlete, it is the plan they said they
 * completed.
 *
 * ## Extras count
 *
 * Consistent with the week header's Actual line and with `computeWeekSignals`
 * since `d511e9a`: work the athlete did is work the athlete did, whether or not
 * the engine asked for it. An extra with no duration contributes nothing, the
 * same as everywhere else — there is no honest number to invent.
 *
 * ## TOTAL, not WORK
 *
 * Every figure here is `sessionTiming().total` and `sessionMiles()` — warm-up and
 * cool-down included — because this table sits next to `w.summary`, which is also
 * total. Mixing the two is the oldest bug shape in this repo.
 *
 * PURE — no I/O, no dates.
 */

import type { ExtraWorkout, Session, WorkoutLog } from "@/lib/schemas";
import { sessionMiles, sessionTiming, type WeekTimeBreakdown } from "@/lib/session-volume";
import { ADAPT } from "@/lib/engine/adapt-config";

/** A week's actual training time, in the plan's own categories. */
export interface WeekActualTime extends WeekTimeBreakdown {
  /** Everything except weightlifting — what the "Cardio time" column means. */
  cardioMinutes: number;
  /** On-foot distance, total miles. */
  miles: number;
  /**
   * The same minutes split the way a TRIATHLON reads them, mirroring
   * `weekIronmanTime`: brick segments are pulled apart into their own
   * disciplines, so a brick's run leg lands in `run` rather than in a lump. The
   * flat fields above stay HYROX-shaped, where a brick is simply cardio.
   */
  ironman: { swim: number; bike: number; run: number; lift: number; total: number };
  /**
   * Whether anything counted at all. Distinguishes a real zero (a week logged
   * as entirely skipped) from an empty one (a week not yet logged), so the table
   * can print a dash for the second without pretending the first didn't happen.
   */
  any: boolean;
}

/** Extra-workout kinds whose recorded distance is on-foot mileage. */
const ON_FOOT_EXTRAS: ReadonlySet<ExtraWorkout["kind"]> = new Set(["run", "hybrid"]);

function share(status: WorkoutLog["status"]): number {
  if (status === "completed") return 1;
  if (status === "partial") return ADAPT.PARTIAL_CREDIT;
  return 0;
}

/** Which bucket a planned session's minutes belong to. Mirrors `weekTimeByCategory`. */
function bucketOf(kind: Session["kind"]): keyof WeekTimeBreakdown | null {
  switch (kind) {
    case "hybrid":
      return "hybrid";
    case "lift":
      return "strength";
    case "run":
      return "running";
    case "cardio":
    case "swim":
    case "bike":
    case "brick":
      return "nonRunningCardio";
    default:
      return null; // race days are the event, not training
  }
}

function bucketOfExtra(kind: ExtraWorkout["kind"]): keyof WeekTimeBreakdown {
  if (kind === "lift") return "strength";
  if (kind === "hybrid") return "hybrid";
  if (kind === "run") return "running";
  return "nonRunningCardio"; // cardio + other
}

/**
 * Add one logged session's minutes to the triathlon split.
 *
 * A BRICK is the only session that belongs to more than one discipline, so its
 * minutes are divided in the ratio the plan prescribed. That ratio is the only
 * information anyone has: the athlete logs one duration for the whole brick, and
 * asking them to split it would be asking for a number they did not measure.
 */
function addIronman(
  tri: { swim: number; bike: number; run: number; lift: number; total: number },
  session: Session,
  minutes: number,
): void {
  if (session.kind === "swim") tri.swim += minutes;
  else if (session.kind === "bike") tri.bike += minutes;
  else if (session.kind === "run") tri.run += minutes;
  else if (session.kind === "lift") tri.lift += minutes;
  else if (session.kind === "brick") {
    const planned = session.segments.reduce((n, seg) => n + seg.durationMin, 0);
    if (planned <= 0) return;
    for (const seg of session.segments) {
      const part = minutes * (seg.durationMin / planned);
      if (seg.discipline === "bike") tri.bike += part;
      else if (seg.discipline === "run") tri.run += part;
      else if (seg.discipline === "swim") tri.swim += part;
    }
  }
}

export function weekActualTimeByCategory(
  week: { days: { day: WorkoutLog["day"]; sessions: Session[] }[] },
  logs: readonly WorkoutLog[],
  extras: readonly ExtraWorkout[] = [],
): WeekActualTime {
  const acc = { hybrid: 0, strength: 0, running: 0, nonRunningCardio: 0, total: 0 };
  const tri = { swim: 0, bike: 0, run: 0, lift: 0, total: 0 };
  let miles = 0;
  let any = false;

  const byDay = new Map<WorkoutLog["day"], Session[]>();
  for (const d of week.days) byDay.set(d.day, d.sessions);

  for (const log of logs) {
    const session = byDay.get(log.day)?.[log.sessionIndex];
    if (!session) continue; // a log left behind by a regenerated week
    const bucket = bucketOf(session.kind);
    if (!bucket) continue;
    const f = share(log.status);
    if (f > 0) any = true;

    // A typed duration is the athlete correcting the estimate, so it wins whole
    // — it is not scaled by `f`, because someone reporting 30 minutes on a
    // partial session means thirty minutes.
    const minutes = log.actuals?.durationMin ?? sessionTiming(session).total * f;
    acc[bucket] += minutes;
    addIronman(tri, session, minutes);

    if (session.kind === "run" || session.kind === "hybrid") {
      miles += log.actuals?.distanceMiles ?? sessionMiles(session) * f;
    }
  }

  for (const x of extras) {
    any = true;
    const m = x.durationMin ?? 0;
    acc[bucketOfExtra(x.kind)] += m;
    // An extra has no segments to take apart, so the triathlon split takes it
    // whole: a lift is lift time, anything else on foot is run time, and the
    // rest is bike time — the closest honest home for "I did 40 minutes of
    // something aerobic" in a swim/bike/run table.
    if (x.kind === "lift") tri.lift += m;
    else if (x.kind === "run" || x.kind === "hybrid") tri.run += m;
    else tri.bike += m;
    if (ON_FOOT_EXTRAS.has(x.kind)) miles += x.distanceMiles ?? 0;
  }

  const round = (n: number) => Math.round(n);
  const out: WeekActualTime = {
    hybrid: round(acc.hybrid),
    strength: round(acc.strength),
    running: round(acc.running),
    nonRunningCardio: round(acc.nonRunningCardio),
    total: 0,
    cardioMinutes: 0,
    ironman: {
      swim: Math.round(tri.swim),
      bike: Math.round(tri.bike),
      run: Math.round(tri.run),
      lift: Math.round(tri.lift),
      total: 0,
    },
    miles: Math.round(miles * 10) / 10,
    any,
  };
  out.ironman.total = out.ironman.swim + out.ironman.bike + out.ironman.run + out.ironman.lift;
  out.total = out.hybrid + out.strength + out.running + out.nonRunningCardio;
  // Weightlifting is excluded from cardio time (spec) — the same exclusion
  // `weekCardioMinutes` makes on the planned side.
  out.cardioMinutes = out.hybrid + out.running + out.nonRunningCardio;
  return out;
}

/** Extras keyed by week, the shape the summary table wants. */
export function groupExtrasByWeek(extras: readonly ExtraWorkout[]): Map<number, ExtraWorkout[]> {
  const m = new Map<number, ExtraWorkout[]>();
  for (const x of extras) {
    const list = m.get(x.weekNumber) ?? [];
    list.push(x);
    m.set(x.weekNumber, list);
  }
  return m;
}
