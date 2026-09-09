/**
 * THE ATHLETE'S OWN STARTING SIZES (Levi, 2026-09-09: "the custom program
 * builder needs to allow the user to input times and mileage for the runs /
 * bikes / bricks").
 *
 * This is the first crack in the rule the custom tier was built on — "the
 * template says WHAT and WHERE, never HOW MUCH" — so what matters is that it is
 * a crack and not a break. Two things have to be true at once:
 *
 *   1. the athlete gets the week they typed, in week one; and
 *   2. every guard that makes a custom program the SAME engine still holds —
 *      the ramp, the deload, the taper, the session time cap, the long run's
 *      ceiling. A size is a starting point, not a licence.
 *
 * (2) is the one that would be quietly lost, so most of this file is about it.
 * Deterministic engine throughout — no AI, no I/O.
 */
import { describe, it, expect } from "vitest";
import { buildSkeleton, toEngineInput } from "@/lib/engine";
import { assembleProgram } from "./assemble";
import { sessionMiles, sessionTiming } from "@/lib/session-volume";
import { templateStartMileage } from "@/lib/engine/slots";
import type { Session } from "@/lib/schemas";
import type { WeekTemplate } from "@/lib/engine/types";

const START = "2026-09-14";

/** Four runs, three sized, plus a lift. 4 + 4 + 8 sized, one unsized at the floor. */
const sized: WeekTemplate = {
  days: [
    { day: "mon", sessions: [{ kind: "lift", liftType: "full" }] },
    { day: "tue", sessions: [{ kind: "run", runType: "threshold", startMiles: 4 }] },
    { day: "wed", sessions: [{ kind: "run", runType: "easy", startMiles: 4 }] },
    { day: "thu", sessions: [{ kind: "run", runType: "easy" }] },
    { day: "sat", sessions: [{ kind: "run", runType: "long", startMiles: 8 }] },
  ],
};

const gen = (weekTemplate: WeekTemplate, over: Record<string, unknown> = {}) =>
  ({
    profile: {
      firstName: "L",
      age: 35,
      bodyWeight: 80,
      weightUnit: "kg",
      runningExp: "intermediate",
      hybridExp: "intermediate",
      liftingExp: "intermediate",
      trainingClass: "non_highly_trained",
      trainingDays: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"],
      sex: "male",
      weeklyHours: "h10_20",
      benchmarks: { fiveKTime: "24:00" },
    },
    programType: "goal_event",
    sport: "hyrox",
    races: [{ raceDate: "2026-12-05", priority: "A" }],
    startDate: START,
    weekTemplate,
    ...over,
  }) as never;

const build = (t: WeekTemplate, over: Record<string, unknown> = {}) => {
  const sk = buildSkeleton(toEngineInput(gen(t, over), START));
  const { program } = assembleProgram(sk, [], "intermediate", { fiveKTime: "24:00" } as never);
  return { sk, program };
};

const runsOf = (w: { days: { sessions: Session[] }[] }) =>
  w.days
    .flatMap((d) => d.sessions)
    .filter((s): s is Extract<Session, { kind: "run" }> => s.kind === "run");
const runOfType = (w: { days: { sessions: Session[] }[] }, t: string) =>
  runsOf(w).find((r) => r.runType === t);

describe("week one is the week the athlete typed", () => {
  it("sets the program's starting mileage from the sizes", () => {
    // 4 + 4 + 8 sized, plus the 3-mile floor for the one unsized run.
    expect(templateStartMileage(sized)).toBe(19);
    const { sk } = build(sized);
    expect(sk.weeks[0]!.targetMileage).toBe(19);
  });

  it("does not touch a week that sized nothing", () => {
    // The regression guard for every athlete who never opens this feature: an
    // authored week with no sizes must still come from the experience tables.
    const unsized: WeekTemplate = {
      days: sized.days.map((d) => ({
        day: d.day,
        sessions: d.sessions.map(({ startMiles: _drop, ...rest }) => rest),
      })),
    };
    expect(templateStartMileage(unsized)).toBe(0);
    expect(build(unsized).sk.weeks[0]!.targetMileage).not.toBe(19);
  });

  it("gives each sized run the distance that was asked for", () => {
    const w1 = build(sized).program.weeks[0]!;
    // Total miles, which is what the athlete reads and what the week reports —
    // not work miles. The tolerance is the rep snap on the threshold run.
    expect(sessionMiles(runOfType(w1, "long")!)).toBeCloseTo(8, 0);
    // The SIZED easy run, not whichever easy run comes first — the week holds two
    // and only one of them was given a number.
    const sizedEasy = runsOf(w1).find((r) => r.runType === "easy" && r.shareOfWeek !== undefined);
    expect(sizedEasy).toBeDefined();
    expect(sessionMiles(sizedEasy!)).toBeCloseTo(4, 0);
  });

  it("still lets an explicit startMileage win — they said it more directly", () => {
    expect(build(sized, { startMileage: 30 }).sk.weeks[0]!.targetMileage).toBe(30);
  });
});

