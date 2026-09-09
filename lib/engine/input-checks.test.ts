/**
 * THE REST OF THE FORM (audit following Levi, 2026-09-09).
 *
 * The year-0226 incident was reported as three bugs and fixed as one date. This
 * file covers the rest of the class it belongs to: the onboarding form blocks
 * native submit so a stray Enter cannot start a generation, which blocks the
 * browser's native VALIDATION too, which makes every `min`, `max` and `step` in
 * that 1,700-line form decorative.
 *
 * Each `describe` below pairs a value an athlete can plausibly type with what it
 * MEASURABLY does downstream, run through the real engine functions rather than
 * described in prose. The measurement is the argument for the check: none of
 * these values crashes anything, and that is exactly the problem — they all come
 * back out as a program that is merely, invisibly wrong.
 */
import { describe, it, expect } from "vitest";
import {
  checkBenchmarkTimes,
  checkHeartRates,
  checkHrZones,
  checkProfileNumbers,
  checkStartingVolume,
  checkStrengthNumbers,
  TIME_BENCHMARK_FIELDS,
} from "./input-checks";
import { computePaces, parseTimeToSeconds } from "./paces";
import { resolveHrModel, zoneBandsFromPercents, zoneBpmRange, type Zone } from "@/lib/zones";
import { suggestedWeight } from "./strength";

const ZONES: Zone[] = [1, 2, 3, 4, 5];
const bpm = (m: Parameters<typeof zoneBpmRange>[0]) =>
  ZONES.map((z) => {
    const r = zoneBpmRange(m, z);
    return `${r.min}-${r.max}`;
  });

// --- benchmark times --------------------------------------------------------

describe("a 5K time with a digit missing", () => {
  it("is what a good one looks like, for comparison", () => {
    const p = computePaces({ fiveKTime: "24:00" })!;
    expect(Math.round(p.vdot)).toBe(40);
    expect(Math.round(p.easy)).toBe(588); // 9:48 / mile
  });

  it("produces a world-beating VDOT and a one-minute mile, silently", () => {
    // "2:40" is "24:00" with the 4 dropped, or a mile split typed into the 5K
    // box. `vdotFromRace` returns a positive finite number, so every guard in
    // `computePaces` waves it through.
    const p = computePaces({ fiveKTime: "2:40" })!;
    expect(p.vdot).toBeGreaterThan(500); // a real world record is ~85
    expect(p.easy).toBeLessThan(90); // easy pace: 1:12 / mile
    expect(p.interval).toBeLessThan(60); // interval pace: 0:58 / mile
    // And pace is what converts the week's cardio MINUTES into MILES, so a
    // 90-minute session cap at this pace sizes one "easy run" at ~70 miles.
    expect((90 * 60) / p.easy).toBeGreaterThan(60);
  });

  it("is refused, with the remedy in the message", () => {
    const msg = checkBenchmarkTimes({ fiveKTime: "2:40" });
    expect(msg).toContain("5K time");
    expect(msg).toContain("mm:ss");
  });

  it("accepts the times people actually run", () => {
    for (const t of ["24:00", "18:30", "35:00", "24:0", "24"]) {
      expect(checkBenchmarkTimes({ fiveKTime: t })).toBeNull();
    }
  });

  it("refuses a time that parses to nothing rather than letting it vanish", () => {
    // `parseTimeToSeconds("1:2:3:4")` is null and `"2400"` is 2,400 MINUTES, so
    // both leave `computePaces` with no VDOT at all — the athlete's benchmark is
    // dropped on the floor and nothing says so.
    expect(parseTimeToSeconds("1:2:3:4")).toBeNull();
    expect(computePaces({ fiveKTime: "1:2:3:4" })).toBeNull();
    expect(computePaces({ fiveKTime: "2400" })).toBeNull();
    expect(checkBenchmarkTimes({ fiveKTime: "1:2:3:4" })).toContain("isn't a time");
    expect(checkBenchmarkTimes({ fiveKTime: "2400" })).toContain("Check the minutes and seconds");
  });
});

