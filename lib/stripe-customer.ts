import type Stripe from "stripe";

/**
 * Whether a Stripe error means "that object does not exist under this key".
 *
 * The case that needed it (2026-09-28): accounts created during the July billing
 * test have a `stripe_customer_id` recorded from TEST mode. Under the live key
 * Stripe answers "No such customer … a similar object exists in test mode". The
 * admin delete failed on it, and so would that athlete's checkout and billing
 * portal. A customer that does not exist in the mode we are running in cannot be
 * charged in that mode, so there is nothing to cancel: it is treated as absent,
 * not as a failure. Any other Stripe error still stops the action.
 */
export function isMissingStripeObject(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { code?: unknown; raw?: { code?: unknown } };
  return e.code === "resource_missing" || e.raw?.code === "resource_missing";
}

/** True when the customer exists (and is not deleted) under the current Stripe key. */
export async function stripeCustomerExists(stripe: Stripe, customerId: string): Promise<boolean> {
  try {
    const c = await stripe.customers.retrieve(customerId);
    return !("deleted" in c && c.deleted);
  } catch (err) {
    if (isMissingStripeObject(err)) return false;
    throw err;
  }
}
