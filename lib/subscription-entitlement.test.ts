/**
 * Who can see their program (2026-09-20).
 *
 * This file exists because the decision it covers was, until today, reachable
 * only through two Supabase round-trips and therefore covered by no test at
 * all — on a product with live billing. Getting it wrong one way gives the
 * program away; the other way locks out someone who is paying.
 *
 * The change it pins: the 14-day NO-CARD trial is gone. It was enforced
 * app-side off `profiles.trial_started_at`, which meant every freshly onboarded
 * athlete was entitled and `gateProgramWeeks` could never fire. The paywall
 * existed and was unreachable. The trial now lives in Stripe with a card
 * against it, and "no subscription" is the ordinary state of a new user rather
 * than an error.
 */
import { describe, it, expect } from "vitest";
import {
  entitlementFor,
  subscriptionIsLive,
  TRIAL_DAYS,
  type SubscriptionRow,
} from "./subscription";

const NOW = Date.parse("2026-09-20T12:00:00Z");
const DAY = 24 * 60 * 60 * 1000;
const iso = (ms: number) => new Date(ms).toISOString();

function row(over: Partial<SubscriptionRow> = {}): SubscriptionRow {
  return {
    status: "active",
    plan: "monthly",
    tier: "standard",
    price_id: "price_x",
    current_period_end: iso(NOW + 20 * DAY),
    cancel_at_period_end: false,
    ...over,
  };
}

describe("the trial is seven days and Stripe owns it", () => {
  it("is seven days", () => {
    expect(TRIAL_DAYS).toBe(7);
  });
});

describe("a brand-new athlete with no card", () => {
  const e = entitlementFor(null, { billingEnabled: true, now: NOW });

  it("is NOT entitled — this is the feature, not a bug", () => {
    // If this ever flips to true, the paywall stops firing everywhere at once
    // and nobody notices, because nothing errors. That is exactly what the old
    // app-side trial did.
    expect(e.entitled).toBe(false);
    expect(e.reason).toBe("none");
  });

  it("is offered no trial countdown, because they have not started one", () => {
    expect(e.trialEndsAt).toBeNull();
    expect(e.trialDaysLeft).toBeNull();
  });
});

describe("an athlete inside a carded trial", () => {
  const sub = row({ status: "trialing", current_period_end: iso(NOW + 5 * DAY) });
  const e = entitlementFor(sub, { billingEnabled: true, now: NOW });

  it("is entitled to the whole program", () => {
    expect(e.entitled).toBe(true);
    expect(e.reason).toBe("trial");
  });

  it("counts down from the Stripe period end, not from a second stored date", () => {
    expect(e.trialEndsAt).toBe(iso(NOW + 5 * DAY));
    expect(e.trialDaysLeft).toBe(5);
  });

  it("gets STANDARD, never the custom tier", () => {
    // Deliberate: an athlete who authors a custom week on day 3 and loses it on
    // day 8 has had a worse experience than one never offered it.
    expect(e.tier).toBe("standard");
  });

  it("never reports negative days once the clock runs out", () => {
    const late = entitlementFor(sub, { billingEnabled: true, now: NOW + 9 * DAY });
    expect(late.trialDaysLeft).toBe(0);
    expect(late.entitled).toBe(false);
  });
});

describe("an athlete whose trial ended without paying", () => {
  const e = entitlementFor(row({ status: "trialing", current_period_end: iso(NOW - DAY) }), {
    billingEnabled: true,
    now: NOW,
  });

  it("loses access", () => {
    expect(e.entitled).toBe(false);
  });

  it("keeps the trial end date so the UI can say what happened", () => {
    expect(e.trialEndsAt).toBe(iso(NOW - DAY));
    expect(e.trialDaysLeft).toBe(0);
  });
});

describe("a paying subscriber", () => {
  it("is entitled and is NOT described as trialing", () => {
    const e = entitlementFor(row(), { billingEnabled: true, now: NOW });
    expect(e.entitled).toBe(true);
    expect(e.reason).toBe("subscription");
    expect(e.trialEndsAt).toBeNull();
  });

  it("keeps the tier they bought", () => {
    expect(entitlementFor(row({ tier: "custom" }), { billingEnabled: true, now: NOW }).tier).toBe(
      "custom",
    );
  });

  it("is still entitled while cancelling at period end", () => {
    // Cancelling is not the same as cancelled: they paid for this period.
    const e = entitlementFor(row({ cancel_at_period_end: true }), {
      billingEnabled: true,
      now: NOW,
    });
    expect(e.entitled).toBe(true);
  });

  it("loses access once the period has actually passed", () => {
    const e = entitlementFor(row({ current_period_end: iso(NOW - DAY) }), {
      billingEnabled: true,
      now: NOW,
    });
    expect(e.entitled).toBe(false);
  });
});

describe("statuses that must never grant access", () => {
  for (const status of [
    "incomplete",
    "incomplete_expired",
    "past_due",
    "canceled",
    "unpaid",
    "paused",
  ] as const) {
    it(`${status} is not entitled`, () => {
      expect(entitlementFor(row({ status }), { billingEnabled: true, now: NOW }).entitled).toBe(
        false,
      );
    });
  }
});

describe("billing switched off", () => {
  it("entitles everyone at the custom tier, for pre-launch testing", () => {
    const e = entitlementFor(null, { billingEnabled: false, now: NOW });
    expect(e.entitled).toBe(true);
    expect(e.reason).toBe("billing_off");
    expect(e.tier).toBe("custom");
  });
});

describe("subscriptionIsLive", () => {
  it("treats a trial as live", () => {
    expect(subscriptionIsLive(row({ status: "trialing" }), NOW)).toBe(true);
  });
  it("treats no row as not live", () => {
    expect(subscriptionIsLive(null, NOW)).toBe(false);
  });
  it("treats a row with no period end as live while the status allows", () => {
    expect(subscriptionIsLive(row({ current_period_end: null }), NOW)).toBe(true);
  });
});