describe("a pace override typed on a keypad with no colon", () => {
  it("overrides the derived pace with 13 hours per mile", () => {
    // The four pace inputs carry `inputMode="numeric"`. On a phone that raises a
    // digits-only keypad — no colon — under a label that asks for "8:30".
    const p = computePaces({ fiveKTime: "24:00", easyPace: "830" })!;
    expect(p.easy).toBe(49800); // 830 minutes per mile
  });

  it("is refused, in the unit the toggle beside it is set to", () => {
    expect(checkBenchmarkTimes({ easyPace: "830", paceUnit: "mi" })).toContain("per mile");
    expect(checkBenchmarkTimes({ easyPace: "830", paceUnit: "km" })).toContain("per km");
    expect(checkBenchmarkTimes({ easyPace: "8:30", paceUnit: "mi" })).toBeNull();
    expect(checkBenchmarkTimes({ easyPace: "5:15", paceUnit: "km" })).toBeNull();
    // The bands differ by unit, because the engine multiplies by the unit: a
    // 17-minute pace is a slow walk-jog per mile and off the end of the scale
    // per kilometre.
    expect(checkBenchmarkTimes({ easyPace: "17:00", paceUnit: "mi" })).toBeNull();
    expect(checkBenchmarkTimes({ easyPace: "17:00", paceUnit: "km" })).toContain("per km");
  });

  it("ignores blanks — every one of these fields is optional", () => {
    expect(checkBenchmarkTimes({})).toBeNull();
    expect(checkBenchmarkTimes({ easyPace: "", fiveKTime: undefined })).toBeNull();
  });
});

describe("the time fields the checker knows about", () => {
  it("covers every benchmark on the form that holds a time", () => {
    for (const name of [
      "mileTime",
      "fiveKTime",
      "tenKTime",
      "ski2kTime",
      "row2kTime",
      "easyPace",
      "thresholdPace",
      "intervalPace",
      "tempoPace",
      "cssPace",
      "glycolyticTestSec",
      "goalFinishTime",
      "hyroxSkiErg",
      "hyroxRunTotal",
    ]) {
      expect(TIME_BENCHMARK_FIELDS).toContain(name);
    }
  });

  it("checks HYROX splits for shape but not for plausibility", () => {
    // Deliberate. A split is context for the prompt and a soft bias in the
    // station needs analysis — a wrong-but-readable one shifts an emphasis, it
    // does not put a number in front of the athlete to go and run. What is worth
    // catching is a split that parses to nothing and disappears.
    expect(checkBenchmarkTimes({ hyroxSledPush: "0:03" })).toBeNull();
    expect(checkBenchmarkTimes({ hyroxSledPush: "nope" })).toContain("isn't a time");
  });
});

// --- heart rate -------------------------------------------------------------

describe("a threshold HR above max HR", () => {
  it("collapses every zone onto a single bpm", () => {
    // Both numbers sit inside their own schema bounds (`thresholdHr` 90–220,
    // `maxHr` 100–230); nothing compares them. The Friel conversion clamps each
    // band at max, so Z2 through Z5 land on the same number.
    const m = resolveHrModel({ age: 40, maxHr: 150, thresholdHr: 200 });
    expect(bpm(m)).toEqual(["0-150", "150-150", "150-150", "150-150", "150-150"]);
  });

  it("is refused, and points at the boxes rather than at the zones", () => {
    const msg = checkHeartRates({ age: 40, maxHr: 150, thresholdHr: 200 });
    expect(msg).toContain("threshold HR");
    expect(msg).toContain("which number went in which box");
  });

  it("accepts an ordinary set of three", () => {
    expect(checkHeartRates({ age: 40, maxHr: 188, restingHr: 52, thresholdHr: 168 })).toBeNull();
  });

  it("refuses a resting HR at or above the others, which is otherwise discarded", () => {
    // `resolveHrModel` requires `restingHr < maxHR` before it will use Karvonen.
    // Fail that and the athlete's resting HR is silently ignored — the zones
    // quietly revert to %HRmax with nothing on screen to say why.
    const m = resolveHrModel({ age: 40, maxHr: 110, restingHr: 118 });
    expect(m.method).toBe("hrmax");
    expect(checkHeartRates({ age: 40, maxHr: 110, restingHr: 118 })).toContain("resting HR");
    expect(checkHeartRates({ age: 40, restingHr: 118, thresholdHr: 100 })).toContain("resting HR");
  });

  it("blames the age ESTIMATE when no max HR was given, because it is the wrong one", () => {
    // A measured lactate-threshold HR above an age-formula max is common and
    // correct. The number to change is the missing max HR, not the threshold, so
    // the message asks for the max HR instead of calling the threshold wrong.
    const msg = checkHeartRates({ age: 40, thresholdHr: 185 });
    expect(msg).toContain("estimate");
    expect(msg).toContain("tested max HR");
    expect(msg).not.toContain("which box");
    // …and with the tested max HR supplied, the same threshold is fine.
    expect(checkHeartRates({ age: 40, maxHr: 195, thresholdHr: 185 })).toBeNull();
  });
});

