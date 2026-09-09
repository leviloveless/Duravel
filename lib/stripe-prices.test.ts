/**
 * WHAT A STRIPE PRICE ID BUYS.
 *
 * `subscription-tier.test.ts` pins the tier LADDER — the ranking and the
 * coercion of a row written before the column existed. This file pins the step
 * before it: turning a price id from Stripe into the `plan` and `tier` that get
 * written to that row. Between them they cover both ends of the entitlement
 * write; the database round-trip is covered by migration 0045's own `not null
 * default 'standard'`.
 *
 * The reason this file exists at all is that the mapping had never been executed
 * outside production. It lived inside the webhook route, closed over `env`, in a
 * module that pulls in Stripe and the service-role Supabase client on import —
 * so the only way to run it was to send it a real webhook. For the standard
 * plans that was survivable, because live traffic exercised them daily. For the
 * custom tier it meant the first execution of the code would have been against a
 * paying customer.
 *
 * The failure mode being pinned is specifically the QUIET one. `resolvePrice`
 * fails closed, which is correct — an unknown price must never be handed the
 * tier above — but failing closed on a custom subscriber writes them down as
 * `standard` and says nothing. So the tests below assert the fallback AND assert
 * that it reports itself as unrecognised, which is what the webhook logs on.
 */
import { describe, it, expect } from "vitest";
import { resolvePrice, customTierIsPurchasable, type ConfiguredPrices } from "./stripe-prices";

/**
 * A fully-configured deployment: all three prices set, all distinct.
 *
 * The annual id is the real live one recorded on 2026-07-18 (product
 * `prod_Ut3BnXkptmdRK0`). Using it rather than a placeholder is deliberate — it
 * makes this file the one place in the repo where the mapping from that id to
 * "annual" is written down and checked, so a future edit that swaps the env vars
 * around fails here instead of in a customer's account.
 */
const ALL_SET: ConfiguredPrices = {
  monthly: "price_1TtH5CEnQhxb3rRAKnX1JqWf",
  annual: "price_1TuBKrEnQhxb3rRAMKVzVpE3",
  customMonthly: "price_custom_not_yet_created",
};

/** Production today: the custom price does not exist, so its var is unset. */
const CUSTOM_UNSET: ConfiguredPrices = {
  monthly: ALL_SET.monthly,
  annual: ALL_SET.annual,
};

describe("resolving a configured price id", () => {
  it("reads the annual price as the annual interval at the standard tier", () => {
    expect(resolvePrice(ALL_SET.annual, ALL_SET)).toEqual({
      plan: "annual",
      tier: "standard",
      unrecognized: false,
    });
  });

  it("reads the monthly price as the monthly interval at the standard tier", () => {
    expect(resolvePrice(ALL_SET.monthly, ALL_SET)).toEqual({
      plan: "monthly",
      tier: "standard",
      unrecognized: false,
    });
  });

  it("reads the custom price as the monthly interval at the CUSTOM tier", () => {
    // The custom tier is billed monthly, so interval alone cannot distinguish it
    // from the standard monthly plan. This pair of assertions is the entire
    // reason `tier` is a separate axis from `plan`.
    expect(resolvePrice(ALL_SET.customMonthly, ALL_SET)).toEqual({
      plan: "monthly",
      tier: "custom",
      unrecognized: false,
    });
  });
});

describe("a price id that matches nothing configured", () => {
  // This is the drift case: a price created in the Stripe dashboard whose id was
  // never put in the environment, or an env var pointing at an archived price.
  it("falls back to standard rather than granting the tier above", () => {
    const r = resolvePrice("price_someone_made_this_in_the_dashboard", ALL_SET);
    expect(r.tier).toBe("standard");
    expect(r.plan).toBeNull();
  });

  it("reports itself as unrecognised, so the fallback is not silent", () => {
    // The assertion that matters. Failing closed is the right direction and a
    // completely quiet one; without this flag a paying custom subscriber is
    // downgraded with no error, no failed webhook and nothing in the logs. The
    // webhook warns on exactly this boolean.
    expect(resolvePrice("price_unknown", ALL_SET).unrecognized).toBe(true);
  });

  it("treats a subscription with no price id as a different failure, not drift", () => {
    // Nothing to recognise, so nothing to report as misconfiguration — this is
    // Stripe handing us an item without a price, which is a separate problem and
    // should not fire the configuration warning.
    expect(resolvePrice(null, ALL_SET).unrecognized).toBe(false);
    expect(resolvePrice(undefined, ALL_SET).unrecognized).toBe(false);
  });
});

describe("when the custom price is not configured (production today)", () => {
  it("still resolves the two live plans exactly as before", () => {
    // The custom tier arriving must not disturb anything a current subscriber
    // depends on. This is the regression guard for the paying users.
    expect(resolvePrice(CUSTOM_UNSET.annual, CUSTOM_UNSET).plan).toBe("annual");
    expect(resolvePrice(CUSTOM_UNSET.monthly, CUSTOM_UNSET).plan).toBe("monthly");
    expect(resolvePrice(CUSTOM_UNSET.annual, CUSTOM_UNSET).tier).toBe("standard");
  });

  it("cannot grant the custom tier to anyone", () => {
    expect(resolvePrice("price_anything_at_all", CUSTOM_UNSET).tier).toBe("standard");
  });

  it("flags a real custom price id as unrecognised instead of ignoring it", () => {
    // The scenario the warning exists for: the price got created in Stripe and
    // someone subscribed before the env var was set. They are being under-
    // entitled right now, and this is the only place that says so.
    const r = resolvePrice("price_custom_not_yet_created", CUSTOM_UNSET);
    expect(r.tier).toBe("standard");
    expect(r.unrecognized).toBe(true);
  });
});

describe("an env var that is set to something empty or padded", () => {
  // An env var set to "" is a configuration mistake, not a deliberate off, and
  // an id pasted into a hosting dashboard picks up whitespace surprisingly often.
  // Both are normalised, so neither can turn into a silent mismatch.
  it("never lets an empty configured id match", () => {
    const r = resolvePrice("", { monthly: "", annual: "", customMonthly: "" });
    expect(r).toEqual({ plan: null, tier: "standard", unrecognized: false });
  });

  it("matches a configured id that arrived with surrounding whitespace", () => {
    const padded: ConfiguredPrices = { customMonthly: "  price_custom  \n" };
    expect(resolvePrice("price_custom", padded).tier).toBe("custom");
  });
});

describe("whether the custom plan is on sale", () => {
  /**
   * One predicate feeds both the pricing page (offer it or mark it coming soon)
   * and the checkout route (accept the request or decline it). They must never
   * disagree, because disagreeing IS the bug: a page advertising a plan the
   * server refuses.
   */
  it("is false while the price id is unset, so the page cannot advertise it", () => {
    expect(customTierIsPurchasable(CUSTOM_UNSET)).toBe(false);
    expect(customTierIsPurchasable({})).toBe(false);
    expect(customTierIsPurchasable({ customMonthly: "   " })).toBe(false);
  });

  it("becomes true the moment the price id is set, with nothing else to remember", () => {
    // The property worth pinning: the guard is DERIVED from the price id rather
    // than being its own feature flag. A separate flag would be a second thing to
    // set, and forgetting it would leave the plan hidden after it was ready —
    // a guard that keeps hiding a configured plan is its own bug.
    expect(customTierIsPurchasable(ALL_SET)).toBe(true);
  });
});