describe("a size is a starting point, not a licence", () => {
  it("ramps with the program instead of staying put", () => {
    // The whole reason a SHARE is stored rather than the miles typed. A long run
    // pinned at 8 miles for sixteen weeks is not a training plan.
    const { program } = build(sized);
    const w1 = sessionMiles(runOfType(program.weeks[0]!, "long")!);
    const later = program.weeks
      .slice(1)
      .map((w) => runOfType(w, "long"))
      .filter((r): r is NonNullable<typeof r> => !!r)
      .map(sessionMiles);
    expect(Math.max(...later)).toBeGreaterThan(w1);
  });

  it("holds the long run to its 90-minute ceiling however big the number was", () => {
    // 40 miles on a Saturday is not a long run, and the athlete typing it does
    // not make it one. Every long run in the program, not just week one.
    const greedy: WeekTemplate = {
      days: [
        { day: "tue", sessions: [{ kind: "run", runType: "easy", startMiles: 4 }] },
        { day: "thu", sessions: [{ kind: "run", runType: "easy", startMiles: 4 }] },
        { day: "sat", sessions: [{ kind: "run", runType: "long", startMiles: 40 }] },
      ],
    };
    for (const w of build(greedy).program.weeks) {
      const long = runOfType(w, "long");
      if (long) expect(sessionTiming(long).total).toBeLessThanOrEqual(90);
    }
  });

  it("holds a sized QUALITY run to its share of the week", () => {
    // A quality run is capped at roughly a fifth of the week's mileage, and an
    // athlete typing a bigger number does not move that. Asking for a 6-mile
    // threshold session in a 19-mile week is asking for 32% of the week's running
    // at threshold; what comes back is about a fifth.
    //
    // This is the property that made the whole feature safe to build: the size is
    // the starting point, the caps are still the caps.
    const greedyQuality: WeekTemplate = {
      days: [
        { day: "tue", sessions: [{ kind: "run", runType: "threshold", startMiles: 12 }] },
        { day: "thu", sessions: [{ kind: "run", runType: "easy", startMiles: 4 }] },
        { day: "sat", sessions: [{ kind: "run", runType: "long", startMiles: 8 }] },
      ],
    };
    const w1 = build(greedyQuality).program.weeks[0]!;
    const thr = runOfType(w1, "threshold");
    if (thr) {
      expect(sessionMiles(thr)).toBeLessThan(12);
      expect(sessionMiles(thr)).toBeLessThan(w1.summary.totalMileage * 0.35);
    }
  });

  it("holds every sized run to the session time cap", () => {
    const greedy: WeekTemplate = {
      days: [
        { day: "tue", sessions: [{ kind: "run", runType: "interval", startMiles: 30 }] },
        { day: "sat", sessions: [{ kind: "run", runType: "long", startMiles: 9 }] },
      ],
    };
    for (const w of build(greedy).program.weeks) {
      for (const r of runsOf(w)) expect(sessionTiming(r).total).toBeLessThanOrEqual(120);
    }
  });

  it("still tapers — race week is the protocol's, not the athlete's", () => {
    const { program } = build(sized);
    const last = program.weeks[program.weeks.length - 1]!;
    const peak = Math.max(...program.weeks.map((w) => w.summary.totalMileage));
    expect(last.summary.totalMileage).toBeLessThan(peak);
  });
});

describe("a bike is aerobic time, never mileage", () => {
  const withBike: WeekTemplate = {
    days: [
      { day: "tue", sessions: [{ kind: "run", runType: "easy", startMiles: 4 }] },
      { day: "wed", sessions: [{ kind: "bike", startMin: 75 }] },
      { day: "sat", sessions: [{ kind: "run", runType: "long", startMiles: 8 }] },
    ],
  };

  it("reaches the athlete, at the length they asked for", () => {
    const w1 = build(withBike).program.weeks[0]!;
    const bike = w1.days.flatMap((d) => d.sessions).find((s) => s.kind === "bike");
    expect(bike).toBeDefined();
    expect(sessionTiming(bike!).total).toBe(75);
  });

  it("adds nothing to the week's mileage", () => {
    // A ride is not on the athlete's feet. If it counted, every run in the week
    // would shrink to pay for it.
    expect(templateStartMileage(withBike)).toBe(12);
  });
});
