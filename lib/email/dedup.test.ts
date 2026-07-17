import { describe, it, expect } from "vitest";
import { buildDedupKey, trialCycle } from "./dedup";

const U = "11111111-1111-1111-1111-111111111111";

describe("buildDedupKey", () => {
  it("welcome is one-per-user", () => {
    expect(buildDedupKey({ template: "welcome", userId: U })).toBe(`welcome:${U}`);
  });

  it("onboarding_nudge is one-per-user", () => {
    expect(buildDedupKey({ template: "onboarding_nudge", userId: U })).toBe(`onboarding_nudge:${U}`);
  });

  it("receipt is keyed on the Stripe invoice (idempotent on webhook replay)", () => {
    expect(buildDedupKey({ template: "receipt", invoiceId: "in_123" })).toBe("receipt:in_123");
  });

  it("trial_ending embeds stage + user + trial cycle", () => {
    const started = "2026-07-03T12:00:00.000Z";
    const cycle = trialCycle(started);
    expect(
      buildDedupKey({ template: "trial_ending", userId: U, stage: "T-3", trialStartedAt: started }),
    ).toBe(`trial_ending:T-3:${U}:${cycle}`);
  });

  it("each trial stage gets a distinct key", () => {
    const started = "2026-07-03T12:00:00.000Z";
    const keys = (["T-3", "T-1", "T-0"] as const).map((stage) =>
      buildDedupKey({ template: "trial_ending", userId: U, stage, trialStartedAt: started }),
    );
    expect(new Set(keys).size).toBe(3);
  });

  it("a reset trial_started_at produces a fresh cycle → fresh keys (re-trial allowed)", () => {
    const k1 = buildDedupKey({
      template: "trial_ending",
      userId: U,
      stage: "T-3",
      trialStartedAt: "2026-07-03T12:00:00.000Z",
    });
    const k2 = buildDedupKey({
      template: "trial_ending",
      userId: U,
      stage: "T-3",
      trialStartedAt: "2026-08-01T09:30:00.000Z",
    });
    expect(k1).not.toBe(k2);
  });
});

describe("trialCycle", () => {
  it("is stable for the same instant and equals epoch seconds", () => {
    const started = "2026-07-03T12:00:00.000Z";
    expect(trialCycle(started)).toBe(String(Math.floor(Date.parse(started) / 1000)));
    expect(trialCycle(started)).toBe(trialCycle(started));
  });
  it("ignores sub-second jitter (truncates to the second)", () => {
    expect(trialCycle("2026-07-03T12:00:00.400Z")).toBe(trialCycle("2026-07-03T12:00:00.900Z"));
  });
  it("falls back to a raw marker on an unparseable date", () => {
    expect(trialCycle("nope")).toBe("raw:nope");
  });
});
