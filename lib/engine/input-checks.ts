/**
 * Sanity checks on the numbers and times a program is built from.
 *
 * ## Why this file exists
 *
 * The onboarding form deliberately blocks native submit — `handleGenerate` is
 * the only path that starts a generation, so that a stray Enter key cannot — and
 * blocking native submit also blocks the browser's native VALIDATION. Every
 * `min`, `max`, `required`, `step` and `pattern` in that 1,700-line form is
 * therefore DECORATIVE. `min={minDate}` on the race-date input had never done
 * anything, which is how a race dated year 226 reached the engine and came back
 * out as three unrelated-looking bugs (see `race-dates.ts`).
 *
 * That was one field. This file is the rest of the audit.
 *
 * The lesson worth carrying is not "validate inputs". It is that **the cost of a
 * bad input is almost never a bad input** — the engine is defensive, so a
 * nonsense number rarely crashes it. It flows through clamps and fallbacks and
 * emerges as a program that is merely wrong, in two or three places that look
 * like separate defects. Every check here is ranked and worded by that
 * consequence, not by how easy the value is to type.
 *
 * ## What each check is actually preventing (measured)
 *
 *   5K "2:40" — one dropped digit from "24:00", or a mile split in the 5K box.
 *   VDOT 605 (a world record is ~85). Easy pace 1:12/mile, interval 0:58/mile.
 *   Because pace is what converts the week's cardio minutes into MILES, a
 *   90-minute session cap at 1:12/mile sizes a single "easy run" at ~70 miles.
 *   The athlete sees an absurd pace, absurd session distances and an absurd
 *   weekly total: three bugs, one keystroke.
 *
 *   Pace override "830" — the four pace inputs carry `inputMode="numeric"`,
 *   which on a phone raises a keypad with NO COLON on it. The form asks for
 *   "8:30" using a keyboard that cannot type it. "830" parses as 830 minutes:
 *   13 hours 50 minutes per mile, and it overrides the derived pace silently
 *   because it is a positive, finite number.
 *
 *   Threshold HR 200 with max HR 150 — both inside their own schema ranges
 *   (`thresholdHr` 90–220, `maxHr` 100–230), nothing compares them. The Friel
 *   conversion clamps at max, so Z2 through Z5 all collapse to 150–150 bpm.
 *   Every zone chip on the program page reads the same number, every session's
 *   HR line reads the same number, and the rep-by-rep peak ramp degenerates to
 *   a flat line. Nothing anywhere says "heart rate".
 *
 *   Zone 3 low typed 7 instead of 70 — each band is checked in isolation by the
 *   schema (0–100, high > low), so 7–80 passes. Zone 3 then reads 13–144 bpm and
 *   swallows Zones 1 and 2 whole; a tempo run is prescribed at a recovery heart
 *   rate.
 *
 *   5-rep max "2250" instead of "225" — `fiveRmSquat` is a bare `z.number()`
 *   with no sign and no bound. Every squat in the program is then prescribed at
 *   ~83% of a 2,531 lb one-rep max.
 *
 * PURE — no I/O, no framework, no clock. Used by the onboarding form as the
 * athlete advances, and again by the server action on submit, so the two cannot
 * drift. Each function returns ONE message (the form shows one line) or null.
 */

import { parseTimeToSeconds } from "./paces";
import { maxHeartRate, type Sex } from "@/lib/zones";

// --- time strings -----------------------------------------------------------

/** Seconds → "m:ss" / "h:mm:ss", for quoting a number back at the athlete. */
function hms(sec: number): string {
  const s = Math.round(sec);
  const two = (n: number) => String(n).padStart(2, "0");
  if (s >= 3600)
    return `${Math.floor(s / 3600)}:${two(Math.floor((s % 3600) / 60))}:${two(s % 60)}`;
  return `${Math.floor(s / 60)}:${two(s % 60)}`;
}

/**
 * A benchmark expressed as a time.
 *
 * `min`/`max` are PLAUSIBILITY bounds, not records: wide enough that no real
 * athlete is refused, narrow enough that a missing or extra digit cannot pass.
 * A field with no bounds is checked for shape only — see HYROX splits below.
 */
type TimeField = {
  label: string;
  example: string;
  minSec?: number;
  maxSec?: number;
};

