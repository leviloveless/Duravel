/**
 * Editing an extra workout (Levi, 2026-08-13).
 *
 * Extras could only be ADDED and DELETED. Correcting a mistyped duration meant
 * deleting the workout and retyping every field, so `ExtraWorkoutUpdateSchema`
 * and `updateExtraWorkout` close that gap.
 *
 * The schema is what these tests pin — the action itself needs Supabase, and
 * this repo mocks nothing (`vi.mock` appears nowhere), so the validation surface
 * is the honest seam. What matters:
 *
 *  - it accepts exactly what the ADD form accepts, plus an `id`. If the two ever
 *    drift, a field will be addable but not editable, which is a silent trap;
 *  - **an omitted optional field is a CLEAR, not a keep.** An edit form that
 *    cannot unset a value strands the athlete who typed 45 minutes by mistake.
 *    The action writes `?? null` for every optional, so "absent" must parse.
 */
import { describe, it, expect } from "vitest";
import { ExtraWorkoutInputSchema, ExtraWorkoutUpdateSchema } from "@/lib/schemas";

const base = {
  programId: "prog-1",
  weekNumber: 2,
  day: "wed" as const,
  kind: "run" as const,
};

describe("ExtraWorkoutUpdateSchema", () => {
  it("is the add schema plus an id — so anything addable is editable", () => {
    const full = {
      ...base,
      title: "Lunch run",
      durationMin: 45,
      distanceMiles: 5.2,
      avgHr: 150,
      goalZone: 2,
      rpe: 5,
      note: "felt good",
    };
    expect(ExtraWorkoutInputSchema.safeParse(full).success).toBe(true);
    expect(ExtraWorkoutUpdateSchema.safeParse({ ...full, id: "x1" }).success).toBe(true);
  });

  it("requires the id — an update with nothing to update is a bug, not a no-op", () => {
    expect(ExtraWorkoutUpdateSchema.safeParse(base).success).toBe(false);
    expect(ExtraWorkoutUpdateSchema.safeParse({ ...base, id: "" }).success).toBe(false);
  });

  it("accepts an edit that CLEARS every optional field", () => {
    // The action maps each optional to `?? null`, so this is how the athlete
    // takes back a duration they typed by mistake. If the schema demanded them,
    // a wrong value could never be removed — only overwritten.
    const cleared = ExtraWorkoutUpdateSchema.safeParse({ ...base, id: "x1" });
    expect(cleared.success).toBe(true);
    if (cleared.success) {
      expect(cleared.data.durationMin).toBeUndefined();
      expect(cleared.data.distanceMiles).toBeUndefined();
      expect(cleared.data.avgHr).toBeUndefined();
      expect(cleared.data.rpe).toBeUndefined();
      expect(cleared.data.note).toBeUndefined();
    }
  });

  it("allows week and day to move — a workout logged on the wrong day is a fix", () => {
    const moved = ExtraWorkoutUpdateSchema.safeParse({
      ...base,
      id: "x1",
      weekNumber: 3,
      day: "sat",
    });
    expect(moved.success).toBe(true);
  });

  it("still enforces the field bounds", () => {
    const bad = [
      { rpe: 11 },
      { rpe: 0 },
      { avgHr: 300 },
      { avgHr: 20 },
      { durationMin: 0 },
      { durationMin: 601 },
      { distanceMiles: -1 },
      { weekNumber: 0 },
      { weekNumber: 99 },
      { day: "funday" },
      { kind: "yoga" },
      { title: "x".repeat(81) },
      { note: "x".repeat(281) },
    ];
    for (const over of bad) {
      const res = ExtraWorkoutUpdateSchema.safeParse({ ...base, id: "x1", ...over });
      expect(res.success, JSON.stringify(over)).toBe(false);
    }
  });

  it("rejects a non-integer RPE or duration rather than silently rounding", () => {
    expect(ExtraWorkoutUpdateSchema.safeParse({ ...base, id: "x1", rpe: 5.5 }).success).toBe(false);
    expect(
      ExtraWorkoutUpdateSchema.safeParse({ ...base, id: "x1", durationMin: 45.5 }).success,
    ).toBe(false);
  });
});
