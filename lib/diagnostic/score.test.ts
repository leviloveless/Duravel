import { describe, it, expect } from "vitest";
import {
  completenessOf,
  diagnose,
  parseClock,
  questionEvidence,
  speedReserve,
  testEvidence,
} from "@/lib/diagnostic/score";
import { QUESTIONS, TESTS } from "@/lib/diagnostic/questions";
import { GOALS } from "@/lib/library/types";

const primary = (r: ReturnType<typeof diagnose>) => r.ranked[0]!.limiter;

describe("parseClock", () => {
  it("reads mm:ss", () => expect(parseClock("21:40")).toBe(1300));
  it("reads h:mm:ss", () => expect(parseClock("1:17:10")).toBe(4630));
  it("reads bare seconds", () => expect(parseClock("232")).toBe(232));
  it("rejects empty and rubbish", () => {
    expect(parseClock("")).toBeNull();
    expect(parseClock("abc")).toBeNull();
    expect(parseClock("1:2:3:4")).toBeNull();
  });
  it("rejects a duration typed as a clock", () => {
    // 4:90 is somebody meaning 4 min 90 s. Accepting it silently would put a
    // bad benchmark into the engine, which is the expensive kind of mistake.
    expect(parseClock("4:90")).toBeNull();
  });
});

describe("speedReserve", () => {
  it("is zero when the kilometre matches 5 k pace", () => {
    expect(speedReserve(1300, 260)).toBeCloseTo(0, 6);
  });
  it("rises as the kilometre gets faster than 5 k pace", () => {
    expect(speedReserve(1300, 234)).toBeCloseTo(0.1, 6);
  });
  it("does not divide by zero", () => {
    expect(speedReserve(0, 0)).toBe(0);
  });
});

