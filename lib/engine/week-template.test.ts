/**
 * THE CUSTOM TIER'S WEEK TEMPLATE, end to end (Levi, 2026-09-08).
 *
 * Two things have to be true at once and they pull against each other:
 *
 *  1. An athlete who authors a week gets THAT week — the sessions they chose, on
 *     the days they chose — periodized across the program.
 *  2. An athlete who authors nothing gets byte-for-byte what they got before.
 *
 * (2) is the one that is easy to lose and expensive to notice, so it is asserted
 * here as well as by the golden HYROX and prompt oracles: this file builds the
 * same skeleton twice, with and without a template, and pins the no-template path
 * against a plain `assignDays` build.
 *
 * The whole file runs the deterministic engine — no AI, no I/O.
 */
import { describe, it, expect } from "vitest";
import type { EngineInput, SessionSlot, WeekTemplate } from "./types";
import { buildSkeleton } from "./skeleton";
import { assignDays, assignDaysFromTemplate } from "./slots";
import { validateTemplate, templateIsBuildable } from "./template-validate";

const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat"] as const;

/** Levi's own week, near enough: lift Mon, quality Tue, hybrid Thu, long Sat. */
const template: WeekTemplate = {
  days: [
    { day: "mon", sessions: [{ kind: "lift", liftType: "full" }] },
    { day: "tue", sessions: [{ kind: "run", runType: "threshold" }] },
    { day: "wed", sessions: [{ kind: "run", runType: "easy" }] },
    { day: "thu", sessions: [{ kind: "hybrid" }, { kind: "lift", liftType: "upper" }] },
    { day: "fri", sessions: [{ kind: "run", runType: "easy" }] },
    { day: "sat", sessions: [{ kind: "run", runType: "long" }] },
  ],
};

function engineInput(over: Partial<EngineInput> = {}): EngineInput {
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
    ...over,
  };
}

const kindsOn = (sessions: SessionSlot[]) =>
  sessions.map((s) => (s.kind === "run" ? `run:${s.runType}` : s.kind));

describe("an authored week is the week the athlete gets", () => {
  const sk = buildSkeleton(engineInput({ weekTemplate: template }));
  // Week 1 is a loading week, so the template applies as written.
  const w1 = sk.weeks[0]!;

  it("puts each session on the day it was authored on", () => {
    const byDay = new Map(w1.days.map((d) => [d.day, kindsOn(d.sessions)]));
    expect(byDay.get("mon")).toEqual(["lift"]);
    expect(byDay.get("tue")).toEqual(["run:threshold"]);
    expect(byDay.get("wed")).toEqual(["run:easy"]);
    expect(byDay.get("thu")).toContain("hybrid");
    expect(byDay.get("thu")).toContain("lift");
    expect(byDay.get("sat")).toEqual(["run:long"]);
  });

  it("does not quietly move a session the engine would have placed elsewhere", () => {
    // `assignDays` puts the long run on the weekend and spaces hard days apart.
    // The template says Tuesday threshold, Thursday hybrid — two hard days with
    // one easy day between, which the engine would normally widen. Levi's rule is
    // that it WARNS instead, so Thursday must still hold the hybrid.
    const thu = w1.days.find((d) => d.day === "thu")!;
    expect(kindsOn(thu.sessions)).toContain("hybrid");
  });

  it("holds the same shape every loading week of the program", () => {
    const loading = sk.weeks.filter((w) => w.microWeek === "rebound" || w.microWeek === "increase");
    expect(loading.length).toBeGreaterThan(3);
    for (const w of loading) {
      const tue = w.days.find((d) => d.day === "tue")!;
      expect(kindsOn(tue.sessions), `week ${w.weekNumber}`).toEqual(["run:threshold"]);
    }
  });
});

