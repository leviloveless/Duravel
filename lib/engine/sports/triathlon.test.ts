import { describe, it, expect } from "vitest";
import type { EngineInput } from "../types";
import { buildSkeleton } from "../skeleton";
import { ProgramDataSchema } from "@/lib/schemas";
import { getSport } from "./index";
import { tri_70_3, tri_140_6, buildTriProgramData, rebuildTriWeek, swimLevelFromCss, bikeLevelFromFtp, triVolumeLevel, triAnchorsFromBenchmarks } from "./triathlon";
import { weekCardioMinutes } from "@/lib/session-volume";
import { computeWeekSignals } from "../adapt";

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

  it("rebound weeks hold the prior increase week's volume (no continuous ramp)", () => {
    // Long, non-highly-trained program → repeating rebound/increase/deload.
    const skel = buildSkeleton(triInput("tri_70_3", { durationWeeks: 20, trainingClass: "non_highly_trained" }));
    const working = skel.weeks.filter((w) => w.phase !== "taper");
    let sawCheck = false;
    for (let i = 1; i < working.length; i++) {
      const w = working[i]!;
      const prev = working[i - 1]!;
      // A rebound immediately following an increase must match that increase's volume.
      if (w.microWeek === "rebound" && prev.microWeek === "deload") {
        // rebound follows deload; the increase two weeks back is the held level.
        const inc = working[i - 2];
        if (inc && inc.microWeek === "increase") {
          expect(w.targetCardioMinutes).toBe(inc.targetCardioMinutes);
          sawCheck = true;
        }
      }
    }
    expect(sawCheck).toBe(true);
    // And volume must never strictly increase on a rebound vs the week before a deload.
  });

  it("increase weeks step up and deloads dip below the held level", () => {
    const skel = buildSkeleton(triInput("tri_70_3", { durationWeeks: 20, trainingClass: "non_highly_trained" }));
    const working = skel.weeks.filter((w) => w.phase !== "taper");
    for (let i = 1; i < working.length; i++) {
      const w = working[i]!;
      const prev = working[i - 1]!;
      if (w.microWeek === "deload") expect(w.targetCardioMinutes).toBeLessThan(prev.targetCardioMinutes);
    }
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

  it("derives swim level from CSS and bike level from FTP (W/kg, sex-specific)", () => {
    expect(swimLevelFromCss("1:30")).toBe("advanced");
    expect(swimLevelFromCss("1:50")).toBe("intermediate");
    expect(swimLevelFromCss("2:10")).toBe("beginner");
    expect(swimLevelFromCss(undefined)).toBeUndefined();
    // 280W / 70kg = 4.0 W/kg → advanced (M); same absolute for a lighter female.
    expect(bikeLevelFromFtp(280, 70, "male")).toBe("advanced");
    expect(bikeLevelFromFtp(210, 70, "male")).toBe("intermediate"); // 3.0
    expect(bikeLevelFromFtp(140, 70, "male")).toBe("beginner"); // 2.0
    expect(bikeLevelFromFtp(200, 70, "female")).toBe("intermediate"); // 2.86, ≥2.4
    expect(bikeLevelFromFtp(280, undefined, "male")).toBeUndefined();
  });

  it("blends the volume tier and a strong cyclist lifts it above run alone", () => {
    const base = triInput("tri_70_3", { runningExp: "beginner" });
    expect(triVolumeLevel(base)).toBe("beginner");
    // beginner run + advanced swim + advanced bike → rounds up to intermediate.
    expect(triVolumeLevel({ ...base, swimLevel: "advanced", bikeLevel: "advanced" })).toBe("intermediate");
  });

  it("explicit swim/bike experience selectors override the CSS/FTP-derived level", () => {
    // Explicit advanced swim + bike set via EngineInput.swimLevel/bikeLevel
    // (toEngineInput fills these from profile.swimExp/bikeExp when present).
    const withExplicit = triInput("tri_70_3", { runningExp: "beginner", swimLevel: "advanced", bikeLevel: "advanced" });
    const withoutExplicit = triInput("tri_70_3", { runningExp: "beginner" });
    const peak = (i: typeof withExplicit) =>
      Math.max(...buildSkeleton(i).weeks.map((w) => w.targetCardioMinutes));
    // A stronger explicit swim/bike tier raises peak volume vs. run-only beginner.
    expect(peak(withExplicit)).toBeGreaterThan(peak(withoutExplicit));
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

  it("counts swim/bike/brick minutes toward weekly cardio load", () => {
    const data = buildTriProgramData(buildSkeleton(triInput("tri_70_3")));
    const build = data.weeks.find((w) => w.phase === "build")!;
    // Load accounting must see the tri sessions (was 0 before swim/bike/brick support).
    expect(weekCardioMinutes(build)).toBeGreaterThan(0);
  });

  it("computes adaptation signals on a tri week without crashing", () => {
    const data = buildTriProgramData(buildSkeleton(triInput("tri_70_3")));
    const build = data.weeks.find((w) => w.phase === "build")!;
    const signals = computeWeekSignals(build, []);
    expect(signals.plannedSessions).toBeGreaterThan(0);
    expect(signals.plannedCardioMinutes).toBeGreaterThan(0);
  });

  it("personalizes swim/bike content from CSS + FTP anchors", () => {
    const anchors = triAnchorsFromBenchmarks({ cssPace: "1:40", ftpWatts: 250 });
    expect(anchors.cssSec).toBe(100);
    expect(anchors.ftpWatts).toBe(250);
    const data = buildTriProgramData(buildSkeleton(triInput("tri_70_3")), anchors);
    const texts: string[] = [];
    for (const w of data.weeks) for (const d of w.days) for (const s of d.sessions) if ("description" in s && s.description) texts.push(s.description);
    // CSS pace appears verbatim in swim sets; watt targets appear in bike sets.
    expect(texts.some((t) => t.includes("1:40/100m"))).toBe(true);
    expect(texts.some((t) => /\d{2,3}–\d{2,3}W/.test(t))).toBe(true);
  });

  it("falls back to % FTP / generic CSS wording without anchors", () => {
    const data = buildTriProgramData(buildSkeleton(triInput("tri_70_3")));
    expect(ProgramDataSchema.safeParse(data).success).toBe(true);
    const texts: string[] = [];
    for (const w of data.weeks) for (const d of w.days) for (const s of d.sessions) if ("description" in s && s.description) texts.push(s.description);
    expect(texts.some((t) => t.includes("% FTP"))).toBe(true);
    expect(texts.some((t) => t.includes("CSS pace"))).toBe(true);
    // No watt numbers when FTP is unknown.
    expect(texts.some((t) => /\d{2,3}–\d{2,3}W/.test(t))).toBe(false);
  });

  it("rebuildTriWeek regenerates a week at a revised (lower) cardio target", () => {
    const input = triInput("tri_70_3");
    const skel = buildSkeleton(input);
    const target = skel.weeks.find((w) => w.phase === "build")!;
    const cut = { ...target, targetCardioMinutes: Math.round(target.targetCardioMinutes * 0.7) };
    const { skeletonWeek, programWeek } = rebuildTriWeek(cut, input, tri_70_3);
    expect(skeletonWeek.targetCardioMinutes).toBe(cut.targetCardioMinutes);
    const full = rebuildTriWeek(target, input, tri_70_3);
    // Lower target → less (or equal) total prescribed minutes than the full week.
    expect(weekCardioMinutes(programWeek)).toBeLessThan(weekCardioMinutes(full.programWeek));
    // Still a valid, populated week with swim+bike+run.
    const kinds = new Set(programWeek.days.flatMap((d) => d.sessions.map((s) => s.kind)));
    expect(kinds.has("swim") && kinds.has("bike") && kinds.has("run")).toBe(true);
  });
});