/** Per-mile and per-km plausibility bands for a training pace. */
const PACE_BOUNDS = {
  mi: { minSec: 210, maxSec: 1500, example: "8:30" }, // 3:30–25:00 / mile
  km: { minSec: 130, maxSec: 930, example: "5:15" }, // 2:10–15:30 / km
} as const;

const PACE_FIELDS = ["easyPace", "thresholdPace", "intervalPace", "tempoPace"] as const;

const PACE_LABEL: Record<(typeof PACE_FIELDS)[number], string> = {
  easyPace: "Easy pace",
  thresholdPace: "Threshold pace",
  intervalPace: "Interval pace",
  tempoPace: "Tempo pace",
};

/**
 * Every benchmark the athlete types as a time, and what a believable one looks
 * like. The four pace overrides are handled separately because their bounds
 * depend on the unit toggle sitting next to them.
 */
const TIME_FIELDS: Record<string, TimeField> = {
  // Race times. These three feed VDOT, and VDOT sets every prescribed pace AND
  // the pace→miles conversion that sizes the week, so they are bounded tightly.
  mileTime: { label: "1-mile time", example: "6:30", minSec: 210, maxSec: 1200 },
  fiveKTime: { label: "5K time", example: "24:00", minSec: 720, maxSec: 4500 },
  tenKTime: { label: "10K time", example: "50:00", minSec: 1500, maxSec: 9000 },

  // Erg benchmarks — they bias the needs analysis rather than setting a pace,
  // so the bands are generous.
  ski2kTime: { label: "2000m ski erg", example: "7:30", minSec: 240, maxSec: 1500 },
  row2kTime: { label: "2000m row erg", example: "7:30", minSec: 240, maxSec: 1500 },

  // Sport anchors.
  cssPace: { label: "Swim CSS pace", example: "1:40", minSec: 45, maxSec: 240 },
  glycolyticTestSec: { label: "Glycolytic test", example: "3:10", minSec: 60, maxSec: 1800 },
  // Wide on purpose at the fast end: this one field serves HYROX (~1h) and the
  // whole DEKA family, and a DEKA STRONG goal is ten to fourteen MINUTES. A
  // fifteen-minute floor sized to HYROX would have refused a correct entry.
  goalFinishTime: { label: "Goal finish time", example: "1:15:00", minSec: 300, maxSec: 43200 },

  // HYROX splits from a previous race. Deliberately SHAPE ONLY, no bounds: these
  // are reference context for the prompt and a soft bias in the station needs
  // analysis — a wrong-but-parseable split shifts an emphasis, it does not
  // produce a number the athlete has to go out and run. What is worth catching
  // is a split that parses to nothing and vanishes without a word.
  hyroxSkiErg: { label: "SkiErg split", example: "4:20" },
  hyroxSledPush: { label: "Sled Push split", example: "2:10" },
  hyroxSledPull: { label: "Sled Pull split", example: "3:00" },
  hyroxBurpeeBroadJump: { label: "Burpee Broad Jump split", example: "4:30" },
  hyroxRow: { label: "Row split", example: "4:30" },
  hyroxFarmersCarry: { label: "Farmers Carry split", example: "1:50" },
  hyroxSandbagLunge: { label: "Sandbag Lunges split", example: "4:00" },
  hyroxWallBalls: { label: "Wall Balls split", example: "5:00" },
  hyroxRunTotal: { label: "Run total", example: "45:00" },
  hyroxRoxzone: { label: "Roxzone", example: "6:00" },
};

export type TimeBenchmarks = Partial<Record<string, string | number | undefined>> & {
  paceUnit?: "mi" | "km";
};

/**
 * Every benchmark field name that holds a time. Exported so the form can gather
 * exactly these out of its FormData instead of keeping a second list that drifts
 * from this one — the drift being the whole failure mode this file exists for.
 */
export const TIME_BENCHMARK_FIELDS: readonly string[] = [
  ...Object.keys(TIME_FIELDS),
  ...PACE_FIELDS,
];

