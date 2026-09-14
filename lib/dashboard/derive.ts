import type { ExtraWorkout, ProgramWeek, Session, WorkoutLog } from "@/lib/schemas";
import { sessionTiming } from "@/lib/session-volume";
import { parseTimeToSeconds } from "@/lib/engine/paces";
import {
  HYROX_EVENT_KEYS,
  HYROX_EVENT_LABEL,
  eventBand,
  type HyroxEventKey,
} from "@/lib/engine/hyrox-standards";
import { TARGET_ZONE_DISTRIBUTION, type Zone } from "@/lib/zones";

/**
 * Everything the dashboard shows, derived here as pure functions (2026-09-13).
 *
 * They are pure so they can be tested without a database, and they are in one
 * file so the dashboard cannot quietly grow a second opinion about a number the
 * program page already shows.
 *
 * ⚠️ WORK vs TOTAL. Every duration below goes through `sessionTiming(s).total`,
 * never `session.durationMin`. On a run the latter is the MAIN SET ONLY — it
 * excludes warm-up, cool-down and between-rep recovery — and using it is the
 * single most repeated bug in this repo (eleven occurrences and counting). A
 * dashboard that reports "6.4 of 9.8 hours" from work minutes would understate
 * every athlete's week by roughly a third and look plausible doing it.
 */

const MIN_PER_HOUR = 60;

// ─── weekly planned vs completed ────────────────────────────────────────────

export interface WeekHours {
  weekNumber: number;
  plannedMin: number;
  /** Null for a week that has not happened yet — NOT zero, which would draw a bar. */
  completedMin: number | null;
}

function weekPlannedMinutes(week: ProgramWeek): number {
  let total = 0;
  for (const day of week.days) for (const s of day.sessions) total += sessionTiming(s).total;
  return total;
}

/**
 * How much of each week actually happened.
 *
 * A partial session counts HALF. That is a judgement call and worth stating: the
 * alternative — counting a partial as complete — would let a week of half-done
 * sessions report as a perfect week, and counting it as zero would tell an
 * athlete who did 40 minutes of a 60-minute run that they did nothing. Half is
 * wrong in both directions by the smallest amount.
 *
 * Off-plan extras count too, because they count everywhere else in the app
 * (compliance, strain, ACWR since 2026-08-18) and a dashboard that disagreed
 * with the program page it links to would be the bug, not the feature.
 */
export function weeklyHours(
  weeks: readonly ProgramWeek[],
  logs: readonly WorkoutLog[],
  extras: readonly ExtraWorkout[],
  elapsedWeeks: number,
): WeekHours[] {
  return weeks.map((week) => {
    const plannedMin = weekPlannedMinutes(week);
    if (week.weekNumber > elapsedWeeks) {
      return { weekNumber: week.weekNumber, plannedMin, completedMin: null };
    }

    let done = 0;
    week.days.forEach((day) => {
      day.sessions.forEach((s, i) => {
        const log = logs.find(
          (l) => l.weekNumber === week.weekNumber && l.day === day.day && l.sessionIndex === i,
        );
        if (!log) return;
        const minutes = sessionTiming(s).total;
        if (log.status === "completed") done += minutes;
        else if (log.status === "partial") done += minutes / 2;
      });
    });

    for (const e of extras) {
      if (e.weekNumber === week.weekNumber) done += e.durationMin ?? 0;
    }

    return { weekNumber: week.weekNumber, plannedMin, completedMin: Math.round(done) };
  });
}

export const asHours = (min: number): number => Math.round((min / MIN_PER_HOUR) * 10) / 10;

// ─── intensity distribution ─────────────────────────────────────────────────

export interface ZoneSlice {
  zone: Zone;
  /** Whole percent of cardio minutes spent in this zone, summing to 100. */
  actual: number;
  target: number;
}

/** Sessions that carry a trainable zone. A lift has no meaningful goal zone. */
function sessionZoneMinutes(s: Session): { zone: Zone; minutes: number } | null {
  if (!("goalZone" in s) || typeof s.goalZone !== "number") return null;
  const zone = Math.min(5, Math.max(1, Math.round(s.goalZone))) as Zone;
  return { zone, minutes: sessionTiming(s).total };
}

/**
 * Where the athlete's cardio minutes actually sit, against the engine's target
 * of 20/60/10/5/5.
 *
 * Computed from the SESSIONS, not from `week.summary.zoneDistribution`. The
 * stored summary is a snapshot written at generation, and this repo has already
 * learned once that two surfaces reading different sources will eventually
 * disagree in front of an athlete.
 *
 * Percentages are largest-remainder rounded so they sum to exactly 100 — five
 * independently rounded numbers reaching 99 or 101 is the kind of detail that
 * makes a chart look broken for no real reason.
 */
export function zoneMix(weeks: readonly ProgramWeek[]): ZoneSlice[] {
  const minutes: Record<Zone, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  for (const w of weeks) {
    for (const d of w.days) {
      for (const s of d.sessions) {
        const z = sessionZoneMinutes(s);
        if (z) minutes[z.zone] += z.minutes;
      }
    }
  }

  const zones: Zone[] = [1, 2, 3, 4, 5];
  const total = zones.reduce((sum, z) => sum + minutes[z], 0);
  if (total === 0) {
    return zones.map((zone) => ({ zone, actual: 0, target: TARGET_ZONE_DISTRIBUTION[zone] }));
  }

  const exact = zones.map((z) => ({ zone: z, value: (minutes[z] / total) * 100 }));
  const floored = exact.map((e) => ({ ...e, floor: Math.floor(e.value) }));
  let remainder = 100 - floored.reduce((s, f) => s + f.floor, 0);
  const byFraction = [...floored].sort(
    (a, b) => b.value - b.floor - (a.value - a.floor) || a.zone - b.zone,
  );
  const bump = new Set<Zone>();
  for (const f of byFraction) {
    if (remainder <= 0) break;
    bump.add(f.zone);
    remainder -= 1;
  }

  return zones.map((zone) => ({
    zone,
    actual: (floored.find((f) => f.zone === zone)?.floor ?? 0) + (bump.has(zone) ? 1 : 0),
    target: TARGET_ZONE_DISTRIBUTION[zone],
  }));
}

