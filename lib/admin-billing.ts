import type Stripe from "stripe";
import { env } from "@/lib/env";
import { getStripe } from "@/lib/stripe";
import { stripeCustomerExists } from "@/lib/stripe-customer";

/**
 * Stripe, from the admin side (2026-09-27).
 *
 * Billing actions go to STRIPE, not to the `subscriptions` table. That table is a
 * mirror the webhook writes on every Stripe event; editing it would be
 * overwritten by the next event and would disagree with what Stripe charges in
 * the meantime. So cancel, resume and refund are Stripe API calls, and the
 * webhook brings the result back into the app like any other billing event —
 * usually within seconds.
 *
 * Changing someone's PLAN (monthly <-> annual, standard <-> custom) is not here
 * on purpose. It prorates, and the Stripe dashboard previews the proration before
 * you commit; a one-click button here would not. Each customer links straight to
 * their dashboard page for that.
 *
 * The TRIAL is a Stripe subscription in `trialing` (2026-09-20), so extending or
 * ending one is a Stripe call too — `trial_end` — never an app-side date.
 */

/** The shared Stripe client, or null when no secret key is configured (the admin says so). */
export function stripeAdmin(): Stripe | null {
  return env.STRIPE_SECRET_KEY ? getStripe() : null;
}

/** Dashboard link for a customer, pointing at test or live data to match the key. */
export function dashboardUrl(customerId: string): string {
  const test = (env.STRIPE_SECRET_KEY ?? "").startsWith("sk_test_");
  return `https://dashboard.stripe.com${test ? "/test" : ""}/customers/${customerId}`;
}

export type SubSummary = {
  id: string;
  status: string;
  /** Seconds since epoch; set while the subscription is trialing. */
  trialEnd: number | null;
  cancelAtPeriodEnd: boolean;
  /** Seconds since epoch; the latest end across the subscription's items. */
  currentPeriodEnd: number | null;
  items: { price: string; amount: number | null; currency: string; interval: string | null }[];
};

export type ChargeSummary = {
  id: string;
  amount: number;
  amountRefunded: number;
  currency: string;
  created: number;
  status: string;
  refunded: boolean;
  description: string | null;
};

export type CustomerSummary = {
  id: string;
  email: string | null;
  created: number;
  dashboardUrl: string;
  subscriptions: SubSummary[];
  charges: ChargeSummary[];
};

function summarizeSub(s: Stripe.Subscription): SubSummary {
  const ends = s.items.data
    .map((i) => i.current_period_end)
    .filter((n): n is number => typeof n === "number");
  return {
    id: s.id,
    status: s.status,
    trialEnd: s.trial_end,
    cancelAtPeriodEnd: s.cancel_at_period_end,
    currentPeriodEnd: ends.length ? Math.max(...ends) : null,
    items: s.items.data.map((i) => ({
      price: i.price.nickname ?? i.price.id,
      amount: i.price.unit_amount,
      currency: i.price.currency,
      interval: i.price.recurring?.interval ?? null,
    })),
  };
}

function summarizeCharge(c: Stripe.Charge): ChargeSummary {
  return {
    id: c.id,
    amount: c.amount,
    amountRefunded: c.amount_refunded,
    currency: c.currency,
    created: c.created,
    status: c.status,
    refunded: c.refunded,
    description: c.description,
  };
}

/**
 * Every Stripe customer that belongs to this account: the one the webhook
 * recorded (when there is one) plus any whose email matches. Stripe's email
 * filter is case-sensitive, so both the address as stored and its lowercase form
 * are looked up. Deduplicated by id.
 */
export async function customerIdsFor(
  stripe: Stripe,
  email: string | null,
  recordedCustomerId: string | null,
): Promise<string[]> {
  const ids = new Set<string>();
  if (recordedCustomerId && (await stripeCustomerExists(stripe, recordedCustomerId))) {
    ids.add(recordedCustomerId);
  }
  if (email) {
    for (const e of new Set([email, email.toLowerCase()])) {
      const list = await stripe.customers.list({ email: e, limit: 10 });
      for (const c of list.data) ids.add(c.id);
    }
  }
  return [...ids];
}