/** One time field, against its own spec. Null when it is blank or believable. */
function checkTimeField(raw: unknown, spec: TimeField): string | null {
  if (raw === undefined || raw === null || raw === "") return null;
  const text = String(raw).trim();
  if (!text) return null;

  // The SAME parser the engine will use. Checking with a different one is how a
  // validator ends up green on a value its consumer silently drops.
  const sec = parseTimeToSeconds(text);
  if (sec === null || !Number.isFinite(sec) || sec <= 0) {
    return `${spec.label} "${text}" isn't a time we can read. Enter it as mm:ss — for example ${spec.example}.`;
  }

  if (spec.minSec !== undefined && sec < spec.minSec) {
    return `${spec.label} "${text}" reads as ${hms(sec)}, which is faster than anyone has gone. Enter it as mm:ss — for example ${spec.example}.`;
  }
  if (spec.maxSec !== undefined && sec > spec.maxSec) {
    return `${spec.label} "${text}" reads as ${hms(sec)}. Check the minutes and seconds — a colon is needed between them, as in ${spec.example}.`;
  }
  return null;
}

/**
 * Every benchmark time on the form, in the athlete's terms.
 *
 * The four pace overrides are measured against the unit currently selected in
 * the toggle beside them, because that toggle is what the engine multiplies by.
 */
export function checkBenchmarkTimes(benchmarks: TimeBenchmarks | undefined): string | null {
  if (!benchmarks) return null;

  for (const [name, spec] of Object.entries(TIME_FIELDS)) {
    const issue = checkTimeField(benchmarks[name], spec);
    if (issue) return issue;
  }

  const unit = benchmarks.paceUnit === "km" ? "km" : "mi";
  const bounds = PACE_BOUNDS[unit];
  const per = unit === "km" ? "km" : "mile";
  for (const name of PACE_FIELDS) {
    const issue = checkTimeField(benchmarks[name], {
      label: `${PACE_LABEL[name]} (per ${per})`,
      example: bounds.example,
      minSec: bounds.minSec,
      maxSec: bounds.maxSec,
    });
    if (issue) return issue;
  }
  return null;
}

// --- heart rate -------------------------------------------------------------

export interface HeartRateInput {
  age?: number;
  sex?: Sex;
  maxHr?: number;
  restingHr?: number;
  thresholdHr?: number;
}

/**
 * The three heart rates against each other.
 *
 * Each one is already bounded on its own by the schema, and each bound is
 * correct; what nothing checks is the ORDER. Resting < threshold < max is not a
 * style preference, it is the definition of the three terms, and every violation
 * of it degrades the zone model silently:
 *
 *   - threshold ≥ max  → the Friel conversion clamps every band at max, so the
 *     zones above the crossing point collapse onto a single bpm;
 *   - resting ≥ max    → `resolveHrModel` refuses the Karvonen branch and falls
 *     back to %HRmax, so the resting HR the athlete typed is simply discarded
 *     with nothing on screen to say so.
 *
 * When no tested max HR was given, the comparison is against the age/sex
 * ESTIMATE — and there the message points at the estimate rather than at the
 * athlete's number, because a genuinely high lactate-threshold HR above an age
 * formula is common and correct. The remedy in that case is to supply the max
 * HR, not to change the threshold.
 */
export function checkHeartRates(input: HeartRateInput): string | null {
  const { maxHr, restingHr, thresholdHr } = input;

  if (thresholdHr !== undefined && maxHr !== undefined && thresholdHr >= maxHr) {
    return `Your threshold HR (${thresholdHr}) is at or above your max HR (${maxHr}). Threshold heart rate is always below max — check which number went in which box.`;
  }

  if (restingHr !== undefined && maxHr !== undefined && restingHr >= maxHr) {
    return `Your resting HR (${restingHr}) is at or above your max HR (${maxHr}). Check which number went in which box.`;
  }

  if (restingHr !== undefined && thresholdHr !== undefined && restingHr >= thresholdHr) {
    return `Your resting HR (${restingHr}) is at or above your threshold HR (${thresholdHr}). Check which number went in which box.`;
  }

  if (thresholdHr !== undefined && maxHr === undefined) {
    const estimated = maxHeartRate(input.age, input.sex);
    if (thresholdHr >= estimated) {
      return `Your threshold HR (${thresholdHr}) is above the max HR we estimate from your age (${estimated}), which would collapse your top zones onto one number. Add your tested max HR as well.`;
    }
  }

  return null;
}

/** One custom zone band, as the form stores it: whole percentages of max HR. */
export interface ZoneBandPercent {
  low: number;
  high: number;
}

