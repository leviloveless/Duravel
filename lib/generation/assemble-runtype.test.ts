import { describe, it, expect } from "vitest";
import { daySessions } from "./assemble";
import type { AiWeek, Session } from "@/lib/schemas";
import type { SessionSlot, WeekSkeleton } from "@/lib/engine/types";

/**
 * The engine owns RUN TYPE, including which day holds the weekly long run.
 *
 * Sessions are matched to planned slots by KIND, so before this guard an AI that
 * returned an "easy" run on the planned long-run day would have that easy run
 * assembled verbatim — silently moving the long run to whichever day the model
 * happened to put one on, and defeating the athlete's long-run day preference.
 */

type DaySlot = WeekSkeleton["days"][number];

const longSlot: SessionSlot = { kind: "run", runType: "long", goalZone: 2, isLong: true };
const easySlot: SessionSlot = { kind: "run", runType: "easy", goalZone: 2 };

const aiRun = (runType: string, goalZone = 3): Session => ({
  kind: "run",
  runType: runType as Extract<Session, { kind: "run" }>["runType"],
  durationMin: 40,
  paceMinMile: "7:30",
  distanceMiles: 5,
  goalZone,
});

const skel = (sessions: SessionSlot[]): DaySlot => ({ day: "sat", sessions });
const ai = (sessions: Session[]): AiWeek => ({ weekNumber: 1, days: [{ day: "sat", sessions }] });

describe("daySessions — engine run type wins over the AI's", () => {
  it("rewrites an AI easy run to the planned LONG run (keeps the long run on its day)", () => {
    const out = daySessions(skel([longSlot]), ai([aiRun("easy", 2)]), [], 1);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ kind: "run", runType: "long", goalZone: 2 });
  });

  it("rewrites an AI long run to the planned EASY run (no duplicate long runs)", () => {
    const out = daySessions(skel([easySlot]), ai([aiRun("long", 2)]), [], 1);
    expect(out[0]).toMatchObject({ kind: "run", runType: "easy" });
  });

  it("carries the engine's goal zone with the enforced type", () => {
    const out = daySessions(
      skel([{ kind: "run", runType: "interval", goalZone: 5 }]),
      ai([aiRun("easy", 2)]),
      [],
      1,
    );
    expect(out[0]).toMatchObject({ runType: "interval", goalZone: 5 });
  });

  it("prefers an exact type match so the AI's own content is kept where it agrees", () => {
    const out = daySessions(skel([longSlot, easySlot]), ai([aiRun("easy", 2), aiRun("long", 2)]), [], 1);
    // The AI's "long" fills the long slot and its "easy" fills the easy slot,
    // rather than both being force-rewritten in positional order.
    expect(out.map((s) => (s.kind === "run" ? s.runType : s.kind))).toEqual(["long", "easy"]);
  });

  it("leaves a correctly-typed run untouched", () => {
    const out = daySessions(skel([longSlot]), ai([aiRun("long", 2)]), [], 1);
    expect(out[0]).toMatchObject({ runType: "long", distanceMiles: 5, durationMin: 40 });
  });
});
