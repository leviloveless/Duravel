/**
 * THE GOAL PRESETS MUST NOT WARN ABOUT THEMSELVES (Levi, 2026-09-08).
 *
 * `suggestTemplate` and `validateTemplate` are two halves of the same feature and
 * they run against each other live in the designer: the preset fills the grid,
 * the validator reads it back. So a preset that trips its own rules opens the
 * custom tier by telling the athlete the week it just gave them is wrong.
 *
 * That happened three times while these were being written, and each one was a
 * real finding rather than a test to relax:
 *
 *   1. every preset put a hard session the day before the long run, because
 *      Friday was simply the last free day;
 *   2. the full-body lift landed the day before a quality run, because "not the
 *      day before the LONG run" is a narrower rule than the one that matters;
 *   3. a hybrid was treated as neutral and two quality runs added beside it,
 *      giving a six-day week four hard days out of four available — which cannot
 *      be separated however they are ordered.
 *
 * This file is what keeps all three fixed.
 */
import { describe, it, expect } from "vitest";
import { suggestTemplate, TEMPLATE_GOALS, type TemplateGoal } from "./template-presets";
import { validateTemplate, templateIsBuildable } from "./template-validate";
import type { TrainingDayName } from "./types";

const SIX: TrainingDayName[] = ["mon", "tue", "wed", "thu", "fri", "sat"];
const FOUR: TrainingDayName[] = ["tue", "thu", "sat", "sun"];
const THREE: TrainingDayName[] = ["tue", "thu", "sat"];

/** Warnings the LAYOUT is responsible for — the ones a preset can actually fix. */
const LAYOUT_CODES = new Set([
  "back_to_back_hard_days",
  "quality_after_long_run",
  "consecutive_leg_lifts",
  "leg_lift_before_key_run",
  "two_lifts_one_day",
  "no_rest_day",
]);

const goals = TEMPLATE_GOALS.map((g) => g.id);

describe.each(goals)("the %s preset", (goal: TemplateGoal) => {
  for (const [name, days, mileage] of [
    ["six training days", SIX, 30],
    ["four training days", FOUR, 20],
    ["three training days", THREE, 15],
  ] as const) {
    describe(name, () => {
      const t = suggestTemplate(goal, {
        trainingDays: [...days],
        includeHybrid: true,
        peakMileage: mileage,
      });
      const issues = validateTemplate(t, {
        trainingDays: [...days],
        peakMileage: mileage,
        prescribesHybrid: true,
      });

      it("is buildable", () => {
        expect(templateIsBuildable(issues), JSON.stringify(issues)).toBe(true);
      });

      it("raises no layout warning against itself", () => {
        const layout = issues.filter((i) => LAYOUT_CODES.has(i.code));
        expect(layout.map((i) => `${i.code}${i.day ? `/${i.day}` : ""}`)).toEqual([]);
      });

      it("gives the week exactly one long run", () => {
        const all = t.days.flatMap((d) => d.sessions);
        expect(all.filter((s) => s.kind === "run" && s.runType === "long")).toHaveLength(1);
      });

      it("leaves a day clear where the week has one to spare", () => {
        // Only meaningful from six training days up. An athlete who trains three
        // days already has four off, and reserving a fifth is how the preset
        // blocked its own output on `too_few_training_days`.
        if (days.length < 6) return;
        const used = t.days.filter((d) => d.sessions.length > 0).length;
        expect(used).toBeLessThan(days.length);
      });

      it("never puts three sessions on a day", () => {
        for (const d of t.days) expect(d.sessions.length).toBeLessThanOrEqual(2);
      });
    });
  }
});

describe("the goals differ from each other, which is the only reason to have three", () => {
  const shape = (goal: TemplateGoal) =>
    JSON.stringify(
      suggestTemplate(goal, { trainingDays: [...SIX], peakMileage: 30 }).days.flatMap((d) =>
        d.sessions.map((s) => (s.kind === "run" ? s.runType : s.kind)),
      ),
    );

  it("puts a different kind of hard session in the week", () => {
    expect(shape("aerobic_capacity")).not.toBe(shape("lactate_threshold"));
    expect(shape("aerobic_base")).not.toBe(shape("aerobic_capacity"));
  });

  it("keeps aerobic base the least intense of the three", () => {
    const hard = (goal: TemplateGoal) =>
      suggestTemplate(goal, { trainingDays: [...SIX], peakMileage: 30 })
        .days.flatMap((d) => d.sessions)
        .filter(
          (s) => s.kind === "run" && ["interval", "threshold", "tempo"].includes(s.runType ?? ""),
        ).length;
    expect(hard("aerobic_base")).toBeLessThan(hard("lactate_threshold"));
  });
});

describe("a hybrid takes a quality slot rather than sitting outside the count", () => {
  it("places fewer named quality runs when the sport has station work", () => {
    const named = (includeHybrid: boolean) =>
      suggestTemplate("lactate_threshold", {
        trainingDays: [...SIX],
        includeHybrid,
        peakMileage: 30,
      })
        .days.flatMap((d) => d.sessions)
        .filter(
          (s) => s.kind === "run" && ["interval", "threshold", "tempo"].includes(s.runType ?? ""),
        ).length;
    // A station session is interval work with a sled attached. Counting it as
    // neutral is what gave a six-day week four hard days it could not separate.
    expect(named(true)).toBeLessThan(named(false));
  });
});

describe("too few training days to build a week", () => {
  it("returns an empty template rather than a broken one", () => {
    const t = suggestTemplate("aerobic_base", { trainingDays: ["tue", "thu"] });
    expect(t.days).toEqual([]);
  });
});