describe("a custom zone band with a dropped zero", () => {
  const withZ3Low = (low: number) => ({
    z1: { low: 0, high: 60 },
    z2: { low: 60, high: 70 },
    z3: { low, high: 80 },
    z4: { low: 80, high: 90 },
    z5: { low: 90, high: 100 },
  });

  it("makes Zone 3 swallow Zones 1 and 2 whole", () => {
    const m = resolveHrModel({ age: 40, customBands: zoneBandsFromPercents(withZ3Low(7)) });
    // Zone 3 — "moderate / tempo" — now runs from a resting heart rate upward.
    expect(bpm(m)[2]).toBe("13-144");
  });

  it("is refused by name, which the schema's per-band rule cannot do", () => {
    // `HrZoneBandSchema` validates each band alone: 0–100 and high above low. A
    // band of 7–80 passes all three. Only the ladder catches it.
    const bands = Object.values(withZ3Low(7));
    const msg = checkHrZones(bands);
    expect(msg).toContain("Zone 3");
    expect(msg).toContain("Zone 2");
  });

  it("accepts the standard bands and any ladder with gaps in it", () => {
    expect(checkHrZones(Object.values(withZ3Low(70)))).toBeNull();
    expect(
      checkHrZones([
        { low: 0, high: 55 },
        { low: 60, high: 70 },
        { low: 75, high: 80 },
        { low: 85, high: 90 },
        { low: 92, high: 100 },
      ]),
    ).toBeNull();
  });

  it("catches a cleared box, which the form reads as zero rather than as blank", () => {
    // The zone inputs are controlled with `Number(e.target.value)`, and
    // `Number("")` is 0 — so emptying a box does not blank it.
    expect(checkHrZones(Object.values(withZ3Low(0)))).toContain("Zone 3");
  });

  it("ignores zones entirely when the athlete has not set any", () => {
    expect(checkHrZones(undefined)).toBeNull();
    expect(checkHrZones([])).toBeNull();
  });
});

// --- plain numbers ----------------------------------------------------------

describe("age and body weight", () => {
  it("refuses a fractional age on the step that owns the field", () => {
    // `validateStep` checked the RANGE only, so 25.5 advanced past step 1 and
    // was refused four steps later by the schema, in Zod's words, on a screen
    // with no age field on it.
    expect(checkProfileNumbers({ age: 25.5 })).toContain("whole number");
    expect(checkProfileNumbers({ age: 25 })).toBeNull();
    expect(checkProfileNumbers({ age: 8 })).toContain("13 and 100");
  });

  it("refuses a body weight that is wrong in either unit, and names the toggle", () => {
    // `z.number().positive()` had no ceiling at all. Body weight goes verbatim
    // into every generation prompt and into the W/kg that sets a triathlete's
    // bike level.
    expect(checkProfileNumbers({ bodyWeight: 1750, weightUnit: "lbs" })).toContain("switch");
    expect(checkProfileNumbers({ bodyWeight: 1750, weightUnit: "lbs" })).toContain("kg");
    expect(checkProfileNumbers({ bodyWeight: 0.5, weightUnit: "kg" })).toContain("looks wrong");
  });

  it("accepts real athletes in both units", () => {
    expect(checkProfileNumbers({ age: 35, bodyWeight: 175, weightUnit: "lbs" })).toBeNull();
    expect(checkProfileNumbers({ age: 35, bodyWeight: 79.4, weightUnit: "kg" })).toBeNull();
    // A unit MIX-UP is undetectable — 80 is a real weight either way — and this
    // deliberately does not guess at one.
    expect(checkProfileNumbers({ bodyWeight: 80, weightUnit: "lbs" })).toBeNull();
  });
});

