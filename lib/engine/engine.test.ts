import { describe, it, expect } from "vitest";
import type { EngineInput, TrainingClassName, ProgramTypeName, ExperienceLevel } from "./types";
import { allocateMesocycles, expandPhases } from "./mesocycles";
import { sequenceMicrocycles, microcyclePattern } from "./microcycles";
import { applyTapers } from "./taper";
import { buildSkeleton } from "./skeleton";
import { INCREASE_MILEAGE_FACTOR, DELOAD_FACTOR, STARTING_MILEAGE } from "./volume";

// ---- helpers ----

function makeInput(overrides: Partial<EngineInput> = {}): EngineInput {
  return {
    trainingClass: "non_highly_trained",
    runningExp: "intermediate",
    hybridExp: "intermediate",
    liftingExp: "intermediate",
    programType: "goal_event",
    durationWeeks: 20,
    trainingDays: ["mon", "tue", "wed", "thu", "fri", "sat"],
    races: [{ weekNumber: 20, priority: "A" }],
    ...overrides,
  };
}

const allDurations = Array.from({ length: 21 }, (_, i) => i + 4); // 4..24
const classes: TrainingClassName[] = ["non_highly_trained", "highly_trained"];

// ============================================================
// Mesocycle allocation
// ============================================================

describe("mesocycle allocation — spec worked examples", () => {
  it("20-wk non-highly-trained A race = 9/6/3/2", () => {
    const a = allocateMesocycles(makeInput({ trainingClass: "non_highly_trained" }));
    expect(a).toEqual({ base: 9, build: 6, peak: 3, taper: 2 });
  });

  it("20-wk highly-trained A race = 8/6/4/2", () => {
    const a = allocateMesocycles(
      makeInput({ trainingClass: "highly_trained", durationWeeks: 20 }),
    );
    expect(a).toEqual({ base: 8, build: 6, peak: 4, taper: 2 });
  });
});

describe("mesocycle allocation — invariants across 4..24 wks, both classes", () => {
  for (const cls of classes) {
    for (const D of allDurations) {
      it(`${cls} ${D}wk A: sums to duration, base largest, taper protected`, () => {
        const a = allocateMesocycles(
          makeInput({ trainingClass: cls, durationWeeks: D, races: [{ weekNumber: D, priority: "A" }] }),
        );
        expect(a.base + a.build + a.peak + a.taper).toBe(D);
        // taper protected at 2 for an A race whenever there's room
        if (D >= 5) expect(a.taper).toBe(2);
        // base is the largest mesocycle once the program is non-trivially long
        if (D >= 6) {
          expect(a.base).toBeGreaterThanOrEqual(a.build);
          expect(a.base).toBeGreaterThanOrEqual(a.peak);
        }
        // every non-taper phase present for reasonably long programs
        if (D >= 7) {
          expect(a.base).toBeGreaterThan(0);
          expect(a.build).toBeGreaterThan(0);
          expect(a.peak).toBeGreaterThan(0);
        }
      });
    }
  }
});

describe("mesocycle allocation — taper by priority & general fitness", () => {
  it("B race → 1-week taper", () => {
    const a = allocateMesocycles(makeInput({ races: [{ weekNumber: 20, priority: "B" }] }));
    expect(a.taper).toBe(1);
    expect(a.base + a.build + a.peak + a.taper).toBe(20);
  });

  it("C race → 1-week taper", () => {
    const a = allocateMesocycles(makeInput({ races: [{ weekNumber: 20, priority: "C" }] }));
    expect(a.taper).toBe(1);
  });

  it("general fitness → no taper mesocycle", () => {
    const a = allocateMesocycles(
      makeInput({ programType: "general_fitness", races: [] }),
    );
    expect(a.taper).toBe(0);
    expect(a.base + a.build + a.peak).toBe(20);
    expect(a.base).toBeGreaterThanOrEqual(a.build);
  });
});

describe("expandPhases", () => {
  it("produces a phase per week in Base→Build→Peak→Taper order", () => {
    const alloc = { base: 9, build: 6, peak: 3, taper: 2 };
    const phases = expandPhases(alloc, 20);
    expect(phases).toHaveLength(20);
    expect(phases.slice(0, 9).every((p) => p === "base")).toBe(true);
    expect(phases.slice(9, 15).every((p) => p === "build")).toBe(true);
    expect(phases.slice(15, 18).every((p) => p === "peak")).toBe(true);
    expect(phases.slice(18, 20).every((p) => p === "taper")).toBe(true);
  });
});

// ============================================================
// Microcycle sequencing + volume math
// ============================================================

