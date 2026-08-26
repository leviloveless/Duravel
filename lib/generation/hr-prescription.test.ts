/**
 * END TO END — every rep-based quality run in a generated program carries a
 * heart-rate range for its reps and one for its recovery jog (Levi, 2026-08-25).
 *
 * The unit tests cover the lines themselves; what this file proves is the
 * WIRING, which is where this repo's HR work has failed before: a value the
 * engine computes, silently dropped on its way to the session. Here the risk is
 * `assembleArgsFromInput` → `assembleProgram` → `buildWeek` → `describeSessions`
 * → `redescribeQualityRuns`, four hand-offs, the last of which REWRITES the text
 * after reconciliation and would quietly drop the HR lines if it were not passed
 * the model too.
 *
 * Runs with EMPTY chunks, so it is the deterministic engine end to end — no AI.
 */
import { describe, it, expect } from "vitest";
import type { GenerationInput, Session } from "@/lib/schemas";
import { buildSkeleton, toEngineInput } from "@/lib/engine";
import { assembleArgsFromInput, assembleProgram } from "./assemble";
import { HR_LINE_PREFIX } from "@/lib/engine/hr-targets";
import { hrModelFromProfile, zoneBpmRange } from "@/lib/zones";

const START = "2026-08-31";

function input(over: Record<string, unknown> = {}): GenerationInput {
  return {
    profile: {
      firstName: "L",
      age: 35,
      bodyWeight: 80,
      weightUnit: "kg",
      runningExp: "intermediate",
      hybridExp: "intermediate",
      liftingExp: "intermediate",
      trainingClass: "non_highly_trained",
      trainingDays: ["mon", "tue", "wed", "thu", "fri", "sat"],
      sex: "male",
      benchmarks: { fiveKTime: "22:00", tenKTime: "46:00" },
      ...over,
    },
    programType: "goal_event",
    durationWeeks: 16,
    races: [{ raceDate: "2026-12-19", priority: "A" }],
    startDate: START,
  } as unknown as GenerationInput;
}

function build(gen: GenerationInput): Session[] {
  const a = assembleArgsFromInput(gen);
  const { program } = assembleProgram(
    buildSkeleton(toEngineInput(gen, START)),
    [],
    a.runningExp,
    a.raceTimes,
    a.benchmarks,
    a.weightUnit,
    a.division,
    a.sex,
    a.catalog,
    a.liftingExp,
    a.equipment,
    a.hr,
  );
  return program.weeks.flatMap((w) => w.days.flatMap((d) => d.sessions));
}

const runs = (sessions: Session[], runType: string) =>
  sessions.filter((s) => s.kind === "run" && s.runType === runType);

/** A session's how-to text — a lift has none, so the union needs the guard. */
const desc = (s: Session): string =>
  "description" in s && typeof s.description === "string" ? s.description : "";

const hrLines = (s: Session): string[] =>
  desc(s)
    .split("\n")
    .filter((l: string) => l.startsWith(HR_LINE_PREFIX));

describe("a generated program prescribes HR per rep and per recovery jog", () => {
  const sessions = build(input());

  it("generates the quality runs this test depends on", () => {
    expect(runs(sessions, "interval").length).toBeGreaterThan(2);
    expect(runs(sessions, "threshold").length).toBeGreaterThan(0);
  });

  for (const runType of ["interval", "threshold"] as const) {
    it(`gives every multi-rep ${runType} run both lines`, () => {
      const multi = runs(sessions, runType).filter((s) => desc(s).includes(" x "));
      expect(multi.length).toBeGreaterThan(0);
      for (const s of multi) {
        const ls = hrLines(s);
        expect(
          ls.some((l) => l.startsWith(`${HR_LINE_PREFIX}reps:`)),
          desc(s),
        ).toBe(true);
        expect(
          ls.some((l) => l.startsWith(`${HR_LINE_PREFIX}recovery jog:`)),
          desc(s),
        ).toBe(true);
      }
    });

    it(`never gives a ${runType} run TWO sets of lines`, () => {
      // `redescribeQualityRuns` rewrites the text after reconciliation. If it
      // appended instead of replacing, this is where it would show.
      for (const s of runs(sessions, runType)) {
        const ls = hrLines(s);
        expect(ls.filter((l) => l.startsWith(`${HR_LINE_PREFIX}reps:`)).length).toBeLessThan(2);
      }
    });
  }

  it("uses the athlete's own bpm, and the zone the ENGINE assigned", () => {
    const model = hrModelFromProfile(input().profile as never);
    const interval = runs(sessions, "interval")[0]!;
    const threshold = runs(sessions, "threshold")[0]!;
    expect(interval.kind === "run" && interval.goalZone).toBe(5);
    expect(threshold.kind === "run" && threshold.goalZone).toBe(4);
    expect(hrLines(interval)[0]).toContain(`${zoneBpmRange(model, 5).min}+ bpm`);
    expect(hrLines(threshold)[0]).toContain(
      `${zoneBpmRange(model, 4).min}–${zoneBpmRange(model, 4).max} bpm`,
    );
  });

  it("leaves easy, long and hybrid sessions alone", () => {
    for (const s of sessions) {
      if (s.kind === "run" && (s.runType === "interval" || s.runType === "threshold")) continue;
      expect(hrLines(s), `${s.kind}`).toHaveLength(0);
    }
  });

  it("adds the nudge only when max HR is an age estimate", () => {
    const estimated = hrLines(runs(build(input()), "interval")[0]!);
    expect(estimated.some((l) => l.includes("estimate"))).toBe(true);

    const measured = hrLines(runs(build(input({ restingHr: 48 })), "interval")[0]!);
    expect(measured.some((l) => l.includes("estimate"))).toBe(false);
    // ...and the measured athlete's numbers actually differ from the estimate.
    expect(measured[0]).not.toBe(estimated[0]);
  });
});
