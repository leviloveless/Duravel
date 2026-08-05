import { describe, it, expect } from "vitest";
import { capExperience, trainingCaps, DEFAULT_CAPS } from "./caps";
import type { ExperienceLevel } from "./types";

const exp = (
  runningExp: ExperienceLevel,
  hybridExp?: ExperienceLevel,
  liftingExp?: ExperienceLevel,
) => ({ runningExp, hybridExp, liftingExp });

describe("capExperience — which level the caps key off", () => {
  it("HYROX / DEKA use running experience, ignoring the others", () => {
    expect(capExperience("station_hybrid", exp("beginner", "advanced", "advanced"))).toBe(
      "beginner",
    );
    expect(capExperience("station_hybrid", exp("advanced", "beginner", "beginner"))).toBe(
      "advanced",
    );
  });

  it("triathlon uses the LOWEST of the three", () => {
    expect(capExperience("triathlon", exp("advanced", "intermediate", "beginner"))).toBe(
      "beginner",
    );
    expect(capExperience("triathlon", exp("advanced", "advanced", "intermediate"))).toBe(
      "intermediate",
    );
    expect(capExperience("triathlon", exp("advanced", "advanced", "advanced"))).toBe("advanced");
  });

  it("general fitness follows the triathlon rule — it is mixed-modality too", () => {
    expect(capExperience("general_fitness", exp("advanced", "beginner", "advanced"))).toBe(
      "beginner",
    );
  });

  it("falls back to running experience when the others are missing", () => {
    expect(capExperience("triathlon", exp("intermediate"))).toBe("intermediate");
  });
});

describe("trainingCaps", () => {
  it("maps each level to its session and day cap", () => {
    expect(trainingCaps("station_hybrid", exp("beginner"))).toEqual({
      session: 90,
      day: 180,
      cardioSession: 90,
    });
    expect(trainingCaps("station_hybrid", exp("intermediate"))).toEqual({
      session: 105,
      day: 210,
      cardioSession: 105,
    });
    expect(trainingCaps("station_hybrid", exp("advanced"))).toEqual({
      session: 120,
      day: 240,
      cardioSession: 120,
    });
  });

  it("the day cap is exactly two capped sessions in every tier", () => {
    for (const level of ["beginner", "intermediate", "advanced"] as const) {
      const c = trainingCaps("station_hybrid", exp(level));
      expect(c.day).toBe(c.session * 2);
    }
  });

  it("defaults to the most conservative tier", () => {
    expect(DEFAULT_CAPS).toEqual({ session: 90, day: 180, cardioSession: 90 });
  });

  it("the athlete's own profile: HYROX + beginner runner → 90 / 180 despite advanced lifting", () => {
    expect(trainingCaps("station_hybrid", exp("beginner", "intermediate", "advanced"))).toEqual({
      session: 90,
      day: 180,
      cardioSession: 90,
    });
  });
});

