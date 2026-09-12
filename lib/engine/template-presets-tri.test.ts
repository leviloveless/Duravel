/**
 * The triathlon preset, held to the bar the running presets are held to.
 *
 * `suggestTemplate` and `validateTemplate` are two halves of one feature: a
 * preset that trips its own validator is worse than no preset, because the
 * athlete's first sight of the designer is a week the engine is complaining
 * about. The running presets have had that test since 2026-09-08; adding a
 * fourth layout without one would have been the easiest possible way to ship the
 * same bug in a new sport.
 *
 * What is asserted here that the running suite cannot assert: that all three
 * disciplines actually appear. A triathlon week with no swim in it passes every
 * layout rule in the validator — they are all rules about running impact — which
 * is exactly why it needs saying out loud.
 */
import { describe, it, expect } from "vitest";
import { suggestTemplate, TEMPLATE_GOALS, type TemplateGoal } from "./template-presets";
import { validateTemplate, templateIsBuildable } from "./template-validate";
import type { TrainingDayName } from "./types";

const SIX: TrainingDayName[] = ["mon", "tue", "wed", "thu", "sat", "sun"];
const FIVE: TrainingDayName[] = ["mon", "tue", "thu", "sat", "sun"];
const FOUR: TrainingDayName[] = ["tue", "thu", "sat", "sun"];
const THREE: TrainingDayName[] = ["tue", "thu", "sat"];

/** Warnings the preset raises against its OWN layout — the ones it must not. */
const LAYOUT_CODES = new Set([
  "back_to_back_hard_days",
  "quality_after_long_run",
  "lift_before_key_run",
  "lifts_on_consecutive_days",
  "no_rest_day",
]);

const goals = TEMPLATE_GOALS.map((g) => g.id);

describe.each(goals)("the triathlon %s preset", (goal: TemplateGoal) => {
  for (const [name, days] of [
    ["six training days", SIX],
    ["five training days", FIVE],
    ["four training days", FOUR],
    ["three training days", THREE],
  ] as const) {
    describe(name, () => {
      const t = suggestTemplate(goal, {
        trainingDays: [...days],
        includeSwimBike: true,
        peakMileage: 25,
      });
      const issues = validateTemplate(t, {
        trainingDays: [...days],
        peakMileage: 25,
        prescribesSwimBike: true,
      });
      const all = t.days.flatMap((d) => d.sessions);

      it("is buildable", () => {
        expect(templateIsBuildable(issues), JSON.stringify(issues, null, 1)).toBe(true);
      });

      it("raises no layout warning against itself", () => {
        const layout = issues.filter((i) => LAYOUT_CODES.has(i.code));
        expect(layout.map((i) => `${i.code}${i.day ? `/${i.day}` : ""}`)).toEqual([]);
      });

      it("puts all three disciplines in the week", () => {
        expect(
          all.some((s) => s.kind === "swim"),
          "no swim",
        ).toBe(true);
        expect(
          all.some((s) => s.kind === "bike" || s.kind === "brick"),
          "no ride",
        ).toBe(true);
        expect(
          all.some((s) => s.kind === "run"),
          "no run",
        ).toBe(true);
      });

      it("gives the week exactly one long run", () => {
        expect(all.filter((s) => s.kind === "run" && s.runType === "long")).toHaveLength(1);
      });

      it("rehearses race day with a brick", () => {
        expect(all.filter((s) => s.kind === "brick")).toHaveLength(1);
      });

      it("never puts three sessions on a day", () => {
        for (const d of t.days) expect(d.sessions.length).toBeLessThanOrEqual(2);
      });

      it("offers no station work — a triathlon has no sled", () => {
        expect(all.some((s) => s.kind === "hybrid")).toBe(false);
        expect(all.some((s) => s.kind === "lift" && s.liftType === "power")).toBe(false);
      });
    });
  }
});

describe("a triathlon week is not a running week with a swim bolted on", () => {
  it("spends most of its sessions outside running", () => {
    const t = suggestTemplate("aerobic_base", {
      trainingDays: [...SIX],
      includeSwimBike: true,
      peakMileage: 25,
    });
    const all = t.days.flatMap((d) => d.sessions);
    const runs = all.filter((s) => s.kind === "run").length;
    const other = all.filter(
      (s) => s.kind === "swim" || s.kind === "bike" || s.kind === "brick",
    ).length;
    expect(other).toBeGreaterThanOrEqual(runs);
  });
});

/**
 * The warning that told a triathlete their sessions were capped at "8 minutes".
 *
 * `week_cannot_carry_hours` was first written against `bandSessionCap`, on the
 * assumption that it returned a per-session MINUTE ceiling. It returns a
 * per-week SESSION COUNT — 5 to 8 — so the message read "every one at its
 * 8-minute ceiling this week tops out near 0.9 h against the 20 h your band
 * allows". Every test around it passed, because none of them read the sentence.
 *
 * These do. The numbers are asserted as numbers, in the units a human would
 * check them in.
 */