const ZONE_NAMES = ["Zone 1", "Zone 2", "Zone 3", "Zone 4", "Zone 5"] as const;

/**
 * The five custom zone bands, as a LADDER rather than five separate bands.
 *
 * `HrZoneBandSchema` validates each band on its own — 0–100, high above low —
 * and that is exactly the check a dropped zero survives. Typing 7 where 70 was
 * meant gives Zone 3 the band 7–80, which every isolated rule accepts and which
 * makes Zone 3 span from a resting heart rate to a threshold one, swallowing
 * Zones 1 and 2 whole.
 *
 * Zones may leave GAPS between them (Friel's own bands do), so the rule is that
 * each zone starts at or above where the one below it ends — not that they touch.
 *
 * Also worth knowing: the form's zone inputs are controlled with
 * `Number(e.target.value)`, and `Number("")` is 0 — so clearing a box does not
 * blank it, it silently sets it to zero. That lands here as an ordering failure
 * with a message that names the zone.
 */
export function checkHrZones(zones: ZoneBandPercent[] | undefined): string | null {
  if (!zones || zones.length === 0) return null;

  for (let i = 0; i < zones.length; i++) {
    const z = zones[i]!;
    const name = ZONE_NAMES[i] ?? `Zone ${i + 1}`;
    if (!Number.isFinite(z.low) || !Number.isFinite(z.high)) {
      return `${name} needs a low % and a high %.`;
    }
    if (z.low < 0 || z.high > 100) {
      return `${name} is set to ${z.low}–${z.high}%. Zone bounds are percentages of your max HR, so they run from 0 to 100.`;
    }
    if (z.high <= z.low) {
      return `${name} is set to ${z.low}–${z.high}%, so it has no width. Its high % has to be above its low %.`;
    }
  }

  for (let i = 1; i < zones.length; i++) {
    const below = zones[i - 1]!;
    const here = zones[i]!;
    if (here.low < below.high) {
      return `${ZONE_NAMES[i] ?? `Zone ${i + 1}`} starts at ${here.low}% but ${ZONE_NAMES[i - 1] ?? `Zone ${i}`} already reaches ${below.high}%. Each zone has to start at or above where the one below it ends.`;
    }
  }

  return null;
}

// --- plain numbers ----------------------------------------------------------

export type WeightUnit = "lbs" | "kg";

/**
 * Plausibility bands for a body weight, per unit.
 *
 * A unit MIX-UP is not detectable — 80 is a real weight in both — and this makes
 * no attempt to guess at one. What it catches is the entry that is wrong in
 * either unit: a decimal point in the wrong place, or a weight in grams.
 */
const BODY_WEIGHT_BOUNDS: Record<WeightUnit, { min: number; max: number }> = {
  lbs: { min: 60, max: 550 },
  kg: { min: 27, max: 250 },
};

/** A 5-rep max, per unit. Above these is a total, a typo, or the wrong unit. */
const FIVE_RM_BOUNDS: Record<WeightUnit, { max: number }> = {
  lbs: { max: 1000 },
  kg: { max: 450 },
};

export interface ProfileNumbers {
  age?: number;
  bodyWeight?: number;
  weightUnit?: WeightUnit;
}

/**
 * Age and body weight.
 *
 * `validateStep` already checks the age RANGE, but not that it is a whole
 * number — so 25.5 advances past step 1 and is refused four steps later by the
 * schema, in Zod's words, on a screen that does not contain the age field. The
 * integer check belongs next to the range check, on the step that owns the
 * control.
 *
 * Body weight had no upper bound anywhere: `z.number().positive()` and a
 * `validateStep` test of `> 0`. Its downstream effect is mostly bounded
 * (`runImpactFactor` floors its taper at 0.8), but it goes verbatim into every
 * generation and adaptation prompt and into the W/kg that sets a triathlete's
 * bike level, and "1750 lbs" in a prompt is not a number worth defending.
 */
