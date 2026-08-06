/**
 * The HYROX warm-up, and the fact that its running counts (Levi, 2026-08-06).
 *
 * `sessionTiming` has ALWAYS budgeted 10 minutes before and 5 after a hybrid
 * session — that is where its 55-to-75-minute total came from. But nothing ever
 * told the athlete to run them, and `sessionMiles` counted only the station runs,
 * so the jog was invisible in the week's mileage.
 *
 * Two rules, both asserted here:
 *   1. every hybrid carries a warm-up + cooldown line that reads like a run's;
 *   2. that distance COUNTS — it is part of the week's prescribed mileage, so the
 *      runs come down to make room rather than the week silently growing.
 */
import { describe, it, expect } from "vitest";
import { assembleProgram } from "./assemble";
import { buildSkeleton, toEngineInput } from "@/lib/engine";
import {
  weekMileage,
  sessionMiles,
  hybridRunMiles,
  hybridOverheadMiles,
  HYBRID_WARMUP,
  HYBRID_COOLDOWN,
} from "@/lib/session-volume";
import type { GenerationInput, Session } from "@/lib/schemas";

type HybridSession = Extract<Session, { kind: "hybrid" }>;

const input = (): GenerationInput =>
  ({
    sport: "hyrox",
    programType: "goal_event",
    durationWeeks: 16,
    profile: {
      firstName: "T",
      age: 30,
      bodyWeight: 175,
      weightUnit: "lb",
      runningExp: "intermediate",
      hybridExp: "intermediate",
      liftingExp: "intermediate",
      trainingClass: "non_highly_trained",
      trainingDays: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"],
      weeklyHours: "h5_10",
      benchmarks: { fiveKTime: "26:00" },
    },
    races: [{ raceDate: "2026-11-23", priority: "A" }],
  }) as unknown as GenerationInput;

function build() {
  const skeleton = buildSkeleton(toEngineInput(input(), "2026-08-03"));
  const { program } = assembleProgram(skeleton, [], "intermediate", "26:00");
  const hybrids: HybridSession[] = [];
  for (const w of program.weeks) {
    for (const d of w.days) {
      for (const s of d.sessions) if (s.kind === "hybrid") hybrids.push(s);
    }
  }
  return { skeleton, program, hybrids };
}

describe("hybrid warm-up", () => {
  it("every hybrid session gets a warm-up and a cooldown", () => {
    const { hybrids } = build();
    expect(hybrids.length).toBeGreaterThan(0);
    for (const h of hybrids) {
      expect(h.warmup, JSON.stringify(h.warmup)).toBeTruthy();
      expect(h.cooldown, JSON.stringify(h.cooldown)).toBeTruthy();
    }
  });

  it("the warm-up is a RUN, stated with minutes, distance and pace", () => {
    const { hybrids } = build();
    const h = hybrids[0]!;
    // e.g. "Warm up: 10 min easy (~0.9 mi) @ 10:33/mi" — the same shape a
    // quality run's warm-up uses, because it is the same builder.
    expect(h.warmup).toMatch(
      new RegExp(`^Warm up: ${HYBRID_WARMUP} min easy \\(~\\d+(\\.\\d+)? mi\\) @ \\d+:\\d{2}/mi$`),
    );
    expect(h.cooldown).toMatch(
      new RegExp(
        `^Cooldown: ${HYBRID_COOLDOWN} min easy \\(~\\d+(\\.\\d+)? mi\\) @ \\d+:\\d{2}/mi$`,
      ),
    );
  });

  it("the jog distance is stamped and non-zero", () => {
    const { hybrids } = build();
    for (const h of hybrids) expect(h.overheadMiles ?? 0).toBeGreaterThan(0);
  });

  it("the stated distance IS the distance counted", () => {
    // The two figures printed in the prescription must sum to `overheadMiles`,
    // or the athlete runs one number and the week counts another. This is the
    // same trap `runOverheadMiles` documents — round each leg separately.
    const { hybrids } = build();
    const h = hybrids[0]!;
    const printed = [h.warmup!, h.cooldown!]
      .map((line) => Number(/\(~([\d.]+) mi\)/.exec(line)![1]))
      .reduce((a, b) => a + b, 0);
    expect(Math.round(printed * 10) / 10).toBe(h.overheadMiles);
  });

  it("sessionMiles counts the warm-up on top of the station runs", () => {
    const { hybrids } = build();
    const h = hybrids[0]!;
    expect(sessionMiles(h)).toBeCloseTo(hybridRunMiles(h) + (h.overheadMiles ?? 0), 1);
    // ...and it is strictly more than the stations alone — the regression.
    expect(sessionMiles(h)).toBeGreaterThan(hybridRunMiles(h));
  });

  it("the week does not silently GROW — the runs give the distance back", () => {
    // The whole point of counting it against the target. A week containing a
    // hybrid must still land on its prescribed mileage, not overshoot by the
    // warm-up. (Race weeks are structurally different and excluded.)
    const { skeleton, program } = build();
    program.weeks.forEach((w, i) => {
      const skel = skeleton.weeks[i]!;
      if (skel.raceDay) return;
      const hasHybrid = w.days.some((d) => d.sessions.some((s) => s.kind === "hybrid"));
      if (!hasHybrid) return;
      // Runs can only shrink to their minimums, so a very dense low-mileage week
      // can still land over — but never by more than the engine already did
      // before warm-ups were counted.
      expect(weekMileage(w), `wk${w.weekNumber}`).toBeGreaterThanOrEqual(skel.targetMileage - 0.15);
    });
  });

  it("hybridOverheadMiles is pace-driven and safe on nonsense input", () => {
    expect(hybridOverheadMiles(10)).toBeGreaterThan(0);
    // Faster athlete covers more ground in the same fixed minutes.
    expect(hybridOverheadMiles(8)).toBeGreaterThan(hybridOverheadMiles(13));
    for (const bad of [0, -1, NaN, Infinity]) expect(hybridOverheadMiles(bad)).toBe(0);
  });

  it("a program built before this rule still reads as it always did", () => {
    // `overheadMiles` absent → no warm-up is counted, so the session is exactly
    // its station mileage. (It is now rounded to a tenth like a run's, which is
    // the only difference and is under 0.05 mi.)
    const legacy = {
      kind: "hybrid",
      goalZone: 4,
      elements: [{ exercise: "Run", prescription: "1000 m" }],
    } as HybridSession;
    expect(sessionMiles(legacy)).toBe(Math.round(hybridRunMiles(legacy) * 10) / 10);
    expect(sessionMiles(legacy)).toBeCloseTo(hybridRunMiles(legacy), 1);
  });
});
