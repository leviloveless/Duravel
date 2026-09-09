import { describe, it, expect } from "vitest";
import {
  calibrate,
  expectedAverageHr,
  expectedPeakHr,
  judgeSession,
  sessionHrShape,
  MIN_SAMPLES,
  NO_CALIBRATION,
  type SessionCalibration,
} from "./hr-calibration";
import { resolveHrModel, zoneBpmRange } from "@/lib/zones";
import { recoveryFactor, repsForWorkMiles } from "./interval-structure";
import { repPeakBpm, tempoBandBpm, HR_LINE_PREFIX } from "./hr-targets";
import { runDescription } from "./run-descriptions";
import type { Session } from "@/lib/schemas";

// The athlete from the reported session: max 205, threshold 175 → Friel bands.
const MODEL = resolveHrModel({ age: 27, sex: "male", maxHr: 205, thresholdHr: 175 });

/** The work distance the reported session was reconciled to — 4 x 1 km. */
const INTERVAL_MILES = 2.5;

const interval = (): Session => ({
  kind: "run",
  runType: "interval",
  durationMin: 20,
  paceMinMile: "8:07",
  distanceMiles: INTERVAL_MILES,
  goalZone: 5,
});
const easy = (): Session => ({
  kind: "run",
  runType: "easy",
  durationMin: 40,
  paceMinMile: "10:33",
  distanceMiles: 4,
  goalZone: 2,
});

/**
 * The peaks the athlete's PRESCRIPTION prints for this session, computed the way
 * the description path computes them: rep count off the run's work distance (the
 * reconciler resizes it), peaks off the athlete's own zone model. Deliberately
 * NOT via `expectedPeakHr` — the whole point is that two independently-derived
 * numbers now agree.
 */
const printedPeaks = (s: Session): number[] => {
  if (s.kind !== "run") return [];
  const reps = repsForWorkMiles(s.runType, s.distanceMiles, "intermediate") ?? 0;
  return repPeakBpm(MODEL, s.goalZone as 1 | 2 | 3 | 4 | 5, s.runType, reps);
};
const lastPrintedPeak = (s: Session): number => printedPeaks(s).at(-1)!;

describe("sessionHrShape — the true time structure", () => {
  it("counts the between-rep recovery the stored timing leaves out", () => {
    // N reps have N-1 gaps, so at 1:1 the recovery is 0.8 of the rep time for a
    // 5-rep session — not 1.0. The session's own timing reports 45 min; the truth
    // is 15 warmup (7 jogged, 8 on the bike) + 20 reps + 16 recovery + 10
    // cooldown. Moving part of the warm-up off the feet changed its MILEAGE, not
    // its minutes or its zone, so this shape is unchanged.
    const rec = 20 * recoveryFactor("interval", "intermediate");
    expect(sessionHrShape(interval())).toEqual({ workMin: 20, easyMin: 15 + 10 + rec, totalMin: 20 + 15 + 10 + rec });
    expect(rec).toBeCloseTo(16, 5);
  });

  it("prefers the recovery the session actually carries", () => {
    const s = { ...interval(), recoveryMin: 12 };
    expect(sessionHrShape(s)?.easyMin).toBe(15 + 10 + 12);
  });

  it("uses 2:1 for threshold and nothing for tempo", () => {
    const th = { ...interval(), runType: "threshold" as const, durationMin: 20 };
    expect(sessionHrShape(th)?.easyMin).toBeCloseTo(12 + 8 + 20 * recoveryFactor("threshold", "intermediate"), 5);
    const tempo = { ...interval(), runType: "tempo" as const, durationMin: 30 };
    expect(sessionHrShape(tempo)?.easyMin).toBe(12 + 8); // continuous — no recovery
  });

  it("ignores sessions with no sharp HR target", () => {
    expect(sessionHrShape(easy())).toBeNull();
  });
});

