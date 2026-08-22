/**
 * The weekly mileage step has absolute ends (Levi, 2026-08-19).
 *
 * The old rule was purely relative — `min(max(1.5, 7.5%), 10%)` — and a purely
 * relative rule grows every athlete by the same fraction wherever they start.
 * Over a real 16-week goal-event program that measured as 33–48% growth at EVERY
 * starting mileage, which treats "3 → 4.4 mi" and "45 → 60 mi" as equivalent
 * progress.
 *
 * What was actually broken was the two ends:
 *
 *  - a 5 mi/week athlete stepped +0.5 mi, took 36 weeks to reach 15 mpw, and
 *    finished a whole 16-week block peaking at 7.3 mi;
 *  - a 45 mi/week athlete stepped +3.4, a 60 mi athlete +4.5, an 80 mi athlete
 *    +6.0 — the absolute jump growing exactly where it should be flattening.
 *
 * ## The load-bearing test in this file is `THE INTERIOR IS UNTOUCHED`
 *
 * It replays the OLD formula as an oracle across 10–40 mi and asserts the new
 * one agrees to the mile. That is what makes this a safe change rather than a
 * re-tune of everybody's program: the athletes in the middle — most of them —
 * get byte-identical weeks, and if a future edit to `increaseStep` disturbs
 * them, this fails.
 *
 * Against pristine `main` the floor/ceiling/cap tests fail on BEHAVIOUR (they
 * assert numbers, not new exports); the interior test passes there, as it must.
 */
import { describe, it, expect } from "vitest";
import { sequenceMicrocycles } from "./microcycles";
import {
  INCREASE_MILEAGE_MIN_STEP,
  INCREASE_MILEAGE_PCT,
  MAX_INCREASE_MILEAGE_REL_PCT,
  increaseStep,
} from "./volume";

/** The step, as an athlete's own weekly mileage sees it. */
const step = (current: number) =>
  increaseStep(current, INCREASE_MILEAGE_PCT, INCREASE_MILEAGE_MIN_STEP);

describe("THE INTERIOR IS UNTOUCHED — 10 to 40 mi is what it always was", () => {
  /** The pre-2026-08-19 rule, replayed as an oracle. */
  const oldRule = (c: number) =>
    Math.min(
      Math.max(INCREASE_MILEAGE_MIN_STEP, c * INCREASE_MILEAGE_PCT),
      c * MAX_INCREASE_MILEAGE_REL_PCT,
    );

  it("matches the old formula at every half-mile from 10 to 40", () => {
    for (let c = 10; c <= 40; c += 0.5) {
      expect(step(c), `${c} mi`).toBeCloseTo(oldRule(c), 10);
    }
  });

  it("leaves the familiar landmarks alone", () => {
    expect(step(12)).toBeCloseTo(1.2, 10);
    expect(step(15)).toBeCloseTo(1.5, 10);
    expect(step(20)).toBeCloseTo(1.5, 10);
    expect(step(25)).toBeCloseTo(1.875, 10);
    expect(step(30)).toBeCloseTo(2.25, 10);
    expect(step(40)).toBeCloseTo(3.0, 10);
  });
});

describe("the floor — a percentage of a small number is not a training decision", () => {
  it("gives a low-mileage athlete a whole mile instead of half of one", () => {
    // 0.5 mi under the old rule. Half a mile is not a week's progression.
    expect(step(5)).toBeCloseTo(1.0, 10);
    expect(step(8)).toBeCloseTo(1.0, 10);
  });

  it("stops binding once the percentage is worth more", () => {
    // 10 mi is the crossover: 10% = 1.0, so the floor and the rule agree, and
    // above it the percentage takes over cleanly.
    expect(step(10)).toBeCloseTo(1.0, 10);
    expect(step(11)).toBeCloseTo(1.1, 10);
  });

  it("never lets the floor become a reckless relative jump", () => {
    // A flat 1 mi is 33% of a 3 mi week — past the >30% progression Nielsen 2014
    // associated with distance-related injury. The ceiling holds it to 20%.
    expect(step(3)).toBeCloseTo(0.6, 10);
    expect(step(4)).toBeCloseTo(0.8, 10);
    expect(step(2)).toBeCloseTo(0.4, 10);
  });
});

describe("the cap — the absolute jump stops growing where it should flatten", () => {
  it("holds a high-mileage athlete at three miles", () => {
    // 3.375 / 4.5 / 6.0 under the old rule.
    expect(step(45)).toBeCloseTo(3.0, 10);
    expect(step(60)).toBeCloseTo(3.0, 10);
    expect(step(80)).toBeCloseTo(3.0, 10);
  });

  it("takes effect exactly at 40 mi, so nothing below it moves", () => {
    expect(step(40)).toBeCloseTo(3.0, 10);
    expect(step(39.5)).toBeLessThan(3.0);
  });
});

describe("the shape of the whole curve", () => {
  it("is monotonic — more mileage never buys a smaller step", () => {
    let prev = 0;
    for (let c = 1; c <= 100; c += 0.5) {
      const s = step(c);
      expect(s, `went backwards at ${c} mi`).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = s;
    }
  });

  it("never exceeds 20% of current, anywhere", () => {
    for (let c = 1; c <= 100; c += 0.5) {
      expect(step(c) / c, `${c} mi`).toBeLessThanOrEqual(0.2 + 1e-9);
    }
  });

  it("is always a positive step — no athlete ever stalls", () => {
    for (let c = 1; c <= 100; c += 0.5) expect(step(c)).toBeGreaterThan(0);
  });
});

describe("what it does to a real program", () => {
  const peak = (start: number) =>
    Math.max(...sequenceMicrocycles(16, "non_highly_trained", start, 300).heldMileage);

  it("gets a 5 mi/week athlete somewhere over 16 weeks", () => {
    // 8.1 before — a whole block to gain three miles.
    expect(peak(5)).toBeGreaterThan(9);
  });

  it("leaves a 25 mi/week athlete's program exactly where it was", () => {
    expect(peak(25)).toBeCloseTo(35.9, 1);
  });

  it("pulls a 60 mi/week athlete's peak back off 86 miles", () => {
    expect(peak(60)).toBeLessThan(80);
    // …without stalling them: still a real block of growth.
    expect(peak(60)).toBeGreaterThan(70);
  });
});
