import { describe, it, expect } from "vitest";
import { LIBRARY } from "@/lib/library/workouts";
import { DISCIPLINES, GOALS, PHASES, type Goal } from "@/lib/library/types";

/**
 * Invariants for the seed library. These are not style checks — each one is a
 * property the `/library` page or a future scheduler depends on, and all of them
 * are the kind of thing that breaks silently when somebody adds a workout by
 * copy-pasting the one above it.
 */
describe("the workout library", () => {
  it("has the seed set", () => {
    expect(LIBRARY.length).toBe(70);
  });

  it("gives every id exactly once", () => {
    // A duplicate id is the bug that matters most: ids are stable references, so
    // two workouts sharing one means a scheduled session resolves to the wrong
    // workout — and React renders the wrong one under a duplicate key besides.
    const ids = LIBRARY.map((w) => w.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("uses only known goals, disciplines and phases", () => {
    for (const w of LIBRARY) {
      expect(GOALS).toContain(w.goal);
      expect(DISCIPLINES).toContain(w.discipline);
      expect(PHASES).toContain(w.phase);
    }
  });

  it("carries ten workouts per goal", () => {
    // Even coverage is what makes the goal filter useful: a goal with two entries
    // reads as a broken filter rather than a small category.
    const byGoal = new Map<Goal, number>();
    for (const w of LIBRARY) byGoal.set(w.goal, (byGoal.get(w.goal) ?? 0) + 1);
    for (const g of GOALS) expect(byGoal.get(g), g).toBe(10);
  });

  it("leaves no goal without a hybrid or lift option", () => {
    // HYROX and DEKA are the bread and butter, so every goal has to be reachable
    // through work an athlete does in a gym, not only through running.
    for (const g of GOALS) {
      const kinds = LIBRARY.filter((w) => w.goal === g).map((w) => w.discipline);
      expect(
        kinds.some((k) => k === "hybrid" || k === "lift"),
        g,
      ).toBe(true);
    }
  });

  it("gives every workout a real structure and a real reason", () => {
    for (const w of LIBRARY) {
      expect(w.structure.length, w.id).toBeGreaterThanOrEqual(2);
      expect(
        w.structure.every((s) => s.trim().length > 0),
        w.id,
      ).toBe(true);
      expect(w.why.trim().length, w.id).toBeGreaterThan(30);
      expect(w.why.trim().endsWith("."), w.id).toBe(true);
    }
  });

  it("keeps durations inside a plausible session length", () => {
    for (const w of LIBRARY) {
      expect(w.minutes, w.id).toBeGreaterThanOrEqual(20);
      expect(w.minutes, w.id).toBeLessThanOrEqual(120);
    }
  });

  it("prefixes every id with its own goal", () => {
    // Stronger than a shape check: the prefix is how a human scanning the file
    // sees which block a workout belongs to, and a copy-pasted entry that kept
    // the previous block's prefix is exactly the mistake this catches.
    const prefix: Record<Goal, string> = {
      aerobic: "aer",
      threshold: "thr",
      vo2: "vo2",
      durability: "dur",
      hypertrophy: "hyp",
      max_strength: "str",
      max_power: "pwr",
    };
    for (const w of LIBRARY) {
      expect(w.id, w.id).toMatch(/^[a-z][a-z0-9]{2}-[a-z0-9-]+$/);
      expect(
        w.id.startsWith(`${prefix[w.goal]}-`),
        `${w.id} should start with ${prefix[w.goal]}-`,
      ).toBe(true);
    }
  });

  it("names each workout once", () => {
    const names = LIBRARY.map((w) => w.name);
    expect(new Set(names).size).toBe(names.length);
  });
});
