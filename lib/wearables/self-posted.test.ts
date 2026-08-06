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
import { looksSelfPosted } from "./self-posted";

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

/**
 * REGRESSION — a backfill is a POINT-IN-TIME update, and 0040's missed anything
 * imported after it ran.
 *
 * Live, 2026-08-06, minutes after 0040 was applied: `Sync now` pulled in two
 * activities Duravel had posted that morning (pre-patch-23, so never claimed by
 * `markSelfPosted`), and the banner went straight back to (4) offering both as
 * evidence for the session that produced them. `looksSelfPosted` runs at ingest
 * so a late import is claimed on arrival.
 */
describe("looksSelfPosted", () => {
  const post = (over: Record<string, unknown> = {}) => ({
    manual: true,
    name: "Week 1 - Thursday - Threshold Run",
    ...over,
  });

  it("recognises Duravel's current title format", () => {
    expect(looksSelfPosted("strava", post())).toBe(true);
    // The two that reappeared live were Week 1 Thursday runs.
    expect(looksSelfPosted("strava", post({ name: "Week 12 - Sunday - Hybrid (HYROX)" }))).toBe(
      true,
    );
  });

  it("recognises the legacy `Duravel Run — Week 1` format", () => {
    expect(looksSelfPosted("strava", post({ name: "Duravel Run — Week 1" }))).toBe(true);
  });

  it("BOTH conditions must hold — a device-recorded activity is never ours", () => {
    // Duravel only ever posts via the manual endpoint, so a watch recording that
    // happens to be titled like a Duravel post stays the athlete's.
    expect(looksSelfPosted("strava", post({ manual: false }))).toBe(false);
    expect(looksSelfPosted("strava", post({ manual: undefined }))).toBe(false);
    // ...and a manual entry the athlete titled themselves stays linkable.
    expect(looksSelfPosted("strava", post({ name: "Morning shakeout" }))).toBe(false);
    expect(looksSelfPosted("strava", post({ name: "" }))).toBe(false);
  });

  it("never fires for a provider Duravel does not post to", () => {
    // A name-shaped heuristic on Oura or Apple Health could only ever produce
    // false positives — there is no endpoint we write to there.
    expect(looksSelfPosted("oura", post())).toBe(false);
    expect(looksSelfPosted("apple_health", post())).toBe(false);
    expect(looksSelfPosted("garmin", post())).toBe(false);
  });

  it("survives junk payloads without throwing", () => {
    expect(looksSelfPosted("strava", null)).toBe(false);
    expect(looksSelfPosted("strava", undefined)).toBe(false);
    expect(looksSelfPosted("strava", "not an object")).toBe(false);
    expect(looksSelfPosted("strava", { manual: "true", name: "Week 1 - Mon - Run" })).toBe(false);
    expect(looksSelfPosted("strava", { manual: true, name: 42 })).toBe(false);
  });

  it("matches migration 0042's SQL predicate exactly", () => {
    // `manual` true AND name ~ '^Week [0-9]+ - ' OR name like 'Duravel %'.
    // If these two ever drift, the backfill and the ingest path disagree about
    // which activities are Duravel's — which is how this bug happened.
    expect(looksSelfPosted("strava", post({ name: "Week1 - Monday - Run" }))).toBe(false);
    expect(looksSelfPosted("strava", post({ name: "week 1 - Monday - Run" }))).toBe(false);
    expect(looksSelfPosted("strava", post({ name: "Duravel" }))).toBe(false);
  });
});