describe("microcycle patterns", () => {
  it("NHT = 3-week rebound/increase/deload", () => {
    expect(microcyclePattern("non_highly_trained")).toEqual(["rebound", "increase", "deload"]);
  });
  it("HT = 4-week rebound/increase/increase/deload", () => {
    expect(microcyclePattern("highly_trained")).toEqual(["rebound", "increase", "increase", "deload"]);
  });
});

describe("microcycle volume math (NHT)", () => {
  const start = 20;
  const seq = sequenceMicrocycles(9, "non_highly_trained", start, 200);

  it("week 1 rebound holds starting mileage", () => {
    expect(seq.labels[0]).toBe("rebound");
    expect(seq.mileage[0]).toBe(start);
  });

  it("week 2 increase is +7.5% mileage", () => {
    expect(seq.labels[1]).toBe("increase");
    expect(seq.mileage[1]).toBeCloseTo(start * INCREASE_MILEAGE_FACTOR, 1);
  });

  it("week 3 deload is -40% of the held (increase) level", () => {
    expect(seq.labels[2]).toBe("deload");
    expect(seq.mileage[2]).toBeCloseTo(start * INCREASE_MILEAGE_FACTOR * DELOAD_FACTOR, 1);
  });

  it("week 4 rebound holds the pre-deload peak (progressive overload)", () => {
    expect(seq.labels[3]).toBe("rebound");
    expect(seq.mileage[3]).toBeCloseTo(start * INCREASE_MILEAGE_FACTOR, 1);
    expect(seq.mileage[3]).toBeGreaterThan(seq.mileage[0]);
  });

  it("cardio rises +10% on increase weeks (diverging from mileage's +7.5%)", () => {
    expect(seq.cardioMinutes[1]).toBeGreaterThan(seq.cardioMinutes[0]);
    expect(seq.cardioMinutes[1]).toBe(Math.round(200 * 1.1));
  });
});

describe("microcycle volume math (HT — two increase weeks)", () => {
  const seq = sequenceMicrocycles(8, "highly_trained", 30, 300);
  it("compounds two increases before deloading", () => {
    expect(seq.labels.slice(0, 4)).toEqual(["rebound", "increase", "increase", "deload"]);
    expect(seq.mileage[2]).toBeCloseTo(30 * 1.075 * 1.075, 1);
    expect(seq.mileage[3]).toBeCloseTo(30 * 1.075 * 1.075 * DELOAD_FACTOR, 1);
  });
});

// ============================================================
// Taper insertion
// ============================================================

describe("A race taper (2 weeks, -30%/-30%)", () => {
  const D = 20;
  const flat = 40;
  const base = {
    mileage: new Array(D).fill(flat),
    cardioMinutes: new Array(D).fill(400),
    microLabels: new Array(D).fill("rebound") as any,
  };
  const res = applyTapers(base, [{ weekNumber: 20, priority: "A" }]);

  it("week 19 is -30% and labeled taper", () => {
    expect(res.mileage[18]).toBeCloseTo(flat * 0.7, 1);
    expect(res.microLabels[18]).toBe("taper");
  });
  it("week 20 is a further -30% (~51% cumulative) and labeled race", () => {
    expect(res.mileage[19]).toBeCloseTo(flat * 0.49, 1);
    expect(res.microLabels[19]).toBe("race");
    expect(res.raceWeeks.get(20)?.priority).toBe("A");
  });
});

describe("B race taper (1 week, -40%)", () => {
  const D = 12;
  const base = {
    mileage: new Array(D).fill(30),
    cardioMinutes: new Array(D).fill(300),
    microLabels: new Array(D).fill("rebound") as any,
  };
  const res = applyTapers(base, [{ weekNumber: 12, priority: "B" }]);
  it("reduces the race week by 40% and labels it race", () => {
    expect(res.mileage[11]).toBeCloseTo(30 * 0.6, 1);
    expect(res.microLabels[11]).toBe("race");
  });
});

describe("multi-race taper (mid-program B, resume, end A)", () => {
  const D = 20;
  const base = {
    mileage: new Array(D).fill(40),
    cardioMinutes: new Array(D).fill(400),
    microLabels: new Array(D).fill("increase") as any,
  };
  const res = applyTapers(base, [
    { weekNumber: 10, priority: "B" },
    { weekNumber: 20, priority: "A" },
  ]);
  it("inserts a mid-program taper at the B race", () => {
    expect(res.microLabels[9]).toBe("race");
    expect(res.mileage[9]).toBeCloseTo(40 * 0.6, 1);
    expect(res.raceWeeks.get(10)?.priority).toBe("B");
  });
  it("resumes normal progression after the B race", () => {
    expect(res.microLabels[10]).toBe("increase");
    expect(res.mileage[10]).toBe(40);
  });
  it("still applies the 2-week A taper at the end", () => {
    expect(res.microLabels[18]).toBe("taper");
    expect(res.microLabels[19]).toBe("race");
    expect(res.raceWeeks.get(20)?.priority).toBe("A");
  });
});

