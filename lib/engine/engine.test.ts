import { describe, it, expect } from "vitest";
import type { EngineInput, TrainingClassName, ProgramTypeName, ExperienceLevel } from "./types";
import { allocateMesocycles, expandPhases } from "./mesocycles";
import { sequenceMicrocycles, microcyclePattern } from "./microcycles";
import { applyTapers } from "./taper";
import { buildSkeleton } from "./skeleton";
import { buildRunSlots, assignDays } from "./slots";
import { runDescription } from "./run-descriptions";
import type { PhaseName, RunType, TrainingDayName } from "./types";
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

  it("C race → no taper mesocycle (train through)", () => {
    const a = allocateMesocycles(makeInput({ races: [{ weekNumber: 20, priority: "C" }] }));
    expect(a.taper).toBe(0);
    expect(a.base + a.build + a.peak + a.taper).toBe(20);
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
    expect(seq.mileage[3]).toBeGreaterThan(seq.mileage[0]!);
  });

  it("cardio rises on increase weeks by the greater of +20 min or +10%", () => {
    expect(seq.cardioMinutes[1]).toBeGreaterThan(seq.cardioMinutes[0]!);
    // max(20, 10% of 200 = 20) = 20 → 220 (Tasks #6)
    expect(seq.cardioMinutes[1]).toBe(220);
  });
});