export async function billingSnapshot(
  email: string | null,
  recordedCustomerId: string | null,
): Promise<{ configured: boolean; customers: CustomerSummary[]; error: string | null }> {
  const stripe = stripeAdmin();
  if (!stripe) return { configured: false, customers: [], error: null };
  try {
    const ids = await customerIdsFor(stripe, email, recordedCustomerId);
    const customers: CustomerSummary[] = [];
    for (const id of ids) {
      const customer = await stripe.customers.retrieve(id);
      if ("deleted" in customer && customer.deleted) continue;
      const [subs, charges] = await Promise.all([
        stripe.subscriptions.list({ customer: id, status: "all", limit: 10 }),
        stripe.charges.list({ customer: id, limit: 10 }),
      ]);
      customers.push({
        id,
        email: customer.email ?? null,
        created: customer.created,
        dashboardUrl: dashboardUrl(id),
        subscriptions: subs.data.map(summarizeSub),
        charges: charges.data.map(summarizeCharge),
      });
    }
    return { configured: true, customers, error: null };
  } catch (err) {
    return {
      configured: true,
      customers: [],
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function customerOf(obj: { customer: string | { id: string } | null }): string | null {
  if (!obj.customer) return null;
  return typeof obj.customer === "string" ? obj.customer : obj.customer.id;
}

/**
 * Refuse to act on a Stripe object that does not belong to the account being
 * edited. Only the administrator can reach these actions, but a stale tab or a
 * pasted id must not cancel or refund the wrong athlete.
 */
async function assertOwned(
  allowed: string[],
  customerId: string | null,
  what: string,
): Promise<void> {
  if (!customerId || !allowed.includes(customerId)) {
    throw new Error(`That ${what} does not belong to this account's Stripe customer.`);
  }
}

export async function cancelSubscription(
  stripe: Stripe,
  allowedCustomers: string[],
  subscriptionId: string,
  when: "period_end" | "now",
): Promise<void> {
  const sub = await stripe.subscriptions.retrieve(subscriptionId);
  await assertOwned(allowedCustomers, customerOf(sub), "subscription");
  if (when === "now") await stripe.subscriptions.cancel(subscriptionId);
  else await stripe.subscriptions.update(subscriptionId, { cancel_at_period_end: true });
}

export async function resumeSubscription(
  stripe: Stripe,
  allowedCustomers: string[],
  subscriptionId: string,
): Promise<void> {
  const sub = await stripe.subscriptions.retrieve(subscriptionId);
  await assertOwned(allowedCustomers, customerOf(sub), "subscription");
  await stripe.subscriptions.update(subscriptionId, { cancel_at_period_end: false });
}

/** Full refund of the charge's remaining balance. Returns the refunded amount in minor units. */
export async function refundCharge(
  stripe: Stripe,
  allowedCustomers: string[],
  chargeId: string,
): Promise<{ amount: number; currency: string }> {
  const charge = await stripe.charges.retrieve(chargeId);
  await assertOwned(allowedCustomers, customerOf(charge), "charge");
  const remaining = charge.amount - charge.amount_refunded;
  if (remaining <= 0) throw new Error("That charge has already been fully refunded.");
  const refund = await stripe.refunds.create({ charge: chargeId, amount: remaining });
  return { amount: refund.amount, currency: refund.currency };
}

/**
 * Cancel every live subscription on these customers immediately. Used before a
 * permanent delete, so nobody keeps being charged for an account that no longer
 * exists. Returns the ids it canceled.
 */
export async function cancelAllLive(stripe: Stripe, customerIds: string[]): Promise<string[]> {
  const canceled: string[] = [];
  for (const customer of customerIds) {
    const subs = await stripe.subscriptions.list({ customer, status: "all", limit: 100 });
    for (const s of subs.data) {
      if (s.status === "canceled" || s.status === "incomplete_expired") continue;
      await stripe.subscriptions.cancel(s.id);
      canceled.push(s.id);
    }
  }
  return canceled;
}

/**
 * Move a carded trial's end date. The card is charged at the NEW end, so this is
 * how an athlete who lost days to a bug gets them back without a comp. Proration
 * is off: nothing has been charged yet, so there is nothing to prorate.
 */
export async function extendTrial(
  stripe: Stripe,
  allowedCustomers: string[],
  subscriptionId: string,
  endsAtUnix: number,
): Promise<void> {
  const sub = await stripe.subscriptions.retrieve(subscriptionId);
  await assertOwned(allowedCustomers, customerOf(sub), "subscription");
  if (sub.status !== "trialing") throw new Error("That subscription isn't on a trial.");
  await stripe.subscriptions.update(subscriptionId, {
    trial_end: endsAtUnix,
    proration_behavior: "none",
  });
}

/**
 * End a carded trial now. Stripe starts the paid period immediately and CHARGES
 * THE CARD TODAY — the admin page says so before the button is reachable.
 */
export async function endTrialNow(
  stripe: Stripe,
  allowedCustomers: string[],
  subscriptionId: string,
): Promise<void> {
  const sub = await stripe.subscriptions.retrieve(subscriptionId);
  await assertOwned(allowedCustomers, customerOf(sub), "subscription");
  if (sub.status !== "trialing") throw new Error("That subscription isn't on a trial.");
  await stripe.subscriptions.update(subscriptionId, { trial_end: "now" });
}