// ============================================================
// Full skeleton integration
// ============================================================

describe("buildSkeleton — structural integrity", () => {
  const durations = [4, 12, 20, 21, 24];
  const raceCounts = [0, 1, 2, 3];

  for (const cls of classes) {
    for (const D of durations) {
      for (const nRaces of raceCounts) {
        const races = buildRaces(nRaces, D);
        const programType: ProgramTypeName = nRaces === 0 ? "general_fitness" : "goal_event";

        it(`${cls} ${D}wk ${nRaces} race(s): well-formed`, () => {
          const skeleton = buildSkeleton(
            makeInput({ trainingClass: cls, durationWeeks: D, programType, races }),
          );

          // right number of weeks, numbered 1..D
          expect(skeleton.weeks).toHaveLength(D);
          skeleton.weeks.forEach((w, i) => expect(w.weekNumber).toBe(i + 1));

          // allocation sums to D
          const a = skeleton.allocation;
          expect(a.base + a.build + a.peak + a.taper).toBe(D);

          for (const w of skeleton.weeks) {
            // zone targets present, sum to 100
            const z = w.zoneTargets;
            expect(z.z1 + z.z2 + z.z3 + z.z4 + z.z5).toBe(100);

            // every training day mapped, non-negative targets
            expect(w.days.map((d) => d.day)).toEqual(makeInput().trainingDays);
            expect(w.targetMileage).toBeGreaterThanOrEqual(0);
            expect(w.targetCardioMinutes).toBeGreaterThanOrEqual(0);

            // non-race, non-taper weeks carry exactly 3 lift sessions
            if (w.microWeek !== "race" && w.microWeek !== "taper" && w.microWeek !== "deload") {
              const lifts = countKind(w, "lift");
              expect(lifts).toBe(3);
              // run count within the spec's 3–8 band
              const runs = countKind(w, "run");
              expect(runs).toBeGreaterThanOrEqual(3);
              expect(runs).toBeLessThanOrEqual(8);
            }
          }

          // race weeks carry a race session + raceDay marker
          for (const race of races) {
            const wk = skeleton.weeks.find((w) => w.raceDay);
            expect(wk).toBeTruthy();
          }
          const raceSlotWeeks = skeleton.weeks.filter((w) => countKind(w, "race") > 0);
          expect(raceSlotWeeks.length).toBe(races.length);
        });
      }
    }
  }
});

describe("buildSkeleton — spec anchor end-to-end (20wk NHT A race)", () => {
  const skeleton = buildSkeleton(makeInput());
  it("matches the 9/6/3/2 allocation", () => {
    expect(skeleton.allocation).toEqual({ base: 9, build: 6, peak: 3, taper: 2 });
  });
  it("final week is the A race", () => {
    const last = skeleton.weeks[skeleton.weeks.length - 1];
    expect(last.microWeek).toBe("race");
    expect(last.raceDay?.priority).toBe("A");
    expect(last.phase).toBe("taper");
  });
  it("peak-phase mileage sits below the build-phase high (volume drops in peak)", () => {
    const buildMax = Math.max(...skeleton.weeks.filter((w) => w.phase === "build").map((w) => w.targetMileage));
    const peakMax = Math.max(...skeleton.weeks.filter((w) => w.phase === "peak").map((w) => w.targetMileage));
    expect(peakMax).toBeLessThan(buildMax);
  });
  it("starting mileage matches the intermediate runner anchor", () => {
    expect(skeleton.weeks[0].targetMileage).toBe(STARTING_MILEAGE.intermediate);
  });
});

// ---- local helpers ----

function buildRaces(n: number, D: number): EngineInput["races"] {
  if (n === 0) return [];
  if (n === 1) return [{ weekNumber: D, priority: "A" }];
  if (n === 2) {
    return [
      { weekNumber: Math.max(1, Math.floor(D / 2)), priority: "B" },
      { weekNumber: D, priority: "A" },
    ];
  }
  return [
    { weekNumber: Math.max(1, Math.floor(D / 3)), priority: "C" },
    { weekNumber: Math.max(2, Math.floor((2 * D) / 3)), priority: "B" },
    { weekNumber: D, priority: "A" },
  ];
}

function countKind(week: { days: { sessions: { kind: string }[] }[] }, kind: string): number {
  return week.days.reduce((n, d) => n + d.sessions.filter((s) => s.kind === kind).length, 0);
}
