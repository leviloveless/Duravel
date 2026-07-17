/**
 * PROMPT ORACLE — freezes the HYROX system + user prompts so the sport-config
 * rewire of the prompt layer stays byte-identical for HYROX. Generated from the
 * pre-rewire builders; a diff means the prompt drifted.
 */
import { describe, it, expect } from "vitest";
import type { GenerationInput } from "@/lib/schemas";
import { buildSkeleton, toEngineInput } from "@/lib/engine";
import { hyrox } from "@/lib/engine/sports";
import { buildSystemPrompt, buildUserPrompt } from "./prompts";

const START = "2026-07-16";

const genInput: GenerationInput = {
  profile: {
    firstName: "Test",
    age: 35,
    bodyWeight: 80,
    weightUnit: "kg",
    runningExp: "intermediate",
    hybridExp: "intermediate",
    liftingExp: "intermediate",
    trainingClass: "non_highly_trained",
    trainingDays: ["mon", "tue", "wed", "thu", "fri"],
    sex: "male",
    benchmarks: {
      fiveKTime: "22:00",
      tenKTime: "46:00",
      ski2kTime: "7:30",
      row2kTime: "7:20",
      fiveRmSquat: 140,
      fiveRmDeadlift: 180,
      fiveRmBench: 100,
    },
  },
  programType: "goal_event",
  durationWeeks: 16,
  races: [{ raceDate: "2026-11-05", priority: "A" }],
  startDate: START,
};

const skeleton = buildSkeleton(toEngineInput(genInput, START));
const weeksIn = (phase: string) => skeleton.weeks.filter((w) => w.phase === phase);

describe("PROMPT ORACLE — HYROX prompts must stay byte-identical through the config rewire", () => {
  it("system prompt", () => {
    expect(buildSystemPrompt()).toMatchSnapshot();
  });
  it("user prompt — base mesocycle", () => {
    expect(buildUserPrompt(genInput, "base", weeksIn("base"))).toMatchSnapshot();
  });
  it("user prompt — build mesocycle", () => {
    expect(buildUserPrompt(genInput, "build", weeksIn("build"))).toMatchSnapshot();
  });
  it("user prompt — peak mesocycle", () => {
    expect(buildUserPrompt(genInput, "peak", weeksIn("peak"))).toMatchSnapshot();
  });

  it("prompt persona is config-driven — the rewire is live, not cosmetic", () => {
    const triish = { ...hyrox, philosophy: { ...hyrox.philosophy, coach: "expert triathlon coach" } };
    const sys = buildSystemPrompt(triish);
    expect(sys).toContain("You are an expert triathlon coach");
    expect(sys).not.toBe(buildSystemPrompt()); // differs from the HYROX default
    // Default (no cfg) still resolves to HYROX.
    expect(buildSystemPrompt()).toContain("You are an expert HYROX coach");
  });
});