// ─── HYROX station bands ────────────────────────────────────────────────────

export interface StationBand {
  key: HyroxEventKey;
  label: string;
  seconds: number;
  /** 0 = at the novice ceiling, 1 = at the elite floor. Clamped to [0, 1]. */
  position: number;
  /** Same scale, for the athlete's goal split — null when there is no goal. */
  goalPosition: number | null;
  /** True for the three weakest stations relative to their own band. */
  focus: boolean;
}

/**
 * Place each station split inside its own public reference band.
 *
 * This is the dashboard's whole reason to exist. An athlete knows their wall-ball
 * time; what they cannot know is that 6:45 is mid-pack while their 1:58 farmers
 * carry is nearly elite — and therefore which station is actually costing them
 * the race. Positions are normalised against the SAME F/C table the projection
 * model uses, so the dashboard and the projection cannot tell different stories.
 *
 * `focus` marks the three weakest by position, not by raw time: the slowest
 * station in seconds is almost always the run, which tells nobody anything.
 */
export function stationBands(
  benchmarks: Record<string, unknown> | null | undefined,
  opts: { sex?: string; division?: string; age?: number; goalFinishSeconds?: number | null },
): StationBand[] {
  const marks = benchmarks ?? {};

  const rows: StationBand[] = [];
  for (const key of HYROX_EVENT_KEYS) {
    const raw = marks[key];
    if (typeof raw !== "string") continue;
    const seconds = parseTimeToSeconds(raw);
    if (seconds == null || seconds <= 0) continue;

    const band = eventBand(key, opts.sex, opts.division, opts.age);
    const span = band.C - band.F;
    if (span <= 0) continue;

    rows.push({
      key,
      label: HYROX_EVENT_LABEL[key],
      seconds,
      position: clamp01((band.C - seconds) / span),
      goalPosition: null,
      focus: false,
    });
  }

  // The three weakest relative to their own band get the flag — but ONLY the
  // ones that are actually below this athlete's own average position. Taking
  // the bottom three unconditionally meant an athlete with three benchmarks had
  // all three flagged as weaknesses, and an evenly-developed athlete was told to
  // focus on stations that were not weak. "Worst three" is only advice when
  // there is something worse than average to point at.
  const mean = rows.reduce((sum, r) => sum + r.position, 0) / (rows.length || 1);
  const weakest = new Set(
    [...rows]
      .filter((r) => r.position < mean)
      .sort((a, b) => a.position - b.position)
      .slice(0, 3)
      .map((r) => r.key),
  );
  for (const r of rows) r.focus = weakest.has(r.key);

  // A goal finish implies a goal split for every station: hold each one's share
  // of the current total. Crude on purpose — it is a reference marker, not a
  // prescription, and pretending to know which station SHOULD carry the gain
  // would be a stronger claim than the data supports.
  const goal = opts.goalFinishSeconds ?? null;
  if (goal && rows.length) {
    const current = rows.reduce((s, r) => s + r.seconds, 0);
    if (current > 0 && goal < current) {
      const scale = goal / current;
      for (const r of rows) {
        const band = eventBand(r.key, opts.sex, opts.division, opts.age);
        const span = band.C - band.F;
        if (span > 0) r.goalPosition = clamp01((band.C - r.seconds * scale) / span);
      }
    }
  }

  return rows;
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

/** "1:17:10" / "77:10" / "4630" all become seconds; anything else null. */
export function goalSeconds(goalFinishTime: string | null | undefined): number | null {
  if (!goalFinishTime) return null;
  return parseTimeToSeconds(goalFinishTime);
}

/** mm:ss, or h:mm:ss past an hour. Used for every split the dashboard prints. */
export function formatSplit(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const two = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${two(m)}:${two(sec)}` : `${m}:${two(sec)}`;
}

// ─── race countdown ─────────────────────────────────────────────────────────

export interface Countdown {
  days: number;
  weeks: number;
  spareDays: number;
}

/**
 * Whole days from `from` to `raceISO`, both taken as calendar dates.
 *
 * Compared in UTC on purpose. A countdown is a DATE difference, and running it
 * through local time is how "76 days" becomes "75 days" for anyone west of UTC
 * after 5pm — the same class of hydration mismatch `formatInstant` exists to
 * prevent elsewhere in this app.
 */
export function countdown(raceISO: string, from: Date = new Date()): Countdown | null {
  const [y, m, d] = raceISO.split("-").map(Number);
  if (!y || !m || !d) return null;
  const race = Date.UTC(y, m - 1, d);
  const today = Date.UTC(from.getFullYear(), from.getMonth(), from.getDate());
  const days = Math.round((race - today) / 86_400_000);
  if (days < 0) return null;
  return { days, weeks: Math.floor(days / 7), spareDays: days % 7 };
}
