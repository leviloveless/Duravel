/**
 * Pushing an extra workout to Strava (Levi, 2026-08-19).
 *
 * The ask, verbatim: "Add a function to push extra workouts to Strava. The
 * pushed workouts need to put Duravel in the title & top of description."
 *
 * So the first two tests here are the requirement itself, and the rest are the
 * traps around it — the ones that come from Strava freezing `elapsed_time`,
 * `distance` and `start_date` at creation with no DELETE endpoint to undo a bad
 * one. Anything wrong in that payload is wrong on the athlete's Strava feed
 * permanently.
 *
 * The I/O half (`pushExtraToStrava`) is not covered here, matching
 * `autoPostSessionToStrava`: it is gating + tokens around this payload and the
 * already-tested `syncAutoPost` rule (see `strava-autopost-idempotency.test.ts`),
 * and the repo mocks nothing.
 */
import { describe, it, expect } from "vitest";
import type { ExtraWorkout } from "@/lib/schemas";
import {
  EXTRA_KIND_TO_SPORT,
  EXTRA_NEEDS_DURATION,
  EXTRA_STRAVA_HEADER,
  buildExtraStravaActivity,
  buildExtraStravaText,
  extraStartLocalIso,
  withDuravelHeader,
} from "./extra-strava";

function x(over: Partial<ExtraWorkout> = {}): ExtraWorkout {
  return {
    id: "x1",
    weekNumber: 3,
    day: "wed",
    kind: "run",
    ...over,
  } as ExtraWorkout;
}

describe("Duravel is in the title and at the top of the description", () => {
  it("leads the activity name", () => {
    const { name } = buildExtraStravaText(
      x({ title: "Morning ride", kind: "cardio", durationMin: 45 }),
    );
    expect(name.startsWith("Duravel")).toBe(true);
    // …and keeps the week/day shape the session titles already use.
    expect(name).toBe("Duravel - Week 3 - Wednesday - Morning Ride");
  });

  it("is the first line of the description", () => {
    const { description } = buildExtraStravaText(x({ durationMin: 40, distanceMiles: 4.2 }));
    expect(description.split("\n")[0]).toBe(EXTRA_STRAVA_HEADER);
  });

  it("names the workout by kind when the athlete didn't title it", () => {
    expect(buildExtraStravaText(x({ kind: "lift", durationMin: 50 })).name).toBe(
      "Duravel - Week 3 - Wednesday - Strength",
    );
  });

  it("carries the same stats line the app shows, plus the note", () => {
    const { description } = buildExtraStravaText(
      x({ durationMin: 45, distanceMiles: 4.2, avgHr: 148, rpe: 6, note: "Easy, felt good." }),
    );
    expect(description).toContain("Extra workout - Week 3 - Wednesday");
    expect(description).toContain("45 min · 4.2 mi · 148 bpm · RPE 6");
    expect(description).toContain("Easy, felt good.");
  });
});

describe("the header goes on exactly once", () => {
  // The refresh path rewrites the description of an activity that ALREADY
  // carries the header. Three pushes must not mean three headers.
  it("does not stack when applied to its own output", () => {
    const once = withDuravelHeader("45 min");
    expect(withDuravelHeader(once)).toBe(once);
    expect(withDuravelHeader(withDuravelHeader(once))).toBe(once);
  });

  it("survives a re-push of the whole built description", () => {
    const extra = x({ durationMin: 45, note: "hi" });
    const first = buildExtraStravaText(extra).description;
    const second = buildExtraStravaText(extra).description;
    expect(second).toBe(first);
    expect(second.match(new RegExp(EXTRA_STRAVA_HEADER, "g"))).toHaveLength(1);
  });

  it("is the whole description when there is nothing else to say", () => {
    expect(withDuravelHeader("")).toBe(EXTRA_STRAVA_HEADER);
    expect(withDuravelHeader("   \n ")).toBe(EXTRA_STRAVA_HEADER);
  });
});

describe("the payload Strava will freeze forever", () => {
  it("REFUSES a workout with no duration rather than inventing one", () => {
    // `elapsed_time` cannot be corrected after creation and there is no DELETE,
    // so a defaulted 45 min would be a permanent lie. The session auto-post can
    // default because a planned session has an engine estimate behind it; an
    // extra with no duration is the athlete saying "I don't know".
    expect(() => buildExtraStravaActivity(x(), "2026-08-19T12:00:00Z")).toThrow(
      EXTRA_NEEDS_DURATION,
    );
    expect(() => buildExtraStravaActivity(x({ durationMin: 0 }), "2026-08-19T12:00:00Z")).toThrow(
      EXTRA_NEEDS_DURATION,
    );
  });

  it("sends minutes as seconds and miles as metres", () => {
    const a = buildExtraStravaActivity(
      x({ durationMin: 45, distanceMiles: 4.2 }),
      "2026-08-19T07:15:00Z",
    );
    expect(a.elapsedSeconds).toBe(2700);
    expect(Math.round(a.distanceMeters!)).toBe(6759);
    expect(a.startLocalIso).toBe("2026-08-19T07:15:00Z");
  });

  it("omits distance entirely when there is none — a 0 renders an empty pace", () => {
    const a = buildExtraStravaActivity(
      x({ kind: "lift", durationMin: 60 }),
      "2026-08-19T12:00:00Z",
    );
    expect(a.distanceMeters).toBeUndefined();
    expect(a.sportType).toBe("WeightTraining");
  });

  it("maps every kind to a sport Strava accepts", () => {
    expect(EXTRA_KIND_TO_SPORT).toEqual({
      run: "Run",
      lift: "WeightTraining",
      hybrid: "Crossfit",
      cardio: "Workout",
      other: "Workout",
    });
    for (const kind of Object.keys(EXTRA_KIND_TO_SPORT) as (keyof typeof EXTRA_KIND_TO_SPORT)[]) {
      const a = buildExtraStravaActivity(x({ kind, durationMin: 30 }), "2026-08-19T12:00:00Z");
      expect(a.sportType, kind).toBe(EXTRA_KIND_TO_SPORT[kind]);
    }
  });
});

describe("the activity lands on the day the workout happened", () => {
  // Program starts Monday 2026-08-10, so week 3 Wednesday is 2026-08-26.
  const START = "2026-08-10";

  it("uses the extra's own calendar day, not the day the button was pressed", () => {
    const iso = extraStartLocalIso(x(), START, "2026-09-04T18:30:00Z");
    expect(iso).toBe("2026-08-26T12:00:00Z");
  });

  it("keeps the real clock time when the extra is from today", () => {
    // Same day → the time is not a guess, so don't replace it with one.
    expect(extraStartLocalIso(x(), START, "2026-08-26T06:45:00Z")).toBe("2026-08-26T06:45:00Z");
  });

  it("falls back to now when the program start date is unknown", () => {
    expect(extraStartLocalIso(x(), null, "2026-09-04T18:30:00Z")).toBe("2026-09-04T18:30:00Z");
  });

  it("walks the weekdays within a week", () => {
    const on = (d: ExtraWorkout["day"]) =>
      extraStartLocalIso(x({ day: d }), START, "2026-01-01T00:00:00Z");
    expect(on("mon")).toBe("2026-08-24T12:00:00Z");
    expect(on("wed")).toBe("2026-08-26T12:00:00Z");
    expect(on("sun")).toBe("2026-08-30T12:00:00Z");
  });
});