describe("caps reach the skeleton through the real generation path", () => {
  it("a HYROX beginner runner gets the 90/180 tier regardless of lifting experience", async () => {
    const { toEngineInput } = await import("./skeleton");
    const engineInput = toEngineInput({
      sport: "hyrox",
      programType: "fixed_duration",
      durationWeeks: 8,
      profile: {
        trainingDays: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"],
        runningExp: "beginner",
        hybridExp: "intermediate",
        liftingExp: "advanced",
        trainingClass: "non_highly_trained",
        weightUnit: "lbs",
      },
    } as never);
    expect(engineInput.caps).toEqual({ session: 90, day: 180, cardioSession: 90 });
  });

  /**
   * Updated 2026-08-05 with the legacy band back-fill.
   *
   * This case has no `weeklyHours`, so it used to reach the caps bandless and take
   * the beginner tier off the athlete's beginner LIFTING level — a 90-minute
   * session cap for an advanced triathlete training seven days a week. A 70.3
   * build needs three-hour rides, so that cap was the direct cause of legacy
   * triathlon weeks landing an average of 476 minutes under their prescription.
   *
   * The back-fill now infers h10_20 from the athlete's own stored volume (35 mi /
   * 630 min a week) and uses it to raise the CAPS ONLY. The "lowest of the three"
   * rule is unchanged — it still sets the 90-minute floor; the inferred band lifts
   * it. Nothing else about the program moves.
   */
  it("a triathlete takes the lowest of the three, then the inferred band lifts it", async () => {
    const { toEngineInput } = await import("./skeleton");
    const engineInput = toEngineInput({
      sport: "tri_70_3",
      programType: "fixed_duration",
      durationWeeks: 8,
      profile: {
        trainingDays: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"],
        runningExp: "advanced",
        hybridExp: "advanced",
        liftingExp: "beginner",
        trainingClass: "non_highly_trained",
        weightUnit: "lbs",
      },
    } as never);
    expect(engineInput.caps).toEqual({ session: 120, day: 300, cardioSession: 180 });
    // CAPS ONLY. The inferred band must not leak into `weeklyHours`, or the
    // athlete silently becomes a band athlete — new zone targets, new session
    // budget, a different program from the one they are running.
    expect(engineInput.weeklyHours).toBeUndefined();
    expect(engineInput.startMileage).toBeUndefined();
    expect(engineInput.startCardioMinutes).toBeUndefined();
  });

  it("a back-filled band is never bigger than the athlete's days can hold", async () => {
    const { toEngineInput } = await import("./skeleton");
    const threeDay = toEngineInput({
      sport: "tri_70_3",
      programType: "fixed_duration",
      durationWeeks: 8,
      profile: {
        trainingDays: ["mon", "wed", "fri"],
        runningExp: "advanced",
        hybridExp: "advanced",
        liftingExp: "beginner",
        trainingClass: "non_highly_trained",
        weightUnit: "lbs",
      },
    } as never);
    // Same volume as the 7-day athlete above, but three days cannot hold h10_20
    // (which requires 7), so the inference is capped and the caps stay at the
    // conservative tier instead of handing a 3-day athlete 3-hour sessions.
    expect(threeDay.caps).toEqual({ session: 90, day: 180, cardioSession: 90 });
  });
});

// --- weekly-hours bands raise the caps (Levi, 2026-08-04) --------------------
//
// The experience tiers (90/105/120) were written for athletes training under ~10
// hours a week, and they silently became the ceiling on WEEKLY volume: a week is
// at most `days x 2 sessions x sessionCap`, so 7 days x 2 x 120 = 1680 min = 28 h.
// An athlete who selected 30-40 hours could not be given the program they asked
// for. Two sessions a day stays absolute; the volume goes into LONGER Zone 1-2
// blocks, which is what a high-volume endurance week is actually made of.

describe("weekly-hours bands raise the session caps", () => {
  const adv = { runningExp: "advanced", hybridExp: "advanced", liftingExp: "advanced" } as const;

  it("raises the general session cap on the high-volume bands", () => {
    expect(trainingCaps("station_hybrid", adv, "h10_20").session).toBe(120);
    expect(trainingCaps("station_hybrid", adv, "h20_30").session).toBe(150);
    expect(trainingCaps("station_hybrid", adv, "h30_40").session).toBe(180);
  });

  it("gives Zone 1-2 cardio its own, higher ceiling", () => {
    expect(trainingCaps("station_hybrid", adv, "h5_10").cardioSession).toBe(150); // 2.5 h
    expect(trainingCaps("station_hybrid", adv, "h10_20").cardioSession).toBe(180); // 3 h
    expect(trainingCaps("station_hybrid", adv, "h20_30").cardioSession).toBe(240); // 4 h
    expect(trainingCaps("station_hybrid", adv, "h30_40").cardioSession).toBe(300); // 5 h
  });

  it("never lets the cardio ceiling fall below the general session cap", () => {
    for (const band of ["h0_5", "h5_10", "h10_20", "h20_30", "h30_40"] as const) {
      for (const level of ["beginner", "intermediate", "advanced"] as const) {
        const caps = trainingCaps("station_hybrid", { runningExp: level }, band);
        expect(caps.cardioSession).toBeGreaterThanOrEqual(caps.session);
        // A day is still exactly two sessions — the longest possible pair.
        expect(caps.day).toBe(caps.session + caps.cardioSession);
      }
    }
  });

  it("leaves the sub-5-hour band on the experience tier", () => {
    const caps = trainingCaps("station_hybrid", adv, "h0_5");
    expect(caps.session).toBe(120);
    expect(caps.cardioSession).toBe(120); // nothing to absorb at 5 h/week
  });

  it("a beginner on a high-volume band still gets the band's caps", () => {
    // The band is the athlete's stated time budget; it outranks the tier default.
    const caps = trainingCaps("station_hybrid", { runningExp: "beginner" }, "h30_40");
    expect(caps.session).toBe(180);
    expect(caps.cardioSession).toBe(300);
  });
});