describe("the objective rules", () => {
  it("calls a big speed reserve a threshold problem, not a speed one", () => {
    // 5 k at 4:20/km but a 3:35 kilometre: the gear is there, the engine is not.
    const ev = testEvidence({ fiveKSec: 1300, oneKSec: 215 }, {});
    expect(ev.some((e) => e.limiter === "threshold")).toBe(true);
    expect(ev.some((e) => e.limiter === "vo2")).toBe(false);
  });

  it("calls a tiny speed reserve a VO2 problem", () => {
    const ev = testEvidence({ fiveKSec: 1300, oneKSec: 253 }, {});
    expect(ev.some((e) => e.limiter === "vo2")).toBe(true);
  });

  it("says nothing about speed reserve from the 5 k alone", () => {
    // The whole point of a ratio is that one number cannot produce it.
    expect(testEvidence({ fiveKSec: 1300 }, {})).toHaveLength(0);
  });

  it("treats heavy heart-rate drift as an aerobic-base problem", () => {
    const ev = testEvidence({ decouplingPct: 11 }, {});
    expect(ev.find((e) => e.limiter === "aerobic")!.weight).toBe(1);
  });

  it("ignores decoupling inside the normal band", () => {
    expect(testEvidence({ decouplingPct: 3.5 }, {})).toHaveLength(0);
  });

  it("reads a big compromised-running gap as durability", () => {
    const ev = testEvidence({ freshKmSec: 255, compromisedKmSec: 310 }, {});
    expect(ev.find((e) => e.limiter === "durability")!.weight).toBe(1);
  });

  it("treats a small compromised gap as a strength, not a weakness", () => {
    const ev = testEvidence({ freshKmSec: 255, compromisedKmSec: 262 }, {});
    expect(ev.every((e) => e.limiter !== "durability")).toBe(true);
  });

  it("judges the squat as a RATIO to body weight, not as a number", () => {
    // Identical bar weight, different athletes: 120 at 70 kg is 1.7x and fine,
    // 120 at 110 kg is 1.1x and is the limiter. The absolute number says nothing.
    const light = testEvidence({ squat3Rm: 120 }, { bodyWeight: 70, sex: "male" });
    const heavy = testEvidence({ squat3Rm: 120 }, { bodyWeight: 110, sex: "male" });
    expect(light.some((e) => e.limiter === "max_strength")).toBe(false);
    expect(heavy.some((e) => e.limiter === "max_strength")).toBe(true);
  });

  it("says nothing about strength without a body weight to compare against", () => {
    expect(testEvidence({ squat3Rm: 60 }, {})).toHaveLength(0);
  });

  it("uses a lower strength floor for women", () => {
    const ctx = { bodyWeight: 65 };
    const male = testEvidence({ squat3Rm: 85 }, { ...ctx, sex: "male" });
    const female = testEvidence({ squat3Rm: 85 }, { ...ctx, sex: "female" });
    expect(male.some((e) => e.limiter === "max_strength")).toBe(true);
    expect(female.some((e) => e.limiter === "max_strength")).toBe(false);
  });

  it("reads a short broad jump as a power problem", () => {
    const ev = testEvidence({ broadJumpCm: 140 }, { heightIn: 72, sex: "male" });
    expect(ev.find((e) => e.limiter === "max_power")!.weight).toBe(1);
  });

  it("reads few unbroken wall balls as muscular endurance", () => {
    const ev = testEvidence({ wallBallsUnbroken: 12 }, {});
    expect(ev.find((e) => e.limiter === "hypertrophy")!.weight).toBeGreaterThan(0.9);
  });

  it("says nothing when the wall-ball number is strong", () => {
    expect(testEvidence({ wallBallsUnbroken: 60 }, {})).toHaveLength(0);
  });

  it("only judges the ski against running, never on its own", () => {
    expect(testEvidence({ ski500Sec: 200 }, {})).toHaveLength(0);
    const paired = testEvidence({ ski500Sec: 200, fiveKSec: 1300 }, {});
    expect(paired.some((e) => e.limiter === "hypertrophy")).toBe(true);
  });

  it("gives every piece of evidence a reason naming the actual number", () => {
    const ev = testEvidence(
      { fiveKSec: 1300, oneKSec: 215, decouplingPct: 11, wallBallsUnbroken: 12 },
      {},
    );
    expect(ev.length).toBeGreaterThan(0);
    for (const e of ev) {
      expect(e.reason.length).toBeGreaterThan(20);
      expect(/\d/.test(e.reason), e.reason).toBe(true);
    }
  });
});

describe("questionEvidence", () => {
  it("ignores unknown questions and unknown options", () => {
    expect(questionEvidence({ nope: "whatever" })).toHaveLength(0);
    expect(questionEvidence({ [QUESTIONS[0]!.id]: "not-an-option" })).toHaveLength(0);
  });

  it("keeps every questionnaire weight at or below 0.5", () => {
    // The cap is the design: no pile of opinions may outvote a stopwatch.
    for (const q of QUESTIONS) {
      for (const o of q.options) {
        for (const e of o.evidence) {
          expect(e.weight, `${q.id}/${o.id}`).toBeLessThanOrEqual(0.5);
        }
      }
    }
  });

  it("only ever names limiters that are real library goals", () => {
    for (const q of QUESTIONS) {
      for (const o of q.options) {
        for (const e of o.evidence) expect(GOALS).toContain(e.limiter);
      }
    }
  });
});