export function checkProfileNumbers(p: ProfileNumbers): string | null {
  if (p.age !== undefined) {
    if (!Number.isFinite(p.age) || !Number.isInteger(p.age)) {
      return "Enter your age as a whole number of years.";
    }
    if (p.age < 13 || p.age > 100) return "Enter an age between 13 and 100.";
  }

  if (p.bodyWeight !== undefined) {
    const unit: WeightUnit = p.weightUnit === "kg" ? "kg" : "lbs";
    const b = BODY_WEIGHT_BOUNDS[unit];
    if (!Number.isFinite(p.bodyWeight) || p.bodyWeight <= 0) {
      return "Enter your body weight.";
    }
    if (p.bodyWeight < b.min || p.bodyWeight > b.max) {
      const other = unit === "kg" ? "lbs" : "kg";
      return `A body weight of ${p.bodyWeight} ${unit} looks wrong. Check the number, or switch the unit to ${other}.`;
    }
  }

  return null;
}

export interface StrengthNumbers {
  fiveRmSquat?: number;
  fiveRmBench?: number;
  fiveRmDeadlift?: number;
  bike20MinCals?: number;
}

const FIVE_RM_LABEL: Record<keyof StrengthNumbers, string> = {
  fiveRmSquat: "5-rep max squat",
  fiveRmBench: "5-rep max bench",
  fiveRmDeadlift: "5-rep max deadlift",
  bike20MinCals: "Assault bike cals / 20 min",
};

/**
 * The strength and erg numbers, which the schema types as a bare `z.number()` —
 * no sign, no ceiling.
 *
 * Both ends matter and they fail differently. A NEGATIVE 5RM is dropped by
 * `suggestedWeight` (`fiveRm > 0`), so the athlete's entry disappears and every
 * lift silently reverts to a "%1RM · RIR" cue with no absolute weight — a
 * regression they would read as a missing feature. An INFLATED one is worse
 * because it is honoured: "2250" for "225" puts a 2,531 lb one-rep max through
 * the Epley conversion and prescribes ~83% of it on every squat in the program.
 */
export function checkStrengthNumbers(n: StrengthNumbers, weightUnit?: WeightUnit): string | null {
  const unit: WeightUnit = weightUnit === "kg" ? "kg" : "lbs";
  const max = FIVE_RM_BOUNDS[unit].max;

  for (const key of ["fiveRmSquat", "fiveRmBench", "fiveRmDeadlift"] as const) {
    const v = n[key];
    if (v === undefined) continue;
    if (!Number.isFinite(v) || v <= 0) {
      return `${FIVE_RM_LABEL[key]} has to be a positive weight. Leave it blank if you don't know it.`;
    }
    if (v > max) {
      return `${FIVE_RM_LABEL[key]} of ${v} ${unit} looks wrong — enter the weight you lift for 5 reps, not a total or a one-rep max.`;
    }
  }

  const cals = n.bike20MinCals;
  if (cals !== undefined) {
    if (!Number.isFinite(cals) || cals <= 0 || cals > 1000) {
      return `${FIVE_RM_LABEL.bike20MinCals} of ${cals} looks wrong. Enter the calorie total from a 20-minute effort, or leave it blank.`;
    }
  }

  return null;
}

export interface StartingVolume {
  startMileage?: number;
  startCardioMinutes?: number;
}

/**
 * The two optional starting-volume overrides.
 *
 * These are the one place where the form and the schema openly contradict each
 * other: both inputs carry `min={0}` and are labelled optional, while the schema
 * is `z.number().positive()`. A literal 0 — a perfectly reasonable thing to type
 * when you are not running yet — is therefore accepted by the control, carried
 * through four steps and refused at the very end in Zod's own words.
 *
 * Blank is what the schema means by "none", so the message says blank.
 */
export function checkStartingVolume(v: StartingVolume): string | null {
  const mi = v.startMileage;
  if (mi !== undefined) {
    if (!Number.isFinite(mi) || mi <= 0) {
      return "Leave starting weekly mileage blank if you aren't running yet — 0 isn't a starting volume.";
    }
    if (mi > 200) {
      return `A starting weekly mileage of ${mi} is beyond what this program builds from. Enter the miles you run in a typical week now, or leave it blank.`;
    }
  }

  const ca = v.startCardioMinutes;
  if (ca !== undefined) {
    if (!Number.isFinite(ca) || ca <= 0) {
      return "Leave starting weekly cardio blank if you aren't training yet — 0 isn't a starting volume.";
    }
    if (ca > 2000) {
      return `A starting weekly cardio of ${ca} minutes is over 33 hours. Enter the minutes you train in a typical week now, or leave it blank.`;
    }
  }

  return null;
}
