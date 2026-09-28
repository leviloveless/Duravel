import type Stripe from "stripe";
import { stripeAdmin } from "@/lib/admin-billing";
import type { PromoPlan } from "@/lib/admin-account-rules";

/**
 * Promotion codes, created in Stripe (2026-09-27).
 *
 * A Stripe promo is two objects: a COUPON (the discount: 20% off, once) and a
 * PROMOTION CODE (the thing an athlete types: GYM20, with its own limits). This
 * creates both, one coupon per code, so deactivating a code never disturbs
 * another code's discount.
 *
 * Checkout already sets `allow_promotion_codes: true` (2026-09-20), so a code made
 * here can be typed on Stripe's checkout page straight away.
 */

export type PromoSummary = {
  id: string;
  code: string;
  active: boolean;
  timesRedeemed: number;
  maxRedemptions: number | null;
  expiresAt: number | null;
  created: number;
  firstTimeOnly: boolean;
  discount: string;
};

function describeCoupon(c: Stripe.Coupon | string | null): string {
  if (!c || typeof c === "string") return "—";
  const off =
    c.percent_off !== null && c.percent_off !== undefined
      ? `${c.percent_off}% off`
      : c.amount_off !== null && c.amount_off !== undefined
        ? `$${(c.amount_off / 100).toFixed(2)} off`
        : "discount";
  const how =
    c.duration === "repeating"
      ? `for ${c.duration_in_months ?? "?"} months`
      : c.duration === "forever"
        ? "forever"
        : "once";
  return `${off}, ${how}`;
}

export async function listPromos(): Promise<{
  configured: boolean;
  promos: PromoSummary[];
  error: string | null;
}> {
  const stripe = stripeAdmin();
  if (!stripe) return { configured: false, promos: [], error: null };
  try {
    const list = await stripe.promotionCodes.list({ limit: 50, expand: ["data.promotion.coupon"] });
    return {
      configured: true,
      error: null,
      promos: list.data.map((p) => ({
        id: p.id,
        code: p.code,
        active: p.active,
        timesRedeemed: p.times_redeemed,
        maxRedemptions: p.max_redemptions,
        expiresAt: p.expires_at,
        created: p.created,
        firstTimeOnly: p.restrictions.first_time_transaction,
        discount: describeCoupon(p.promotion.coupon),
      })),
    };
  } catch (err) {
    return {
      configured: true,
      promos: [],
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Create the coupon, then the code. If the code fails (most often: that code
 * already exists), the coupon just made is deleted again rather than left as an
 * orphan in the Stripe dashboard.
 */
export async function createPromo(plan: PromoPlan): Promise<{ promoId: string; couponId: string }> {
  const stripe = stripeAdmin();
  if (!stripe) throw new Error("Stripe is not configured (STRIPE_SECRET_KEY).");
  const coupon = await stripe.coupons.create({
    ...plan.discount,
    duration: plan.duration,
    ...(plan.durationInMonths ? { duration_in_months: plan.durationInMonths } : {}),
    name: plan.code,
  });
  try {
    const promo = await stripe.promotionCodes.create({
      promotion: { type: "coupon", coupon: coupon.id },
      code: plan.code,
      ...(plan.maxRedemptions ? { max_redemptions: plan.maxRedemptions } : {}),
      ...(plan.expiresAt ? { expires_at: plan.expiresAt } : {}),
      ...(plan.firstTimeOnly ? { restrictions: { first_time_transaction: true } } : {}),
    });
    return { promoId: promo.id, couponId: coupon.id };
  } catch (err) {
    await stripe.coupons.del(coupon.id).catch(() => undefined);
    throw err;
  }
}

export async function setPromoActive(promoId: string, active: boolean): Promise<string> {
  const stripe = stripeAdmin();
  if (!stripe) throw new Error("Stripe is not configured (STRIPE_SECRET_KEY).");
  const promo = await stripe.promotionCodes.update(promoId, { active });
  return promo.code;
}
