import { describe, it, expect } from "vitest";
import { applyStrengthSchemes } from "./assemble";
import { REQUIRED_MOVEMENT_PATTERNS } from "@/lib/schemas";
import type { ProgramWeek, Session } from "@/lib/schemas";

function weekWith(phase: ProgramWeek["phase"], micro: ProgramWeek["microWeek"]): ProgramWeek {
  return {
    weekNumber: 1,
    phase,
    microWeek: micro,
    summary: {
      totalCardioMinutes: 0,
      totalMileage: 0,
      zoneDistribution: { z1: 0, z2: 0, z3: 0, z4: 0, z5: 0 },
    },
    days: [
      {
        day: "mon",
        sessions: [
          {
            kind: "lift",
            liftType: "full",
            movements: [
              { pattern: "squat", sets: 3, repRange: "12-15" },
              { pattern: "lunge", sets: 3, repRange: "12-15" },
            ],
          },
        ],
      },
    ],
  };
}

describe("applyStrengthSchemes", () => {
  it("overrides AI reps with periodized schemes + weights + plyo (Base)", () => {
    const w = weekWith("base", "increase");
    applyStrengthSchemes(w, { fiveRmSquat: 315 }, "lbs");
    const lift = w.days[0]!.sessions[0]!;
    if (lift.kind !== "lift") throw new Error("expected lift");
    const squat = lift.movements.find((m) => m.pattern === "squat")!;
    const lunge = lift.movements.find((m) => m.pattern === "lunge")!;
    expect(squat.emphasis).toBe("max_strength");
    expect(squat.repRange).not.toBe("12-15"); // AI value overridden
    expect(squat.suggestedWeight).toContain("lbs");
    expect(lunge.emphasis).toBe("endurance");
    expect(lift.power).toBeTruthy(); // plyometrics in Base
  });

  it("no plyometric element in Peak", () => {
    const w = weekWith("peak", "rebound");
    applyStrengthSchemes(w);
    const lift = w.days[0]!.sessions[0]!;
    if (lift.kind !== "lift") throw new Error("expected lift");
    expect(lift.power).toBeUndefined();
    expect(lift.movements[0]!.intensityPct).toBe(88);
  });
});

// --- weekly working-set volume + the light full-body day ----------------------
//
// Levi's rules (2026-08-04): weekly working sets per movement PATTERN come from
// lifting experience (beginner 6 / intermediate 8 / advanced 10, scaled down on
// deload + taper) and are split across the sessions that train that pattern; and
// when a week carries more than one full-body lift, the LATER one runs light
// (12–15 reps).

type Lift = Extract<Session, { kind: "lift" }>;
type Move = { pattern: string; sets: number; repRange: string };

function makeWeek(
  phase: ProgramWeek["phase"],
  micro: ProgramWeek["microWeek"],
  sessions: {
    day: ProgramWeek["days"][number]["day"];
    liftType: Lift["liftType"];
    patterns: string[];
  }[],
): ProgramWeek {
  return {
    weekNumber: 1,
    phase,
    microWeek: micro,
    summary: {
      totalCardioMinutes: 0,
      totalMileage: 0,
      zoneDistribution: { z1: 0, z2: 0, z3: 0, z4: 0, z5: 0 },
    },
    days: sessions.map((s) => ({
      day: s.day,
      sessions: [
        {
          kind: "lift" as const,
          liftType: s.liftType,
          movements: s.patterns.map((p) => ({
            pattern: p as Move["pattern"],
            sets: 3,
            repRange: "8-10",
          })),
        } as Lift,
      ],
    })),
  } as ProgramWeek;
}

const lifts = (w: ProgramWeek): Lift[] =>
  w.days.flatMap((d) => d.sessions).filter((s): s is Lift => s.kind === "lift");

/** Weekly sets for one pattern across the whole week. */
const weeklySets = (w: ProgramWeek, pattern: string): number =>
  lifts(w)
    .flatMap((s) => s.movements)
    .filter((m) => m.pattern === pattern)
    .reduce((n, m) => n + m.sets, 0);