describe("a 5-rep max with a stray digit", () => {
  it("is honoured all the way to a prescribed working weight", () => {
    // `fiveRmSquat` is a bare `z.number()` — no sign, no ceiling. "2250" for
    // "225" runs a 2,531 lb one-rep max through the scheme intensity and prints
    // the result on every squat in the program.
    const scheme = { intensityPct: 80, rir: 2, emphasis: "strength" } as Parameters<
      typeof suggestedWeight
    >[0];
    expect(suggestedWeight(scheme, "squat", { fiveRmSquat: 225 }, "lbs")).toContain("210 lbs");
    expect(suggestedWeight(scheme, "squat", { fiveRmSquat: 2250 }, "lbs")).toContain("2100 lbs");
  });

  it("is refused, and says which number was wanted", () => {
    const msg = checkStrengthNumbers({ fiveRmSquat: 2250 }, "lbs");
    expect(msg).toContain("5 reps");
    expect(checkStrengthNumbers({ fiveRmSquat: 225 }, "lbs")).toBeNull();
    expect(checkStrengthNumbers({ fiveRmSquat: 102 }, "kg")).toBeNull();
    expect(checkStrengthNumbers({ fiveRmSquat: 1020 }, "kg")).toContain("looks wrong");
  });

  it("refuses a negative one, which is otherwise dropped without a word", () => {
    // `suggestedWeight` guards with `fiveRm > 0`, so a negative entry silently
    // reverts every lift to a "%1RM · RIR" cue with no absolute weight — which
    // reads as a missing feature, not as a bad input.
    expect(checkStrengthNumbers({ fiveRmBench: -185 }, "lbs")).toContain("positive weight");
  });

  it("bounds the bike calorie test too, and ignores blanks", () => {
    expect(checkStrengthNumbers({ bike20MinCals: 320 }, "lbs")).toBeNull();
    expect(checkStrengthNumbers({ bike20MinCals: 32000 }, "lbs")).toContain("looks wrong");
    expect(checkStrengthNumbers({}, "lbs")).toBeNull();
  });
});

describe("the starting-volume overrides", () => {
  it("refuses the 0 that the control invites and the schema forbids", () => {
    // Both inputs carry `min={0}` and are labelled optional; the schema is
    // `z.number().positive()`. A literal 0 therefore looked accepted for four
    // more steps and was refused at the end in Zod's own words. Blank is what
    // the schema means by "none", so the message says blank.
    expect(checkStartingVolume({ startMileage: 0 })).toContain("blank");
    expect(checkStartingVolume({ startCardioMinutes: 0 })).toContain("blank");
  });

  it("keeps the schema's ceilings but explains them", () => {
    expect(checkStartingVolume({ startMileage: 250 })).toContain("typical week");
    expect(checkStartingVolume({ startCardioMinutes: 5000 })).toContain("33 hours");
  });

  it("accepts real numbers and blanks", () => {
    expect(checkStartingVolume({ startMileage: 22, startCardioMinutes: 350 })).toBeNull();
    expect(checkStartingVolume({})).toBeNull();
  });
});

describe("the goal finish time, which one field serves two very different events", () => {
  it("accepts a HYROX goal and a DEKA STRONG one", () => {
    // A band sized to HYROX (~1h) would refuse a correct DEKA STRONG goal of
    // twelve minutes. Sharing one input across a family of events means the
    // check has to be as wide as the family.
    expect(checkBenchmarkTimes({ goalFinishTime: "1:15:00" })).toBeNull();
    expect(checkBenchmarkTimes({ goalFinishTime: "42:00" })).toBeNull();
    expect(checkBenchmarkTimes({ goalFinishTime: "12:30" })).toBeNull();
  });

  it("still catches a missing colon", () => {
    expect(checkBenchmarkTimes({ goalFinishTime: "11500" })).toContain("Goal finish time");
  });
});
