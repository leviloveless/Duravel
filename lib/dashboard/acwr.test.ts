/**
 * ACWR as the athlete reads it (Levi, 2026-09-20).
 *
 * The assertions that matter are the COLD START ones. A 28-day window on day 10
 * of a program is mostly zeros; divide by it and the ratio explodes, and the
 * athlete is told they are spiking during the easiest fortnight of their block.
 * That is the failure this file exists to prevent.
 */
import { describe, it, expect } from "vitest";
import { acwrSeries, weeklyAcwr, acwrBand, ACWR_LOW, ACUTE_DAYS, CHRONIC_DAYS } from "./acwr";
import { ADAPT } from "@/lib/engine/adapt-config";
import { addDays } from "./fitness";

const START = "2026-01-05"; // a Monday

/** A load map with `perDay` on every day from START for `days` days. */
function steady(days: number, perDay: number): Map<string, number> {
  const m = new Map<string, number>();
  for (let i = 0; i < days; i++) m.set(addDays(START, i), perDay);
  return m;
}

describe("the cold start", () => {
  it("reports nothing until three weeks of history exist", () => {
    const load = steady(60, 50);
    const pts = acwrSeries(load, START, addDays(START, 40));
    const minDays = ADAPT.ACWR_MIN_WEEKS * 7;
    // Day index 0 is day 1 of the program, so the first ratio lands at index
    // minDays - 1.
    for (let i = 0; i < minDays - 1; i++) expect(pts[i]!.acwr, `day ${i + 1}`).toBeNull();
    expect(pts[minDays - 1]!.acwr).not.toBeNull();
  });

  it("does not manufacture a spike out of days before the program began", () => {
    // THE BUG THIS PREVENTS. A flat divisor of 4 weeks would measure week 3's
    // seven days against 28 days of which 7 never happened, reporting ~1.75 for
    // an athlete who has done exactly the same thing every single day.
    const load = steady(60, 50);
    const pts = acwrSeries(load, START, addDays(START, 40));
    const first = pts.find((p) => p.acwr !== null)!;
    expect(first.acwr).toBeCloseTo(1, 2);
  });

  it("is 1.0 the whole way through a perfectly steady block", () => {
    const pts = acwrSeries(steady(60, 50), START, addDays(START, 59));
    for (const p of pts) if (p.acwr !== null) expect(p.acwr, p.date).toBeCloseTo(1, 2);
  });
});

describe("the ratio", () => {
  it("rises when the last week is bigger than the month behind it", () => {
    const load = steady(60, 50);
    for (let i = 53; i < 60; i++) load.set(addDays(START, i), 150); // triple the last week
    const pts = acwrSeries(load, START, addDays(START, 59));
    expect(pts[pts.length - 1]!.acwr!).toBeGreaterThan(1.5);
  });

  it("falls in a taper", () => {
    const load = steady(60, 50);
    for (let i = 53; i < 60; i++) load.set(addDays(START, i), 10);
    const pts = acwrSeries(load, START, addDays(START, 59));
    expect(pts[pts.length - 1]!.acwr!).toBeLessThan(ACWR_LOW);
  });

  it("uses a 7-day numerator and a 28-day weekly-equivalent denominator", () => {
    // Stated as arithmetic rather than trusting the shape: with 40 a day, the
    // acute window is 7 x 40 and the chronic weekly equivalent is also 7 x 40.
    const pts = acwrSeries(steady(60, 40), START, addDays(START, 59));
    const last = pts[pts.length - 1]!;
    expect(last.acute).toBe(ACUTE_DAYS * 40);
    expect(last.chronic).toBe(Math.round((CHRONIC_DAYS * 40) / (CHRONIC_DAYS / 7)));
  });

  it("counts rest days as zero rather than skipping them", () => {
    // Train Mon-Fri, rest the weekend, forever. The ratio must still be ~1: a
    // series that only sampled training days would be blind to the rest.
    const load = new Map<string, number>();
    for (let i = 0; i < 60; i++) {
      const dow = i % 7;
      if (dow < 5) load.set(addDays(START, i), 70);
    }
    const pts = acwrSeries(load, START, addDays(START, 59));
    expect(pts[pts.length - 1]!.acwr!).toBeCloseTo(1, 1);
  });

  it("reports null rather than Infinity when nothing has been logged", () => {
    const pts = acwrSeries(new Map(), START, addDays(START, 40));
    for (const p of pts) expect(p.acwr).toBeNull();
  });
});

describe("the bands follow the engine's own thresholds", () => {
  it("does not restate ACWR_CAUTION or ACWR_SPIKE", () => {
    // If Levi retunes the engine, the bands on screen move with it. A hard-coded
    // 1.3 here would fork silently the first time he did.
    expect(acwrBand(ADAPT.ACWR_SPIKE)).toBe("high");
    expect(acwrBand(ADAPT.ACWR_SPIKE - 0.01)).toBe("caution");
    expect(acwrBand(ADAPT.ACWR_CAUTION)).toBe("caution");
    expect(acwrBand(ADAPT.ACWR_CAUTION - 0.01)).toBe("optimal");
  });

  it("names the low end too", () => {
    expect(acwrBand(ACWR_LOW)).toBe("optimal");
    expect(acwrBand(ACWR_LOW - 0.01)).toBe("low");
    expect(acwrBand(0)).toBe("low");
  });
});

describe("the weekly view", () => {
  const weekStartISO = (n: number) => addDays(START, (n - 1) * 7);

  it("gives one row per week that has started", () => {
    const load = steady(60, 50);
    // Week n starts at day-index (n-1)*7, so week 6's Monday is index 35.
    // Standing on index 34 — the Sunday of week 5 — weeks 1-5 have begun and
    // week 6 has not yet.
    const rows = weeklyAcwr(load, weekStartISO, [1, 2, 3, 4, 5, 6, 7, 8], addDays(START, 34));
    expect(rows.map((r) => r.weekNumber)).toEqual([1, 2, 3, 4, 5]);
    expect(
      weeklyAcwr(load, weekStartISO, [1, 2, 3, 4, 5, 6], addDays(START, 35)).at(-1)!.weekNumber,
    ).toBe(6);
  });

  it("reads a finished week on its Sunday and the current week on today", () => {
    const load = steady(60, 50);
    const today = addDays(START, 37); // Thursday of week 6
    const rows = weeklyAcwr(load, weekStartISO, [1, 2, 3, 4, 5, 6], today);
    const wk5 = rows.find((r) => r.weekNumber === 5)!;
    const wk6 = rows.find((r) => r.weekNumber === 6)!;
    expect(wk5.end).toBe(addDays(weekStartISO(5), 6)); // its own Sunday
    expect(wk6.end).toBe(today); // part-finished, reported at today
  });

  it("shows the current week rather than waiting for Sunday", () => {
    // The whole reason `end` clamps to today: an athlete checking on Wednesday
    // should see this week, not a blank row.
    const rows = weeklyAcwr(steady(60, 50), weekStartISO, [1, 2, 3, 4, 5], addDays(START, 30));
    expect(rows[rows.length - 1]!.weekNumber).toBe(5);
    expect(rows[rows.length - 1]!.acwr).not.toBeNull();
  });

  it("catches a week that spiked", () => {
    const load = steady(60, 50);
    for (let i = 28; i < 35; i++) load.set(addDays(START, i), 200); // week 5
    const rows = weeklyAcwr(load, weekStartISO, [1, 2, 3, 4, 5], addDays(START, 34));
    const wk5 = rows.find((r) => r.weekNumber === 5)!;
    expect(wk5.band).toBe("high");
  });
});
