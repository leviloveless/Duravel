/**
 * What the athlete is told about the trial and the plan it rolls into
 * (2026-09-29). PURE, and shared by the pricing page and the Stripe Checkout
 * page, so the two can never describe different terms.
 *
 * Levi's rule: wherever the card is asked for, say plainly that nothing is
 * charged until the trial ends, and name the plan it becomes. The default plan
 * is Standard monthly — the pricing page opens on it and every "Start your free
 * trial" link in the app goes to that page.
 */

export type CheckoutSelection = "monthly" | "annual" | "custom_monthly" | "custom_annual";

export const DEFAULT_SELECTION: CheckoutSelection = "monthly";

const PLANS: Record<CheckoutSelection, { name: string; price: string }> = {
  monthly: { name: "Standard monthly", price: "$19.99/month" },
  annual: { name: "Standard annual", price: "$159.99/year" },
  custom_monthly: { name: "Custom monthly", price: "$29.99/month" },
  custom_annual: { name: "Custom annual", price: "$239.99/year" },
};

export function planName(selection: CheckoutSelection): string {
  return PLANS[selection].name;
}

export function planPrice(selection: CheckoutSelection): string {
  return PLANS[selection].price;
}

/** The sentence shown beside the card request, on our page and on Stripe's. */
export function trialTerms(selection: CheckoutSelection, trialDays: number): string {
  const p = PLANS[selection];
  return (
    `You won't be charged today. Your card is only charged when your ${trialDays}-day free ` +
    `trial ends — then ${p.price} on the ${p.name} plan. Cancel before the trial ends and ` +
    `you pay nothing.`
  );
}
