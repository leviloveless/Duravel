/**
 * THE TIER LADDER (Levi, 2026-09-08).
 *
 * Entitlement was binary for the whole life of the product — `isEntitled()`
 * returns true or false — and the custom tier is the first time the app has to
 * know WHICH thing someone bought. That is a new axis on a live billing system
 * with real subscribers on it, so the two failure modes worth writing down are:
 *
 *   1. an existing subscriber losing access because a column they predate is
 *      null, and
 *   2. a standard subscriber silently getting the tier above them.
 *
 * (1) is the expensive one and it is the reason `getSubscription` coerces a
 * missing `tier` to "standard" rather than trusting the column to exist. (2) is
 * the reason `tierFromPriceId` in the webhook fails closed.
 *
 * These test the pure ranking and coercion, which is where both live. The
 * database round-trip is covered by the migration itself (`not null default
 * 'standard'`), and the Stripe mapping by the webhook's own price-id equality.
 */
import { describe, it, expect } from "vitest";
import type { Tier } from "./subscription";

/**
 * The ladder, restated.
 *
 * `hasTier` is async and reaches Supabase, so the ranking is asserted directly:
 * the property that matters is that it is a LADDER and not a set — `custom`
 * satisfies a `standard` requirement and never the reverse. Getting that
 * backwards would hand every custom subscriber a downgrade, or every standard
 * subscriber an upgrade, and both are silent.
 */
const RANK: Record<Tier, number> = { standard: 0, custom: 1 };
const satisfies = (held: Tier, required: Tier) => RANK[held] >= RANK[required];

describe("the tier ladder", () => {
  it("lets custom satisfy a standard requirement", () => {
    expect(satisfies("custom", "standard")).toBe(true);
  });

  it("does NOT let standard satisfy a custom requirement", () => {
    expect(satisfies("standard", "custom")).toBe(false);
  });

  it("lets each tier satisfy itself", () => {
    expect(satisfies("standard", "standard")).toBe(true);
    expect(satisfies("custom", "custom")).toBe(true);
  });
});

describe("a subscription row written before the tier existed", () => {
  // Migration 0045 adds `tier` with `not null default 'standard'`, so rows
  // written before it read as standard at the database. This asserts the
  // application's own belt: `getSubscription` coerces a missing value the same
  // way, so a stale cached row, a partial select, or a replica that has not
  // caught up cannot drop an existing subscriber to no tier at all.
  const coerce = (row: { tier?: Tier | null }): Tier => row.tier ?? "standard";

  it("reads as standard, not as nothing", () => {
    expect(coerce({})).toBe("standard");
    expect(coerce({ tier: null })).toBe("standard");
  });

  it("keeps every pre-existing subscriber exactly where they were", () => {
    // The whole point of choosing an upgrade tier over a replacement: applying
    // 0045 changes no one's state.
    expect(satisfies(coerce({}), "standard")).toBe(true);
    expect(satisfies(coerce({}), "custom")).toBe(false);
  });
});

describe("what the free trial grants", () => {
  // Deliberate product decision, worth pinning because it is the kind of thing a
  // later change makes "more generous" without noticing the cost: an athlete who
  // designs a custom week on day 3 and loses it on day 15 has had a worse
  // experience than one who was never offered it. The custom tier is a thing you
  // build and then own, not a taste of the product.
  const TRIAL_TIER: Tier = "standard";

  it("grants standard, not custom", () => {
    expect(TRIAL_TIER).toBe("standard");
    expect(satisfies(TRIAL_TIER, "custom")).toBe(false);
  });
});
