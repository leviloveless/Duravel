import { describe, it, expect } from "vitest";
import {
  calibrate,
  expectedAverageHr,
  judgeSession,
  sessionHrShape,
  MIN_SAMPLES,
  NO_CALIBRATION,
  type SessionCalibration,
} from "./hr-calibration";
import { resolveHrModel, zoneBpmRange } from "@/lib/zones";
import { recoveryFactor } from "./interval-structure";
import type { Session } from "@/lib/schemas";

// The athlete from the reported session: max 205, threshold 175 → Friel bands.
const MODEL = resolveHrModel({ age: 27, sex: "male", maxHr: 205, thresholdHr: 175 });

const interval = (): Session => ({
  kind: "run",
  runType: "interval",
  durationMin: 20,
  paceMinMile: "8:07",
  distanceMiles: 2.5,
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

describe("sessionHrShape — the true time structure", () => {
  it("counts the between-rep recovery the stored timing leaves out", () => {
    // N reps have N-1 gaps, so at 1:1 the recovery is 0.8 of the rep time for a
    // 5-rep session — not 1.0. The session's own timing reports 45 min; the truth
    // is 15 warmup + 20 reps + 16 recovery + 10 cooldown.
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
  it("judges a PEAK against the work-zone floor", () => {
    const floor = zoneBpmRange(MODEL, 5).min;
    expect(judgeSession(interval(), { kind: "peak", bpm: floor + 5 }, MODEL)?.verdict).toBe("on_target");
    expect(judgeSession(interval(), { kind: "peak", bpm: floor - 20 }, MODEL)?.verdict).toBe("under");
    expect(judgeSession(interval(), { kind: "peak", bpm: floor + 25 }, MODEL)?.verdict).toBe("over");
  });

  it("judges an AVERAGE against the blended expectation", () => {
    const expected = expectedAverageHr(interval(), MODEL)!;
    expect(judgeSession(interval(), { kind: "average", bpm: expected }, MODEL)?.verdict).toBe("on_target");
    expect(judgeSession(interval(), { kind: "average", bpm: expected - 20 }, MODEL)?.verdict).toBe("under");
  });

  it("the reported session reads as on-target, not under", () => {
    // Peaks of 170/175/175/180 against a Zone 5 floor of 175 — the top three are in
    // band and the first is the cardiac-lag ramp. Judged on the athlete's own
    // threshold-anchored model rather than a generic %HRmax scale.
    const floor = zoneBpmRange(MODEL, 5).min;
    expect(floor).toBeLessThanOrEqual(176);
    const verdicts = [170, 175, 175, 180].map(
      (bpm) => judgeSession(interval(), { kind: "peak", bpm }, MODEL)?.verdict,
    );
    expect(verdicts.filter((v) => v === "on_target").length).toBeGreaterThanOrEqual(3);
  });

  it("returns null for sessions it cannot read", () => {
    expect(judgeSession(easy(), { kind: "peak", bpm: 150 }, MODEL)).toBeNull();
    expect(judgeSession(interval(), { kind: "peak", bpm: 0 }, MODEL)).toBeNull();
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
