import { createClient } from "@/lib/supabase/server";
import { env, envFlag } from "@/lib/env";

/**
 * Subscription / entitlement helpers (billing).
 *
 * `subscriptions` is written only by the Stripe webhook (service role). Reads go
 * through the normal RLS-scoped server client, so a user only ever sees their own
 * row.
 *
 * Free trial: a 7-day trial that REQUIRES A CARD, run by Stripe
 * (`trial_period_days` on the Checkout session) rather than by this file.
 *
 * ## What changed on 2026-09-20, and why
 *
 * It used to be a 14-day NO-CARD trial enforced here, app-side, starting when
 * the `profiles` row was created. That is the opposite of what the numbers want.
 * Opt-in trials convert at roughly 4-6%; opt-out (card-required) at 25-35% — and
 * measured end to end, accounting for the smaller number of people willing to
 * hand over a card, opt-out still produces about 2.9x more paying customers per
 * thousand visitors. On Levi's pricing that is the difference between a ~$140
 * cost per paying customer and a ~$48 one, which is the difference between
 * being unable to advertise and being able to.
 *
 * Seven days rather than fourteen because a fortnight is a long time to forget
 * you started something, and a forgotten trial becomes a surprise $19.99 and a
 * Stripe dispute. The reminder emails matter more than the length.
 *
 * ## Where the card is asked for, which is the part that is easy to get wrong
 *
 * NOT at signup. The athlete signs up, onboards, and the engine builds them a
 * real 16-week program; `gateProgramWeeks` then shows them the first
 * `FREE_PREVIEW_WEEKS` of it and the paywall asks for the card. Contextual
 * capture like that keeps roughly 3x more trial starts than asking upfront,
 * because the ask lands after there is something worth paying for rather than
 * against an empty form.
 *
 * ⚠️ That flow only works because the app-side trial is GONE. While
 * `getEntitlement` handed every new profile a free window, a brand-new user was
 * `entitled` and the paywall never fired — the gate existed and was unreachable.
 * Deleting the app-side trial is what turns the paywall on, not any new code.
 *
 * Entitlement is therefore: billing off, OR a live subscription — where
 * "live" includes Stripe's own `trialing`, which is what a carded trial is.
 */

export type Plan = "monthly" | "annual";

/**
 * Product level — distinct from `Plan`, which is the billing INTERVAL.
 *
 * Until 2026-09-08 entitlement was binary and `plan` was the only axis, because
 * there was only one thing to buy. The custom tier ($39.99/mo — an athlete
 * authors their own training week and the engine periodizes it) sits above the
 * standard plan, so the app now has to know which product someone holds as well
 * as how often they pay for it.
 *
 * `custom` implies `standard` and never the reverse. Nothing else in the ladder;
 * add a rung here and in `TIER_RANK` together.
 */
export type Tier = "standard" | "custom";

const TIER_RANK: Record<Tier, number> = { standard: 0, custom: 1 };

export type SubscriptionRow = {
  status:
    | "incomplete"
    | "incomplete_expired"
    | "trialing"
    | "active"
    | "past_due"
    | "canceled"
    | "unpaid"
    | "paused";
  plan: Plan | null;
  tier: Tier;
  price_id: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
};

const ENTITLED_STATUSES = new Set(["active", "trialing"]);

// The trial length lives in `billing-constants.ts` — see that file for why — and
// is re-exported here so every existing `from "@/lib/subscription"` still works.
export { TRIAL_DAYS } from "./billing-constants";
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Whether subscription gating is enforced. OFF by default so nothing is paywalled
 * until you set BILLING_ENABLED=true — lets you ship the Stripe plumbing and test
 * checkout end-to-end before flipping the app to paid.
 */
export const billingEnabled = envFlag(env.BILLING_ENABLED);

/** The signed-in user's subscription row, or null. */
export async function getSubscription(): Promise<SubscriptionRow | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data } = await supabase
    .from("subscriptions")
    .select("status, plan, tier, price_id, current_period_end, cancel_at_period_end")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!data) return null;
  // A row written before migration 0045 has no tier. Reading it as `standard`
  // rather than null keeps every pre-existing subscriber exactly where they were.
  const row = data as Partial<SubscriptionRow>;
  return { ...row, tier: row.tier ?? "standard" } as SubscriptionRow;
}

/**
 * Whether a subscription row is live — PURE, so it can be tested.
 *
 * `trialing` counts, which is the whole basis of the carded trial: Stripe holds
 * the card, charges nothing until the trial ends, and reports `trialing` the
 * entire time. An expired period does not count whatever the status says, which
 * covers the window between a failed renewal and the webhook catching up.
 */
export function subscriptionIsLive(sub: SubscriptionRow | null, now: number = Date.now()): boolean {
  if (!sub) return false;
  if (!ENTITLED_STATUSES.has(sub.status)) return false;
  if (sub.current_period_end && new Date(sub.current_period_end).getTime() < now) return false;
  return true;
}

