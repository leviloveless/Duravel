import type { ExtraWorkout, ProgramWeek, WorkoutLog } from "@/lib/schemas";
import { sessionTiming } from "@/lib/session-volume";

/**
 * Fitness, Fatigue and Form (2026-09-13) — Duravel's answer to the chart every
 * endurance athlete already knows from TrainingPeaks.
 *
 * The shape is the standard one and deliberately so: two exponentially-weighted
 * moving averages of daily training load over different windows, and their
 * difference.
 *
 *   Fitness  — 42-day EWMA. Slow. What you have built.
 *   Fatigue  —  7-day EWMA. Fast. What you are carrying right now.
 *   Form     — Fitness minus Fatigue, read on the MORNING of the day (i.e. from
 *              yesterday's values), which is the convention: your form today is
 *              the product of training up to last night, not of the session you
 *              have not done yet.
 *
 * ⚠️ WHERE THIS DIFFERS, AND WHY IT HAS TO. TrainingPeaks runs on TSS, which is
 * defined against a threshold power or pace. Duravel has neither for a sled push
 * or a set of wall balls, and inventing a TSS for them would be a number with a
 * familiar name and no meaning. So the daily load here is
 * MINUTES × an intensity weight taken from the session's own goal zone — the
 * same session-RPE family the adaptation engine already uses (`lib/engine/load.ts`),
 * expressed per day instead of per week.
 *
 * That makes the UNITS Duravel's own. A Duravel Fitness of 60 is not a
 * TrainingPeaks CTL of 60 and the UI must never imply it is. What transfers is
 * the SHAPE — rising, flat, falling, and the freshness swing into a race — which
 * is the part an athlete actually reads.
 *
 * Only LOGGED work counts. A planned session that did not happen built no
 * fitness, and a chart that counted intentions would flatter exactly the athlete
 * who most needs to see the truth.
 */

/** Intensity weight per goal zone. Zone 2 is the unit; zone 5 costs ~2.4× a minute of it. */
const ZONE_WEIGHT: Record<number, number> = {
  1: 0.55,
  2: 1.0,
  3: 1.45,
  4: 1.9,
  5: 2.4,
};

/** A lift has no goal zone; it is weighted as moderate work rather than dropped. */
const LIFT_WEIGHT = 1.3;

/** Time constants, in days. The pair that makes the two curves mean what they mean. */
export const FITNESS_DAYS = 42;
export const FATIGUE_DAYS = 7;

export interface DayPoint {
  /** "YYYY-MM-DD" */
  date: string;
  /** Duravel load units for the day (0 on a rest or unlogged day). */
  load: number;
  fitness: number;
  fatigue: number;
  /** Fitness − Fatigue as of the MORNING: yesterday's curves, not today's. */
  form: number;
}

/** The load one session contributes, if it was actually done. */
export function sessionLoad(
  session: {
    kind: string;
    goalZone?: number;
  },
  status: WorkoutLog["status"],
): number {
  if (status === "skipped") return 0;
  const minutes = sessionTiming(session as never).total;
  const weight =
    session.kind === "lift"
      ? LIFT_WEIGHT
      : (ZONE_WEIGHT[Math.min(5, Math.max(1, Math.round(session.goalZone ?? 2)))] ?? 1);
  // A partial session counts half, matching how the hours chart treats it — two
  // surfaces disagreeing about what "half done" means is worse than either rule.
  const completion = status === "partial" ? 0.5 : 1;
  return minutes * weight * completion;
}

/** Add days to a "YYYY-MM-DD" date, staying in UTC so no zone shifts the day. */
export function addDays(iso: string, n: number): string {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  const t = new Date(Date.UTC(y, m - 1, d));
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
}

/** Whole days between two "YYYY-MM-DD" dates (b − a). */
export function daysBetween(a: string, b: string): number {
  const [ay, am, ad] = a.split("-").map(Number) as [number, number, number];
  const [by, bm, bd] = b.split("-").map(Number) as [number, number, number];
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000);
}

/**
 * Daily load from a program's logged sessions and extras.
 *
 * `weekStartISO(n)` must return the Monday of program week n — passed in rather
 * than computed here so this file stays pure and the caller keeps using the same
 * `weekStartDate` the rest of the app does.
 */
