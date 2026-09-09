/**
 * Starting weeks for the three goals Levi named (custom tier, 2026-09-08):
 * aerobic base, aerobic capacity, lactate threshold.
 *
 * ## Why presets and not a blank grid
 *
 * A blank seven-day grid is the worst thing to hand someone who has just paid
 * for the ability to design their own week. It is not that they cannot fill it —
 * it is that the first week they fill in is the one they will keep, and most
 * athletes' instinct is to put the hard days where the free time is. These give
 * them a correct week to react to instead of a blank one to invent, which is a
 * much easier problem and a much better outcome.
 *
 * ## The invariant worth keeping
 *
 * **A preset must not raise a warning against itself.** `validateTemplate` is
 * the same code path the designer runs live, so a preset that trips its own
 * rules would open the feature by telling the athlete their week is wrong before
 * they have touched it. The layout below is built to satisfy those rules — hard
 * days separated, one long run, one rest day, no leg lift the day before a key
 * run — and there is a test that asserts exactly that.
 *
 * ## What the goals actually change
 *
 * Only the quality dose and its type. Every goal gets the same long run (the
 * aerobic anchor is not optional) and the same easy fill (which is where the
 * adaptation is). Volume is never in here — it is the engine's, always.
 *
 * PURE — no I/O.
 */

import type { RunType, TemplateSession, TrainingDayName, WeekTemplate } from "./types";
import { runsForMileage } from "./slots";

export type TemplateGoal = "aerobic_base" | "aerobic_capacity" | "lactate_threshold";

export const TEMPLATE_GOALS: {
  id: TemplateGoal;
  label: string;
  blurb: string;
}[] = [
  {
    id: "aerobic_base",
    label: "Aerobic base",
    blurb:
      "Frequency first. One quality session, everything else easy — the widest, cheapest adaptation there is, and the foundation the other two are spent from.",
  },
  {
    id: "aerobic_capacity",
    label: "Aerobic capacity",
    blurb:
      "Two hard sessions a week, interval-biased. Raises the ceiling; costs more recovery, so the easy days have to stay genuinely easy.",
  },
  {
    id: "lactate_threshold",
    label: "Lactate threshold",
    blurb:
      "Two hard sessions a week at threshold and tempo. Raises the pace you can hold for an hour, which is the one that decides a HYROX result.",
  },
];

/** The quality run types each goal reaches for, hardest session first. */
const GOAL_QUALITY: Record<TemplateGoal, RunType[]> = {
  aerobic_base: ["fartlek"],
  aerobic_capacity: ["interval", "tempo"],
  lactate_threshold: ["threshold", "tempo"],
};

