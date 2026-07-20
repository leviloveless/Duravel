import { describe, it, expect } from "vitest";
import {
  rpeFromStravaExertion,
  feelFromNote,
  stravaEffortFromDetail,
  effortFromActivity,
  FEEL_MAX,
} from "./effort";

describe("rpeFromStravaExertion", () => {
  it("rounds + clamps to 1-10, treats 0/unset as no RPE", () => {
    expect(rpeFromStravaExertion(7)).toBe(7);
    expect(rpeFromStravaExertion(6.6)).toBe(7);
    expect(rpeFromStravaExertion(0)).toBeNull();
    expect(rpeFromStravaExertion(0.2)).toBeNull();
    expect(rpeFromStravaExertion(11)).toBe(10);
    expect(rpeFromStravaExertion(null)).toBeNull();
    expect(rpeFromStravaExertion("8")).toBeNull();
    expect(rpeFromStravaExertion(NaN)).toBeNull();
  });
});

describe("feelFromNote", () => {
  it("trims, nulls empty, caps length", () => {
    expect(feelFromNote("  legs felt great  ")).toBe("legs felt great");
    expect(feelFromNote("   ")).toBeNull();
    expect(feelFromNote(42)).toBeNull();
    expect(feelFromNote("x".repeat(FEEL_MAX + 50))!.length).toBe(FEEL_MAX);
  });
});

describe("stravaEffortFromDetail", () => {
  it("maps perceived_exertion + private_note", () => {
    expect(stravaEffortFromDetail({ perceived_exertion: 8, private_note: "tough tempo" }))
      .toEqual({ rpe: 8, feel: "tough tempo" });
    expect(stravaEffortFromDetail({})).toEqual({ rpe: null, feel: null });
  });
});

describe("effortFromActivity", () => {
  it("only Strava carries RPE today; others return empty", () => {
    expect(effortFromActivity("strava", { perceived_exertion: 5, private_note: "ok" }))
      .toEqual({ rpe: 5, feel: "ok" });
    expect(effortFromActivity("oura", { perceived_exertion: 5 })).toEqual({ rpe: null, feel: null });
    expect(effortFromActivity("apple_health", {})).toEqual({ rpe: null, feel: null });
  });
});
