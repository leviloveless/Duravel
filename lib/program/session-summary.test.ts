/**
 * Per-workout share artifacts — the card seed and the Strava description
 * (Levi, 2026-08-04).
 */
import { describe, it, expect } from "vitest";
import type { Session, WorkoutLog } from "@/lib/schemas";
import { sessionSummary } from "./session-summary";
import { stripBrandTag, BRAND_MARKER, buildBrandedDescription } from "@/lib/wearables/branding";

const run: Session = {
  kind: "run",
  runType: "threshold",
  durationMin: 25,
  paceMinMile: "7:31",
  distanceMiles: 3,
  overheadMiles: 2.2,
  recoveryMiles: 0.8,
  goalZone: 4,
  description:
    "Warm up: 12 min easy (~1.3 mi) @ 9:02/mi\nWork: 3 x 1 mile at 7:31/mi (4:40/km)\nCooldown: 8 min easy (~0.9 mi) @ 9:02/mi",
};

const lift: Session = {
  kind: "lift",
  liftType: "full",
  movements: [
    {
      pattern: "squat",
      sets: 4,
      repRange: "5-6",
      exercise: "Back Squat",
      suggestedWeight: "285 lbs",
    },
    { pattern: "chest_fly", sets: 3, repRange: "12-15", exercise: "Dumbbell Chest Fly" },
  ],
};

const CTX = { athlete: "Levi", programName: "Fall prep", weekNumber: 6 };

describe("sessionSummary", () => {
  it("works on a session that was never logged — the whole point", () => {
    // The old path (`sessionCardFromLog`) REQUIRED a completed log, so a planned
    // workout had no card and no description at all.
    const s = sessionSummary(run, CTX);
    expect(s.title).toBe("Threshold run — 6 mi"); // 3 work + 2.2 overhead + 0.8 recovery
    expect(s.cardData.sessType).toBe("Threshold run");
    expect(s.cardData.athlete).toBe("Levi");
    expect(s.cardData.sessVol).toBe("6 mi");
    expect(s.stravaDescription).toContain("3 x 1 mile");
    expect(s.stravaDescription).toContain("Planned: 6 mi");
    expect(s.stravaDescription).not.toContain("Actual:");
  });

  it("swaps to actuals once the workout is logged", () => {
    const log = {
      status: "completed",
      rpe: 7,
      note: "Legs felt great.",
      actuals: { distanceMiles: 6.2, durationMin: 54, avgHr: 161 },
    } as unknown as WorkoutLog;
    const s = sessionSummary(run, { ...CTX, log });
    expect(s.title).toBe("Threshold run — 6.2 mi");
    expect(s.cardData.sessVol).toBe("6.2 mi");
    expect(s.cardData.sessTime).toBe("54 min");
    expect(s.cardData.sessHr).toBe("Avg 161 bpm");
    expect(s.cardData.coachNote).toBe("Legs felt great.");
    // The plan is still shown alongside what actually happened.
    expect(s.stravaDescription).toContain("Planned: 6 mi · 45 min · Zone 4"); // 12 wu + 25 work + 8 cd
    expect(s.stravaDescription).toContain("Actual: 6.2 mi · 54 min · avg 161 bpm · RPE 7");
  });

  it("writes the lift prescription, sets x reps and load included", () => {
    const s = sessionSummary(lift, CTX);
    expect(s.title).toBe("Full body lift");
    expect(s.stravaDescription).toContain("Back Squat — 4 x 5–6 — 285 lbs");
    expect(s.stravaDescription).toContain("Dumbbell Chest Fly — 3 x 12–15");
    expect(s.cardData.sessMain).toContain("Back Squat");
  });

  it("ends with the Duravel tag and starts with the marker so a re-write can't stack", () => {
    // The block OPENS with BRAND_MARKER on purpose: stripBrandTag cuts from the
    // first marker to the end, so opening with it makes the whole block —
    // description included — replaceable. Without that, re-writing an activity
    // would strip only the footer and append the body again.
    const s = sessionSummary(run, CTX);
    expect(s.stravaDescription.startsWith(BRAND_MARKER)).toBe(true);
    expect(s.stravaDescription.trimEnd().endsWith("duravel.app")).toBe(true);
    expect(s.stravaDescription).toContain("Week 6");
    expect(s.stravaDescription).toContain("Fall prep");

    const athletesOwnText = "Beautiful morning out there.";
    const first = buildBrandedDescription(athletesOwnText, {}, s.stravaDescription);
    const second = buildBrandedDescription(first, {}, s.stravaDescription);
    expect(second).toBe(first); // idempotent
    expect(stripBrandTag(first)).toBe(athletesOwnText); // athlete's text survives
    expect(first.match(/Back Squat|3 x 1 mile/g)?.length).toBe(1); // body written once
  });

  it("falls back to the one-line tag when no body is supplied (legacy callers)", () => {
    const tagOnly = buildBrandedDescription("hi", { sessionLabel: "Easy run", weekNumber: 2 });
    expect(tagOnly).toContain("— Duravel · Easy run · Week 2");
    expect(tagOnly.startsWith("hi")).toBe(true);
  });

  it("handles every session kind without throwing", () => {
    const kinds: Session[] = [
      run,
      lift,
      { kind: "cardio", durationMin: 45, goalZone: 2, modality: "bike" },
      { kind: "hybrid", goalZone: 4, elements: [{ exercise: "Row erg", prescription: "500m" }] },
      { kind: "swim", durationMin: 40, goalZone: 2, sessionType: "endurance" },
      { kind: "bike", durationMin: 90, goalZone: 2, sessionType: "endurance", isLong: true },
      {
        kind: "brick",
        goalZone: 2,
        segments: [
          { discipline: "bike", durationMin: 120, goalZone: 2 },
          { discipline: "run", durationMin: 20, goalZone: 2 },
        ],
      },
    ] as unknown as Session[];
    for (const s of kinds) {
      const out = sessionSummary(s, CTX);
      expect(out.title.length).toBeGreaterThan(0);
      expect(out.stravaDescription.startsWith(BRAND_MARKER)).toBe(true);
      expect(out.stravaDescription).toContain("duravel.app");
      expect(out.cardData.type).toBe("session");
    }
  });

  it("is deterministic — same session in, same text out", () => {
    expect(sessionSummary(run, CTX).stravaDescription).toBe(
      sessionSummary(run, CTX).stravaDescription,
    );
  });
});