describe("expectedAverageHr — why a session average can't be judged against the work zone", () => {
  it("a perfectly-executed session would read as UNDER if judged against the work zone", () => {
    // This is the trap, demonstrated rather than asserted with a magic number: take
    // a session whose average is exactly what the prescription implies, then judge
    // it both ways. Against the blended expectation it is on target; against the
    // work-zone floor — the naive comparison — it is "under", and would be every
    // time, forever.
    const expected = expectedAverageHr(interval(), MODEL)!;
    const workFloor = zoneBpmRange(MODEL, 5).min;
    expect(expected).toBeLessThan(workFloor);
    expect(judgeSession(interval(), { kind: "average", bpm: expected }, MODEL)?.verdict).toBe("on_target");
    expect(judgeSession(interval(), { kind: "peak", bpm: expected }, MODEL)?.verdict).toBe("under");
  });

  it("is bounded by the two zones it blends", () => {
    const expected = expectedAverageHr(interval(), MODEL)!;
    const z2 = zoneBpmRange(MODEL, 2);
    const z5 = zoneBpmRange(MODEL, 5);
    expect(expected).toBeGreaterThan(z2.min);
    expect(expected).toBeLessThan(z5.max);
  });
});

describe("judgeSession", () => {
  it("judges a PEAK against the last rep's PRINTED estimate", () => {
    // The bar is the number the athlete's own prescription states as the top of
    // its HR line, not the flat floor of the work zone. For this session those
    // are 18 bpm apart, so the two comparisons do not merely round differently —
    // they reach opposite verdicts.
    const target = lastPrintedPeak(interval());
    expect(judgeSession(interval(), { kind: "peak", bpm: target }, MODEL)?.expected).toBe(target);
    expect(judgeSession(interval(), { kind: "peak", bpm: target }, MODEL)?.verdict).toBe(
      "on_target",
    );
    expect(judgeSession(interval(), { kind: "peak", bpm: target - 20 }, MODEL)?.verdict).toBe(
      "under",
    );
    expect(judgeSession(interval(), { kind: "peak", bpm: target + 20 }, MODEL)?.verdict).toBe(
      "over",
    );
  });

  it("agrees with the bpm the session TEXT actually prints", () => {
    // The guard that matters most, because it crosses the seam the bug lived on:
    // parse the figure out of the HR line the athlete reads, and require the judge
    // to be measuring against that exact number. Nothing in between may re-derive
    // it, round it differently, or substitute a zone bound for it.
    const s = interval();
    const reps = repsForWorkMiles("interval", INTERVAL_MILES, "intermediate")!;
    const text = runDescription("interval", "intermediate", null, reps, {
      model: MODEL,
      goalZone: 5,
    });
    const line = text.split("\n").find((l) => l.startsWith(`${HR_LINE_PREFIX}reps:`))!;
    const printed = Number(/- (\d+) by the end of rep \d+$/.exec(line)![1]);
    const judged = judgeSession(s, { kind: "peak", bpm: printed }, MODEL)!;
    expect(judged.expected).toBe(printed);
    expect(judged.deltaBpm).toBe(0);
  });

  it("hitting the prescription exactly is never a verdict against the athlete", () => {
    // THE BUG, in the two directions it ran. Judged against the Zone 5 floor, an
    // athlete who peaked exactly where the text told them to read as "over" on a
    // multi-rep session (the last rep's estimate sits well above the floor) and
    // as "under" on a single-rep one (rep 1's estimate sits below it, by design,
    // because heart rate is still climbing when a rep ends). Both verdicts drive
    // a pace-model suggestion, so both were an adaptation firing on nothing.
    const floor = zoneBpmRange(MODEL, 5).min;
    for (const session of [interval(), { ...interval(), distanceMiles: 0.62 }]) {
      const target = lastPrintedPeak(session);
      expect(judgeSession(session, { kind: "peak", bpm: target }, MODEL)?.verdict).toBe(
        "on_target",
      );
      // ...and the naive comparison would have said something else.
      expect(Math.abs(target - floor)).toBeGreaterThan(5);
    }
  });

  it("uses the LAST rep's estimate, never the first — HR is a back-half signal", () => {
    const peaks = printedPeaks(interval());
    expect(peaks.length).toBeGreaterThan(1);
    expect(expectedPeakHr(interval(), MODEL)).toBe(peaks[peaks.length - 1]);
    expect(expectedPeakHr(interval(), MODEL)).not.toBe(peaks[0]);
  });

  it("follows the rep count the run was RESIZED to, not the experience default", () => {
    // The reconciler resizes every quality run to make the week hit its mileage,
    // and the printed HR line follows that resize. A longer session climbs closer
    // to its ceiling, so its bar is higher — judging both against one number would
    // put the same athlete on the wrong side of it for half their sessions.
    const short = { ...interval(), distanceMiles: 1.24 }; // 2 reps
    const long = { ...interval(), distanceMiles: 3.73 }; // 6 reps
    expect(expectedPeakHr(short, MODEL)).toBe(lastPrintedPeak(short));
    expect(expectedPeakHr(long, MODEL)).toBe(lastPrintedPeak(long));
    expect(expectedPeakHr(long, MODEL)!).toBeGreaterThan(expectedPeakHr(short, MODEL)!);
  });

  it("judges a TEMPO peak against the drifted end of its band", () => {
    // Tempo is continuous, so there is no last rep — the analogous number is where
    // the band the prescription prints finishes.
    const t = { ...interval(), runType: "tempo" as const, goalZone: 3, durationMin: 30 };
    const end = tempoBandBpm(MODEL, 3).end;
    expect(expectedPeakHr(t, MODEL)).toBe(end);
    expect(end).not.toBe(zoneBpmRange(MODEL, 3).min);
    expect(judgeSession(t, { kind: "peak", bpm: end }, MODEL)?.verdict).toBe("on_target");
  });

  it("judges an AVERAGE against the blended expectation", () => {
    const expected = expectedAverageHr(interval(), MODEL)!;
    expect(judgeSession(interval(), { kind: "average", bpm: expected }, MODEL)?.verdict).toBe("on_target");
    expect(judgeSession(interval(), { kind: "average", bpm: expected - 20 }, MODEL)?.verdict).toBe("under");
  });

  it("still reads the athlete's own model, not a generic %HRmax scale", () => {
    // What the original report was about, and what must survive the change: an
    // athlete with a measured threshold HR is judged off THEIR Zone 5, so their
    // logged peaks land in band instead of being scored against 93% of an
    // age-estimated max.
    expect(zoneBpmRange(MODEL, 5).min).toBeLessThanOrEqual(176);
    const estimated = resolveHrModel({ age: 27, sex: "male" });
    expect(expectedPeakHr(interval(), MODEL)).not.toBe(expectedPeakHr(interval(), estimated));
  });

  it("returns null for sessions it cannot read", () => {
    expect(judgeSession(easy(), { kind: "peak", bpm: 150 }, MODEL)).toBeNull();
    expect(judgeSession(interval(), { kind: "peak", bpm: 0 }, MODEL)).toBeNull();
    expect(expectedPeakHr(easy(), MODEL)).toBeNull();
  });
});

