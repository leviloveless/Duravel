import { describe, it, expect } from "vitest";
import { applyStrengthSchemes } from "./assemble";
import type { ProgramWeek } from "@/lib/schemas";

function weekWith(phase: ProgramWeek["phase"], micro: ProgramWeek["microWeek"]): ProgramWeek {
  return {
    weekNumber: 1,
    phase,
    microWeek: micro,
    summary: { totalCardioMinutes: 0, totalMileage: 0, zoneDistribution: { z1: 0, z2: 0, z3: 0, z4: 0, z5: 0 } },
    days: [
      {
        day: "mon",
        sessions: [
          {
            kind: "lift",
            liftType: "full",
            movements: [
              { pattern: "squat", sets: 3, repRange: "12-15" },
              { pattern: "lunge", sets: 3, repRange: "12-15" },
            ],
          },
        ],
      },
    ],
  };
}

describe("applyStrengthSchemes", () => {
  it("overrides AI reps with periodized schemes + weights + plyo (Base)", () => {
    const w = weekWith("base", "increase");
    applyStrengthSchemes(w, { fiveRmSquat: 315 }, "lbs");
    const lift = w.days[0].sessions[0];
    if (lift.kind !== "lift") throw new Error("expected lift");
    const squat = lift.movements.find((m) => m.pattern === "squat")!;
    const lunge = lift.movements.find((m) => m.pattern === "lunge")!;
    expect(squat.emphasis).toBe("max_strength");
    expect(squat.repRange).not.toBe("12-15"); // AI value overridden
    expect(squat.suggestedWeight).toContain("lbs");
    expect(lunge.emphasis).toBe("endurance");
    expect(lift.power).toBeTruthy(); // plyometrics in Base
  });

  it("no plyometric element in Peak", () => {
    const w = weekWith("peak", "rebound");
    applyStrengthSchemes(w);
    const lift = w.days[0].sessions[0];
    if (lift.kind !== "lift") throw new Error("expected lift");
    expect(lift.power).toBeUndefined();
    expect(lift.movements[0].intensityPct).toBe(88);
  });
});