describe("weekly working-set volume per movement pattern", () => {
  const threeDayWeek = () =>
    makeWeek("base", "increase", [
      { day: "mon", liftType: "lower", patterns: ["squat", "hip_hinge", "lunge"] },
      { day: "wed", liftType: "full", patterns: ["squat", "horizontal_press"] },
      { day: "fri", liftType: "upper", patterns: ["horizontal_press", "vertical_pull"] },
    ]);

  it("hits 8 weekly sets per pattern for an intermediate lifter", () => {
    const w = threeDayWeek();
    applyStrengthSchemes(w, undefined, "lbs", "intermediate");
    // trained once → all 8 in that session; trained twice → 4 + 4
    expect(weeklySets(w, "hip_hinge")).toBe(8);
    expect(weeklySets(w, "lunge")).toBe(8);
    expect(weeklySets(w, "squat")).toBe(8);
    expect(weeklySets(w, "horizontal_press")).toBe(8);
  });

  it("scales with lifting experience: beginner 6, advanced 10", () => {
    for (const [exp, target] of [
      ["beginner", 6],
      ["intermediate", 8],
      ["advanced", 10],
    ] as const) {
      const w = threeDayWeek();
      applyStrengthSchemes(w, undefined, "lbs", exp);
      for (const pattern of ["squat", "hip_hinge", "lunge", "horizontal_press", "vertical_pull"])
        expect(weeklySets(w, pattern), `${exp} ${pattern}`).toBe(target);
    }
  });

  it("uses LIFTING experience, not the running experience the reconciler takes", () => {
    const a = threeDayWeek();
    const b = threeDayWeek();
    applyStrengthSchemes(a, undefined, "lbs", "beginner");
    applyStrengthSchemes(b, undefined, "lbs", "advanced");
    expect(weeklySets(a, "squat")).toBeLessThan(weeklySets(b, "squat"));
  });

  it("splits a pattern's sets across the sessions that train it, heavier session first", () => {
    const w = makeWeek("base", "increase", [
      { day: "mon", liftType: "lower", patterns: ["squat"] },
      { day: "wed", liftType: "full", patterns: ["squat"] },
      { day: "fri", liftType: "upper", patterns: ["squat"] },
    ]);
    applyStrengthSchemes(w, undefined, "lbs", "intermediate"); // 8 over 3 sessions
    const sets = lifts(w).map((s) => s.movements[0]!.sets);
    expect(sets).toEqual([3, 3, 2]); // remainder to the earlier sessions
    expect(sets.reduce((a, b) => a + b, 0)).toBe(8);
  });

  it("never prescribes a zero-set movement, even if the week is very fragmented", () => {
    const w = makeWeek("base", "increase", [
      { day: "mon", liftType: "lower", patterns: ["squat"] },
      { day: "tue", liftType: "lower", patterns: ["squat"] },
      { day: "wed", liftType: "lower", patterns: ["squat"] },
      { day: "thu", liftType: "lower", patterns: ["squat"] },
      { day: "fri", liftType: "lower", patterns: ["squat"] },
      { day: "sat", liftType: "lower", patterns: ["squat"] },
      { day: "sun", liftType: "lower", patterns: ["squat"] },
    ]);
    applyStrengthSchemes(w, undefined, "lbs", "beginner"); // 6 sets, 7 sessions
    for (const s of lifts(w)) expect(s.movements[0]!.sets).toBeGreaterThanOrEqual(1);
  });

  it("scales down on deload and taper weeks", () => {
    const work = threeDayWeek();
    const deload = makeWeek("base", "deload", [
      { day: "mon", liftType: "lower", patterns: ["squat"] },
    ]);
    const taper = makeWeek("taper", "taper", [
      { day: "mon", liftType: "lower", patterns: ["squat"] },
    ]);
    applyStrengthSchemes(work, undefined, "lbs", "intermediate");
    applyStrengthSchemes(deload, undefined, "lbs", "intermediate");
    applyStrengthSchemes(taper, undefined, "lbs", "intermediate");
    expect(weeklySets(deload, "squat")).toBeLessThan(weeklySets(work, "squat"));
    expect(weeklySets(taper, "squat")).toBeLessThan(weeklySets(deload, "squat"));
  });
});

