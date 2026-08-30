/**
 * THE GOAL BELONGS IN THE TITLE (Levi, 2026-08-25: "put the workout goal in the
 * title rather than on each line of the workout").
 *
 * The awkward case is the one to guard: a heavy full-body day runs max strength
 * throughout EXCEPT the lunge and the chest fly, which are muscular endurance by
 * design. Measured across 196 generated lift sessions, 10% mix two goals. The
 * title names the dominant goal and only the departures keep a line label — so a
 * 15-rep lunge under a "Max strength" title still reads as deliberate.
 */
import { describe, it, expect } from "vitest";
import { sessionTypeLabel, sessionEmphasis } from "./session-labels";
import { movementLine } from "@/components/program/format";
import type { Session } from "@/lib/schemas";

const lift = (liftType: string, emphases: (string | undefined)[]): Session =>
  ({
    kind: "lift",
    liftType,
    movements: emphases.map((emphasis, i) => ({
      pattern: "squat",
      exercise: `Move ${i + 1}`,
      sets: 3,
      repRange: "5",
      emphasis,
    })),
  }) as unknown as Session;

describe("the session title carries the goal", () => {
  it("names it for a heavy full-body day", () => {
    expect(sessionTypeLabel(lift("full", ["max_strength", "max_strength"]))).toBe(
      "Full body lift · Max strength",
    );
  });

  it("names it for a light day", () => {
    expect(sessionTypeLabel(lift("full", ["endurance", "endurance"]))).toBe(
      "Full body lift · Muscular endurance",
    );
  });

  it("takes the DOMINANT goal when a day mixes two", () => {
    const s = lift("full", ["max_strength", "max_strength", "max_strength", "endurance"]);
    expect(sessionEmphasis(s)).toBe("max_strength");
    expect(sessionTypeLabel(s)).toBe("Full body lift · Max strength");
  });

  it("does not say Power twice on a power day", () => {
    // "Power / explosive lift · Power" — the lift type IS the goal there.
    expect(sessionTypeLabel(lift("power", ["power", "power"]))).toBe("Power / explosive lift");
  });

  it("falls back to the bare type when nothing carries a goal", () => {
    expect(sessionTypeLabel(lift("upper", [undefined, undefined]))).toBe("Upper body lift");
  });

  it("leaves non-lift sessions untouched", () => {
    const run = { kind: "run", runType: "interval" } as unknown as Session;
    expect(sessionTypeLabel(run)).toBe("Interval run");
    expect(sessionEmphasis(run)).toBeUndefined();
  });
});

describe("a movement line marks only what departs from the title", () => {
  const m = (emphasis: "max_strength" | "endurance") => ({
    pattern: "lunge" as const,
    exercise: "Walking Lunge",
    sets: 3,
    repRange: "15",
    emphasis,
  });

  it("stays silent when the line matches the session's goal", () => {
    expect(movementLine(m("max_strength"), "max_strength")).not.toMatch(/Max strength/);
  });

  it("speaks up when it does not", () => {
    expect(movementLine(m("endurance"), "max_strength")).toMatch(/· Muscular endurance$/);
  });

  it("keeps its own label when the caller has no session context", () => {
    expect(movementLine(m("endurance"))).toMatch(/· Muscular endurance$/);
  });

  it("drops the word 'reps' from a distance prescription", () => {
    const sled = {
      pattern: "horizontal_press" as const,
      exercise: "Sled Push",
      sets: 4,
      repRange: "15 m",
    };
    expect(movementLine(sled)).toBe("Sled Push — 4 sets × 15 m");
  });

  it("keeps it for an actual rep count, including a range", () => {
    const squat = {
      pattern: "squat" as const,
      exercise: "Back Squat",
      sets: 3,
      repRange: "5-6",
    };
    expect(movementLine(squat)).toBe("Back Squat — 3 sets × 5–6 reps");
  });
});
