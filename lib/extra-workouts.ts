/**
 * Extra (unplanned) workouts — selection + reporting helpers.
 *
 * The engine owns the week's prescribed volume, and `reconcileWeekVolume`
 * guarantees the weekly summary equals it exactly. Extra work the athlete did
 * off-plan is therefore reported ALONGSIDE that summary rather than folded into
 * it: the header still answers "what was I asked to do", and the extras line
 * answers "what else did I do".
 *
 * Pure functions only — no I/O — so the arithmetic behind that line is testable.
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
export function extrasForDay(extras: ExtraWorkout[], weekNumber: number, day: string): ExtraWorkout[] {
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
