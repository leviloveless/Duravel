import { describe, expect, it } from "vitest";
import {
  cohortFunnel,
  isOurStripeEndpoint,
  mirrorDrift,
  missingStripeEvents,
  monthlyValue,
  pct,
  providerRollup,
  revenueSummary,
  trialOutcome,
  utcWeekStart,
  weeklyActivity,
  type SubFact,
} from "./admin-ops";

const D = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 8, 28, 12); // Mon 28 Sep 2026

function sub(over: Partial<SubFact>): SubFact {
  return {
    id: "sub",
    userId: "u1",
    status: "active",
    createdMs: NOW - 20 * D,
    trialStartMs: NOW - 20 * D,
    trialEndMs: NOW - 13 * D,
    canceledAtMs: null,
    unitAmount: 1999,
    currency: "usd",
    interval: "month",
    ...over,
  };
}

describe("trialOutcome", () => {
  it("still in trial", () => {
    expect(trialOutcome(sub({ status: "trialing", trialEndMs: NOW + 2 * D }), NOW)).toBe(
      "in_trial",
    );
  });
  it("converted: billing after the trial, or canceled only after it ended", () => {
    expect(trialOutcome(sub({}), NOW)).toBe("converted");
    expect(trialOutcome(sub({ status: "past_due" }), NOW)).toBe("converted");
    expect(trialOutcome(sub({ status: "canceled", canceledAtMs: NOW - 2 * D }), NOW)).toBe(
      "converted",
    );
  });
  it("did not convert: canceled during the trial, or expired unpaid", () => {
    expect(trialOutcome(sub({ status: "canceled", canceledAtMs: NOW - 15 * D }), NOW)).toBe(
      "canceled_in_trial",
    );
    // Canceled mid-trial but Stripe keeps it trialing until the end, then cancels.
    expect(trialOutcome(sub({ status: "canceled", canceledAtMs: NOW - 13 * D }), NOW)).toBe(
      "canceled_in_trial",
    );
    expect(trialOutcome(sub({ status: "incomplete_expired" }), NOW)).toBe("canceled_in_trial");
  });
  it("no trial at all (a returning subscriber)", () => {
    expect(trialOutcome(sub({ trialStartMs: null, trialEndMs: null }), NOW)).toBe("no_trial");
  });
});

describe("revenue", () => {
  it("annual counts a twelfth; trialing and canceled count nothing", () => {
    expect(monthlyValue(sub({ interval: "year", unitAmount: 15999 }))).toBe(1333);
    expect(monthlyValue(sub({ status: "trialing" }))).toBe(0);
    expect(monthlyValue(sub({ status: "canceled" }))).toBe(0);
  });
  it("summary", () => {
    const s = revenueSummary(
      [
        sub({ id: "a" }),
        sub({ id: "b", interval: "year", unitAmount: 15999 }),
        sub({ id: "c", status: "trialing", trialEndMs: NOW + D }),
        sub({ id: "d", status: "past_due" }),
        sub({ id: "e", status: "canceled", canceledAtMs: NOW - 3 * D }),
        sub({ id: "f", status: "canceled", canceledAtMs: NOW - 15 * D }), // in-trial cancel: not churn
      ],
      NOW,
    );
    expect(s).toMatchObject({
      mrrMinor: 1999 + 1333 + 1999,
      paying: 3,
      payingByPlan: { monthly: 2, annual: 1 },
      inTrial: 1,
      pastDue: 1,
      churned30d: 1,
    });
  });
});

describe("cohortFunnel", () => {
  it("counts each account once per stage", () => {
    const f = cohortFunnel({
      signups: [
        { id: "u1", createdMs: NOW - 5 * D },
        { id: "u2", createdMs: NOW - 5 * D },
        { id: "u3", createdMs: NOW - 5 * D },
        { id: "u4", createdMs: NOW - 5 * D },
        { id: "old", createdMs: NOW - 90 * D },
      ],
      usersWithProgram: new Set(["u1", "u2", "u3", "old"]),
      subs: [
        sub({ id: "s1", userId: "u1" }),
        sub({ id: "s1b", userId: "u1" }), // second sub, same person
        sub({ id: "s2", userId: "u2", status: "trialing", trialEndMs: NOW + D }),
        sub({ id: "s3", userId: "u3", status: "canceled", canceledAtMs: NOW - 15 * D }),
        sub({ id: "so", userId: "old" }),
      ],
      fromMs: NOW - 30 * D,
      nowMs: NOW,
    });
    expect(f).toEqual({
      signups: 4,
      builtProgram: 3,
      startedTrial: 3,
      converted: 1,
      canceledInTrial: 1,
      stillInTrial: 1,
    });
    expect(pct(f.converted, f.startedTrial)).toBe(33);
    expect(pct(1, 0)).toBeNull();
  });
});

