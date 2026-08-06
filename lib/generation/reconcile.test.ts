import { describe, it, expect } from "vitest";
import { reconcileWeekVolume, weekCardioCapacity } from "./reconcile";
import {
  weekMileage,
  weekWorkMileage,
  weekCardioMinutes,
  sessionTiming,
} from "@/lib/session-volume";
import { computePaces, formatPace } from "@/lib/engine/paces";
import type { ProgramDay, Session } from "@/lib/schemas";
import { DEFAULT_CAPS } from "@/lib/engine/caps";

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
const lift = (): Session => ({
  kind: "lift",
  liftType: "full",
  movements: [{ pattern: "squat", sets: 4, repRange: "5-7" }],
});
const daysOf = (...ss: Session[][]): ProgramDay[] =>
  ss.map((x, i) => ({
    day: (["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const)[i]!,
    sessions: x,
  }));
const runsOf = (days: ProgramDay[]): RunS[] =>
  days.flatMap((d) => d.sessions).filter((s): s is RunS => s.kind === "run");
const maxRunTotal = (days: ProgramDay[]) =>
  Math.max(0, ...runsOf(days).map((s) => sessionTiming(s).total));
const hasCardio = (days: ProgramDay[]) =>
  days.some((d) => d.sessions.some((s) => s.kind === "cardio"));
const paceOf = (days: ProgramDay[], t: string) =>
  runsOf(days).find((r) => r.runType === t)?.paceMinMile;

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
    // The target is now the TOTAL on-feet distance (warmup/cooldown + recovery
    // included), so the pure work mileage is strictly less.
    expect(weekMileage({ days })).toBe(11.5);
    expect(weekWorkMileage({ days })).toBeLessThan(11.5);
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
    expect(weekMileage({ days })).toBe(6);
    expect(weekWorkMileage({ days })).toBeLessThan(6);
    expect(weekCardioMinutes({ days })).toBe(150);
    expect(runsOf(days).some((r) => r.runType === "long")).toBe(true);
  });

  it("A/B race weeks keep their built sessions, but still get their overhead stamped", () => {
    // The taper protocol owns the sessions in an A/B race week, so nothing is
    // resized and no filler is added. The runs DO still need their warmup/cooldown
    // (and between-rep recovery) stamped: without it the final week reports work
    // miles only and silently undercounts itself against every other week.
    for (const priority of ["A", "B"] as const) {
      const days = daysOf([run("easy")], [{ kind: "race", priority }]);
      const before = runsOf(days).map((r) => ({
        distanceMiles: r.distanceMiles,
        durationMin: r.durationMin,
        paceMinMile: r.paceMinMile,
      }));
      const dayCount = days.length;
      const sessionKinds = days.map((d) => d.sessions.map((s) => s.kind).join(","));

      reconcileWeekVolume(days, 11.5, 250, P, "intermediate");

      // Prescription untouched — no resizing, no added cardio blocks.
      expect(days).toHaveLength(dayCount);
      expect(days.map((d) => d.sessions.map((s) => s.kind).join(","))).toEqual(sessionKinds);
      expect(
        runsOf(days).map((r) => ({
          distanceMiles: r.distanceMiles,
          durationMin: r.durationMin,
          paceMinMile: r.paceMinMile,
        })),
      ).toEqual(before);
      // ...but the on-feet overhead is now counted.
      for (const r of runsOf(days)) expect(r.overheadMiles).toBeGreaterThan(0);
      expect(weekMileage({ days })).toBeGreaterThan(weekWorkMileage({ days }));
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
    expect(weekMileage({ days })).toBe(15); // total sized to target, not the ~19 mi AI sum
    expect(weekWorkMileage({ days })).toBeLessThan(15);
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
          const capacity = weekCardioCapacity(days, DEFAULT_CAPS);
          reconcileWeekVolume(days, mi, min, P, "intermediate");
          // Total on-feet mileage is filled up to the target; it never undershoots a
          // feasible target and only overshoots when the week's run minimums already
          // exceed it (an unrealistic many-runs/tiny-target combo).
          expect(weekMileage({ days })).toBeGreaterThanOrEqual(mi - 0.05);
          // Cardio is hit EXACTLY whenever the week can hold it. These targets are
          // deliberately generous (22 min per prescribed mile), so the largest of
          // them exceed what two-sessions-a-day can physically fit — and a target
          // the week cannot hold is delivered short, never faked by inflating one
          // block past its cap (Levi, 2026-08-04).
          const delivered = weekCardioMinutes({ days });
          if (min <= capacity) {
            expect(delivered).toBe(min);
          } else {
            expect(delivered).toBeLessThanOrEqual(capacity);
            expect(delivered).toBeGreaterThan(0);
          }
          expect(maxRunTotal(days)).toBeLessThanOrEqual(90);
          // The invariant that actually matters: every session is legal.
          for (const d of days) {
            expect(d.sessions.length).toBeLessThanOrEqual(2);
            for (const s of d.sessions) {
              const lim = s.kind === "cardio" ? DEFAULT_CAPS.cardioSession : DEFAULT_CAPS.session;
              expect(sessionTiming(s).total).toBeLessThanOrEqual(lim);
            }
          }
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
    daysOf(
      [],
      [lift()],
      [lift()],
      [run("interval", 3, 45)],
      [run("threshold", 3, 45)],
      [run("long", 6, 69)],
      [hybrid()],
    );
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
      [run("easy", 3, 30)],
      [lift()],
      [lift()],
      [run("interval", 3, 45)],
      [run("threshold", 3, 45)],
      [run("long", 6, 69)],
      [hybrid()],
    );
    // Cardio target raised: now that between-rep recovery counts, the runs alone
    // supply more of the week, so a 300-minute target leaves no surplus to place.
    reconcileWeekVolume(days, 12.5, 420, P, "intermediate", 1, place);
    const paired = days.filter(
      (d) => d.sessions.some((s) => s.kind === "lift") && isAerobic(d),
    ).length;
    expect(paired).toBeGreaterThan(0);
  });

  it("never puts two filler blocks on the same day", () => {
    const days = build();
    reconcileWeekVolume(days, 12.5, 300, P, "intermediate", 1, place);
    for (const d of days)
      expect(d.sessions.filter((s) => s.kind === "cardio").length, d.day).toBeLessThanOrEqual(1);
  });

  it("preserves every planned session while rebalancing", () => {
    // The rebalancer once spliced from the wrong day's session list, silently
    // deleting a lift and leaving the cardio total over target.
    const days = daysOf(
      [],
      [lift()],
      [lift()],
      [run("interval", 3, 45)],
      [run("threshold", 3, 45), lift()],
      [run("long", 6, 69)],
      [hybrid()],
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
    const weekday = Math.max(
      ...["mon", "tue", "wed", "thu", "fri"].map((k) => totalOf(dayOf(days, k))),
    );
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
  const bigWeek = (): ProgramDay[] => daysOf([], [], [], [], [], [run("long", 14, 120)], []);
  const longest = (days: ProgramDay[]) =>
    Math.max(...days.flatMap((d) => d.sessions).map((s) => sessionTiming(s).total));

  for (const [label, cap] of [
    ["beginner", 90],
    ["intermediate", 105],
    ["advanced", 120],
  ] as const) {
    it(`${label}: no session exceeds ${cap} min`, () => {
      const days = bigWeek();
      reconcileWeekVolume(
        days,
        30,
        400,
        P,
        "intermediate",
        1,
        { preferDays: ["sat", "sun"] },
        { session: cap, day: cap * 2, cardioSession: cap },
      );
      expect(longest(days)).toBeLessThanOrEqual(cap);
    });
  }

  it("an advanced athlete gets a longer single session than a beginner", () => {
    const a = bigWeek();
    const b = bigWeek();
    const place = { preferDays: ["sat", "sun"] as const };
    reconcileWeekVolume(a, 30, 400, P, "intermediate", 1, place, { session: 90, day: 180, cardioSession: 90 });
    reconcileWeekVolume(b, 30, 400, P, "intermediate", 1, place, { session: 120, day: 240, cardioSession: 120 });
    expect(longest(b)).toBeGreaterThan(longest(a));
  });

  it("defaults to the conservative 90-min cap when none is supplied", () => {
    const days = bigWeek();
    reconcileWeekVolume(days, 30, 400, P, "intermediate", 1, { preferDays: ["sat", "sun"] });
    expect(longest(days)).toBeLessThanOrEqual(90);
  });

  it("a run and a cardio block on one day are capped separately, not summed", () => {
    const days = daysOf([], [], [], [], [], [run("long", 12, 100)], []);
    reconcileWeekVolume(
      days,
      20,
      300,
      P,
      "intermediate",
      1,
      { preferDays: ["sat", "sun"] },
      { session: 90, day: 180, cardioSession: 90 },
    );
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
  const CAP = { session: 90, day: 180, cardioSession: 90 };
  const shapes: ProgramDay[][] = [
    daysOf(
      [],
      [lift()],
      [],
      [run("threshold", 3, 45), lift()],
      [],
      [run("long", 7, 80)],
      [hybrid()],
    ),
    daysOf(
      [],
      [lift()],
      [lift()],
      [run("interval", 3, 45)],
      [run("tempo", 4, 50), lift()],
      [run("long", 8, 85)],
      [hybrid()],
    ),
    daysOf(
      [run("easy", 3, 30)],
      [lift()],
      [],
      [hybrid()],
      [run("threshold", 4, 50), lift()],
      [run("long", 9, 88)],
      [],
    ),
  ];

  it("never emits a session longer than the cap, whatever the week shape", () => {
    for (const [i, days] of shapes.entries()) {
      reconcileWeekVolume(days, 20, 420, P, "intermediate", 1, { preferDays: ["sat", "sun"] }, CAP);
      for (const d of days) {
        for (const s of d.sessions) {
          expect(sessionTiming(s).total, `shape ${i} ${d.day} ${s.kind}`).toBeLessThanOrEqual(
            CAP.session,
          );
        }
      }
    }
  });

  it("still hits the exact cardio total while respecting the cap", () => {
    const days = daysOf(
      [],
      [lift()],
      [],
      [run("threshold", 3, 45), lift()],
      [],
      [run("long", 7, 80)],
      [hybrid()],
    );
    reconcileWeekVolume(days, 20, 420, P, "intermediate", 1, { preferDays: ["sat", "sun"] }, CAP);
    expect(weekCardioMinutes({ days } as never)).toBe(420);
  });
});

describe("Zone 1–2 blocks respect the 45-minute floor", () => {
  // Levi's rule: a Zone 1–2 cardio session is worth doing at 45 minutes or more.
  // Below that it only exists as a bolt-on to ANOTHER cardio session on the same day
  // (a run or hybrid — a brick). A lift is not cardio, so two 30-minute spins on
  // back-to-back lift days are wrong: 90 surplus minutes are 45 + 45, not 30 + 30 + 30.
  const place = { preferDays: ["sat", "sun"] as const };
  const CAP = { session: 90, day: 180, cardioSession: 90 };
  const blocks = (days: ProgramDay[]) =>
    days.flatMap((d) =>
      d.sessions
        .filter((s) => s.kind === "cardio")
        .map((s) => ({
          day: d.day,
          minutes: sessionTiming(s).total,
          pairedWithCardio: d.sessions.some((x) => x.kind === "run" || x.kind === "hybrid"),
        })),
    );

  it("never emits a short standalone block — only ever beside a run or hybrid", () => {
    // Wide sweep of week shapes and cardio targets: the surplus varies from a few
    // minutes to hours, which is where sub-45 blocks used to appear.
    const shapes: (() => ProgramDay[])[] = [
      () => daysOf([], [lift()], [lift()], [run("interval", 3, 45)], [], [run("long", 6, 69)], []),
      () =>
        daysOf(
          [],
          [lift()],
          [lift()],
          [run("interval", 3, 45)],
          [run("threshold", 3, 45)],
          [run("long", 6, 69)],
          [hybrid()],
        ),
      () =>
        daysOf([run("easy", 3, 30)], [lift()], [], [hybrid()], [lift()], [run("long", 8, 85)], []),
      () => daysOf([], [], [], [], [], [run("long", 10, 90)], []),
      () =>
        daysOf([lift()], [lift()], [lift()], [run("tempo", 4, 50)], [], [run("long", 7, 80)], []),
    ];
    for (const [i, build] of shapes.entries()) {
      for (const target of [150, 200, 240, 280, 300, 330, 360, 400, 450, 500]) {
        const days = build();
        reconcileWeekVolume(days, 14, target, P, "intermediate", 1, place, CAP);
        const bs = blocks(days);
        for (const b of bs) {
          const why = `shape ${i}/${target} ${b.day}`;
          if (!b.pairedWithCardio) {
            // Standalone: always a real session.
            expect(b.minutes, why).toBeGreaterThanOrEqual(45);
          } else if (bs.length > 1) {
            // Beside a run/hybrid: a brick tail, floor 30.
            expect(b.minutes, why).toBeGreaterThanOrEqual(30);
          }
          // Whatever the case, a block is never a token: a leftover under 15 minutes
          // is dropped rather than put on the calendar.
          expect(b.minutes, why).toBeGreaterThanOrEqual(15);
        }
        // Exact whenever the target is reachable — with two deliberate exceptions: a
        // week whose runs alone already exceed a very low target simply overshoots
        // (nothing is deleted to fit), and a sub-15-minute leftover is dropped instead
        // of shipped as a token block.
        const runMinutes = days
          .flatMap((d) => d.sessions)
          .filter((s) => s.kind === "run" || s.kind === "hybrid")
          .reduce((n, s) => n + sessionTiming(s).total, 0);
        if (runMinutes <= target) {
          const shortfall = target - weekCardioMinutes({ days } as never);
          expect(shortfall, `shape ${i}/${target}`).toBeGreaterThanOrEqual(0);
          expect(shortfall, `shape ${i}/${target}`).toBeLessThan(15);
          if (target - runMinutes >= 15)
            expect(weekCardioMinutes({ days } as never), `shape ${i}/${target}`).toBe(target);
        }
      }
    }
  });

  it("splits 90 surplus minutes into two 45s rather than one 90 or three 30s", () => {
    // Two dry lift days and an empty day available: the old floor put 30 on each of
    // the three. Frequency still beats duration — it just can't go below 45.
    const days = daysOf(
      [],
      [lift()],
      [lift()],
      [run("interval", 3, 45)],
      [run("threshold", 3, 45)],
      [run("long", 6, 69)],
      [hybrid()],
    );
    reconcileWeekVolume(days, 12.5, 300, P, "intermediate", 1, place, CAP);
    const b = blocks(days);
    expect(b.length).toBeGreaterThan(1); // not one giant block
    for (const x of b) if (!x.pairedWithCardio) expect(x.minutes).toBeGreaterThanOrEqual(45);
  });

  it("leaves a long block paired with the long run alone (brick) even under 45", () => {
    // Saturday's block sits next to the long run, so it is a legal brick tail at any
    // length — and is usually well over the floor anyway.
    const days = daysOf([], [lift()], [], [run("tempo", 4, 50)], [], [run("long", 7, 80)], []);
    reconcileWeekVolume(days, 16, 330, P, "intermediate", 1, place, CAP);
    expect(weekCardioMinutes({ days } as never)).toBe(330);
    const sat = days.find((d) => d.day === "sat")!;
    expect(sat.sessions.some((s) => s.kind === "run")).toBe(true);
  });
});

describe("filler is planned before it is written", () => {
  // The layout is decided up front and only then materialised, so no pass mutates
  // an already-prescribed session afterwards. These pin the guarantees that the old
  // place-then-repair design broke: it deleted a lift by splicing the wrong day, and
  // grew a block past the session cap.
  const CAP = { session: 90, day: 180, cardioSession: 90 };
  const place = { preferDays: ["sat", "sun"] as const };

  it("when the weekend cannot be biggest, the caps and the total still hold", () => {
    // Both weekend days already carry two long sessions, so no filler can go there
    // and no weekday allocation can overtake them being beaten.
    const days = daysOf(
      [],
      [lift()],
      [],
      [lift()],
      [],
      [run("long", 8, 85), lift()],
      [hybrid(), lift()],
    );
    reconcileWeekVolume(days, 18, 380, P, "intermediate", 1, place, CAP);
    expect(weekCardioMinutes({ days } as never)).toBe(380);
    for (const d of days) {
      for (const x of d.sessions)
        expect(sessionTiming(x).total, `${d.day} ${x.kind}`).toBeLessThanOrEqual(CAP.session);
      expect(d.sessions.filter((x) => x.kind === "cardio").length, d.day).toBeLessThanOrEqual(1);
    }
  });

  it("never removes or alters a planned lift, run or hybrid", () => {
    const days = daysOf(
      [],
      [lift()],
      [lift()],
      [run("interval", 3, 45)],
      [run("threshold", 3, 45), lift()],
      [run("long", 6, 69)],
      [hybrid()],
    );
    const before = days.flatMap((d) => d.sessions).filter((s) => s.kind !== "cardio").length;
    // 14, not 12.5. This week holds a 6-mile long run plus a hybrid that is now
    // ~6.4 miles on its feet (station runs + the warm-up/cooldown jog counted
    // since 2026-08-06), so at 12.5 there is genuinely no room left for the
    // interval and threshold runs and `sizeRuns` CORRECTLY consolidates one
    // away. That is the consolidation path, which has its own coverage — this
    // test is about leaving a week alone when there IS room for it, so the
    // target is set where that is true.
    reconcileWeekVolume(days, 14, 300, P, "intermediate", 1, place, CAP);
    const after = days.flatMap((d) => d.sessions).filter((s) => s.kind !== "cardio").length;
    expect(after).toBe(before);
    expect(days.flatMap((d) => d.sessions).filter((s) => s.kind === "lift").length).toBe(3);
    expect(days.flatMap((d) => d.sessions).filter((s) => s.kind === "hybrid").length).toBe(1);
  });

  it("is deterministic — same week in, same layout out", () => {
    const build = () =>
      daysOf([], [lift()], [], [run("tempo", 4, 50)], [lift()], [run("long", 7, 80)], [hybrid()]);
    const a = build();
    const b = build();
    reconcileWeekVolume(a, 16, 340, P, "intermediate", 1, place, CAP);
    reconcileWeekVolume(b, 16, 340, P, "intermediate", 1, place, CAP);
    const layout = (d: ProgramDay[]) =>
      d
        .map(
          (x) =>
            `${x.day}:${x.sessions.map((s) => `${s.kind}/${sessionTiming(s).total}`).join("+")}`,
        )
        .join(" ");
    expect(layout(a)).toBe(layout(b));
  });
});
