import { describe, it, expect } from "vitest";
import { reconcileWeekVolume } from "./reconcile";
import { weekMileage, weekWorkMileage, weekCardioMinutes, sessionTiming } from "@/lib/session-volume";
import { computePaces, formatPace } from "@/lib/engine/paces";
import type { ProgramDay, Session } from "@/lib/schemas";

type RunS = Extract<Session, { kind: "run" }>;
const P = computePaces("26:00")!; // 5K 26:00 → 5k pace ≈ 8:22/mi

const run = (rt: string, mi = 4, dur = 32): Session => ({
  kind: "run",
  runType: rt as RunS["runType"],
  distanceMiles: mi,
  durationMin: dur,
  paceMinMile: "8:00",
  goalZone: 2,
});
const hybrid = (): Session => ({
  kind: "hybrid",
  goalZone: 4,
  elements: [
    { exercise: "run", prescription: "1000m @ 8:00 min/mile (threshold)" },
    { exercise: "ski erg", prescription: "500m" },
    { exercise: "run", prescription: "1000m @ 8:00 min/mile (threshold)" },
    { exercise: "row erg", prescription: "500m" },
    { exercise: "run", prescription: "1000m @ 8:00 min/mile (threshold)" },
    { exercise: "assault bike", prescription: "40 cal" },
    { exercise: "run", prescription: "1000m @ 8:00 min/mile (threshold)" },
    { exercise: "wall balls", prescription: "30 reps" },
  ],
});
const lift = (): Session => ({ kind: "lift", liftType: "full", movements: [{ pattern: "squat", sets: 4, repRange: "5-7" }] });
const daysOf = (...ss: Session[][]): ProgramDay[] =>
  ss.map((x, i) => ({ day: (["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const)[i]!, sessions: x }));
const runsOf = (days: ProgramDay[]): RunS[] =>
  days.flatMap((d) => d.sessions).filter((s): s is RunS => s.kind === "run");
const maxRunTotal = (days: ProgramDay[]) => Math.max(0, ...runsOf(days).map((s) => sessionTiming(s).total));
const hasCardio = (days: ProgramDay[]) => days.some((d) => d.sessions.some((s) => s.kind === "cardio"));
const paceOf = (days: ProgramDay[], t: string) => runsOf(days).find((r) => r.runType === t)?.paceMinMile;

describe("pace formulas (Daniels VDOT)", () => {
  it("paces order correctly and sit at sensible offsets from 5K pace", () => {
    // fastest → slowest: interval < threshold < tempo < easy (= long)
    expect(P.interval).toBeLessThan(P.threshold);
    expect(P.threshold).toBeLessThan(P.tempo);
    expect(P.tempo).toBeLessThan(P.easy);
    expect(P.long).toBe(P.easy);
    const delta = (x: number) => x - P.fiveKSecPerMile;
    expect(delta(P.threshold)).toBeGreaterThan(10); // ~+25 s/mi over 5K pace
    expect(delta(P.threshold)).toBeLessThan(40);
    expect(delta(P.easy)).toBeGreaterThan(60); // easy clearly slower than 5K
    expect(delta(P.interval)).toBeLessThan(10); // ~5K pace or a touch faster
  });
});

describe("reconcile — fixed paces, mileage exact, cardio exact via non-running filler", () => {
  it("reported example (11.5 mi / 250 min): both exact, non-running cardio added, no run > 90", () => {
    const days = daysOf([run("easy")], [hybrid()], [lift()], [run("fartlek")], [run("long")], []);
    reconcileWeekVolume(days, 11.5, 250, P, "intermediate");
    // The target is WORK mileage; the total the athlete sees also carries the
    // warmup/cooldown distance, so it is strictly greater.
    expect(weekWorkMileage({ days })).toBe(11.5);
    expect(weekMileage({ days })).toBeGreaterThan(11.5);
    expect(weekCardioMinutes({ days })).toBe(250);
    expect(maxRunTotal(days)).toBeLessThanOrEqual(90);
    expect(hasCardio(days)).toBe(true);
  });

  it("run paces follow the formulas", () => {
    const days = daysOf([run("easy")], [run("long")], [run("fartlek")], [lift()]);
    reconcileWeekVolume(days, 20, 320, P, "intermediate");
    expect(paceOf(days, "easy")).toBe(formatPace(P.easy));
    expect(paceOf(days, "long")).toBe(formatPace(P.long));
    expect(paceOf(days, "fartlek")).toBe(`${formatPace(P.threshold)}–${formatPace(P.easy)}`);
  });

  it("rewrites hybrid run elements to threshold pace", () => {
    const days = daysOf([hybrid()], [run("easy")], [lift()]);
    reconcileWeekVolume(days, 15, 300, P, "intermediate");
    const hy = days[0]!.sessions[0]!;
    const el = hy.kind === "hybrid" ? hy.elements.find((e) => /run/i.test(e.exercise)) : undefined;
    expect(el?.prescription).toContain(`@ ${formatPace(P.threshold)}`);
  });

  it("tight deload consolidates easy runs into the long run; mileage stays exact", () => {
    const days = daysOf([run("easy")], [run("easy")], [run("long")], [lift()]);
    reconcileWeekVolume(days, 6, 150, P, "beginner");
    expect(weekWorkMileage({ days })).toBe(6);
    expect(weekMileage({ days })).toBeGreaterThan(6);
    expect(weekCardioMinutes({ days })).toBe(150);
    expect(runsOf(days).some((r) => r.runType === "long")).toBe(true);
  });

  it("A/B race weeks untouched (taper weeks keep their built sessions)", () => {
    for (const priority of ["A", "B"] as const) {
      const days = daysOf([run("easy")], [{ kind: "race", priority }]);
      const snap = JSON.stringify(days);
      reconcileWeekVolume(days, 11.5, 250, P, "intermediate");
      expect(JSON.stringify(days)).toBe(snap);
    }
  });

  it("C race week IS reconciled to target mileage (train-through), race day untouched", () => {
    // A full train-through week whose AI-filled distances overshoot; the C race
    // sits on the last day. Reconciliation must size the running to the engine
    // target exactly, without adding any session onto the race day.
    const days = daysOf(
      [run("long", 9)],
      [run("threshold", 4)],
      [run("interval", 6)],
      [lift()],
      [{ kind: "race", priority: "C" }],
    );
    reconcileWeekVolume(days, 15, 300, P, "intermediate", 7);
    expect(weekWorkMileage({ days })).toBe(15); // sized to target, not the ~19 mi AI sum
    expect(weekMileage({ days })).toBeGreaterThan(15);
    expect(weekCardioMinutes({ days })).toBe(300);
    expect(maxRunTotal(days)).toBeLessThanOrEqual(90);
    // Race day still holds ONLY the race — no easy run or cardio block stacked on it.
    const raceDay = days.find((d) => d.sessions.some((s) => s.kind === "race"))!;
    expect(raceDay.sessions).toEqual([{ kind: "race", priority: "C" }]);
  });

  it("sweep: mileage + cardio exact (generous targets), no run > 90", () => {
    const rt = ["easy", "long", "fartlek", "tempo", "threshold", "interval", "progression"];
    for (const n of [1, 2, 3, 4, 6]) {
      for (const wh of [false, true]) {
        for (const mi of [8, 11.5, 20, 35, 55]) {
          const min = Math.round(mi * 22); // generous → always leftover for non-running cardio
          const sessions: Session[][] = [];
          for (let i = 0; i < n; i++) sessions.push([run(rt[i % rt.length]!)]);
          if (wh) sessions.push([hybrid()]);
          sessions.push([lift()]);
          while (sessions.length < 7) sessions.push([]);
          const days = daysOf(...sessions);
          reconcileWeekVolume(days, mi, min, P, "intermediate");
          expect(weekWorkMileage({ days })).toBe(mi);
          expect(weekCardioMinutes({ days })).toBe(min);
          expect(maxRunTotal(days)).toBeLessThanOrEqual(90);
        }
      }
    }
  });
});

describe("cardio filler spreads across the week instead of bunching at the weekend", () => {
  // Reported setup: seven training days, lifts midweek, long run + hybrid on the
  // weekend. Every reconciler-added Zone 1-2 block used to land on Sat/Sun,
  // because the weekend preference outranked emptiness in the placement score —
  // so the lift days carried no aerobic work at all and the week ran three
  // consecutive days dry.
  const build = (): ProgramDay[] =>
    daysOf([], [lift()], [lift()], [run("interval", 3, 45)], [run("threshold", 3, 45)], [run("long", 6, 69)], [hybrid()]);
  const place = { preferDays: ["sat", "sun"] as const };
  const AER = ["run", "hybrid", "cardio"];
  const isAerobic = (d: ProgramDay) => d.sessions.some((s) => AER.includes(s.kind));
  const totalOf = (d: ProgramDay) => d.sessions.reduce((n, s) => n + sessionTiming(s).total, 0);
  const dayOf = (days: ProgramDay[], k: string) => days.find((d) => d.day === k)!;

  // Priority order when the surplus minutes cannot satisfy everything:
  //   1. use every training day, 2. keep the weekend biggest, 3. pair the lift days.
  it("uses an empty day before pairing any lift day", () => {
    const days = build();
    reconcileWeekVolume(days, 12.5, 300, P, "intermediate", 1, place);
    expect(dayOf(days, "mon").sessions.length).toBeGreaterThan(0);
  });

  it("pairs the lift days once every day is in use", () => {
    // Same week, but Monday already has a session — so nothing needs filling and
    // the surplus goes to pairing instead.
    const days = daysOf(
      [run("easy", 3, 30)], [lift()], [lift()],
      [run("interval", 3, 45)], [run("threshold", 3, 45)], [run("long", 6, 69)], [hybrid()],
    );
    // Cardio target raised: now that between-rep recovery counts, the runs alone
    // supply more of the week, so a 300-minute target leaves no surplus to place.
    reconcileWeekVolume(days, 12.5, 420, P, "intermediate", 1, place);
    const paired = days.filter((d) => d.sessions.some((s) => s.kind === "lift") && isAerobic(d)).length;
    expect(paired).toBeGreaterThan(0);
  });

  it("never puts two filler blocks on the same day", () => {
    const days = build();
    reconcileWeekVolume(days, 12.5, 300, P, "intermediate", 1, place);
    for (const d of days) expect(d.sessions.filter((s) => s.kind === "cardio").length, d.day).toBeLessThanOrEqual(1);
  });

  it("preserves every planned session while rebalancing", () => {
    // The rebalancer once spliced from the wrong day's session list, silently
    // deleting a lift and leaving the cardio total over target.
    const days = daysOf(
      [], [lift()], [lift()], [run("interval", 3, 45)],
      [run("threshold", 3, 45), lift()], [run("long", 6, 69)], [hybrid()],
    );
    reconcileWeekVolume(days, 12.5, 300, P, "intermediate", 1, place);
    expect(days.flatMap((d) => d.sessions).filter((s) => s.kind === "lift").length).toBe(3);
    expect(days.flatMap((d) => d.sessions).filter((s) => s.kind === "hybrid").length).toBe(1);
    expect(weekCardioMinutes({ days } as never)).toBe(300);
  });

  it("leaves no three-day stretch without aerobic work", () => {
    const days = build();
    reconcileWeekVolume(days, 12.5, 300, P, "intermediate", 1, place);
    let gap = 0;
    let worst = 0;
    for (const d of days) {
      gap = isAerobic(d) ? 0 : gap + 1;
      worst = Math.max(worst, gap);
    }
    expect(worst).toBeLessThan(3);
  });

  it("keeps a weekend day the biggest day of the week", () => {
    const days = build();
    reconcileWeekVolume(days, 12.5, 300, P, "intermediate", 1, place);
    const weekend = Math.max(totalOf(dayOf(days, "sat")), totalOf(dayOf(days, "sun")));
    const weekday = Math.max(...["mon", "tue", "wed", "thu", "fri"].map((k) => totalOf(dayOf(days, k))));
    expect(weekend).toBeGreaterThanOrEqual(weekday);
  });

  it("still hits the exact prescribed cardio total", () => {
    const days = build();
    reconcileWeekVolume(days, 12.5, 300, P, "intermediate", 1, place);
    expect(weekCardioMinutes({ days } as never)).toBe(300);
  });

  it("fills a day the engine merely left empty — that is not a rest day", () => {
    // The distinction that matters: `assignDays` appends a `rest` slot to ANY day
    // that ends up with no sessions, so reading rest days back off the skeleton
    // treated an incidentally-empty day as sacred and guaranteed it stayed empty
    // while other days doubled up. Only a real preference blocks filler.
    const days = build();
    reconcileWeekVolume(days, 12.5, 300, P, "intermediate", 1, place); // no avoidDays
    expect(dayOf(days, "mon").sessions.length).toBeGreaterThan(0);
  });

  it("keeps a preferred rest day clear of filler", () => {
    const days = build();
    reconcileWeekVolume(days, 12.5, 300, P, "intermediate", 1, { ...place, avoidDays: ["mon"] });
    expect(dayOf(days, "mon").sessions.length).toBe(0);
  });
});

describe("session cap scales with experience", () => {
  // 90 / 105 / 120 minutes by tier. A run and a Zone 1-2 block on the same day are
  // two separate sessions: each is capped on its own, and the day cap (exactly two
  // capped sessions) bounds their sum.
  const bigWeek = (): ProgramDay[] =>
    daysOf([], [], [], [], [], [run("long", 14, 120)], []);
  const longest = (days: ProgramDay[]) =>
    Math.max(...days.flatMap((d) => d.sessions).map((s) => sessionTiming(s).total));

  for (const [label, cap] of [["beginner", 90], ["intermediate", 105], ["advanced", 120]] as const) {
    it(`${label}: no session exceeds ${cap} min`, () => {
      const days = bigWeek();
      reconcileWeekVolume(days, 30, 400, P, "intermediate", 1, { preferDays: ["sat", "sun"] }, {
        session: cap,
        day: cap * 2,
      });
      expect(longest(days)).toBeLessThanOrEqual(cap);
    });
  }

  it("an advanced athlete gets a longer single session than a beginner", () => {
    const a = bigWeek();
    const b = bigWeek();
    const place = { preferDays: ["sat", "sun"] as const };
    reconcileWeekVolume(a, 30, 400, P, "intermediate", 1, place, { session: 90, day: 180 });
    reconcileWeekVolume(b, 30, 400, P, "intermediate", 1, place, { session: 120, day: 240 });
    expect(longest(b)).toBeGreaterThan(longest(a));
  });

  it("defaults to the conservative 90-min cap when none is supplied", () => {
    const days = bigWeek();
    reconcileWeekVolume(days, 30, 400, P, "intermediate", 1, { preferDays: ["sat", "sun"] });
    expect(longest(days)).toBeLessThanOrEqual(90);
  });

  it("a run and a cardio block on one day are capped separately, not summed", () => {
    const days = daysOf([], [], [], [], [], [run("long", 12, 100)], []);
    reconcileWeekVolume(days, 20, 300, P, "intermediate", 1, { preferDays: ["sat", "sun"] }, {
      session: 90,
      day: 180,
    });
    for (const d of days) {
      for (const s of d.sessions) expect(sessionTiming(s).total).toBeLessThanOrEqual(90);
      const total = d.sessions.reduce((n, s) => n + sessionTiming(s).total, 0);
      expect(total).toBeLessThanOrEqual(180);
    }
  });
});

describe("the weekend rebalancer respects the session cap", () => {
  // It grows a weekend filler block to keep Sat/Sun the biggest days. Without a cap
  // check that growth ran straight past the athlete's per-session limit — a 98-min
  // block against a 90-min beginner cap showed up in week 13 of a live program.
  const CAP = { session: 90, day: 180 };
  const shapes: ProgramDay[][] = [
    daysOf([], [lift()], [], [run("threshold", 3, 45), lift()], [], [run("long", 7, 80)], [hybrid()]),
    daysOf([], [lift()], [lift()], [run("interval", 3, 45)], [run("tempo", 4, 50), lift()], [run("long", 8, 85)], [hybrid()]),
    daysOf([run("easy", 3, 30)], [lift()], [], [hybrid()], [run("threshold", 4, 50), lift()], [run("long", 9, 88)], []),
  ];

  it("never emits a session longer than the cap, whatever the week shape", () => {
    for (const [i, days] of shapes.entries()) {
      reconcileWeekVolume(days, 20, 420, P, "intermediate", 1, { preferDays: ["sat", "sun"] }, CAP);
      for (const d of days) {
        for (const s of d.sessions) {
          expect(sessionTiming(s).total, `shape ${i} ${d.day} ${s.kind}`).toBeLessThanOrEqual(CAP.session);
        }
      }
    }
  });

  it("still hits the exact cardio total while respecting the cap", () => {
    const days = daysOf([], [lift()], [], [run("threshold", 3, 45), lift()], [], [run("long", 7, 80)], [hybrid()]);
    reconcileWeekVolume(days, 20, 420, P, "intermediate", 1, { preferDays: ["sat", "sun"] }, CAP);
    expect(weekCardioMinutes({ days } as never)).toBe(420);
  });
});

describe("filler is planned before it is written", () => {
  // The layout is decided up front and only then materialised, so no pass mutates
  // an already-prescribed session afterwards. These pin the guarantees that the old
  // place-then-repair design broke: it deleted a lift by splicing the wrong day, and
  // grew a block past the session cap.
  const CAP = { session: 90, day: 180 };
  const place = { preferDays: ["sat", "sun"] as const };

  it("when the weekend cannot be biggest, the caps and the total still hold", () => {
    // Both weekend days already carry two long sessions, so no filler can go there
    // and no weekday allocation can overtake them being beaten.
    const days = daysOf(
      [], [lift()], [], [lift()], [],
      [run("long", 8, 85), lift()],
      [hybrid(), lift()],
    );
    reconcileWeekVolume(days, 18, 380, P, "intermediate", 1, place, CAP);
    expect(weekCardioMinutes({ days } as never)).toBe(380);
    for (const d of days) {
      for (const x of d.sessions) expect(sessionTiming(x).total, `${d.day} ${x.kind}`).toBeLessThanOrEqual(CAP.session);
      expect(d.sessions.filter((x) => x.kind === "cardio").length, d.day).toBeLessThanOrEqual(1);
    }
  });

  it("never removes or alters a planned lift, run or hybrid", () => {
    const days = daysOf(
      [], [lift()], [lift()], [run("interval", 3, 45)],
      [run("threshold", 3, 45), lift()], [run("long", 6, 69)], [hybrid()],
    );
    const before = days.flatMap((d) => d.sessions).filter((s) => s.kind !== "cardio").length;
    reconcileWeekVolume(days, 12.5, 300, P, "intermediate", 1, place, CAP);
    const after = days.flatMap((d) => d.sessions).filter((s) => s.kind !== "cardio").length;
    expect(after).toBe(before);
    expect(days.flatMap((d) => d.sessions).filter((s) => s.kind === "lift").length).toBe(3);
    expect(days.flatMap((d) => d.sessions).filter((s) => s.kind === "hybrid").length).toBe(1);
  });

  it("is deterministic — same week in, same layout out", () => {
    const build = () => daysOf([], [lift()], [], [run("tempo", 4, 50)], [lift()], [run("long", 7, 80)], [hybrid()]);
    const a = build();
    const b = build();
    reconcileWeekVolume(a, 16, 340, P, "intermediate", 1, place, CAP);
    reconcileWeekVolume(b, 16, 340, P, "intermediate", 1, place, CAP);
    const layout = (d: ProgramDay[]) => d.map((x) => `${x.day}:${x.sessions.map((s) => `${s.kind}/${sessionTiming(s).total}`).join("+")}`).join(" ");
    expect(layout(a)).toBe(layout(b));
  });
});