describe("weeklyActivity", () => {
  it("buckets by UTC Monday, newest first; conversions dated at trial end", () => {
    expect(new Date(utcWeekStart(Date.UTC(2026, 8, 30))).toISOString()).toBe(
      "2026-09-28T00:00:00.000Z",
    );
    const rows = weeklyActivity({
      signups: [{ createdMs: NOW }, { createdMs: NOW - 7 * D }, { createdMs: NOW - 400 * D }],
      subs: [sub({ trialStartMs: NOW - 6 * D, trialEndMs: NOW - D })],
      nowMs: NOW,
      weeks: 4,
    });
    expect(rows.map((r) => [r.signups, r.trials, r.conversions])).toEqual([
      [1, 0, 0],
      [1, 1, 1],
      [0, 0, 0],
      [0, 0, 0],
    ]);
  });
});

describe("providerRollup", () => {
  it("connected, fresh, stale and activity counts per provider", () => {
    const r = providerRollup(
      [
        { userId: "a", provider: "strava", lastSyncMs: NOW - 2 * 60 * 60 * 1000, createdMs: 0 },
        { userId: "b", provider: "strava", lastSyncMs: NOW - 3 * D, createdMs: 0 },
        { userId: "c", provider: "strava", lastSyncMs: NOW - 10 * D, createdMs: 0 },
        { userId: "d", provider: "oura", lastSyncMs: null, createdMs: 0 },
      ],
      [
        { provider: "strava", createdMs: NOW - D },
        { provider: "strava", createdMs: NOW - 20 * D },
      ],
      NOW,
    );
    expect(r).toEqual([
      {
        provider: "oura",
        connected: 1,
        synced24h: 0,
        synced7d: 0,
        stale: 1,
        activities7d: 0,
        activities30d: 0,
      },
      {
        provider: "strava",
        connected: 3,
        synced24h: 1,
        synced7d: 2,
        stale: 1,
        activities7d: 1,
        activities30d: 2,
      },
    ]);
  });
});

describe("webhook health", () => {
  it("names the events an endpoint is missing", () => {
    expect(missingStripeEvents(["*"])).toEqual([]);
    expect(
      missingStripeEvents([
        "checkout.session.completed",
        "customer.subscription.created",
        "customer.subscription.updated",
        "customer.subscription.deleted",
        "invoice.payment_succeeded",
      ]),
    ).toEqual(["customer.subscription.trial_will_end"]);
  });
  it("recognises this app's endpoint", () => {
    expect(
      isOurStripeEndpoint("https://duravel.app/api/stripe/webhook", "https://duravel.app"),
    ).toBe(true);
    expect(isOurStripeEndpoint("https://duravel.app/api/stripe/webhook/", null)).toBe(true);
    expect(isOurStripeEndpoint("https://other.app/api/stripe/webhook", "https://duravel.app")).toBe(
      false,
    );
    expect(isOurStripeEndpoint("not a url", "https://duravel.app")).toBe(false);
  });
  it("flags a live subscription the app has no row for, and any status disagreement", () => {
    const drift = mirrorDrift(
      [
        sub({ id: "s1", userId: "u1", status: "active" }),
        sub({ id: "s2", userId: "u2", status: "trialing" }),
        sub({ id: "s3", userId: "u3", status: "canceled" }),
        sub({ id: "s4", userId: "u4", status: "active" }),
      ],
      [
        { userId: "u1", subscriptionId: "s1", status: "active" },
        { userId: "u4", subscriptionId: "s4", status: "trialing" },
      ],
    );
    expect(drift).toEqual([
      { kind: "missing_row", subscriptionId: "s2", userId: "u2", stripeStatus: "trialing" },
      {
        kind: "status_differs",
        subscriptionId: "s4",
        userId: "u4",
        stripeStatus: "active",
        appStatus: "trialing",
      },
    ]);
  });
});