describe("calibrate", () => {
  const sample = (deltaBpm: number): SessionCalibration => ({
    weekNumber: 1,
    runType: "interval",
    reading: { kind: "peak", bpm: 170 },
    expected: 170 - deltaBpm,
    deltaBpm,
    verdict: deltaBpm < -5 ? "under" : deltaBpm > 5 ? "over" : "on_target",
  });

  it("says nothing below the sample floor — one HR trace proves nothing", () => {
    expect(calibrate([])).toEqual(NO_CALIBRATION);
    expect(calibrate([sample(-20), sample(-20)]).verdict).toBe("insufficient_data");
    expect(calibrate(Array.from({ length: MIN_SAMPLES }, () => sample(-20))).verdict).toBe("under");
  });

  it("under-shooting suggests FASTER paces — the 5K input understates fitness", () => {
    const c = calibrate(Array.from({ length: 4 }, () => sample(-20)));
    expect(c.verdict).toBe("under");
    expect(c.suggestedPaceShift).toBeLessThan(0);
    expect(c.message).toMatch(/below target/);
  });

  it("over-shooting suggests easing off", () => {
    const c = calibrate(Array.from({ length: 4 }, () => sample(20)));
    expect(c.verdict).toBe("over");
    expect(c.suggestedPaceShift).toBeGreaterThan(0);
  });

  it("caps the suggestion at 3% however extreme the data", () => {
    const c = calibrate(Array.from({ length: 6 }, () => sample(-60)));
    expect(Math.abs(c.suggestedPaceShift)).toBeLessThanOrEqual(0.03);
  });

  it("reports on-target without suggesting a change", () => {
    const c = calibrate(Array.from({ length: 5 }, () => sample(2)));
    expect(c.verdict).toBe("on_target");
    expect(c.suggestedPaceShift).toBe(0);
    expect(c.message).toMatch(/landing in their prescribed zones/);
  });

  it("a mixed week averages out rather than firing on one bad session", () => {
    const c = calibrate([sample(-25), sample(3), sample(5), sample(2)]);
    expect(c.verdict).toBe("on_target");
  });
});