describe("diagnose", () => {
  it("returns every goal, ranked, even with no input", () => {
    const r = diagnose({}, {});
    expect(r.ranked).toHaveLength(GOALS.length);
    expect(r.confident).toBe(false);
    expect(r.ranked.every((x) => x.score === 0)).toBe(true);
  });

  it("normalises so the top limiter is 100", () => {
    const r = diagnose({}, { decouplingPct: 11 });
    expect(r.ranked[0]!.score).toBe(100);
  });

  it("lets a stopwatch outrank the questionnaire", () => {
    // Four answers all pointing at strength, against measurements saying the
    // aerobic base and compromised running are the real problem. The objective
    // signal must win — otherwise the diagnostic just confirms what the athlete
    // already believed, which is worse than not having one.
    const answers = {
      where_it_breaks: "stations_legs",
      lifting: "never",
      sled: "stuck",
      wall_balls: "grind",
    };
    const withoutTest = diagnose(answers, {});
    expect(primary(withoutTest)).toBe("max_strength");

    const withTest = diagnose(answers, {
      decouplingPct: 12,
      fiveKSec: 1300,
      oneKSec: 215,
      freshKmSec: 255,
      compromisedKmSec: 320,
    });
    expect(primary(withTest)).not.toBe("max_strength");
  });

  it("identifies a classic strong-but-unfit lifter", () => {
    const r = diagnose(
      { where_it_breaks: "every_run_slow", weekly_hours: "under5", easy_pace: "no_easy" },
      { decouplingPct: 12, squat3Rm: 180, wallBallsUnbroken: 55 },
      { bodyWeight: 90, sex: "male" },
    );
    expect(primary(r)).toBe("aerobic");
  });

  it("identifies a runner who cannot lift", () => {
    const r = diagnose(
      { where_it_breaks: "stations_legs", lifting: "never", sled: "stuck" },
      { decouplingPct: 3, squat3Rm: 70, wallBallsUnbroken: 14 },
      { bodyWeight: 80, sex: "male" },
    );
    expect(["max_strength", "hypertrophy"]).toContain(primary(r));
  });

  it("identifies a pure compromised-running problem", () => {
    const r = diagnose({}, { freshKmSec: 250, compromisedKmSec: 305 });
    expect(primary(r)).toBe("durability");
  });

  it("will not claim confidence off opinions alone", () => {
    const answers = Object.fromEntries(QUESTIONS.map((q) => [q.id, q.options[0]!.id]));
    expect(diagnose(answers, {}).confident).toBe(false);
  });

  it("is confident once a third of the battery is done", () => {
    const r = diagnose({}, { fiveKSec: 1300, oneKSec: 215, decouplingPct: 9 });
    expect(r.confident).toBe(true);
  });

  it("is confident on a full questionnaire plus a single test", () => {
    const answers = Object.fromEntries(QUESTIONS.map((q) => [q.id, q.options[1]!.id]));
    expect(diagnose(answers, { decouplingPct: 9 }).confident).toBe(true);
  });

  it("reports completeness over tests only", () => {
    expect(completenessOf({})).toBe(0);
    expect(completenessOf({ fiveKSec: 1 })).toBeCloseTo(1 / TESTS.length, 6);
  });

  it("gives a reason for every limiter it scores above zero", () => {
    const r = diagnose(
      { where_it_breaks: "later_runs" },
      { decouplingPct: 9, freshKmSec: 250, compromisedKmSec: 300 },
    );
    for (const row of r.ranked) {
      if (row.score > 0) expect(row.reasons.length, row.limiter).toBeGreaterThan(0);
    }
  });

  it("ranks deterministically when scores tie", () => {
    const a = diagnose({}, {});
    const b = diagnose({}, {});
    expect(a.ranked.map((r) => r.limiter)).toEqual(b.ranked.map((r) => r.limiter));
  });
});

describe("the battery itself", () => {
  it("gives every test a protocol and a stated purpose", () => {
    for (const t of TESTS) {
      expect(t.protocol.length, t.id).toBeGreaterThanOrEqual(3);
      expect(t.measures.length, t.id).toBeGreaterThan(30);
    }
  });

  it("gives every test a unique id that the results type knows about", () => {
    const ids = TESTS.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("gives every question a unique id and at least three options", () => {
    const ids = QUESTIONS.map((q) => q.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const q of QUESTIONS) expect(q.options.length, q.id).toBeGreaterThanOrEqual(3);
  });
});
