import { describe, it, expect } from "vitest";
import {
  evaluatePreClaim,
  evaluatePostClaim,
  isSameUtcDay,
  isSubscriptionActive,
  type PreClaimInput,
} from "./gate";

const NOW = Date.UTC(2026, 6, 17, 14, 0, 0); // 2026-07-17T14:00Z

function base(overrides: Partial<PreClaimInput> = {}): PreClaimInput {
  return {
    template: "trial_ending",
    emailEnabled: true,
    recipient: "a@b.com",
    suppressed: false,
    prefs: { unsubscribedAll: false, categoryEnabled: true },
    lastLifecycleEmailAt: null,
    nowMs: NOW,
    ...overrides,
  };
}

describe("evaluatePreClaim — universal gates (apply to every tier)", () => {
  it("skips when the feature flag is off", () => {
    expect(evaluatePreClaim(base({ emailEnabled: false }))).toEqual({
      proceed: false,
      reason: "disabled",
    });
  });

  it("skips when no recipient resolves", () => {
    expect(evaluatePreClaim(base({ recipient: null }))).toEqual({
      proceed: false,
      reason: "no_recipient",
    });
  });

  it("skips a hard-suppressed address even for service/transactional mail", () => {
    expect(evaluatePreClaim(base({ template: "trial_ending", suppressed: true }))).toEqual({
      proceed: false,
      reason: "suppressed",
    });
  });

  it("flag is checked before recipient and suppression (ordering)", () => {
    const d = evaluatePreClaim(base({ emailEnabled: false, recipient: null, suppressed: true }));
    expect(d).toEqual({ proceed: false, reason: "disabled" });
  });
});

describe("evaluatePreClaim — service tier bypasses preference + frequency gates", () => {
  it("trial_ending sends even with unsubscribed_all and a same-day lifecycle stamp", () => {
    const d = evaluatePreClaim(
      base({
        template: "trial_ending",
        prefs: { unsubscribedAll: true, categoryEnabled: false },
        lastLifecycleEmailAt: new Date(NOW).toISOString(),
      }),
    );
    expect(d).toEqual({ proceed: true });
  });

  it("receipt (service) is never frequency-capped", () => {
    const d = evaluatePreClaim(
      base({ template: "receipt", lastLifecycleEmailAt: new Date(NOW).toISOString() }),
    );
    expect(d).toEqual({ proceed: true });
  });
});

describe("evaluatePreClaim — lifecycle tier honors preferences + frequency cap", () => {
  it("skips on global unsubscribe", () => {
    const d = evaluatePreClaim(
      base({ template: "onboarding_nudge", prefs: { unsubscribedAll: true, categoryEnabled: true } }),
    );
    expect(d).toEqual({ proceed: false, reason: "unsubscribed_all" });
  });

  it("skips when the category flag is off", () => {
    const d = evaluatePreClaim(
      base({
        template: "onboarding_nudge",
        prefs: { unsubscribedAll: false, categoryEnabled: false },
      }),
    );
    expect(d).toEqual({ proceed: false, reason: "category_off" });
  });

  it("skips when a lifecycle email already went out today (UTC)", () => {
    const earlierToday = Date.UTC(2026, 6, 17, 2, 0, 0);
    const d = evaluatePreClaim(
      base({ template: "onboarding_nudge", lastLifecycleEmailAt: new Date(earlierToday).toISOString() }),
    );
    expect(d).toEqual({ proceed: false, reason: "frequency_cap" });
  });

  it("sends when the last lifecycle email was a previous day", () => {
    const yesterday = Date.UTC(2026, 6, 16, 23, 59, 0);
    const d = evaluatePreClaim(
      base({ template: "onboarding_nudge", lastLifecycleEmailAt: new Date(yesterday).toISOString() }),
    );
    expect(d).toEqual({ proceed: true });
  });

  it("unsubscribed_all is checked before the category flag (ordering)", () => {
    const d = evaluatePreClaim(
      base({
        template: "onboarding_nudge",
        prefs: { unsubscribedAll: true, categoryEnabled: false },
      }),
    );
    expect(d).toEqual({ proceed: false, reason: "unsubscribed_all" });
  });
});

describe("evaluatePostClaim — late entitlement re-check", () => {
  it("skips trial_ending when the user is now an active subscriber", () => {
    expect(
      evaluatePostClaim({ template: "trial_ending", subscriptionActive: true }),
    ).toEqual({ proceed: false, reason: "now_subscribed" });
  });

  it("proceeds trial_ending when still not subscribed", () => {
    expect(
      evaluatePostClaim({ template: "trial_ending", subscriptionActive: false }),
    ).toEqual({ proceed: true });
  });

  it("never blocks a non-trial template on subscription state", () => {
    expect(evaluatePostClaim({ template: "receipt", subscriptionActive: true })).toEqual({
      proceed: true,
    });
  });
});

describe("isSameUtcDay", () => {
  it("true within the same UTC day", () => {
    expect(isSameUtcDay(new Date(Date.UTC(2026, 6, 17, 0, 0, 1)).toISOString(), NOW)).toBe(true);
  });
  it("false across the UTC midnight boundary", () => {
    expect(isSameUtcDay(new Date(Date.UTC(2026, 6, 16, 23, 59, 59)).toISOString(), NOW)).toBe(false);
  });
  it("false on an unparseable date", () => {
    expect(isSameUtcDay("not-a-date", NOW)).toBe(false);
  });
});

describe("isSubscriptionActive", () => {
  it("null row is inactive", () => {
    expect(isSubscriptionActive(null, NOW)).toBe(false);
  });
  it("active with no period end is active", () => {
    expect(isSubscriptionActive({ status: "active", current_period_end: null }, NOW)).toBe(true);
  });
  it("trialing counts as active", () => {
    expect(isSubscriptionActive({ status: "trialing", current_period_end: null }, NOW)).toBe(true);
  });
  it("active but past period end is inactive", () => {
    const past = new Date(NOW - 1000).toISOString();
    expect(isSubscriptionActive({ status: "active", current_period_end: past }, NOW)).toBe(false);
  });
  it("canceled is inactive", () => {
    expect(isSubscriptionActive({ status: "canceled", current_period_end: null }, NOW)).toBe(false);
  });
});
