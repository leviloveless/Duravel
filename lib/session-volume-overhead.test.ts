import { describe, it, expect } from "vitest";
import {
  runOverheadMiles,
  sessionMiles,
  sessionTiming,
  sessionWorkMiles,
  weekMileage,
  weekWorkMileage,
  RUN_WARMUP_COOLDOWN,
} from "./session-volume";
import type { Session } from "./schemas";

const run = (over?: number): Session => ({
  kind: "run",
  runType: "interval",
  durationMin: 20,
  paceMinMile: "8:07",
  distanceMiles: 2.5,
  goalZone: 5,
  ...(over === undefined ? {} : { overheadMiles: over }),
});

describe("warmup / cooldown distance", () => {
  it("derives distance from the fixed overhead MINUTES at easy pace", () => {
    // interval = 7 + 10 = 17 min of RUNNING overhead; at 10 min/mi that is 1.7 mi.
    // The other 8 minutes of the warm-up are on a bike (`RUN_CROSS_WARMUP`) and
    // so cost the week no mileage at all — that is the whole point of moving them
    // (Levi, 2026-09-08).
    expect(RUN_WARMUP_COOLDOWN.interval).toEqual([7, 10]);
    expect(runOverheadMiles("interval", 10)).toBe(1.7);
    expect(runOverheadMiles("easy", 10)).toBe(1); // 5 + 5
  });

  it("equals the sum of the two figures the prescription prints", () => {
    // Each leg is rounded on its own, so the counted mileage and the workout text
    // never disagree by a rounding tenth.
    const paceMin = 10 + 33 / 60;
    const leg = (m: number) => Math.round((m / paceMin) * 10) / 10;
    const r1 = (n: number) => Math.round(n * 10) / 10; // both sides to 1dp
    expect(runOverheadMiles("interval", paceMin)).toBe(r1(leg(7) + leg(10)));
    expect(runOverheadMiles("threshold", paceMin)).toBe(r1(leg(6) + leg(8)));
  });

  it("is zero for a nonsensical pace rather than Infinity", () => {
    expect(runOverheadMiles("interval", 0)).toBe(0);
    expect(runOverheadMiles("interval", Number.NaN)).toBe(0);
  });
});

describe("work miles vs total miles", () => {
  it("work miles are the main set only", () => {
    expect(sessionWorkMiles(run(2.5))).toBe(2.5);
  });

  it("total miles add the warmup/cooldown distance — what the athlete runs", () => {
    expect(sessionMiles(run(2.5))).toBe(5);
  });

  it("a run with no overhead recorded still reports its work miles", () => {
    expect(sessionMiles(run())).toBe(2.5);
  });

  it("weekly totals keep the two apart", () => {
    const week = { days: [{ sessions: [run(2.5), run(2.5)] }] };
    expect(weekWorkMileage(week)).toBe(5);
    expect(weekMileage(week)).toBe(10);
  });

  it("the reported example: 2.5 mi of reps is really 4.1 mi on the feet", () => {
    // 4 x 1km work, plus a 7 min jog warm-up and a 10 min cooldown at 10:33/mi.
    // It was 4.8 miles when the whole 15-minute warm-up was run; the 8 minutes
    // that moved onto the bike are the difference, and they are exactly what a
    // small week could not afford to spend on getting ready.
    const over = runOverheadMiles("interval", 10 + 33 / 60);
    expect(over).toBe(1.6); // 0.7 warmup + 0.9 cooldown, exactly as printed
    expect(sessionMiles(run(over))).toBe(4.1);
  });
});

describe("between-rep recovery counts too", () => {
  const iv = (over?: number, recMin?: number, recMi?: number): Session => ({
    kind: "run",
    runType: "interval",
    durationMin: 20,
    paceMinMile: "8:07",
    distanceMiles: 2.5,
    goalZone: 5,
    ...(over === undefined ? {} : { overheadMiles: over }),
    ...(recMin === undefined ? {} : { recoveryMin: recMin }),
    ...(recMi === undefined ? {} : { recoveryMiles: recMi }),
  });

  it("recovery minutes land in the session total, not in the work target", () => {
    // The reported case: prescribed 45 min, really 60 once the jogging counts.
    const withRec = sessionTiming(iv(2.3, 15, 1.4));
    expect(withRec.work).toBe(35); // 20 reps + 15 recovery
    // 7 jog warmup + 35 + 10 cooldown + the 8-minute bike warm-up, which is time
    // on the athlete's clock even though it is not mileage.
    expect(withRec.total).toBe(60);
    // ...and the work MILEAGE target is untouched by any of it.
    expect(sessionWorkMiles(iv(2.3, 15, 1.4))).toBe(2.5);
  });

  it("recovery miles land in the total the athlete runs", () => {
    // 2.5 of reps + 2.3 warmup/cooldown + 1.4 recovery jogging.
    expect(sessionMiles(iv(2.3, 15, 1.4))).toBe(6.2);
  });

  it("a continuous run is unaffected", () => {
    const easyRun: Session = {
      kind: "run", runType: "easy", durationMin: 40, paceMinMile: "10:33",
      distanceMiles: 4, goalZone: 2, overheadMiles: 0.9,
    };
    expect(sessionTiming(easyRun).work).toBe(40);
    expect(sessionMiles(easyRun)).toBe(4.9);
  });

  it("older sessions with no recovery recorded still add up", () => {
    expect(sessionTiming(iv(2.3)).total).toBe(45);
    expect(sessionMiles(iv(2.3))).toBe(4.8);
  });
});
