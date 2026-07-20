import { describe, it, expect } from "vitest";
import { gateProgramWeeks, FREE_PREVIEW_WEEKS } from "./program-access";
import type { ProgramData } from "@/lib/schemas";

function prog(nWeeks: number): ProgramData {
  const weeks = Array.from({ length: nWeeks }, (_, i) => ({
    weekNumber: i + 1,
    phase: "base",
    microWeek: "increase",
    summary: { totalCardioMinutes: 0, totalMileage: 0, zoneDistribution: { z1: 0, z2: 0, z3: 0, z4: 0, z5: 0 } },
    days: [],
  }));
  return { generatedAt: "2026-07-01", weeks } as unknown as ProgramData;
}

describe("gateProgramWeeks", () => {
  it("returns the full program untouched when entitled", () => {
    const p = prog(12);
    const g = gateProgramWeeks(p, true);
    expect(g.previewing).toBe(false);
    expect(g.lockedWeeks).toBe(0);
    expect(g.program.weeks).toHaveLength(12);
    expect(g.program).toBe(p);
  });

  it("truncates to the free preview when not entitled", () => {
    const g = gateProgramWeeks(prog(12), false);
    expect(g.previewing).toBe(true);
    expect(g.program.weeks).toHaveLength(FREE_PREVIEW_WEEKS);
    expect(g.lockedWeeks).toBe(10);
    expect(g.program.weeks.map((w) => w.weekNumber)).toEqual([1, 2]);
  });

  it("never reports negative locked weeks for a short program", () => {
    const g = gateProgramWeeks(prog(1), false);
    expect(g.program.weeks).toHaveLength(1);
    expect(g.lockedWeeks).toBe(0);
    expect(g.previewing).toBe(true);
  });

  it("respects a custom preview length", () => {
    const g = gateProgramWeeks(prog(8), false, 4);
    expect(g.program.weeks).toHaveLength(4);
    expect(g.lockedWeeks).toBe(4);
  });
});