describe("the week-cannot-carry-hours warning says something true", () => {
  const SIXTH: TrainingDayName[] = ["mon", "tue", "wed", "thu", "sat", "sun"];
  const sparse = {
    days: [
      { day: "mon" as TrainingDayName, sessions: [{ kind: "swim" as const }] },
      { day: "wed" as TrainingDayName, sessions: [{ kind: "bike" as const }] },
      {
        day: "sat" as TrainingDayName,
        sessions: [{ kind: "run" as const, runType: "long" as const }],
      },
    ],
  };

  it("fires when three sessions are asked to hold twenty hours", () => {
    const issues = validateTemplate(sparse, {
      trainingDays: SIXTH,
      weeklyHours: "h10_20",
      maxSessionMinutes: 180,
      prescribesSwimBike: true,
    });
    const w = issues.find((i) => i.code === "week_cannot_carry_hours");
    expect(w, JSON.stringify(issues.map((i) => i.code))).toBeDefined();
    // 3 sessions x 180 min = 9 h, against the band's 20 h.
    expect(w!.message).toContain("180-minute ceiling");
    expect(w!.message).toContain("9 h");
    expect(w!.message).toContain("20 h");
    // The units are hours and minutes, never a session count wearing either.
    expect(w!.message).not.toContain("8-minute");
  });

  it("stays quiet on a week that can carry its band", () => {
    const dense = {
      days: SIXTH.map((day) => ({
        day,
        sessions: [{ kind: "bike" as const }, { kind: "swim" as const }],
      })),
    };
    const issues = validateTemplate(dense, {
      trainingDays: SIXTH,
      weeklyHours: "h10_20",
      maxSessionMinutes: 180,
      prescribesSwimBike: true,
    });
    expect(issues.map((i) => i.code)).not.toContain("week_cannot_carry_hours");
  });

  it("stays quiet when the caller gave it no ceiling to measure against", () => {
    // Silence is the correct failure for a missing input — a warning computed
    // from a number nobody supplied is how the first version got its 8 minutes.
    const issues = validateTemplate(sparse, {
      trainingDays: SIXTH,
      weeklyHours: "h10_20",
      prescribesSwimBike: true,
    });
    expect(issues.map((i) => i.code)).not.toContain("week_cannot_carry_hours");
  });
});

describe("the triathlon weekend is not a mistake", () => {
  const WEEKEND: TrainingDayName[] = ["tue", "thu", "sat", "sun"];
  const week = {
    days: [
      { day: "tue" as TrainingDayName, sessions: [{ kind: "swim" as const }] },
      { day: "thu" as TrainingDayName, sessions: [{ kind: "bike" as const }] },
      { day: "sat" as TrainingDayName, sessions: [{ kind: "brick" as const }] },
      {
        day: "sun" as TrainingDayName,
        sessions: [{ kind: "run" as const, runType: "long" as const }],
      },
    ],
  };

  it("says nothing about a brick on Saturday into a long run on Sunday", () => {
    const issues = validateTemplate(week, {
      trainingDays: WEEKEND,
      prescribesSwimBike: true,
    });
    expect(issues.map((i) => i.code)).not.toContain("back_to_back_hard_days");
  });

  it("still says it for a sport that does not ride", () => {
    // The guard that keeps the exemption honest: the same two days on a HYROX
    // athlete are two hard days, and the rule is unchanged for them.
    const issues = validateTemplate(week, { trainingDays: WEEKEND });
    expect(issues.map((i) => i.code)).toContain("back_to_back_hard_days");
  });

  it("still says it for two hard RUNS on a triathlete's weekend", () => {
    // The exemption is about the ride/run pairing specifically, not a licence to
    // stack anything on a triathlon weekend.
    const twoRuns = {
      days: [
        { day: "tue" as TrainingDayName, sessions: [{ kind: "swim" as const }] },
        { day: "thu" as TrainingDayName, sessions: [{ kind: "bike" as const }] },
        {
          day: "sat" as TrainingDayName,
          sessions: [{ kind: "run" as const, runType: "threshold" as const }],
        },
        {
          day: "sun" as TrainingDayName,
          sessions: [{ kind: "run" as const, runType: "long" as const }],
        },
      ],
    };
    const issues = validateTemplate(twoRuns, {
      trainingDays: WEEKEND,
      prescribesSwimBike: true,
    });
    expect(issues.map((i) => i.code)).toContain("back_to_back_hard_days");
  });
});