/** True when the caller has a live subscription (active/trialing, not expired). */
export async function hasActiveSubscription(): Promise<boolean> {
  return subscriptionIsLive(await getSubscription());
}

export type EntitlementReason = "billing_off" | "subscription" | "trial" | "none";

export type Entitlement = {
  entitled: boolean;
  reason: EntitlementReason;
  /**
   * The product level this entitlement grants.
   *
   * Note what the trial grants: `standard`, not `custom`. An athlete who designs
   * a custom week on day 3 and loses it on day 15 has had a worse experience
   * than one who was never offered it — the feature is not a taste of the
   * product, it is a thing you build and then own. `billing_off` grants `custom`
   * because that path exists for pre-launch testing, where gating nothing is the
   * whole point.
   */
  tier: Tier;
  /** ISO timestamp the trial ends, when the user has (or had) a trial. */
  trialEndsAt: string | null;
  /** Whole days left in the trial (0 once expired); null when no trial applies. */
  trialDaysLeft: number | null;
};

/**
 * Full entitlement status for the signed-in user. Drives both the server gate
 * (isEntitled) and trial UI (dashboard banner, pricing page):
 *
 *   billing off             → always entitled (pre-launch / testing)
 *   active subscription     → entitled
 *   Stripe `trialing`       → entitled, with days remaining
 *   no subscription at all  → NOT entitled, and this is the common case
 *
 * ⚠️ THE LAST LINE IS THE WHOLE FEATURE. A freshly onboarded athlete with no
 * card on file is not entitled, so `gateProgramWeeks` truncates their program to
 * the preview and the paywall asks for a card. Reinstating any app-side grace
 * window here silently disables the paywall everywhere — that is exactly what
 * the old 14-day no-card trial did.
 */
/**
 * Entitlement from a subscription row — PURE, so it can actually be tested.
 *
 * Separated from `getEntitlement` on 2026-09-20 because this function decides
 * whether an athlete can see the program they paid for, and until then it was
 * reachable only through two Supabase round-trips and was therefore covered by
 * no test whatsoever. Getting it wrong in one direction gives the product away;
 * in the other it locks out someone who is paying.
 */
export function entitlementFor(
  sub: SubscriptionRow | null,
  opts: { billingEnabled: boolean; now?: number },
): Entitlement {
  const now = opts.now ?? Date.now();
  if (!opts.billingEnabled) {
    return {
      entitled: true,
      reason: "billing_off",
      tier: "custom",
      trialEndsAt: null,
      trialDaysLeft: null,
    };
  }

  // A carded trial IS a live subscription to Stripe and to this app — `trialing`
  // is in ENTITLED_STATUSES. The only thing that sets it apart for the UI is the
  // countdown, and that comes off `current_period_end`: during a trial Stripe
  // sets the period end TO the trial end, so there is no second date to keep in
  // step with anything.
  const trialing = sub?.status === "trialing";
  const trialEndsAt = trialing ? (sub?.current_period_end ?? null) : null;

  if (subscriptionIsLive(sub, now)) {
    return {
      entitled: true,
      reason: trialing ? "trial" : "subscription",
      tier: sub?.tier ?? "standard",
      trialEndsAt,
      trialDaysLeft: trialEndsAt
        ? Math.max(0, Math.ceil((new Date(trialEndsAt).getTime() - now) / DAY_MS))
        : null,
    };
  }

  // Everyone else: onboarded but never carded, or a subscription that lapsed.
  // Both see the preview and the paywall, and that is the INTENDED state rather
  // than an edge case — see the note on `getEntitlement` below.
  return {
    entitled: false,
    reason: "none",
    tier: "standard",
    trialEndsAt,
    trialDaysLeft: trialEndsAt ? 0 : null,
  };
}

export async function getEntitlement(): Promise<Entitlement> {
  // One round-trip, not two: this used to call `getSubscription()` and then
  // `hasActiveSubscription()`, which fetched the same row again.
  return entitlementFor(billingEnabled ? await getSubscription() : null, { billingEnabled });
}

/**
 * Whether the signed-in user holds at least `tier`.
 *
 * Entitlement first: an expired subscriber holds no tier at all, whatever their
 * last row said. Then rank, so `custom` satisfies a `standard` requirement.
 */
export async function hasTier(tier: Tier): Promise<boolean> {
  const e = await getEntitlement();
  if (!e.entitled) return false;
  return TIER_RANK[e.tier] >= TIER_RANK[tier];
}

/**
 * Gate for paid features:
 *   - billing disabled → always allowed (pre-launch / testing)
 *   - billing enabled  → allowed with a live subscription OR an active free trial
 */
export async function isEntitled(): Promise<boolean> {
  return (await getEntitlement()).entitled;
}
