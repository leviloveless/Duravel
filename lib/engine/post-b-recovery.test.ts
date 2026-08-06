import { describe, it, expect } from "vitest";
import { buildSkeleton } from "./skeleton";
import type { EngineInput, TrainingDayName, WeekSkeleton } from "./types";

/**
 * The week after a B race gets a rest day + two easy days (the post-race
 * protocol). That overwrites the first three training days — and it used to
 * DELETE whatever was scheduled there. An athlete who pins their lifts to
 * early-week days therefore lost every one of them, leaving a full Build week
 * with zero strength work.
 *
 * Displaced lift/hybrid sessions must now be re-homed later in the same week.
 * Runs are deliberately not carried over: the volume reconciler re-sizes the
 * remaining runs to hit the week's prescribed mileage exactly, so a dropped run
 * costs nothing, whereas a dropped lift or hybrid is simply gone.
 */

const ALL: TrainingDayName[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

const base = (over: Partial<EngineInput> = {}): EngineInput => ({
  sport: "hyrox",
  trainingClass: "non_highly_trained",
  runningExp: "intermediate",
  hybridExp: "intermediate",
  liftingExp: "intermediate",
  programType: "goal_event",
  durationWeeks: 16,
  trainingDays: ALL,
  races: [
    { weekNumber: 7, priority: "B" },
    { weekNumber: 16, priority: "A" },
  ],
  ...over,
});

const countKind = (w: WeekSkeleton, kind: string) =>
  w.days.flatMap((d) => d.sessions).filter((s) => s.kind === kind).length;

describe("post-B-race recovery keeps the week's strength + hybrid work", () => {
  it("the week after a B race still has lifts", () => {
    const sk = buildSkeleton(base());
    const after = sk.weeks[7]!; // week 8, 1-based → index 7
    expect(countKind(after, "lift")).toBeGreaterThan(0);
  });

  it("re-homes displaced work rather than deleting it", () => {
    const sk = buildSkeleton(base());
    const after = sk.weeks[7]!;
    const normal = sk.weeks[4]!; // a comparable non-recovery week
    // The recovery week should carry the same amount of strength work as a
    // normal week of the same shape — it is a RECOVERY week for running, not a
    // week where the barbell silently disappears.
    expect(countKind(after, "lift")).toBe(countKind(normal, "lift"));
  });

  it("still applies the protocol: rest, then two easy days", () => {
    const sk = buildSkeleton(base());
    const d = sk.weeks[7]!.days;
    expect(d[0]!.sessions).toEqual([{ kind: "rest" }]);
    expect(d[1]!.sessions.some((s) => s.kind === "run" && s.runType === "easy")).toBe(true);
    expect(d[2]!.sessions.some((s) => s.kind === "run" && s.runType === "easy")).toBe(true);
  });

  it("never stacks more than 2 workouts or 2 lifts on a re-homed day", () => {
    const sk = buildSkeleton(base({ liftDays: ["mon", "tue", "wed"] }));
    for (const day of sk.weeks[7]!.days) {
      expect(day.sessions.filter((s) => s.kind !== "rest").length).toBeLessThanOrEqual(2);
      expect(day.sessions.filter((s) => s.kind === "lift").length).toBeLessThanOrEqual(1);
    }
  });

  it("holds when the athlete pins lifts to the days the protocol overwrites", () => {
    // The reported case: lifts on early-week days, all three wiped by recovery.
    const sk = buildSkeleton(
      base({ liftDays: ["mon", "tue", "wed"], longRunDays: ["sat"], restDays: [] }),
    );
    expect(countKind(sk.weeks[7]!, "lift")).toBeGreaterThan(0);
  });

  it("leaves weeks that don't follow a B race untouched", () => {
    const withB = buildSkeleton(base());
    const withoutB = buildSkeleton(base({ races: [{ weekNumber: 16, priority: "A" }] }));
    // Week 5 precedes the B race in both — identical either way.
    expect(JSON.stringify(withB.weeks[4])).toBe(JSON.stringify(withoutB.weeks[4]));
  });
});

/**
 * REGRESSION (Levi, 2026-08-06) — the recovery pass runs LAST, after every guard
 * inside `assignDays`, and used to receive no day preferences at all. It was the
 * only mover in the engine with no `protectedDays` concept, so it could undo
 * exactly what every other pass had just guaranteed.
 */
describe("post-B-race recovery respects day preferences", () => {
  const dayOf = (w: WeekSkeleton, day: TrainingDayName) => w.days.find((d) => d.day === day)!;
  const isLongRun = (s: { kind: string; isLong?: boolean; runType?: string }) =>
    s.kind === "run" && (s.isLong === true || s.runType === "long");

  it("never writes an easy run onto a preferred rest day", () => {
    // "tue" is the SECOND training day — squarely inside the protocol window,
    // and the slot the protocol used to fill with an easy run unconditionally.
    const sk = buildSkeleton(base({ restDays: ["tue"] }));
    expect(dayOf(sk.weeks[7]!, "tue").sessions).toEqual([{ kind: "rest" }]);
  });

  it("never re-homes displaced work ONTO a preferred rest day", () => {
    const sk = buildSkeleton(
      base({ restDays: ["sun"], liftDays: ["mon", "tue", "wed"], longRunDays: ["sat"] }),
    );
    expect(dayOf(sk.weeks[7]!, "sun").sessions.filter((s) => s.kind !== "rest")).toEqual([]);
  });

  it("keeps the long run when it was pinned to a day the protocol overwrites", () => {
    // An athlete who runs long on Monday: index 0 is the rest day, so the long
    // run used to be deleted outright — only lifts and hybrids were rescued.
    const sk = buildSkeleton(base({ longRunDays: ["mon"], restDays: [] }));
    const after = sk.weeks[7]!;
    expect(after.days.flatMap((d) => d.sessions).filter(isLongRun).length).toBe(1);
    // ...and it lands after the recovery window, not back on top of it.
    const idx = after.days.findIndex((d) => d.sessions.some(isLongRun));
    expect(idx).toBeGreaterThanOrEqual(3);
  });

  it("never ends up with two long runs in the recovery week", () => {
    for (const longRunDays of [["mon"], ["tue"], ["wed"], ["sat"]] as TrainingDayName[][]) {
      const after = buildSkeleton(base({ longRunDays })).weeks[7]!;
      expect(
        after.days.flatMap((d) => d.sessions).filter(isLongRun).length,
        `${longRunDays}`,
      ).toBeLessThanOrEqual(1);
    }
  });

  it("still honours the protocol on the days that are NOT protected", () => {
    const d = buildSkeleton(base({ restDays: ["tue"] })).weeks[7]!.days;
    expect(d[0]!.sessions).toEqual([{ kind: "rest" }]); // mon — rest
    expect(d[1]!.sessions).toEqual([{ kind: "rest" }]); // tue — protected, stays rest
    expect(d[2]!.sessions.some((s) => s.kind === "run" && s.runType === "easy")).toBe(true);
  });

  it("still caps the recovery week at 2 workouts and 1 lift a day", () => {
    const sk = buildSkeleton(
      base({ restDays: ["sun"], liftDays: ["mon", "tue", "wed"], longRunDays: ["mon"] }),
    );
    for (const day of sk.weeks[7]!.days) {
      expect(day.sessions.filter((s) => s.kind !== "rest").length).toBeLessThanOrEqual(2);
      expect(day.sessions.filter((s) => s.kind === "lift").length).toBeLessThanOrEqual(1);
    }
  });
});
