/**
 * Extra (unplanned) workouts — selection + reporting helpers.
 *
 * The engine owns the week's PRESCRIBED volume, and `reconcileWeekVolume`
 * guarantees the weekly summary equals it exactly. Extra work the athlete did
 * off-plan is therefore reported ALONGSIDE that summary rather than folded into
 * it: the header still answers "what was I asked to do", and the extras line
 * answers "what else did I do".
 *
 * What extras DO feed is the other half of the picture — what actually happened.
 * Since 2026-08-18 they reach the adaptation through `computeWeekSignals`
 * (compliance, strain, session-RPE load, actual volume); see the note on
 * `extraActualContribution` below and the header of `lib/engine/adapt.ts`.
 *
 * Pure functions only — no I/O — so the arithmetic behind those numbers is
 * testable.
 */

import { ExtraWorkoutSchema, type ExtraWorkout, type ExtraWorkoutKindName } from "@/lib/schemas";

/** The snake_case shape Postgres hands back; `numeric` arrives as a string. */
export interface ExtraWorkoutRowLike {
  id: string;
  week_number: number;
  day: string;
  kind: string;
  title?: string | null;
  duration_min?: number | null;
  distance_miles?: number | string | null;
  avg_hr?: number | null;
  goal_zone?: number | null;
  rpe?: number | null;
  note?: string | null;
  activity_id?: string | null;
  strava_activity_id?: string | null;
}

