import { describe, it, expect } from "vitest";
import { applyStationProgression } from "./assemble";
import type { ProgramWeek } from "@/lib/schemas";

function hybridWeek(phase: ProgramWeek["phase"]): ProgramWeek {
  return {
    weekNumber: 1, phase, microWeek: "rebound",
    summary: { totalCardioMinutes: 0, totalMileage: 0, zoneDistribution: { z1: 0, z2: 0, z3: 0, z4: 0, z5: 0 } },
    days: [{
      day: "mon",
      sessions: [{
        kind: "hybrid", goalZone: 4,
        elements: [
          { exercise: "run", prescription: "1000m @ 7:30 (threshold)" },
          { exercise: "sled push", prescription: "40m" },
          { exercise: "run", prescription: "1000m @ 7:30 (threshold)" },
          { exercise: "wall balls", prescription: "50 reps" },
        ],
      }],
    }],
  };
}

describe("applyStationProgression", () => {
  it("rewrites stations to race spec but leaves runs alone", () => {
    const w = hybridWeek("peak");
    applyStationProgression(w, "open", "male");
    const hy = w.days[0]!.sessions[0]!;
    if (hy.kind !== "hybrid") throw new Error("expected hybrid");
    expect(hy.elements[0]!.prescription).toContain("threshold"); // run untouched
    expect(hy.elements[1]!.prescription).toContain("152kg"); // sled at Open male race load
    expect(hy.elements[1]!.prescription).toContain("50m"); // peak = full distance
    expect(hy.elements[3]!.prescription).toContain("100 reps"); // wall balls full at peak
  });

  it("progresses volume down in Base (shorter distances, same load)", () => {
    const w = hybridWeek("base");
    applyStationProgression(w, "open", "male");
    const hy = w.days[0]!.sessions[0]!;
    if (hy.kind !== "hybrid") throw new Error("expected hybrid");
    expect(hy.elements[1]!.prescription).toContain("30m"); // 60% of 50m
    expect(hy.elements[1]!.prescription).toContain("152kg"); // race load throughout
  });
});