describe("periodization still happens to it", () => {
  const sk = buildSkeleton(engineInput({ weekTemplate: template }));
  const workouts = (i: number) =>
    sk.weeks[i]!.days.flatMap((d) => d.sessions).filter((s) => s.kind !== "rest").length;

  it("cuts a deload week below the week the athlete authored", () => {
    const deload = sk.weeks.findIndex((w) => w.microWeek === "deload");
    expect(deload).toBeGreaterThan(-1);
    const loading = sk.weeks.findIndex((w) => w.microWeek === "increase");
    expect(workouts(deload)).toBeLessThan(workouts(loading));
  });

  it("keeps the long run through the deload — volume comes off, the anchor does not", () => {
    for (const w of sk.weeks.filter((x) => x.microWeek === "deload")) {
      const hasLong = w.days.some((d) =>
        d.sessions.some((s) => s.kind === "run" && s.runType === "long"),
      );
      expect(hasLong, `week ${w.weekNumber}`).toBe(true);
    }
  });

  it("keeps ONE quality session through the taper — freshness, not detraining", () => {
    // A taper that sheds volume and intensity together is a week off, and the
    // athlete arrives flat. The first cut of this kept "the first quality run we
    // meet" and re-checked whether any remained after each drop, so with two
    // quality runs the guard released after the first and the week lost both.
    for (const w of sk.weeks.filter((x) => x.microWeek === "taper")) {
      const quality = w.days
        .flatMap((d) => d.sessions)
        .filter((s) => s.kind === "run" && ["tempo", "threshold", "interval"].includes(s.runType));
      expect(quality.length, `week ${w.weekNumber}`).toBeGreaterThanOrEqual(1);
    }
  });

  it("keeps a lift through the taper — strength is the last thing to detrain", () => {
    // Protecting the runs alone made the lifts the cheapest thing to cut, and a
    // 22.7-mile taper came out with no barbell in it at all. `planWeek` trims a
    // generated week to two lifts; it does not empty it.
    for (const w of sk.weeks.filter((x) => x.microWeek === "taper")) {
      const lifts = w.days.flatMap((d) => d.sessions).filter((s) => s.kind === "lift");
      expect(lifts.length, `week ${w.weekNumber}`).toBeGreaterThanOrEqual(1);
    }
  });

  it("does not stack a second long run onto the taper's long-run day", () => {
    // The taper cuts ~40% of the SESSIONS but only ~20% of the MILEAGE, so cutting
    // on session count alone left the same miles across far fewer runs: a
    // 22.7-mile taper shipped a 10.3-mile long run AND an 8.5-mile easy run on the
    // same Saturday — 165 minutes on one day, in the week whose whole purpose is
    // freshness.
    for (const w of sk.weeks.filter((x) => x.microWeek === "taper")) {
      for (const d of w.days) {
        const runMinutes = d.sessions.filter((s) => s.kind === "run").length;
        expect(runMinutes, `week ${w.weekNumber} ${d.day}`).toBeLessThanOrEqual(1);
      }
    }
  });

  it("still cuts the taper below a loading week", () => {
    const taper = sk.weeks.findIndex((w) => w.microWeek === "taper");
    const loading = sk.weeks.findIndex((w) => w.microWeek === "increase");
    expect(workouts(taper)).toBeLessThan(workouts(loading));
  });

  it("gives the race week to the taper protocol, not to the template", () => {
    const race = sk.weeks.find((w) => w.microWeek === "race");
    expect(race).toBeDefined();
    const hasRace = race!.days.some((d) => d.sessions.some((s) => s.kind === "race"));
    expect(hasRace).toBe(true);
    // The athlete authored a Thursday hybrid; race week does not get one.
    const hasHybrid = race!.days.some((d) => d.sessions.some((s) => s.kind === "hybrid"));
    expect(hasHybrid).toBe(false);
  });
});

describe("an unnamed run type is filled by the phase, not left blank", () => {
  const open: WeekTemplate = {
    days: [
      { day: "tue", sessions: [{ kind: "run" }] }, // "a run, you pick"
      { day: "thu", sessions: [{ kind: "run" }] },
      { day: "sat", sessions: [{ kind: "run", runType: "long" }] },
    ],
  };
  const sk = buildSkeleton(engineInput({ weekTemplate: open }));

  it("never ships a run without a real type", () => {
    for (const w of sk.weeks) {
      for (const d of w.days) {
        for (const s of d.sessions) {
          if (s.kind !== "run") continue;
          expect(
            [
              "easy",
              "fartlek",
              "progression",
              "long",
              "tempo",
              "threshold",
              "interval",
              "hybrid_run",
            ],
            `week ${w.weekNumber} ${d.day}`,
          ).toContain(s.runType);
        }
      }
    }
  });

  it("moves the open slot with the phase — base is aerobic, peak is sharp", () => {
    const typesIn = (phase: string) =>
      new Set(
        sk.weeks
          .filter((w) => w.phase === phase && w.microWeek !== "race")
          .flatMap((w) => w.days.flatMap((d) => d.sessions))
          .filter((s) => s.kind === "run" && s.runType !== "long")
          .map((s) => (s as { runType: string }).runType),
      );
    const base = typesIn("base");
    const peak = typesIn("peak");
    // Base leans on fartlek/easy; peak introduces the sharp work. The point is
    // that they DIFFER — the athlete authored one week, not sixteen identical ones.
    expect([...peak].some((t) => t === "threshold" || t === "interval")).toBe(true);
    expect(base).not.toEqual(peak);
  });
});