const DAY_ORDER: TrainingDayName[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

export interface PresetOptions {
  /** Days the athlete committed to. Fewer than 3 returns an empty week. */
  trainingDays: TrainingDayName[];
  /** Does the sport have station work to place? HYROX and DEKA do. */
  includeHybrid?: boolean;
  /** How many lifts to place. Default 2 — enough to matter, few enough to fit. */
  lifts?: number;
  /**
   * Peak weekly mileage the program will build to.
   *
   * Without it a preset lays out one run per free day, which at 30 miles a week
   * across six training days is five runs — and `validateTemplate` immediately
   * warns that five runs for 30 miles means six-mile runs. A preset that trips
   * its own warning is worse than no preset. With it, the layout doubles up
   * instead, which is the doctrine's own answer: buy the volume with sessions.
   */
  peakMileage?: number;
}

/**
 * A starting week for `goal`, laid out to pass its own validator.
 *
 * The layout rule, in one line: **the long run anchors the weekend, the quality
 * sessions spread as far from it and from each other as the week allows, the
 * lifts avoid the day before a key run, and one day stays empty.**
 */
export function suggestTemplate(goal: TemplateGoal, opts: PresetOptions): WeekTemplate {
  const days = DAY_ORDER.filter((d) => opts.trainingDays.includes(d));
  if (days.length < 3) return { days: [] };

  const sessions = new Map<TrainingDayName, TemplateSession[]>(days.map((d) => [d, []]));
  const add = (d: TrainingDayName, s: TemplateSession) => {
    const list = sessions.get(d);
    if (list && list.length < 2) list.push(s);
  };

  // The order below is the whole design, and it is ordered by how immovable each
  // thing is. Anything placed later has to fit around what came before, so the
  // sessions whose day actually matters go first.

  // 1. THE LONG RUN ANCHORS THE WEEKEND. Saturday by preference — it leaves
  //    Sunday free to be the rest day, which is the shape most athletes' weeks
  //    already have.
  const longDay = days.includes("sat")
    ? "sat"
    : days.includes("sun")
      ? "sun"
      : days[days.length - 1]!; // safe: days.length >= 3
  add(longDay, { kind: "run", runType: "long" });

  // 2. ONE DAY STAYS EMPTY — the day after the long run, because that is the day
  //    it is actually needed. `validateTemplate` warns about a week with no rest
  //    day, and a preset should never be the thing that triggers it.
  //
  //    ⚠️ ONLY WHERE THERE IS A DAY TO SPARE. An athlete who trains three days
  //    already has four off; reserving a fifth left the preset with two active
  //    days and it blocked its own output on `too_few_training_days`. The
  //    reservation exists to answer the no-rest-day warning, and that warning only
  //    fires on a seven-day week — so anything under six needs nothing here.
  const restDay = days.length >= 6 ? dayAfter(longDay, days) : undefined;

  // 3. THE DAY BEFORE THE LONG RUN STAYS EASY. Not a rule anyone states, but
  //    every one of these presets was tripping `back_to_back_hard_days` on it
  //    before it was written down: the hybrid kept landing on Friday because
  //    Friday was the last free day, and Saturday is the long run.
  const beforeLong = dayBefore(longDay, days);
  // ...and so does the day AFTER it, whether or not that day was reserved as
  // rest. A four-day week (Tue/Thu/Sat/Sun) has the long run on Saturday and no
  // spare day to reserve, so the hybrid took Sunday and the preset opened with a
  // back-to-back-hard warning on its own weekend. The long run has an easy day
  // either side of it or it is not the week's anchor, it is one of three hard days
  // in a row.
  const afterLong = dayAfter(longDay, days);

  /** Days a HARD session may go on. Everything else is easy or empty. */
  const hardDays = days.filter(
    (d) => d !== longDay && d !== restDay && d !== beforeLong && d !== afterLong,
  );
  const available = days.filter((d) => d !== longDay && d !== restDay);

  // 4. THE HYBRID, where the sport has one. It is the race itself, so it gets the
  //    pick of the hard days — and it is placed BEFORE the easy fill, or the fill
  //    takes every day and the hybrid ends up wherever is left.
  if (opts.includeHybrid && hardDays.length > 0) {
    const weekend = hardDays.find((d) => d === "sat" || d === "sun");
    add(weekend ?? hardDays[hardDays.length - 1]!, { kind: "hybrid" }); // safe: length > 0
  }

  // 5. QUALITY, SPREAD AS FAR FROM THE LONG RUN AND FROM EACH OTHER as the week
  //    allows, and never on a day the hybrid already owns — two hard sessions on
  //    one day is one hard day, not two.
  //
  //    ⚠️ A HYBRID COUNTS AS ONE OF THEM. A station session is interval work with
  //    a sled attached; treating it as neutral and adding two quality runs beside
  //    it gave a six-day week four hard days out of four available, which cannot
  //    be separated however they are ordered — every preset opened with two
  //    back-to-back-hard warnings against itself. The hybrid takes a quality slot
  //    rather than sitting outside the count.
  const quality = GOAL_QUALITY[goal].slice(
    0,
    opts.includeHybrid ? Math.max(1, GOAL_QUALITY[goal].length - 1) : GOAL_QUALITY[goal].length,
  );
  const freeHard = hardDays.filter((d) => (sessions.get(d)?.length ?? 0) === 0);
  const qualityDays = spread(freeHard, quality.length);
  quality.forEach((runType, i) => {
    const d = qualityDays[i];
    if (d) add(d, { kind: "run", runType });
  });

  // 6. EASY RUNS FILL WHAT IS LEFT. This is the volume, and the doctrine says it
  //    is bought with sessions rather than length — so every remaining day gets
  //    one rather than the long run getting longer.
  for (const d of available) {
    if ((sessions.get(d)?.length ?? 0) === 0) add(d, { kind: "run", runType: "easy" });
  }

  // 7. LIFTS DOUBLE UP ON DAYS THAT ARE ALREADY HARD. Stacking a lift onto a
  //    quality day keeps the easy days easy — the alternative, a lift on its own
  //    easy day, quietly turns a recovery day into a training day, which is how a
  //    week with only two hard sessions still leaves an athlete tired.
  const liftCount = opts.lifts ?? 2;
  //
  //    A LEG LIFT ALSO NEEDS AN EASY DAY AFTER IT, which `beforeLong` alone did
  //    not give it: the full-body lift kept landing the day before a quality run
  //    and tripping `leg_lift_before_key_run`. So the heavy one goes on a hard day
  //    whose FOLLOWING day is easy, and the upper-body one — which no one runs on
  //    tired legs — takes whatever is left.
  const liftDays = days
    .filter(
      (d) =>
        d !== longDay && d !== restDay && d !== beforeLong && (sessions.get(d)?.length ?? 0) < 2,
    )
    .sort((a, b) => Number(isHardDay(sessions, b)) - Number(isHardDay(sessions, a)));
  const legSafe = liftDays.filter((d) => {
    const next = dayAfter(d, days);
    return next === undefined || next === restDay || !isHardDay(sessions, next);
  });
  const legDay = legSafe[0];
  if (liftCount > 0 && legDay) add(legDay, { kind: "lift", liftType: "full" });
  const rest = liftDays.filter((d) => d !== legDay);
  spread(rest, Math.max(0, liftCount - (legDay ? 1 : 0))).forEach((d) =>
    add(d, { kind: "lift", liftType: "upper" }),
  );

  // 8. ENOUGH RUNS TO CARRY THE MILEAGE WITHOUT LENGTHENING ANY ONE OF THEM.
  //
  //    `runsForMileage` is the volume doctrine in one function: keep splitting
  //    until another run would fall under three miles. A week of six training
  //    days cannot hold seven runs on separate days, so the extras double up —
  //    which is exactly the trade the doctrine asks for, and the reason the
  //    engine tolerates two sessions on a day at all.
  //
  //    Last, so it only ever uses room nothing else wanted.
  if (opts.peakMileage !== undefined) {
    const runsNow = () => [...sessions.values()].flat().filter((s) => s.kind === "run").length;
    const want = runsForMileage(opts.peakMileage);
    for (const d of available) {
      if (runsNow() >= want) break;
      const list = sessions.get(d);
      if (!list || list.length >= 2) continue;
      add(d, { kind: "run", runType: "easy" });
    }
  }

  return {
    days: days
      .map((d) => ({ day: d, sessions: sessions.get(d) ?? [] }))
      .filter((d) => d.sessions.length > 0),
  };
}

const QUALITY = new Set(["threshold", "tempo", "interval", "fartlek", "progression"]);

/** True when the day already carries a session the athlete will feel tomorrow. */
function isHardDay(
  sessions: Map<TrainingDayName, TemplateSession[]>,
  day: TrainingDayName,
): boolean {
  return (sessions.get(day) ?? []).some(
    (s) =>
      s.kind === "hybrid" ||
      (s.kind === "run" && s.runType !== undefined && QUALITY.has(s.runType)),
  );
}

/** `n` days from `pool`, spread as evenly across it as it allows. */
function spread<T>(pool: T[], n: number): T[] {
  if (n <= 0 || pool.length === 0) return [];
  if (n >= pool.length) return [...pool];
  const step = pool.length / n;
  const out: T[] = [];
  for (let i = 0; i < n; i++) out.push(pool[Math.floor(i * step)]!); // safe: floor(i*step) < pool.length for i < n
  return out;
}

function dayAfter(day: TrainingDayName, days: TrainingDayName[]): TrainingDayName | undefined {
  const i = DAY_ORDER.indexOf(day);
  for (let k = 1; k < DAY_ORDER.length; k++) {
    const cand = DAY_ORDER[(i + k) % DAY_ORDER.length]!; // safe: modulo keeps it in range
    if (days.includes(cand)) return cand;
  }
  return undefined;
}

function dayBefore(day: TrainingDayName, days: TrainingDayName[]): TrainingDayName | undefined {
  const i = DAY_ORDER.indexOf(day);
  for (let k = 1; k < DAY_ORDER.length; k++) {
    const cand = DAY_ORDER[(i - k + DAY_ORDER.length) % DAY_ORDER.length]!; // safe: modulo keeps it in range
    if (days.includes(cand)) return cand;
  }
  return undefined;
}
