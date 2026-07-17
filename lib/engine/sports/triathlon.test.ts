import { describe, it, expect } from "vitest";
import type { EngineInput } from "../types";
import { buildSkeleton } from "../skeleton";
import { ProgramDataSchema } from "@/lib/schemas";
import { getSport } from "./index";
import { tri_70_3, tri_140_6, buildTriProgramData } from "./triathlon";

function triInput(sport: EngineInput["sport"], o: Partial<EngineInput> = {}): EngineInput {
  return {
    sport,
    trainingClass: "non_highly_trained",
    runningExp: "intermediate",
    hybridExp: "intermediate",
    liftingExp: "intermediate",
    programType: "goal_event",
    durationWeeks: 16,
    trainingDays: ["mon", "tue", "wed", "thu", "fri", "sat"],
    races: [{ weekNumber: 16, priority: "A" }],
    ...o,
  };
}
function countKind(skel: ReturnType<typeof buildSkeleton>, kind: string): number {
  let n = 0;
  for (const w of skel.weeks) for (const d of w.days) for (const s of d.sessions) if (s.kind === kind) n++;
  return n;
}
function weekMinutesByKind(week: ReturnType<typeof buildSkeleton>["weeks"][number], kind: string): number {
  let m = 0;
  for (const d of week.days) {
    for (const s of d.sessions) {
      if (s.kind === kind && "durationMin" in s) m += (s as { durationMin: number }).durationMin;
    }
  }
  return m;
}

describe("Triathlon", () => {
  it("resolves 70.3 and 140.6", () => {
    expect(getSport("tri_70_3")).toBe(tri_70_3);
    expect(getSport("tri_140_6")).toBe(tri_140_6);
    expect(tri_70_3.family).toBe("triathlon");
  });

  it("builds a swim/bike/run/brick skeleton with per-discipline minutes (no mileage)", () => {
    const skel = buildSkeleton(triInput("tri_70_3"));
    expect(skel.weeks).toHaveLength(16);
    expect(countKind(skel, "swim")).toBeGreaterThan(0);
    expect(countKind(skel, "bike")).toBeGreaterThan(0);
    expect(countKind(skel, "run")).toBeGreaterThan(0);
    expect(countKind(skel, "brick")).toBeGreaterThan(0);
    for (const w of skel.weeks) {
      expect(w.targetMileage).toBe(0);
      expect(w.targetCardioMinutes).toBeGreaterThan(0);
    }
  });

  it("is bike-heavy by time", () => {
    const skel = buildSkeleton(triInput("tri_70_3"));
    const midBuild = skel.weeks.find((w) => w.phase === "build")!;
    expect(weekMinutesByKind(midBuild, "bike")).toBeGreaterThan(weekMinutesByKind(midBuild, "run"));
    expect(weekMinutesByKind(midBuild, "run")).toBeGreaterThan(weekMinutesByKind(midBuild, "swim"));
  });

  it("bricks appear in build/peak, not base", () => {
    const skel = buildSkeleton(triInput("tri_70_3"));
    const base = skel.weeks.find((w) => w.phase === "base")!;
    const peak = skel.weeks.find((w) => w.phase === "peak")!;
    const bricksIn = (w: typeof base) => w.days.reduce((n, d) => n + d.sessions.filter((s) => s.kind === "brick").length, 0);
    expect(bricksIn(base)).toBe(0);
    expect(bricksIn(peak)).toBeGreaterThan(0);
  });

  it("taper reduces volume", () => {
    const skel = buildSkeleton(triInput("tri_70_3"));
    const peakMax = Math.max(...skel.weeks.filter((w) => w.phase === "peak").map((w) => w.targetCardioMinutes));
    const raceWeek = skel.weeks[skel.weeks.length - 1]!;
    expect(raceWeek.targetCardioMinutes).toBeLessThan(peakMax);
  });

  it("140.6 carries more peak volume than 70.3", () => {
    const half = buildSkeleton(triInput("tri_70_3"));
    const full = buildSkeleton(triInput("tri_140_6"));
    const peak = (s: typeof half) => Math.max(...s.weeks.map((w) => w.targetCardioMinutes));
    expect(peak(full)).toBeGreaterThan(peak(half));
  });

  it("assembles deterministic ProgramData (no AI) that passes the schema", () => {
    const data = buildTriProgramData(buildSkeleton(triInput("tri_140_6")));
    expect(ProgramDataSchema.safeParse(data).success).toBe(true);
    const kinds = new Set<string>();
    for (const w of data.weeks) for (const d of w.days) for (const s of d.sessions) kinds.add(s.kind);
    expect(kinds.has("swim")).toBe(true);
    expect(kinds.has("bike")).toBe(true);
    expect(kinds.has("run")).toBe(true);
    expect(kinds.has("brick")).toBe(true);
  });
});