function numOrUndefined(v: number | string | null | undefined): number | undefined {
  if (v === null || v === undefined || v === "") return undefined;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Map stored rows onto the app-side shape, dropping anything that no longer
 * validates. A row that fails is a row we can't render honestly — better to
 * omit it than to show a half-workout.
 */
export function extrasFromRows(rows: readonly ExtraWorkoutRowLike[]): ExtraWorkout[] {
  const out: ExtraWorkout[] = [];
  for (const r of rows) {
    const parsed = ExtraWorkoutSchema.safeParse({
      id: r.id,
      weekNumber: r.week_number,
      day: r.day,
      kind: r.kind,
      title: r.title ?? undefined,
      durationMin: numOrUndefined(r.duration_min),
      distanceMiles: numOrUndefined(r.distance_miles),
      avgHr: numOrUndefined(r.avg_hr),
      goalZone: numOrUndefined(r.goal_zone),
      rpe: numOrUndefined(r.rpe),
      note: r.note ?? undefined,
      activityId: r.activity_id ?? undefined,
      stravaActivityId: r.strava_activity_id ?? undefined,
    });
    if (parsed.success) out.push(parsed.data);
  }
  return out;
}

export interface ExtraTotals {
  count: number;
  /** Total minutes across extras that recorded a duration. */
  minutes: number;
  /** Total running/riding distance across extras that recorded one, in miles. */
  miles: number;
}

export const EMPTY_EXTRA_TOTALS: ExtraTotals = { count: 0, minutes: 0, miles: 0 };

/** Extras belonging to one program week. */
export function extrasForWeek(extras: ExtraWorkout[], weekNumber: number): ExtraWorkout[] {
  return extras.filter((x) => x.weekNumber === weekNumber);
}

/** Extras on one day of one week, in the order they were added. */
export function extrasForDay(
  extras: ExtraWorkout[],
  weekNumber: number,
  day: string,
): ExtraWorkout[] {
  return extras.filter((x) => x.weekNumber === weekNumber && x.day === day);
}

/**
 * Roll a set of extras up for display. Duration and distance are optional per
 * workout (an athlete may log "did a class, no idea how far"), so each is summed
 * only over the entries that recorded it — `count` still counts them all.
 */
export function extraTotals(extras: ExtraWorkout[]): ExtraTotals {
  let minutes = 0;
  let miles = 0;
  for (const x of extras) {
    minutes += x.durationMin ?? 0;
    miles += x.distanceMiles ?? 0;
  }
  return { count: extras.length, minutes, miles: Math.round(miles * 10) / 10 };
}

const KIND_LABEL: Record<ExtraWorkoutKindName, string> = {
  run: "Run",
  lift: "Strength",
  hybrid: "Hybrid",
  cardio: "Cardio",
  other: "Workout",
};

/** Display name for one extra: the athlete's own title, else the kind. */
export function extraTitle(x: ExtraWorkout): string {
  const title = x.title?.trim();
  return title && title.length > 0 ? title : KIND_LABEL[x.kind];
}

/** "45 min · 4.2 mi · RPE 6" — omits whatever wasn't recorded. */
export function extraDetail(x: ExtraWorkout): string {
  const parts: string[] = [];
  if (x.durationMin) parts.push(`${x.durationMin} min`);
  if (x.distanceMiles) parts.push(`${x.distanceMiles} mi`);
  if (x.avgHr) parts.push(`${x.avgHr} bpm`);
  if (x.rpe) parts.push(`RPE ${x.rpe}`);
  return parts.join(" · ");
}

/** "2 extra workouts · 75 min · 6.1 mi" for the week header; "" when none. */
export function extraSummaryLabel(extras: ExtraWorkout[]): string {
  const t = extraTotals(extras);
  if (t.count === 0) return "";
  const parts = [`${t.count} extra workout${t.count === 1 ? "" : "s"}`];
  if (t.minutes > 0) parts.push(`${t.minutes} min`);
  if (t.miles > 0) parts.push(`${t.miles} mi`);
  return parts.join(" · ");
}

/**
 * What extras contribute to a week's ACTUAL volume.
 *
 * Called from `computeWeekSignals`, so this is the arithmetic behind both the
 * week header's Actual line and the volume the adaptation reasons about — one
 * function, so the screen and the engine can't drift apart.
 *
 * ## History (worth keeping, because the scope changed twice)
 *
 * Extras were first reported only alongside the summary ("1 extra workout ·
 * 35 min — not counted in the totals above"), so a week of real unplanned work
 * read as under-delivered. On 2026-08-13 they were folded into the displayed
 * Actual figures and nothing else — deliberately kept out of compliance and the
 * adaptation so self-added work could not inflate next week's prescription.
 *
 * On 2026-08-18 Levi reversed that: extras now feed compliance, strain and
 * session-RPE load as well. The 08-13 worry was real but one-sided — it guarded
 * the CREDIT rules while leaving the LOAD rules (ACWR, monotony, early deload)
 * blind to work that genuinely happened, which is the direction that hurts.
 * Compliance is clamped at 100% and the key-session rules stay planned-only; see
 * `lib/engine/adapt.ts`.
 *
 * PLANNED totals remain untouched in every version of this story: the athlete
 * adding a run does not change what the engine asked them to do.
 *
 * ## Two exclusions that a naive sum gets wrong
 *
 * **Lifts contribute no cardio minutes.** `computeWeekSignals` already skips
 * lifts when accumulating actual cardio (`if (session.kind !== "lift")`), and an
 * extra has to obey the same rule or the two numbers mean different things.
 *
 * **Only on-foot kinds contribute MILES.** The weekly line is *running*
 * mileage. `extraTotals` sums `distanceMiles` across every kind, so a 20-mile
 * bike ride logged as `cardio` would land in it — a wrong number that looks
 * exactly like a right one. Only `run` and `hybrid` count here, matching
 * `sessionMiles`, which counts runs plus the run legs inside hybrids.
 */
export interface ExtraActualContribution {
  /** Minutes to add to the week's actual CARDIO time (excludes lifts). */
  cardioMinutes: number;
  /** Miles to add to the week's actual RUNNING mileage (run + hybrid only). */
  miles: number;
}

/** Kinds whose recorded distance is on-foot mileage. */
const ON_FOOT_KINDS: ReadonlySet<ExtraWorkoutKindName> = new Set(["run", "hybrid"]);

export function extraActualContribution(extras: readonly ExtraWorkout[]): ExtraActualContribution {
  let cardioMinutes = 0;
  let miles = 0;
  for (const x of extras) {
    if (x.kind !== "lift") cardioMinutes += x.durationMin ?? 0;
    if (ON_FOOT_KINDS.has(x.kind)) miles += x.distanceMiles ?? 0;
  }
  return { cardioMinutes: Math.round(cardioMinutes), miles: Math.round(miles * 10) / 10 };
}

/** The week's actual figures — as `computeWeekSignals` reports them, extras
 *  already included. */
export interface WeekActualSignals {
  actualCardioMinutes: number;
  actualMileage: number;
}

/** What the week header should print on its Actual line — `null` = print nothing. */
export interface ActualLine {
  cardioMinutes: number | null;
  miles: number | null;
}

/**
 * What the week header prints on its Actual line.
 *
 * The arithmetic already happened — `signals` comes from `computeWeekSignals`
 * with the week's extras passed in. All that is left is deciding when a metric
 * has nothing to say and should print nothing at all rather than a zero.
 *
 * `hasPlannedLogs` is that decision. A metric prints when at least one PLANNED
 * session was logged (so the zero is a real, measured zero) or when the extras
 * themselves contributed to it. What that rules out is the lift-only week:
 * an athlete whose entire week was one unplanned lift should not be told they
 * ran "0 mi", as though they had gone out and covered no ground.
 *
 * Both metrics used to gate on `signals` alone, which was null until a planned
 * session was logged — so the week this feature exists for (skipped the plan,
 * rode for an hour instead) showed no Actual at all, underneath a caption
 * reading "counted in Actual". The number the caption promised was not on the
 * page. Hence the split gate.
 */
export function weekActualLine(
  signals: WeekActualSignals | null,
  extras: readonly ExtraWorkout[],
  hasPlannedLogs: boolean,
): ActualLine {
  if (!signals) return { cardioMinutes: null, miles: null };
  const extra = extraActualContribution(extras);
  return {
    cardioMinutes:
      hasPlannedLogs || extra.cardioMinutes > 0 ? Math.round(signals.actualCardioMinutes) : null,
    miles: hasPlannedLogs || extra.miles > 0 ? Math.round(signals.actualMileage * 10) / 10 : null,
  };
}
