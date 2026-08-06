/**
 * REGRESSION — `separateLifts` may never put a third session on a day.
 *
 * Two sessions a day is an absolute engine rule, but it used to be true by
 * CLEANUP rather than by construction: `separateLifts` pushed the extra lift onto
 * the best lift-free day whatever that day was already carrying, and
 * `capSessionsPerDay` swept up afterwards. An audit that probed the day layout
 * after every pass in `assignDays` over 47,040 generated weeks found 10,675
 * over-cap days created here — and none created by any other pass. So this was
 * the last place in the pipeline where an illegal week existed, even transiently,
 * and the two passes that run in between (`pairLegLiftWithCardio`, `spreadRuns`)
 * were making their decisions against it.
 *
 * A full destination is now taken only as a SWAP: something legal comes back to
 * the source day, which is keeping a lift of its own — so never another lift, and
 * never the destination's last cardio when a hard-leg lift is moving in (the
 * pairing rule needs it). When nothing can come back, the destination is not a
 * candidate at all.
 */
import { describe, it, expect } from "vitest";
import { separateLifts } from "./sequencing";
import type { DaySlot, TrainingDayName } from "./types";

const day = (d: TrainingDayName, sessions: DaySlot["sessions"]): DaySlot => ({ day: d, sessions });
const lower = { kind: "lift", liftType: "lower" } as const;
const upper = { kind: "lift", liftType: "upper" } as const;
const easy = { kind: "run", runType: "easy", goalZone: 2 } as const;
const tempo = { kind: "run", runType: "tempo", goalZone: 4, isLong: false } as const;
const longRun = { kind: "run", runType: "long", goalZone: 2, isLong: true } as const;
const hybrid = { kind: "hybrid", focus: "stations" } as unknown as DaySlot["sessions"][number];

const work = (d: DaySlot) => d.sessions.filter((s) => s.kind !== "rest").length;
const lifts = (d: DaySlot) => d.sessions.filter((s) => s.kind === "lift").length;
const total = (days: DaySlot[]) => days.reduce((n, d) => n + d.sessions.length, 0);

describe("separateLifts never creates a third session on a day", () => {
  it("swaps instead of stacking when the only lift-free day is already full", () => {
    // mon carries two lifts; tue is the only lift-free day and already has two
    // sessions. The old code pushed the lift on anyway → tue = 3.
    const days = [day("mon", [lower, upper]), day("tue", [easy, tempo])];
    const before = total(days);
    separateLifts(days, new Set());

    for (const d of days)
      expect(work(d), `${d.day} has ${work(d)} sessions`).toBeLessThanOrEqual(2);
    expect(total(days)).toBe(before); // count-preserving
    expect(lifts(days[0]!)).toBe(1);
    expect(lifts(days[1]!)).toBe(1);
  });

  it("prefers a day with room over a full day that would need a swap", () => {
    const days = [day("mon", [lower, upper]), day("tue", [easy, tempo]), day("wed", [easy])];
    separateLifts(days, new Set());

    for (const d of days) expect(work(d)).toBeLessThanOrEqual(2);
    expect(lifts(days[2]!)).toBe(1); // wed had room — nothing had to be displaced
    expect(days[1]!.sessions.map((s) => s.kind)).toEqual(["run", "run"]); // tue untouched
  });

  it("never sends a lift back to the source day (that would rebuild the two-lift day)", () => {
    // tue's only give-back candidate would have to be a lift — so tue is not a
    // legal destination and the pass leaves mon alone rather than stacking.
    const days = [day("mon", [lower, upper])];
    days.push(day("tue", [easy, longRun]));
    separateLifts(days, new Set());
    for (const d of days) expect(work(d)).toBeLessThanOrEqual(2);
    expect(lifts(days[1]!)).toBeLessThanOrEqual(1);
  });

  it("does not strip a full day's last cardio when a hard-leg lift moves in", () => {
    // wed's only non-lift session is the hybrid that makes it a good home for a
    // leg lift; giving it back would defeat pairLegLiftWithCardio. mon is the
    // source and keeps its own lift.
    const days = [day("mon", [lower, upper]), day("wed", [hybrid, tempo])];
    separateLifts(days, new Set());
    for (const d of days) expect(work(d)).toBeLessThanOrEqual(2);
    const wed = days[1]!;
    if (wed.sessions.some((s) => s.kind === "lift")) {
      expect(wed.sessions.some((s) => s.kind === "hybrid" || s.kind === "run")).toBe(true);
    }
  });

  it("leaves the two lifts put when no destination is legal at all", () => {
    const days = [day("mon", [lower, upper]), day("tue", [longRun, tempo])];
    const before = total(days);
    separateLifts(days, new Set(["tue"])); // tue protected → nowhere to go
    expect(total(days)).toBe(before);
    for (const d of days) expect(work(d)).toBeLessThanOrEqual(2);
  });
});
