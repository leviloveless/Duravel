/**
 * AMENDING THE WEEK MID-PROGRAM (Levi, 2026-09-08).
 *
 * His ask: *"the ability to add a new workout mid-program that is incorporated
 * into the following weeks."* Two halves, and the second is the one with teeth —
 * the weeks the athlete has already trained must not move.
 *
 * They must not move for a reason beyond tidiness: the long run's ceiling is
 * measured against the trailing four-week maximum, so rewriting week 3 from week
 * 9 would move a limit that has already done its job, and the plan would stop
 * agreeing with the training that actually happened.
 *
 * Deterministic engine, no AI, no I/O.
 */
import { describe, it, expect } from "vitest";
import { buildSkeleton, templateForWeek } from "./skeleton";
import type { EngineInput, WeekTemplate } from "./types";

const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat"] as const;

const original: WeekTemplate = {
  days: [
    { day: "tue", sessions: [{ kind: "run", runType: "threshold" }] },
    { day: "wed", sessions: [{ kind: "run", runType: "easy" }] },
    { day: "fri", sessions: [{ kind: "run", runType: "easy" }] },
    { day: "sat", sessions: [{ kind: "run", runType: "long" }] },
  ],
};

/** The same week, plus a Monday lift — "add a workout mid-program". */
const amended: WeekTemplate = {
  days: [{ day: "mon", sessions: [{ kind: "lift", liftType: "full" }] }, ...original.days],
};

function input(over: Partial<EngineInput> = {}): EngineInput {
  return {
    trainingClass: "non_highly_trained",
    runningExp: "intermediate",
    hybridExp: "intermediate",
    liftingExp: "intermediate",
    programType: "goal_event",
    durationWeeks: 16,
    trainingDays: [...DAYS],
    races: [{ weekNumber: 16, priority: "A" }],
    startMileage: 20,
    weekTemplate: original,
    ...over,
  };
}

const AMEND_FROM = 9;
const withChange = input({ weekTemplateChanges: [{ fromWeek: AMEND_FROM, template: amended }] });

describe("templateForWeek resolves the history", () => {
  it("uses the original before the change takes effect", () => {
    expect(templateForWeek(withChange, AMEND_FROM - 1)).toBe(original);
    expect(templateForWeek(withChange, 1)).toBe(original);
  });

  it("uses the amendment from its own week onward", () => {
    expect(templateForWeek(withChange, AMEND_FROM)).toBe(amended);
    expect(templateForWeek(withChange, 16)).toBe(amended);
  });

  it("takes the LATEST applicable change when there are several", () => {
    const third: WeekTemplate = {
      days: [{ day: "sat", sessions: [{ kind: "run", runType: "long" }] }],
    };
    const many = input({
      weekTemplateChanges: [
        { fromWeek: 12, template: third },
        { fromWeek: 5, template: amended },
      ],
    });
    expect(templateForWeek(many, 4)).toBe(original);
    expect(templateForWeek(many, 5)).toBe(amended);
    expect(templateForWeek(many, 11)).toBe(amended);
    expect(templateForWeek(many, 12)).toBe(third);
  });

  it("survives an unsorted history — order of entry is not order of effect", () => {
    const unsorted = input({
      weekTemplateChanges: [
        { fromWeek: 9, template: amended },
        { fromWeek: 3, template: original },
      ],
    });
    expect(templateForWeek(unsorted, 10)).toBe(amended);
  });
});

describe("the amendment reaches the program, and only from its own week", () => {
  const before = buildSkeleton(input());
  const after = buildSkeleton(withChange);
  const mondayHasWork = (sk: ReturnType<typeof buildSkeleton>, weekNumber: number) => {
    const w = sk.weeks.find((x) => x.weekNumber === weekNumber)!;
    const mon = w.days.find((d) => d.day === "mon")!;
    return mon.sessions.some((s) => s.kind !== "rest");
  };

  it("adds the session to every week from the change onward", () => {
    for (const w of after.weeks) {
      if (w.weekNumber < AMEND_FROM) continue;
      if (w.microWeek === "race" || w.microWeek === "taper") continue; // protocol owns these
      expect(mondayHasWork(after, w.weekNumber), `week ${w.weekNumber}`).toBe(true);
    }
  });

  it("leaves the weeks already trained exactly as they were", () => {
    for (const w of before.weeks) {
      if (w.weekNumber >= AMEND_FROM) continue;
      expect(
        JSON.stringify(after.weeks.find((x) => x.weekNumber === w.weekNumber)?.days),
        `week ${w.weekNumber}`,
      ).toBe(JSON.stringify(w.days));
    }
  });

  it("does not disturb the mileage progression of the earlier weeks", () => {
    for (const w of before.weeks) {
      if (w.weekNumber >= AMEND_FROM) continue;
      const a = after.weeks.find((x) => x.weekNumber === w.weekNumber)!;
      expect(a.targetMileage, `week ${w.weekNumber}`).toBe(w.targetMileage);
    }
  });
});

describe("a program still rebuilds from its inputs alone", () => {
  it("is deterministic — the same snapshot gives the same program", () => {
    const a = buildSkeleton(withChange);
    const b = buildSkeleton(withChange);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
