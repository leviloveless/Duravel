import { describe, it, expect } from "vitest";
import type { ProgramData, ProgramWeek, Session } from "@/lib/schemas";
import { analyzeGuardrails } from "./guardrails";

const ZONES = { z1: 20, z2: 60, z3: 10, z4: 6, z5: 4 };

function week(
  n: number,
  opts: { miles?: number; cardioMin?: number; sessions?: Session[] } = {},
): ProgramWeek {
  const sessions = opts.sessions ?? [];
  return {
    weekNumber: n,
    phase: "build",
    microWeek: "increase",
    summary: {
      totalCardioMinutes: opts.cardioMin ?? 300,
      totalMileage: opts.miles ?? 20,
      zoneDistribution: ZONES,
    },
    days: [{ day: "mon", sessions }],
  } as ProgramWeek;
}

function prog(weeks: ProgramWeek[]): ProgramData {
  return { generatedAt: "2026-01-01T00:00:00Z", weeks };
}

const run = (mi: number, type = "long", zone = 2): Session =>
  ({ kind: "run", runType: type, durationMin: mi * 9, paceMinMile: "9:00", distanceMiles: mi, goalZone: zone }) as Session;
const heavyLift = (): Session =>
  ({ kind: "lift", liftType: "lower", movements: [{ pattern: "squat", sets: 4, repRange: "5", emphasis: "max_strength" }] }) as Session;

describe("analyzeGuardrails", () => {
  it("is clear for a gentle, gradual program", () => {
    const r = analyzeGuardrails(
      prog([week(1, { miles: 18 }), week(2, { miles: 19 }), week(3, { miles: 20 })]),
    );
    expect(r.clear).toBe(true);
    expect(r.flags).toHaveLength(0);
  });

  it("flags a big single long-run jump", () => {
    const r = analyzeGuardrails(
      prog([
        week(1, { sessions: [run(4)] }),
        week(2, { sessions: [run(4)] }),
        week(3, { sessions: [run(9)] }), // 9 vs 4 = +125%
      ]),
    );
    const f = r.flags.find((x) => x.id === "run_jump");
    expect(f).toBeTruthy();
    expect(f!.severity).toBe("warn");
    expect(f!.week).toBe(3);
  });

  it("flags high running impact", () => {
    const r = analyzeGuardrails(prog([week(1, { miles: 75 })]));
    const f = r.flags.find((x) => x.id === "impact");
    expect(f).toBeTruthy();
    expect(f!.severity).toBe("warn");
  });

  it("flags concurrent heavy strength + hard endurance", () => {
    const r = analyzeGuardrails(
      prog([
        week(1, {
          sessions: [heavyLift(), heavyLift(), run(5, "threshold", 4), run(4, "interval", 5), run(4, "tempo", 4)],
        }),
      ]),
    );
    expect(r.flags.some((x) => x.id === "concurrent")).toBe(true);
  });

  it("flags a weekly volume spike", () => {
    const r = analyzeGuardrails(
      prog([
        week(1, { cardioMin: 300 }),
        week(2, { cardioMin: 300 }),
        week(3, { cardioMin: 300 }),
        week(4, { cardioMin: 520 }), // +73% over ~300
      ]),
    );
    expect(r.flags.some((x) => x.id === "volume_spike" && x.week === 4)).toBe(true);
  });

  it("returns clear for empty/null data", () => {
    expect(analyzeGuardrails(null).clear).toBe(true);
    expect(analyzeGuardrails(prog([])).clear).toBe(true);
  });
});
