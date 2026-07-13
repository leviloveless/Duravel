import { describe, it, expect } from "vitest";
import { reconcileWeekVolume } from "./reconcile";
import { weekMileage, weekCardioMinutes, sessionTiming } from "@/lib/session-volume";
import { computePaces, formatPace } from "@/lib/engine/paces";
import type { ProgramDay, Session } from "@/lib/schemas";

type RunS = Extract<Session, { kind: "run" }>;
const P = computePaces("26:00")!; // 5K 26:00 → 5k pace ≈ 8:22/mi

const run = (rt: string, mi = 4, dur = 32): Session => ({
  kind: "run",
  runType: rt as RunS["runType"],
  distanceMiles: mi,
  durationMin: dur,
  paceMinMile: "8:00",
  goalZone: 2,
});
const hybrid = (): Session => ({
  kind: "hybrid",
  goalZone: 4,
  elements: [
    { exercise: "run", prescription: "1000m @ 8:00 min/mile (threshold)" },
    { exercise: "ski erg", prescription: "500m" },
    { exercise: "run", prescription: "1000m @ 8:00 min/mile (threshold)" },
    { exercise: "row erg", prescription: "500m" },
    { exercise: "run", prescription: "1000m @ 8:00 min/mile (threshold)" },
    { exercise: "assault bike", prescription: "40 cal" },
    { exercise: "run", prescription: "1000m @ 8:00 min/mile (threshold)" },
    { exercise: "wall balls", prescription: "30 reps" },
  ],
});
const lift = (): Session => ({ kind: "lift", liftType: "full", movements: [{ pattern: "squat", sets: 4, repRange: "5-7" }] });
const daysOf = (...ss: Session[][]): ProgramDay[] =>
  ss.map((x, i) => ({ day: (["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const)[i], sessions: x }));
const runsOf = (days: ProgramDay[]): RunS[] =>
  days.flatMap((d) => d.sessions).filter((s): s is RunS => s.kind === "run");
const maxRunTotal = (days: ProgramDay[]) => Math.max(0, ...runsOf(days).map((s) => sessionTiming(s).total));
const hasCardio = (days: ProgramDay[]) => days.some((d) => d.sessions.some((s) => s.kind === "cardio"));
const paceOf = (days: ProgramDay[], t: string) => runsOf(days).find((r) => r.runType === t)?.paceMinMile;

describe("pace formulas (Daniels VDOT)", () => {
  it("paces order correctly and sit at sensible offsets from 5K pace", () => {
    // fastest → slowest: interval < threshold < tempo < easy (= long)
    expect(P.interval).toBeLessThan(P.threshold);
    expect(P.threshold).toBeLessThan(P.tempo);
    expect(P.tempo).toBeLessThan(P.easy);
    expect(P.long).toBe(P.easy);
    const delta = (x: number) => x - P.fiveKSecPerMile;
    expect(delta(P.threshold)).toBeGreaterThan(10); // ~+25 s/mi over 5K pace
    expect(delta(P.threshold)).toBeLessThan(40);
    expect(delta(P.easy)).toBeGreaterThan(60); // easy clearly slower than 5K
    expect(delta(P.interval)).toBeLessThan(10); // ~5K pace or a touch faster
  });
});

describe("reconcile — fixed paces, mileage exact, cardio exact via non-running filler", () => {
  it("reported example (11.5 mi / 250 min): both exact, non-running cardio added, no run > 90", () => {
    const days = daysOf([run("easy")], [hybrid()], [lift()], [run("fartlek")], [run("long")], []);
    reconcileWeekVolume(days, 11.5, 250, P, "intermediate");
    expect(weekMileage({ days })).toBe(11.5);
    expect(weekCardioMinutes({ days })).toBe(250);
    expect(maxRunTotal(days)).toBeLessThanOrEqual(90);
    expect(hasCardio(days)).toBe(true);
  });

  it("run paces follow the formulas", () => {
    const days = daysOf([run("easy")], [run("long")], [run("fartlek")], [lift()]);
    reconcileWeekVolume(days, 20, 320, P, "intermediate");
    expect(paceOf(days, "easy")).toBe(formatPace(P.easy));
    expect(paceOf(days, "long")).toBe(formatPace(P.long));
    expect(paceOf(days, "fartlek")).toBe(`${formatPace(P.threshold)}–${formatPace(P.easy)}`);
  });

  it("rewrites hybrid run elements to threshold pace", () => {
    const days = daysOf([hybrid()], [run("easy")], [lift()]);
    reconcileWeekVolume(days, 15, 300, P, "intermediate");
    const hy = days[0].sessions[0];
    const el = hy.kind === "hybrid" ? hy.elements.find((e) => /run/i.test(e.exercise)) : undefined;
    expect(el?.prescription).toContain(`@ ${formatPace(P.threshold)}`);
  });

  it("tight deload consolidates easy runs into the long run; mileage stays exact", () => {
    const days = daysOf([run("easy")], [run("easy")], [run("long")], [lift()]);
    reconcileWeekVolume(days, 6, 150, P, "beginner");
    expect(weekMileage({ days })).toBe(6);
    expect(weekCardioMinutes({ days })).toBe(150);
    expect(runsOf(days).some((r) => r.runType === "long")).toBe(true);
  });

  it("race weeks untouched", () => {
    const days = daysOf([run("easy")], [{ kind: "race", priority: "A" }]);
    const snap = JSON.stringify(days);
    reconcileWeekVolume(days, 11.5, 250, P, "intermediate");
    expect(JSON.stringify(days)).toBe(snap);
  });

  it("sweep: mileage + cardio exact (generous targets), no run > 90", () => {
    const rt = ["easy", "long", "fartlek", "tempo", "threshold", "interval", "progression"];
    for (const n of [1, 2, 3, 4, 6]) {
      for (const wh of [false, true]) {
        for (const mi of [8, 11.5, 20, 35, 55]) {
          const min = Math.round(mi * 22); // generous → always leftover for non-running cardio
          const sessions: Session[][] = [];
          for (let i = 0; i < n; i++) sessions.push([run(rt[i % rt.length])]);
          if (wh) sessions.push([hybrid()]);
          sessions.push([lift()]);
          while (sessions.length < 7) sessions.push([]);
          const days = daysOf(...sessions);
          reconcileWeekVolume(days, mi, min, P, "intermediate");
          expect(weekMileage({ days })).toBe(mi);
          expect(weekCardioMinutes({ days })).toBe(min);
          expect(maxRunTotal(days)).toBeLessThanOrEqual(90);
        }
      }
    }
  });
});