export function dailyLoad(
  weeks: readonly ProgramWeek[],
  logs: readonly WorkoutLog[],
  extras: readonly ExtraWorkout[],
  weekStartISO: (weekNumber: number) => string,
): Map<string, number> {
  const DAY_INDEX: Record<string, number> = {
    mon: 0,
    tue: 1,
    wed: 2,
    thu: 3,
    fri: 4,
    sat: 5,
    sun: 6,
  };
  const out = new Map<string, number>();
  const add = (date: string, load: number) => {
    if (load > 0) out.set(date, (out.get(date) ?? 0) + load);
  };

  for (const week of weeks) {
    const start = weekStartISO(week.weekNumber);
    for (const day of week.days) {
      const offset = DAY_INDEX[day.day];
      if (offset === undefined) continue;
      const date = addDays(start, offset);
      day.sessions.forEach((s, i) => {
        const log = logs.find(
          (l) => l.weekNumber === week.weekNumber && l.day === day.day && l.sessionIndex === i,
        );
        if (!log) return;
        add(date, sessionLoad(s as never, log.status));
      });
    }
  }

  // Extras have a duration but no goal zone of their own in every case; weight
  // them at their stated zone when they carry one, else as easy aerobic work.
  for (const e of extras) {
    const start = weekStartISO(e.weekNumber);
    const offset = DAY_INDEX[e.day];
    if (offset === undefined) continue;
    const minutes = e.durationMin ?? 0;
    const weight = ZONE_WEIGHT[Math.min(5, Math.max(1, Math.round(e.goalZone ?? 2)))] ?? 1;
    add(addDays(start, offset), minutes * weight);
  }

  return out;
}

/**
 * Walk the load series day by day and produce the three curves.
 *
 * Every calendar day between `from` and `to` gets a point, including rest days —
 * that is the whole mechanism. Fitness and fatigue DECAY on a day off, and a
 * chart that only plotted training days would hide the taper, which is the one
 * stretch an athlete stares at hardest.
 */
export function fitnessSeries(
  load: ReadonlyMap<string, number>,
  from: string,
  to: string,
  seed: { fitness: number; fatigue: number } = { fitness: 0, fatigue: 0 },
): DayPoint[] {
  const days = daysBetween(from, to);
  if (days < 0) return [];

  const kFitness = 1 - Math.exp(-1 / FITNESS_DAYS);
  const kFatigue = 1 - Math.exp(-1 / FATIGUE_DAYS);

  let fitness = seed.fitness;
  let fatigue = seed.fatigue;
  const out: DayPoint[] = [];

  for (let i = 0; i <= days; i++) {
    const date = addDays(from, i);
    // Form is read BEFORE today's load is applied — it is a morning number.
    const form = fitness - fatigue;
    const today = load.get(date) ?? 0;
    fitness = fitness + (today - fitness) * kFitness;
    fatigue = fatigue + (today - fatigue) * kFatigue;
    out.push({
      date,
      load: Math.round(today),
      fitness: Math.round(fitness * 10) / 10,
      fatigue: Math.round(fatigue * 10) / 10,
      form: Math.round(form * 10) / 10,
    });
  }
  return out;
}

export type FormState = "fresh" | "neutral" | "productive" | "overreaching";

/**
 * What a form number means, in words.
 *
 * The bands are expressed as a FRACTION OF FITNESS rather than as absolute
 * numbers, because Duravel's load units are its own: −20 form means something
 * very different to an athlete carrying 90 fitness than to one carrying 25, and
 * a fixed threshold would cry wolf at every beginner.
 */
export function formState(point: { fitness: number; form: number }): FormState {
  const base = Math.max(point.fitness, 1);
  const ratio = point.form / base;
  if (ratio > 0.05) return "fresh";
  if (ratio > -0.1) return "neutral";
  if (ratio > -0.3) return "productive";
  return "overreaching";
}

export const FORM_LABEL: Record<FormState, string> = {
  fresh: "Fresh",
  neutral: "Neutral",
  productive: "Productive",
  overreaching: "Overreaching",
};

export const FORM_BLURB: Record<FormState, string> = {
  fresh:
    "Rested and ready. Where you want to be on race week — and a sign you are undertraining if you sit here for weeks.",
  neutral: "Balanced. Fitness is holding and fatigue is under control.",
  productive:
    "Carrying real fatigue while fitness climbs. This is what a build block is supposed to feel like.",
  overreaching:
    "Fatigue is running well ahead of fitness. Sustainable for a week, not for a block — expect the engine to pull volume back.",
};
