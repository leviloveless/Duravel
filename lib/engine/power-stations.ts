/**
 * The POWER day is the race's four loaded stations (Levi, 2026-08-25).
 *
 * "The power workout should include the following exercises: (1) Sled push,
 * (2) sled pull, (3) wall balls, (4) walking lunges. The number of reps and
 * weight should be scaled to the experience of the user." — and, on loading:
 * "Absolute weights based on the type of race the user is preparing for; the
 * weights should be 150% of the competition weight."
 *
 * What this replaces: a rotation of ballistic barbell and med-ball movements
 * (trap-bar jumps, med-ball throws, broad jumps). Those trained rate of force
 * development in the abstract; these train it on the four implements the race
 * actually asks the athlete to move, at a load heavier than race day so race day
 * feels light.
 *
 * Two decisions worth keeping straight:
 *
 *  - **The load is 150% of the COMPETITION weight, and it does not move with
 *    experience.** It comes from the sport's own station catalog, so it already
 *    answers to division and sex — a Pro-division woman and an Open-division man
 *    get different sleds without anything here knowing about either. EXPERIENCE
 *    SCALES THE VOLUME instead: how far the sled travels, how many wall balls,
 *    how many sets.
 *  - **Experience here is HYBRID experience, not lifting experience.** These are
 *    race stations; how much sled someone can move well is predicted by how much
 *    racing they have done, not by their back squat.
 *
 * Overload at 1.5x race weight is deliberate and is safest on exactly these
 * movements: a sled has no eccentric and no spinal loading, and the wall ball and
 * sandbag are light enough absolutely that half again is still light. It is not a
 * pattern to copy onto a barbell.
 */

import type { Session } from "@/lib/schemas";
import type { ExperienceLevel } from "./types";
import type { LiftPattern } from "./strength";
import type { Division, StationCatalog, StationId, StationSex } from "./stations";
import { HYROX_CATALOG } from "./stations";
import { POWER_REST_SECONDS } from "./strength";

type LiftSession = Extract<Session, { kind: "lift" }>;
type Movement = LiftSession["movements"][number];

/** Race weight x this = the training weight. */
export const POWER_STATION_LOAD_FACTOR = 1.5;

/**
 * The four, in the order they are performed. Ordering is not cosmetic: the two
 * sleds are the most demanding and go first, while the nervous system is fresh;
 * the lunge finishes because it is the one that is meant to accumulate fatigue.
 *
 * Each carries the movement PATTERN it trains, so a power day still reports into
 * the week's seven-pattern requirement like any other lift session.
 */
export const POWER_STATIONS: readonly {
  station: StationId;
  pattern: LiftPattern;
  label: string;
}[] = [
  { station: "sled_push", pattern: "horizontal_press", label: "Sled Push" },
  { station: "sled_pull", pattern: "horizontal_pull", label: "Sled Pull" },
  { station: "wall_balls", pattern: "vertical_press", label: "Wall Balls" },
  { station: "sandbag_lunge", pattern: "lunge", label: "Walking Lunges" },
];

/** The patterns a power day trains — exactly the four stations' patterns. */
export const POWER_STATION_PATTERNS: readonly LiftPattern[] = POWER_STATIONS.map((s) => s.pattern);

/**
 * Volume by HYBRID experience. Sled distances are per set and deliberately far
 * short of the race's 50 m: at 150% of race weight the set has to end while it is
 * still fast, which is the whole difference between power work and a grind.
 */
interface StationVolume {
  sets: number;
  sledMeters: number;
  wallBallReps: number;
  lungeMeters: number;
}

export const POWER_STATION_VOLUME: Record<ExperienceLevel, StationVolume> = {
  beginner: { sets: 3, sledMeters: 12.5, wallBallReps: 10, lungeMeters: 20 },
  intermediate: { sets: 4, sledMeters: 15, wallBallReps: 12, lungeMeters: 20 },
  advanced: { sets: 4, sledMeters: 20, wallBallReps: 15, lungeMeters: 25 },
};