describe("the second full-body lift of a week runs light", () => {
  const twoFulls = () =>
    makeWeek("base", "increase", [
      { day: "tue", liftType: "full", patterns: ["squat", "horizontal_press"] },
      { day: "thu", liftType: "power", patterns: ["squat"] },
      { day: "sat", liftType: "full", patterns: ["squat", "horizontal_press"] },
    ]);

  it("makes the LATER full-body day 12–15 reps and leaves the first heavy", () => {
    const w = twoFulls();
    applyStrengthSchemes(w, undefined, "lbs", "intermediate");
    const [first, , second] = lifts(w);
    expect(first!.movements[0]!.repRange).not.toBe("12-15");
    expect(first!.movements[0]!.emphasis).toBe("max_strength");
    for (const m of second!.movements) {
      expect(m.repRange).toBe("12-15");
      expect(m.emphasis).toBe("endurance");
    }
    expect(second!.movements[0]!.intensityPct!).toBeLessThan(first!.movements[0]!.intensityPct!);
  });

  it("leaves a single full-body day heavy", () => {
    const w = makeWeek("base", "increase", [
      { day: "tue", liftType: "full", patterns: ["squat"] },
      { day: "fri", liftType: "upper", patterns: ["horizontal_press"] },
    ]);
    applyStrengthSchemes(w, undefined, "lbs", "intermediate");
    const full = lifts(w)[0]!;
    expect(full.movements[0]!.repRange).not.toBe("12-15");
    expect(full.movements[0]!.emphasis).toBe("max_strength");
  });

  it("the light day still counts toward the weekly set total", () => {
    const w = twoFulls();
    applyStrengthSchemes(w, undefined, "lbs", "intermediate");
    expect(weeklySets(w, "squat")).toBe(8); // 3 + 3 + 2 across the three sessions
    expect(weeklySets(w, "horizontal_press")).toBe(8); // 4 + 4 across the two fulls
  });
});

// --- spreading patterns across days + the per-session set ceiling -------------
//
// Levi's rule (2026-08-04, round 2). The weekly target alone produced sessions
// nobody could finish: a pattern trained on ONE lift day received its entire
// weekly target there, so an advanced upper day came out four movements at ten
// sets each — 40 working sets against the 45-minute working block a strength
// session is billed at. The fix is two-part and ordered: SPREAD each pattern
// onto a second lift day first (same weekly sets, twice the practice, each
// session recoverable), then CAP what one session may carry as a backstop.

describe("patterns are spread onto a second lift day", () => {
  it("gives a once-a-week pattern a second home, halving the load on each day", () => {
    const w = makeWeek("base", "increase", [
      { day: "tue", liftType: "upper", patterns: ["horizontal_press"] },
      { day: "thu", liftType: "full", patterns: ["squat"] },
    ]);
    applyStrengthSchemes(w, undefined, "lbs", "advanced");
    const [upper, full] = lifts(w);
    // horizontal_press started on the upper day only; the full day accepts it.
    expect(full!.movements.map((m) => m.pattern)).toContain("horizontal_press");
    expect(weeklySets(w, "horizontal_press")).toBe(10); // target still met exactly
    for (const s of lifts(w)) {
      const press = s.movements.find((m) => m.pattern === "horizontal_press");
      expect(press!.sets).toBe(5); // 5 + 5, not 10 + 0
    }
    expect(upper!.movements.map((m) => m.pattern)).not.toContain("squat"); // upper day
  });

  it("respects the lift split — a lower pattern never lands on an upper day", () => {
    const w = makeWeek("base", "increase", [
      { day: "tue", liftType: "upper", patterns: ["horizontal_press"] },
      { day: "thu", liftType: "upper", patterns: ["vertical_pull"] },
      { day: "sat", liftType: "lower", patterns: ["squat"] },
    ]);
    applyStrengthSchemes(w, undefined, "lbs", "intermediate");
    const [a, b, lower] = lifts(w);
    for (const upper of [a!, b!]) {
      for (const m of upper.movements) {
        expect(["squat", "hip_hinge", "lunge"]).not.toContain(m.pattern);
      }
    }
    // squat has nowhere legal to go (one lower day, no full/power day), so it
    // stays once a week and the cap keeps it honest.
    expect(lower!.movements.filter((m) => m.pattern === "squat")).toHaveLength(1);
    expect(weeklySets(w, "squat")).toBe(6); // capped: 2 short of the 8 target
  });

  it("leaves a pattern already trained twice alone", () => {
    const w = makeWeek("base", "increase", [
      { day: "tue", liftType: "full", patterns: ["squat"] },
      { day: "thu", liftType: "full", patterns: ["squat"] },
      { day: "sat", liftType: "full", patterns: ["horizontal_press"] },
    ]);
    applyStrengthSchemes(w, undefined, "lbs", "intermediate");
    const squatDays = lifts(w).filter((s) => s.movements.some((m) => m.pattern === "squat"));
    expect(squatDays).toHaveLength(2);
    expect(weeklySets(w, "squat")).toBe(8);
  });

  it("does nothing when the week has a single lift session", () => {
    const w = makeWeek("taper", "taper", [{ day: "tue", liftType: "full", patterns: ["squat"] }]);
    applyStrengthSchemes(w, undefined, "lbs", "advanced");
    expect(lifts(w)).toHaveLength(1);
    expect(lifts(w)[0]!.movements).toHaveLength(1);
  });
});

