import { describe, it, expect } from "vitest";
import {
  extrasFromRows,
  extraDetail,
  extraSummaryLabel,
  extraTitle,
  extraTotals,
  extrasForDay,
  extrasForWeek,
  EMPTY_EXTRA_TOTALS,
} from "./extra-workouts";
import { ExtraWorkoutInputSchema, ExtraWorkoutSchema, type ExtraWorkout } from "./schemas";

const x = (over: Partial<ExtraWorkout> = {}): ExtraWorkout => ({
  id: "x1",
  weekNumber: 1,
  day: "mon",
  kind: "run",
  ...over,
});

describe("selecting extras", () => {
  const all = [
    x({ id: "a", weekNumber: 1, day: "mon" }),
    x({ id: "b", weekNumber: 1, day: "mon" }),
    x({ id: "c", weekNumber: 1, day: "sat" }),
    x({ id: "d", weekNumber: 2, day: "mon" }),
  ];

  it("slices by week", () => {
    expect(extrasForWeek(all, 1).map((e) => e.id)).toEqual(["a", "b", "c"]);
    expect(extrasForWeek(all, 3)).toEqual([]);
  });

  it("slices by week AND day, keeping insertion order", () => {
    expect(extrasForDay(all, 1, "mon").map((e) => e.id)).toEqual(["a", "b"]);
    expect(extrasForDay(all, 2, "mon").map((e) => e.id)).toEqual(["d"]);
    expect(extrasForDay(all, 1, "wed")).toEqual([]);
  });
});

describe("extraTotals", () => {
  it("is empty for no extras", () => {
    expect(extraTotals([])).toEqual(EMPTY_EXTRA_TOTALS);
  });

  it("sums duration and distance", () => {
    const t = extraTotals([
      x({ durationMin: 45, distanceMiles: 4.2 }),
      x({ durationMin: 30, distanceMiles: 1.9 }),
    ]);
    expect(t).toEqual({ count: 2, minutes: 75, miles: 6.1 });
  });

  it("counts an extra that recorded neither duration nor distance", () => {
    const t = extraTotals([x({ title: "Yoga class" }), x({ durationMin: 20 })]);
    expect(t.count).toBe(2);
    expect(t.minutes).toBe(20);
    expect(t.miles).toBe(0);
  });

  it("does not accumulate floating-point noise in the mileage", () => {
    const t = extraTotals([x({ distanceMiles: 0.1 }), x({ distanceMiles: 0.2 })]);
    expect(t.miles).toBe(0.3);
  });
});

describe("labels", () => {
  it("prefers the athlete's own title, falling back to the kind", () => {
    expect(extraTitle(x({ title: "Pickup basketball" }))).toBe("Pickup basketball");
    expect(extraTitle(x({ kind: "lift" }))).toBe("Strength");
    expect(extraTitle(x({ title: "   " }))).toBe("Run"); // blank title is not a title
  });

  it("omits whatever wasn't recorded", () => {
    expect(extraDetail(x({ durationMin: 45, distanceMiles: 4.2, rpe: 6 }))).toBe("45 min · 4.2 mi · RPE 6");
    expect(extraDetail(x({ durationMin: 45 }))).toBe("45 min");
    expect(extraDetail(x({}))).toBe("");
  });

  it("summarises a week's extras, and says nothing when there are none", () => {
    expect(extraSummaryLabel([])).toBe("");
    expect(extraSummaryLabel([x({ durationMin: 45, distanceMiles: 4.2 })])).toBe("1 extra workout · 45 min · 4.2 mi");
    expect(
      extraSummaryLabel([x({ durationMin: 45, distanceMiles: 4.2 }), x({ durationMin: 30, distanceMiles: 1.9 })]),
    ).toBe("2 extra workouts · 75 min · 6.1 mi");
    expect(extraSummaryLabel([x({ title: "Yoga" })])).toBe("1 extra workout");
  });
});

describe("extrasFromRows", () => {
  const row = {
    id: "r1",
    week_number: 2,
    day: "sat",
    kind: "run",
    title: null,
    duration_min: 40,
    distance_miles: "5.20", // Postgres numeric arrives as a string
    avg_hr: 148,
    goal_zone: null,
    rpe: null,
    note: null,
    activity_id: null,
  };

  it("maps snake_case rows and coerces numeric strings", () => {
    expect(extrasFromRows([row])).toEqual([
      { id: "r1", weekNumber: 2, day: "sat", kind: "run", durationMin: 40, distanceMiles: 5.2, avgHr: 148 },
    ]);
  });

  it("drops a row that no longer validates rather than rendering half a workout", () => {
    expect(extrasFromRows([{ ...row, kind: "kayaking" }])).toEqual([]);
    expect(extrasFromRows([{ ...row, day: "funday" }])).toEqual([]);
    expect(extrasFromRows([row, { ...row, id: "r2", week_number: 99 }]).map((e) => e.id)).toEqual(["r1"]);
  });

  it("keeps an empty list empty", () => {
    expect(extrasFromRows([])).toEqual([]);
  });
});

describe("schema", () => {
  it("accepts a minimal entry — just a day and a kind", () => {
    const parsed = ExtraWorkoutInputSchema.safeParse({
      programId: "p1",
      weekNumber: 1,
      day: "mon",
      kind: "other",
    });
    expect(parsed.success).toBe(true);
  });

  it("accepts a fully detailed entry", () => {
    const parsed = ExtraWorkoutInputSchema.safeParse({
      programId: "p1",
      weekNumber: 3,
      day: "sat",
      kind: "run",
      title: "Parkrun",
      durationMin: 24,
      distanceMiles: 3.1,
      avgHr: 165,
      goalZone: 4,
      rpe: 8,
      note: "Felt strong",
      activityId: "act-1",
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects out-of-range and unknown values", () => {
    const bad = (patch: Record<string, unknown>) =>
      ExtraWorkoutInputSchema.safeParse({ programId: "p1", weekNumber: 1, day: "mon", kind: "run", ...patch }).success;
    expect(bad({ durationMin: 0 })).toBe(false);
    expect(bad({ durationMin: 601 })).toBe(false);
    expect(bad({ distanceMiles: 101 })).toBe(false);
    expect(bad({ rpe: 11 })).toBe(false);
    expect(bad({ goalZone: 6 })).toBe(false);
    expect(bad({ avgHr: 20 })).toBe(false);
    expect(bad({ kind: "swimming" })).toBe(false);
    expect(bad({ day: "funday" })).toBe(false);
    expect(bad({ weekNumber: 25 })).toBe(false);
  });

  it("a stored row round-trips through the read schema", () => {
    expect(ExtraWorkoutSchema.safeParse(x({ durationMin: 45 })).success).toBe(true);
  });
});