describe("microcycle volume math (HT — two increase weeks)", () => {
  const seq = sequenceMicrocycles(8, "highly_trained", 30, 300);
  it("compounds two increases (greater of +1.5 mi or +7.5%) before deloading", () => {
    expect(seq.labels.slice(0, 4)).toEqual(["rebound", "increase", "increase", "deload"]);
    // 30 → +max(1.5, 2.25)=2.25 → 32.25 → +max(1.5, 2.419)=2.419 → 34.669 (Tasks #5)
    expect(seq.mileage[2]).toBeCloseTo(34.7, 1);
    // deload = 60% of the held pre-deload peak (Tasks #4)
    expect(seq.mileage[3]).toBeCloseTo(34.66875 * DELOAD_FACTOR, 1);
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

  it("week 19 is ~80% of peak and labeled taper", () => {
    expect(res.mileage[18]).toBeCloseTo(flat * 0.8, 1);
    expect(res.microLabels[18]).toBe("taper");
  });
  it("week 20 (race week) is ~60% of peak (within 50–70%) and labeled race", () => {
    expect(res.mileage[19]).toBeCloseTo(flat * 0.6, 1);
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

describe("C race trains through (no taper, no volume cut)", () => {
  const D = 12;
  const base = {
    mileage: new Array(D).fill(40),
    cardioMinutes: new Array(D).fill(400),
    microLabels: new Array(D).fill("increase") as any,
  };
  const res = applyTapers(base, [{ weekNumber: 12, priority: "C" }]);
  it("leaves the race week's volume and label unchanged", () => {
    expect(res.mileage[11]).toBe(40);
    expect(res.microLabels[11]).toBe("increase");
    expect(res.raceWeeks.get(12)?.priority).toBe("C");
  });

  it("a C-race skeleton keeps a full training week (not a rest week)", () => {
    const skeleton = buildSkeleton(
      makeInput({ durationWeeks: 12, races: [{ weekNumber: 12, priority: "C" }] }),
    );
    const raceWeek = skeleton.weeks[11]!;
    const sessions = raceWeek.days.flatMap((d) => d.sessions);
    const restDays = raceWeek.days.filter((d) => d.sessions.every((s) => s.kind === "rest")).length;
    // trains through: has real training + the race, not 5 days of rest
    expect(sessions.some((s) => s.kind === "race")).toBe(true);
    expect(sessions.filter((s) => s.kind === "run" || s.kind === "lift" || s.kind === "hybrid").length).toBeGreaterThanOrEqual(3);
    expect(restDays).toBeLessThanOrEqual(2);
  });
});

describe("B race post-race recovery", () => {
  it("opens the week after a mid-program B race with rest + two easy days", () => {
    const D = 12;
    // B race mid-program so there is a following week to recover into.
    const skeleton = buildSkeleton(
      makeInput({ durationWeeks: D, races: [{ weekNumber: 6, priority: "B" }] }),
    );
    const recovery = skeleton.weeks[6]!; // week 7 = the week after the B race
    expect(recovery.days[0]!.sessions.every((s) => s.kind === "rest")).toBe(true);
    expect(recovery.days[1]!.sessions.some((s) => s.kind === "run")).toBe(true);
    expect(recovery.days[2]!.sessions.some((s) => s.kind === "run")).toBe(true);
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

          skeleton.weeks.forEach((w, i) => {
            // zone targets present, sum to 100
            const z = w.zoneTargets;
            expect(z.z1 + z.z2 + z.z3 + z.z4 + z.z5).toBe(100);

            // every training day mapped, non-negative targets
            expect(w.days.map((d) => d.day)).toEqual(makeInput().trainingDays);
            expect(w.targetMileage).toBeGreaterThanOrEqual(0);
            expect(w.targetCardioMinutes).toBeGreaterThanOrEqual(0);

            // full training weeks carry exactly 3 lift sessions; race weeks
            // (incl. a C race that trains through) replace a day with the race,
            // and the week after a B race opens with recovery days
            const afterBRace = i > 0 && skeleton.weeks[i - 1]!.raceDay?.priority === "B";
            if (w.microWeek !== "race" && w.microWeek !== "taper" && w.microWeek !== "deload" && !w.raceDay && !afterBRace) {
              const lifts = countKind(w, "lift");
              expect(lifts).toBe(3);
              // run count within the spec's 3–8 band
              const runs = countKind(w, "run");
              expect(runs).toBeGreaterThanOrEqual(3);
              expect(runs).toBeLessThanOrEqual(8);
            }
          });

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
    const last = skeleton.weeks[skeleton.weeks.length - 1]!;
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
    expect(skeleton.weeks[0]!.targetMileage).toBe(STARTING_MILEAGE.intermediate);
  });
});

// ============================================================
// Run-type placement by phase (Tasks #3, #4, #5)
// ============================================================

function runTypesOf(phase: PhaseName, count: number, pos?: { index: number; length: number }): RunType[] {
  return buildRunSlots(phase, count, pos).map((r) => r.runType);
}

/** All run types the engine programs across a full built skeleton, by phase. */
function runTypesByPhase(skeleton: ReturnType<typeof buildSkeleton>): Record<PhaseName, Set<RunType>> {
  const out: Record<PhaseName, Set<RunType>> = {
    base: new Set(),
    build: new Set(),
    peak: new Set(),
    taper: new Set(),
  };
  for (const w of skeleton.weeks) {
    for (const d of w.days) {
      for (const s of d.sessions) {
        if (s.kind === "run") out[w.phase].add(s.runType);
      }
    }
  }
  return out;
}

describe("run-type placement — buildRunSlots", () => {
  it("always anchors the week with exactly one long run", () => {
    for (const phase of ["base", "build", "peak", "taper"] as PhaseName[]) {
      const types = runTypesOf(phase, 5);
      expect(types.filter((t) => t === "long")).toHaveLength(1);
      expect(types[0]).toBe("long");
    }
  });

  it("fartlek only appears in base and build (Tasks #3)", () => {
    expect(runTypesOf("base", 6)).toContain("fartlek");
    expect(runTypesOf("build", 6, { index: 0, length: 6 })).toContain("fartlek");
    expect(runTypesOf("peak", 6)).not.toContain("fartlek");
    expect(runTypesOf("taper", 6)).not.toContain("fartlek");
  });

  it("progression only appears in peak and taper (Tasks #4)", () => {
    expect(runTypesOf("base", 7)).not.toContain("progression");
    expect(runTypesOf("build", 7, { index: 5, length: 6 })).not.toContain("progression");
    expect(runTypesOf("peak", 4)).toContain("progression");
    expect(runTypesOf("taper", 4)).toContain("progression");
  });

  it("interval enters the 2nd half of build, not the 1st (Tasks #5)", () => {
    expect(runTypesOf("build", 6, { index: 0, length: 6 })).not.toContain("interval");
    expect(runTypesOf("build", 6, { index: 1, length: 6 })).not.toContain("interval");
    expect(runTypesOf("build", 6, { index: 3, length: 6 })).toContain("interval");
    expect(runTypesOf("build", 4, { index: 5, length: 6 })).toContain("interval");
  });

  it("interval appears throughout peak and in higher-count taper weeks (Tasks #5)", () => {
    expect(runTypesOf("peak", 3)).toContain("interval");
    expect(runTypesOf("taper", 3)).toContain("interval"); // long + progression + interval
    expect(runTypesOf("base", 8)).not.toContain("interval");
  });
});

describe("run-type placement — full skeleton respects phase rules", () => {
  const skeleton = buildSkeleton(makeInput({ durationWeeks: 20, trainingClass: "highly_trained" }));
  const byPhase = runTypesByPhase(skeleton);

  it("no fartlek in peak or taper; no progression in base or build", () => {
    expect(byPhase.peak.has("fartlek")).toBe(false);
    expect(byPhase.taper.has("fartlek")).toBe(false);
    expect(byPhase.base.has("progression")).toBe(false);
    expect(byPhase.build.has("progression")).toBe(false);
  });

  it("no interval in base; interval present in peak", () => {
    expect(byPhase.base.has("interval")).toBe(false);
    expect(byPhase.peak.has("interval")).toBe(true);
  });
});

// ============================================================
// Workout-type day preferences (Tasks #1)
// ============================================================

describe("day preferences pin workout types to days (Tasks #1)", () => {
  const days: TrainingDayName[] = ["mon", "tue", "wed", "thu", "fri", "sat"];
  const dayWith = (assigned: ReturnType<typeof assignDays>, kind: string) =>
    assigned.filter((d) => d.sessions.some((s) => s.kind === kind)).map((d) => d.day);

  it("places the long run on the preferred day", () => {
    const assigned = assignDays(days, "build", "increase", "intermediate", "intermediate", undefined, {
      longRunDay: "sat",
    });
    const sat = assigned.find((d) => d.day === "sat")!;
    expect(sat.sessions.some((s) => s.kind === "run" && s.isLong)).toBe(true);
  });

  it("pins lift and hybrid sessions onto their preferred days when there is room", () => {
    const assigned = assignDays(days, "build", "increase", "intermediate", "intermediate", undefined, {
      longRunDay: "sat",
      liftDays: ["mon"],
      hybridDays: ["wed"],
    });
    expect(dayWith(assigned, "lift")).toContain("mon");
    expect(dayWith(assigned, "hybrid")).toContain("wed");
    // long run preference still honored alongside the others
    const sat = assigned.find((d) => d.day === "sat")!;
    expect(sat.sessions.some((s) => s.kind === "run" && s.isLong)).toBe(true);
  });

  it("never drops sessions when honoring preferences (count is preserved)", () => {
    const plain = assignDays(days, "peak", "increase", "advanced", "advanced");
    const pref = assignDays(days, "peak", "increase", "advanced", "advanced", undefined, {
      longRunDay: "sun",
      liftDays: ["mon", "tue"],
      hybridDays: ["thu"],
    });
    const count = (a: ReturnType<typeof assignDays>) =>
      a.reduce((n, d) => n + d.sessions.filter((s) => s.kind !== "rest").length, 0);
    expect(count(pref)).toBe(count(plain));
  });
});

// ============================================================
// Run descriptions (Tasks #2, #4)
// ============================================================

describe("run descriptions (Tasks #2)", () => {
  it("gives every run type a non-empty explanation", () => {
    const types: RunType[] = ["easy", "fartlek", "progression", "long", "tempo", "threshold", "interval", "hybrid_run"];
    for (const t of types) {
      expect(runDescription(t, "intermediate").length).toBeGreaterThan(20);
    }
  });

  it("progression description differs by running experience (Tasks #4)", () => {
    const beg = runDescription("progression", "beginner");
    const adv = runDescription("progression", "advanced");
    expect(beg).not.toBe(adv);
    expect(adv.toLowerCase()).toContain("race pace");
  });

  it("interval description references the 800m repeat protocol (Tasks #5)", () => {
    expect(runDescription("interval", "intermediate").toLowerCase()).toContain("800m");
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
