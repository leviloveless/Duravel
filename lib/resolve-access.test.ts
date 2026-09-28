import { describe, expect, it } from "vitest";
import {
  entitlementFor,
  resolveAccess,
  type AccessOverride,
  type SubscriptionRow,
} from "./subscription";

/**
 * Admin overrides layered onto the carded-trial entitlement rule (2026-09-28).
 *
 * `lib/subscription-entitlement.test.ts` already pins the Stripe half; this pins
 * what an administrator's comp or revoke does on top of it — and that with NO
 * override, `entitlementFor` is byte-for-byte what it was.
 */

const DAY = 86_400_000;
const NOW = Date.parse("2026-09-28T12:00:00.000Z");
const iso = (ms: number) => new Date(ms).toISOString();
const on = { billingEnabled: true, now: NOW };

const sub = (o: Partial<SubscriptionRow>): SubscriptionRow => ({
  status: "active",
  plan: "monthly",
  tier: "standard",
  price_id: "price_x",
  current_period_end: iso(NOW + 10 * DAY),
  cancel_at_period_end: false,
  ...o,
});
const ov = (o: Partial<AccessOverride>): AccessOverride => ({
  access: "default",
  grant_tier: null,
  grant_expires_at: null,
  ...o,
});

describe("resolveAccess — the Stripe states it reports", () => {
  it("never checked out: no access, source none", () => {
    expect(resolveAccess(null, on)).toMatchObject({
      entitled: false,
      reason: "none",
      source: "none",
    });
  });
  it("a carded trial is a live subscription, reported as a trial", () => {
    const r = resolveAccess(
      sub({ status: "trialing", current_period_end: iso(NOW + 3 * DAY) }),
      on,
    );
    expect(r).toMatchObject({ entitled: true, reason: "trial", source: "trial", trialDaysLeft: 3 });
  });
  it("a canceled subscription is lapsed, not 'never checked out'", () => {
    expect(resolveAccess(sub({ status: "canceled" }), on)).toMatchObject({
      entitled: false,
      source: "lapsed",
    });
  });
});

describe("resolveAccess — admin overrides", () => {
  it("a comp gives access with no card at all", () => {
    const r = resolveAccess(null, {
      ...on,
      override: ov({ access: "grant", grant_tier: "custom" }),
    });
    expect(r).toMatchObject({ entitled: true, tier: "custom", source: "override_grant" });
  });
  it("a comp reads to the rest of the app as `subscription`", () => {
    expect(resolveAccess(null, { ...on, override: ov({ access: "grant" }) }).reason).toBe(
      "subscription",
    );
  });
  it("a comp with no tier is standard", () => {
    expect(resolveAccess(null, { ...on, override: ov({ access: "grant" }) }).tier).toBe("standard");
  });
  it("a comp outranks a lower paid tier instead of dropping the athlete to it", () => {
    const r = resolveAccess(sub({}), {
      ...on,
      override: ov({ access: "grant", grant_tier: "custom" }),
    });
    expect(r).toMatchObject({ tier: "custom", source: "override_grant" });
  });
  it("an expired comp falls back to the normal rules, not to a lock-out", () => {
    const expired = ov({ access: "grant", grant_expires_at: iso(NOW - DAY) });
    expect(resolveAccess(sub({}), { ...on, override: expired }).source).toBe("subscription");
    expect(resolveAccess(null, { ...on, override: expired }).source).toBe("none");
  });
  it("a comp is live one millisecond before it expires", () => {
    const r = resolveAccess(null, {
      ...on,
      override: ov({ access: "grant", grant_expires_at: iso(NOW + 1) }),
    });
    expect(r.source).toBe("override_grant");
  });
  it("a revoke beats a paying subscription and a carded trial", () => {
    const revoke = { ...on, override: ov({ access: "revoke" }) };
    expect(resolveAccess(sub({}), revoke)).toMatchObject({
      entitled: false,
      source: "override_revoke",
    });
    expect(resolveAccess(sub({ status: "trialing" }), revoke).entitled).toBe(false);
  });
  it("billing off still lets everyone in, a revoke included", () => {
    const r = resolveAccess(null, {
      billingEnabled: false,
      now: NOW,
      override: ov({ access: "revoke" }),
    });
    expect(r).toMatchObject({ entitled: true, source: "billing_off" });
  });
  it("a `default` override row changes nothing", () => {
    expect(resolveAccess(sub({}), { ...on, override: ov({}) }).source).toBe("subscription");
  });
});

describe("entitlementFor — unchanged shape for every existing caller", () => {
  it("carries no `source` field", () => {
    expect(entitlementFor(sub({}), on)).not.toHaveProperty("source");
  });
  it("gives exactly what resolveAccess gives, minus `source`", () => {
    for (const s of [null, sub({}), sub({ status: "trialing" }), sub({ status: "canceled" })]) {
      const { source: _s, ...rest } = resolveAccess(s, on);
      void _s;
      expect(entitlementFor(s, on)).toEqual(rest);
    }
  });
});
