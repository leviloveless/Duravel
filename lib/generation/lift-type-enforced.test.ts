/**
 * REGRESSION — the engine owns liftType, all of it (Levi, 2026-08-12).
 *
 * Levi, looking at week 2 of his own program: "Why does week 2 have a full body,
 * then power, then lower body weight session? Shouldn't it be full/power/full?"
 * It should. `researchLiftSplit(3)` returns exactly `["full","power","full"]`.
 *
 * What broke it was an asymmetry in `daySessions`. Runs got their planned type
 * restored unconditionally; lifts got it restored ONLY when the plan said
 * "power". And the AI prompt's enum was "upper|lower|full" — "power" was not
 * even offered — so the model's only renderings of the two non-heavy slots were
 * upper/lower/full. Slot 2 was corrected back to power. Slot 3 came back "lower"
 * and sailed through, because `LiftSessionSchema` accepts all four.
 *
 * It was never cosmetic. Three things silently degrade the moment that third
 * "full" becomes "lower", and each has its own test below:
 *
 *   1. `lightSessions` is every full-body session AFTER the first. One `full`
 *      means the set is empty and the week's LIGHT day never happens — the
 *      athlete gets a second heavy-scheme day instead.
 *   2. `acceptsPattern("lower", "horizontal_press")` is false, so
 *      `spreadPatternSessions` can no longer give upper-body patterns a second
 *      home and the weekly set target goes unmet.
 *   3. `spreadFullLiftTypes` early-exits at `if (f < 2) return`, so the "two
 *      full-body days are never adjacent" guard becomes a no-op for that week.
 *
 * These tests drive `daySessions` directly with an AI payload that returns the
 * WRONG liftTypes — which is exactly what the model did in production.
 */
import { describe, it, expect } from "vitest";
import { daySessions } from "./assemble";
import { researchLiftSplit } from "@/lib/engine/slots";
import type { AiWeek } from "@/lib/schemas";
import type { WeekSkeleton } from "@/lib/engine/types";

type SkelDay = WeekSkeleton["days"][number];

/** A skeleton day carrying the three lift slots the engine plans for a full week. */
function liftDay(types: Array<"full" | "power" | "upper" | "lower">): SkelDay {
  return {
    day: "mon",
    sessions: types.map((liftType) => ({ kind: "lift" as const, liftType })),
  } as SkelDay;
}

/** What the model actually returns: everything typed from "upper|lower|full". */
function aiWeek(types: Array<"full" | "power" | "upper" | "lower">): AiWeek {
  return {
    weekNumber: 2,
    days: [
      {
        day: "mon",
        sessions: types.map((liftType) => ({
          kind: "lift" as const,
          liftType,
          movements: [{ pattern: "squat" as const, sets: 3, repRange: "5-7" }],
        })),
      },
    ],
  } as unknown as AiWeek;
}

describe("the engine's planned liftType survives whatever the AI returns", () => {
  it("restores full/power/full when the AI returns full/full/lower", () => {
    const issues: string[] = [];
    // Precisely the production shape: the model has no "power" in its enum, so
    // it renders the power slot as "full" and the light slot as "lower".
    const out = daySessions(
      liftDay(["full", "power", "full"]),
      aiWeek(["full", "full", "lower"]),
      issues,
      2,
    );
    expect(out.map((s) => (s.kind === "lift" ? s.liftType : s.kind))).toEqual([
      "full",
      "power",
      "full",
    ]);
  });

  it("keeps the week's LIGHT day, which one surviving full-body session destroys", () => {
    const issues: string[] = [];
    const out = daySessions(
      liftDay(["full", "power", "full"]),
      aiWeek(["full", "full", "lower"]),
      issues,
      2,
    );
    const lifts = out.filter((s) => s.kind === "lift");
    const fullBody = lifts.filter((s) => s.kind === "lift" && s.liftType === "full");
    // `applyStrengthSchemes` runs light on every full-body day after the first.
    // Two fulls → exactly one light day. The bug left one full → zero.
    expect(fullBody).toHaveLength(2);
    expect(fullBody.slice(1)).toHaveLength(1);
  });

  it("never leaves a planned slot on a type that refuses upper-body patterns", () => {
    const issues: string[] = [];
    const out = daySessions(
      liftDay(["full", "power", "full"]),
      aiWeek(["lower", "lower", "lower"]),
      issues,
      2,
    );
    // A "lower" day accepts only squat/hip_hinge/lunge, so a week of them gives
    // `spreadPatternSessions` nowhere to put a press or a pull.
    for (const s of out) {
      if (s.kind === "lift") expect(s.liftType).not.toBe("lower");
    }
  });

  it("still honours the plan when the plan itself is an upper/lower split", () => {
    const issues: string[] = [];
    // The legacy (no weekly-hours band) path plans ["full","upper","lower"].
    // Enforcement must follow the PLAN, not hard-code the research split.
    const out = daySessions(
      liftDay(["full", "upper", "lower"]),
      aiWeek(["full", "full", "full"]),
      issues,
      2,
    );
    expect(out.map((s) => (s.kind === "lift" ? s.liftType : s.kind))).toEqual([
      "full",
      "upper",
      "lower",
    ]);
  });

  it("leaves the AI's own content alone — only the type is corrected", () => {
    const issues: string[] = [];
    const out = daySessions(liftDay(["power"]), aiWeek(["lower"]), issues, 2);
    const lift = out[0]!;
    if (lift.kind !== "lift") throw new Error("expected a lift");
    expect(lift.liftType).toBe("power");
    expect(lift.movements).toEqual([{ pattern: "squat", sets: 3, repRange: "5-7" }]);
    expect(issues).toEqual([]);
  });

  it("agrees with the split the engine actually plans", () => {
    // Guards the pair: if `researchLiftSplit` ever changes shape, the fixture
    // above stops describing a real week and this test says so.
    expect(researchLiftSplit(3)).toEqual(["full", "power", "full"]);
    expect(researchLiftSplit(2)).toEqual(["full", "power"]);
    expect(researchLiftSplit(1)).toEqual(["full"]);
  });
});