/**
 * What governs a station power set. `POWER_CUE` talks about bar speed, which a
 * sled does not have.
 */
export const POWER_STATION_CUE = "drive hard — end the set the moment speed drops";

const KG_PER_LB = 0.45359237;

/**
 * Round to something a gym can actually load — and at a granularity that suits
 * the implement. Rounding everything to the nearest 2.5 kg turned a 9 kg wall
 * ball into 10 and a 6 kg race weight into 5, which is a sixth of the load on a
 * light implement and reads as an error next to the athlete's own race numbers.
 */
function roundLoad(value: number, unit: "lbs" | "kg"): number {
  if (unit === "kg") return value < 20 ? Math.round(value * 2) / 2 : Math.round(value / 2.5) * 2.5;
  return value < 50 ? Math.round(value) : Math.round(value / 5) * 5;
}

/**
 * The training load for one station: 150% of its competition weight for this
 * division and sex, in the athlete's own unit. `null` for a station the sport
 * carries no load for.
 */
export function powerStationLoad(
  station: StationId,
  division: Division,
  sex: StationSex,
  weightUnit: "lbs" | "kg",
  catalog: StationCatalog = HYROX_CATALOG,
): string | null {
  // The sport the athlete is training for owns the competition weight; HYROX is
  // the fallback for a sport whose catalog has no such station.
  const spec = catalog.stations[station] ?? HYROX_CATALOG.stations[station];
  const raceKg = spec?.loadKg?.[division]?.[sex];
  if (!raceKg) return null;
  const trainingKg = raceKg * POWER_STATION_LOAD_FACTOR;
  const unit = weightUnit === "kg" ? "kg" : "lb";
  const shown = roundLoad(weightUnit === "kg" ? trainingKg : trainingKg / KG_PER_LB, weightUnit);
  // The race figure is a FACT about the athlete's division, not a prescription —
  // it is quoted exactly in kg, and only rounded when converted to pounds.
  const race = weightUnit === "kg" ? raceKg : Math.round(raceKg / KG_PER_LB);
  return `${shown} ${unit} (150% of race ${race})`;
}

export interface PowerStationOptions {
  division: Division;
  sex: StationSex;
  /** HYBRID experience — see the header. */
  hybridExp: ExperienceLevel;
  weightUnit: "lbs" | "kg";
  catalog?: StationCatalog;
}

/** The four movements, fully prescribed. */
export function powerStationMovements(opts: PowerStationOptions): Movement[] {
  const v = POWER_STATION_VOLUME[opts.hybridExp];
  const catalog = opts.catalog ?? HYROX_CATALOG;
  return POWER_STATIONS.map(({ station, pattern, label }) => {
    const reps =
      station === "wall_balls"
        ? `${v.wallBallReps}`
        : station === "sandbag_lunge"
          ? `${v.lungeMeters} m`
          : `${v.sledMeters} m`;
    const weight = powerStationLoad(station, opts.division, opts.sex, opts.weightUnit, catalog);
    const m: Movement = {
      pattern,
      exercise: label,
      sets: v.sets,
      repRange: reps,
      emphasis: "power",
      restSeconds: POWER_REST_SECONDS,
      note: POWER_STATION_CUE,
    };
    if (weight) m.suggestedWeight = weight;
    return m;
  });
}

/**
 * Rewrite every power session in the week as the four stations.
 *
 * Runs AFTER `applyStrengthSchemes`, on purpose. That pass owns the weekly
 * per-pattern set budget and the session set caps, both of which are built around
 * barbell volume; a 15 m sled push is not a set of squats and should not spend
 * that budget. Running last also means nothing downstream re-prescribes these.
 */
export function applyPowerStations(
  week: { days: { sessions: Session[] }[] },
  opts: PowerStationOptions,
): void {
  for (const day of week.days) {
    for (const s of day.sessions) {
      if (s.kind !== "lift" || s.liftType !== "power") continue;
      s.movements = powerStationMovements(opts);
      // The plyometric add-on existed to make an abstract power day concrete.
      // Four race stations at 150% are concrete.
      delete s.power;
    }
  }
}
