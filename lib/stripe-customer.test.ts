import { describe, expect, it } from "vitest";
import type Stripe from "stripe";
import { isMissingStripeObject, stripeCustomerExists } from "./stripe-customer";

const fake = (retrieve: () => Promise<unknown>) =>
  ({ customers: { retrieve } }) as unknown as Stripe;

describe("stripe customer that exists only in the other mode", () => {
  it("reads Stripe's resource_missing as absent, in either error shape", () => {
    expect(isMissingStripeObject({ code: "resource_missing" })).toBe(true);
    expect(isMissingStripeObject({ raw: { code: "resource_missing" } })).toBe(true);
    expect(isMissingStripeObject({ code: "rate_limit" })).toBe(false);
    expect(isMissingStripeObject(new Error("boom"))).toBe(false);
    expect(isMissingStripeObject(null)).toBe(false);
  });

  it("a test-mode id under the live key is treated as no customer", async () => {
    const err = Object.assign(
      new Error("No such customer: 'cus_x'; a similar object exists in test mode"),
      {
        code: "resource_missing",
      },
    );
    await expect(
      stripeCustomerExists(
        fake(() => Promise.reject(err)),
        "cus_x",
      ),
    ).resolves.toBe(false);
  });

  it("a deleted customer is treated as no customer", async () => {
    await expect(
      stripeCustomerExists(
        fake(() => Promise.resolve({ id: "cus_x", deleted: true })),
        "cus_x",
      ),
    ).resolves.toBe(false);
  });

  it("a live customer exists", async () => {
    await expect(
      stripeCustomerExists(
        fake(() => Promise.resolve({ id: "cus_x", email: "a@b.c" })),
        "cus_x",
      ),
    ).resolves.toBe(true);
  });

  it("any other Stripe failure still stops the action", async () => {
    const err = Object.assign(new Error("Rate limited"), { code: "rate_limit" });
    await expect(
      stripeCustomerExists(
        fake(() => Promise.reject(err)),
        "cus_x",
      ),
    ).rejects.toThrow("Rate limited");
  });
});