describe("no lift session exceeds the working-set ceiling", () => {
  const ALL = [
    "squat",
    "hip_hinge",
    "lunge",
    "horizontal_press",
    "vertical_press",
    "horizontal_pull",
    "vertical_pull",
  ];
  const sessionSets = (s: Lift) => s.movements.reduce((n, m) => n + m.sets, 0);

  it("holds a seven-pattern full-body day to 24 sets instead of 35", () => {
    const w = makeWeek("base", "increase", [
      { day: "tue", liftType: "full", patterns: ALL },
      { day: "thu", liftType: "full", patterns: ALL },
      { day: "sat", liftType: "full", patterns: ALL },
    ]);
    applyStrengthSchemes(w, undefined, "lbs", "advanced");
    for (const s of lifts(w)) expect(sessionSets(s)).toBeLessThanOrEqual(24);
  });

  it("moves the trimmed sets to a lighter day rather than dropping them", () => {
    // Advanced, three lift days, every pattern on every day: 7 x 10 = 70 weekly
    // sets against 3 x 24 = 72 slots, so the whole week still fits.
    const w = makeWeek("base", "increase", [
      { day: "tue", liftType: "full", patterns: ALL },
      { day: "thu", liftType: "full", patterns: ALL },
      { day: "sat", liftType: "full", patterns: ALL },
    ]);
    applyStrengthSchemes(w, undefined, "lbs", "advanced");
    const total = lifts(w).reduce((n, s) => n + sessionSets(s), 0);
    expect(total).toBe(70);
  });

  it("never drives a movement below one set", () => {
    const w = makeWeek("base", "increase", [
      { day: "tue", liftType: "full", patterns: ALL },
      { day: "thu", liftType: "full", patterns: ALL },
    ]);
    applyStrengthSchemes(w, undefined, "lbs", "advanced");
    for (const s of lifts(w)) {
      expect(sessionSets(s)).toBeLessThanOrEqual(24);
      for (const m of s.movements) expect(m.sets).toBeGreaterThanOrEqual(1);
    }
  });
});

describe("chest fly is a first-class movement pattern", () => {
  it("is required in a full week and runs high-rep, never as a heavy compound", () => {
    expect(REQUIRED_MOVEMENT_PATTERNS).toContain("chest_fly");
    const w = makeWeek("base", "increase", [
      { day: "tue", liftType: "full", patterns: ["chest_fly"] },
      { day: "thu", liftType: "upper", patterns: ["chest_fly"] },
    ]);
    applyStrengthSchemes(w, undefined, "lbs", "intermediate");
    for (const s of lifts(w)) {
      const fly = s.movements.find((m) => m.pattern === "chest_fly")!;
      // Isolation movement: endurance emphasis on every lift type, including the
      // full-body day that makes every other pattern max-strength.
      expect(fly.emphasis).toBe("endurance");
      expect(fly.exercise).toMatch(/Fly/);
    }
    expect(weeklySets(w, "chest_fly")).toBe(8);
  });

  it("counts toward the weekly set budget like any other pattern", () => {
    const ALL8 = [
      "squat",
      "hip_hinge",
      "lunge",
      "horizontal_press",
      "vertical_press",
      "horizontal_pull",
      "vertical_pull",
      "chest_fly",
    ];
    const w = makeWeek("base", "increase", [
      { day: "tue", liftType: "full", patterns: ALL8 },
      { day: "thu", liftType: "full", patterns: ALL8 },
      { day: "sat", liftType: "full", patterns: ALL8 },
    ]);
    applyStrengthSchemes(w, undefined, "lbs", "intermediate");
    for (const p of ALL8) expect(weeklySets(w, p)).toBeGreaterThan(0);
    for (const s of lifts(w)) {
      expect(s.movements.reduce((n, m) => n + m.sets, 0)).toBeLessThanOrEqual(24);
    }
  });
});
