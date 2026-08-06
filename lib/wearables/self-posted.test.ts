/**
 * REGRESSION — Duravel must never offer its OWN Strava post as the evidence for
 * the session that produced it (Levi, 2026-08-06, migration 0040).
 *
 * The loop, seen live on the program page:
 *
 *     Synced workouts ready to link (4)
 *       Run · Thu, Aug 6 · 1.00 mi · 8 min
 *       Matches your Threshold run on Thursday · Week 1.   [Confirm match]
 *
 * That "Run" was written to Strava BY the auto-post when the threshold run was
 * logged. Sync imported it back, and `suggest-data` — which filtered on nothing
 * but "unlinked + same day" — matched it to its own source session. Confirming
 * it would set the actuals to the planned numbers, so adherence, readiness and
 * the weekly adaptation would read a perfectly-executed week no matter what the
 * athlete did. It carried the pre-patch-21 `1.00 mi` too, so the actual would
 * have been not just circular but wrong.
 */
import { describe, it, expect } from "vitest";
import { isLinkCandidate } from "./suggest-data";

const activity = (over: Partial<{ linked: boolean; self_posted: boolean }> = {}) => ({
  linked: false,
  self_posted: false,
  ...over,
});

describe("isLinkCandidate", () => {
  it("a real synced workout is linkable", () => {
    expect(isLinkCandidate(activity())).toBe(true);
  });

  it("an activity Duravel posted is NEVER linkable", () => {
    expect(isLinkCandidate(activity({ self_posted: true }))).toBe(false);
  });

  it("still rejects anything already linked", () => {
    expect(isLinkCandidate(activity({ linked: true }))).toBe(false);
    expect(isLinkCandidate(activity({ linked: true, self_posted: true }))).toBe(false);
  });

  it("treats a MISSING flag as linkable, so a pre-0040 deploy behaves as before", () => {
    // `getUserActivities` falls back to a select without `self_posted` when the
    // migration hasn't been applied. Undefined must not silently hide every
    // activity from the link UI.
    expect(isLinkCandidate({ linked: false })).toBe(true);
    expect(isLinkCandidate({ linked: false, self_posted: undefined })).toBe(true);
  });

  it("only an exact `true` disqualifies", () => {
    // Guards against a truthy-but-not-true value from a loose JSON round-trip
    // flipping a legitimate activity out of the athlete's link list.
    expect(isLinkCandidate({ linked: false, self_posted: false })).toBe(true);
  });
});