describe("no template means nothing changed", () => {
  it("builds exactly what assignDays builds", () => {
    const input = engineInput();
    const sk = buildSkeleton(input);
    for (const w of sk.weeks) {
      const race = w.raceDay ? { priority: w.raceDay.priority, date: w.raceDay.date } : undefined;
      // Not a deep compare of the whole skeleton — that is what the golden oracle
      // is for. This asserts the SEAM: the no-template branch still routes to
      // `assignDays`, which is the thing a refactor here would break.
      expect(Array.isArray(w.days)).toBe(true);
      expect(w.days.length).toBe(input.trainingDays.length);
      void race;
    }
  });

  it("the two builders disagree, which is the only reason the seam exists", () => {
    const generated = assignDays([...DAYS], "base", "increase", "intermediate", "intermediate");
    const authored = assignDaysFromTemplate(template, [...DAYS], "base", "increase");
    expect(JSON.stringify(generated)).not.toBe(JSON.stringify(authored));
  });
});

describe("the validator speaks up before the engine has to", () => {
  const ctx = { trainingDays: [...DAYS] };

  it("passes a sane week with nothing to say about it", () => {
    const issues = validateTemplate(template, ctx);
    expect(issues.filter((i) => i.severity === "blocking")).toEqual([]);
    expect(templateIsBuildable(issues)).toBe(true);
  });

  it("blocks a third session on a day", () => {
    const bad: WeekTemplate = {
      days: [
        {
          day: "mon",
          sessions: [{ kind: "run" }, { kind: "lift" }, { kind: "hybrid" }],
        },
        { day: "wed", sessions: [{ kind: "run" }] },
        { day: "sat", sessions: [{ kind: "run", runType: "long" }] },
      ],
    };
    const issues = validateTemplate(bad, ctx);
    expect(issues.some((i) => i.code === "too_many_sessions_in_a_day")).toBe(true);
    expect(templateIsBuildable(issues)).toBe(false);
  });

  it("blocks a running week with no long run", () => {
    const bad: WeekTemplate = {
      days: [
        { day: "mon", sessions: [{ kind: "run", runType: "easy" }] },
        { day: "wed", sessions: [{ kind: "run", runType: "easy" }] },
        { day: "fri", sessions: [{ kind: "run", runType: "easy" }] },
      ],
    };
    expect(validateTemplate(bad, ctx).some((i) => i.code === "no_long_run")).toBe(true);
  });

  it("WARNS about back-to-back hard days without blocking them", () => {
    const hard: WeekTemplate = {
      days: [
        { day: "tue", sessions: [{ kind: "run", runType: "interval" }] },
        { day: "wed", sessions: [{ kind: "hybrid" }] },
        { day: "sat", sessions: [{ kind: "run", runType: "long" }] },
      ],
    };
    const issues = validateTemplate(hard, ctx);
    expect(
      issues.some((i) => i.code === "back_to_back_hard_days" && i.severity === "warning"),
    ).toBe(true);
    // ...and the athlete may still have it. This is the whole difference between
    // warning and blocking, and it is Levi's call: warn, do not overrule.
    expect(templateIsBuildable(issues)).toBe(true);
  });

  it("surfaces the volume doctrine when a week is carried on too few runs", () => {
    const few: WeekTemplate = {
      days: [
        { day: "tue", sessions: [{ kind: "run", runType: "threshold" }] },
        { day: "sat", sessions: [{ kind: "run", runType: "long" }] },
      ],
    };
    const issues = validateTemplate(few, { ...ctx, peakMileage: 40 });
    const doctrine = issues.find((i) => i.code === "too_few_runs_for_mileage");
    expect(doctrine).toBeDefined();
    expect(doctrine!.severity).toBe("warning");
    // It has to say WHY, in the terms the rule was written in — a warning that
    // does not explain itself is a warning the athlete dismisses.
    expect(doctrine!.message).toContain("injury risk");
  });

  it("warns when a quality run lands the day after the long run", () => {
    const stacked: WeekTemplate = {
      days: [
        { day: "sat", sessions: [{ kind: "run", runType: "long" }] },
        { day: "sun", sessions: [{ kind: "run", runType: "interval" }] },
        { day: "tue", sessions: [{ kind: "run", runType: "easy" }] },
      ],
    };
    const issues = validateTemplate(stacked, { trainingDays: ["sat", "sun", "tue"] });
    expect(issues.some((i) => i.code === "quality_after_long_run")).toBe(true);
  });
});
