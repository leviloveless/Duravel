import { createClient } from "@/lib/supabase/server";
import { env } from "@/lib/env";

/**
 * Subscription / entitlement helpers (billing).
 *
 * `subscriptions` is written only by the Stripe webhook (service role). Reads go
 * through the normal RLS-scoped server client, so a user only ever sees their own
 * row.
 *
 * Free trial: every user gets a 14-day, no-card trial that starts when their
 * `profiles` row is created (onboarding). It's enforced here, app-side — there is
 * deliberately no Stripe trial, so the trial never requires a card. Entitlement is
 * therefore: billing off, OR a live subscription, OR still inside the trial window.
 */

export type Plan = "monthly" | "annual";

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
  price_id: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
};

const ENTITLED_STATUSES = new Set(["active", "trialing"]);

/** Length of the no-card free trial, in days. */
export const TRIAL_DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Whether subscription gating is enforced. OFF by default so nothing is paywalled
 * until you set BILLING_ENABLED=true — lets you ship the Stripe plumbing and test
 * checkout end-to-end before flipping the app to paid.
 */
export const billingEnabled = env.BILLING_ENABLED === "true";

/** The signed-in user's subscription row, or null. */
export async function getSubscription(): Promise<SubscriptionRow | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data } = await supabase
    .from("subscriptions")
    .select("status, plan, price_id, current_period_end, cancel_at_period_end")
    .eq("user_id", user.id)
    .maybeSingle();
  return (data as SubscriptionRow | null) ?? null;
}

/** True when the caller has a live subscription (active/trialing, not expired). */
export async function hasActiveSubscription(): Promise<boolean> {
  const sub = await getSubscription();
  if (!sub) return false;
  if (!ENTITLED_STATUSES.has(sub.status)) return false;
  if (
    sub.current_period_end &&
    new Date(sub.current_period_end).getTime() < Date.now()
  ) {
    return false;
  }
  return true;
}

/** The signed-in user's trial start (profiles.trial_started_at), or null. */
async function getTrialStartedAt(): Promise<string | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data } = await supabase
    .from("profiles")
    .select("trial_started_at")
    .eq("id", user.id)
    .maybeSingle();
  const started = (data as { trial_started_at?: string } | null)?.trial_started_at;
  return started ?? null;
}

export type EntitlementReason = "billing_off" | "subscription" | "trial" | "none";

export type Entitlement = {
  entitled: boolean;
  reason: EntitlementReason;
  /** ISO timestamp the trial ends, when the user has (or had) a trial. */
  trialEndsAt: string | null;
  /** Whole days left in the trial (0 once expired); null when no trial applies. */
  trialDaysLeft: number | null;
};

/**
 * Full entitlement status for the signed-in user. Drives both the server gate
 * (isEntitled) and trial UI (dashboard banner, pricing page):
 *
 *   billing off        → always entitled (pre-launch / testing)
 *   live subscription  → entitled
 *   inside trial        → entitled, with days remaining
 *   trial ended / none  → not entitled
 */
export async function getEntitlement(): Promise<Entitlement> {
  if (!billingEnabled) {
    return { entitled: true, reason: "billing_off", trialEndsAt: null, trialDaysLeft: null };
  }
  if (await hasActiveSubscription()) {
    return { entitled: true, reason: "subscription", trialEndsAt: null, trialDaysLeft: null };
  }
  const startedAt = await getTrialStartedAt();
  if (startedAt) {
    const endMs = new Date(startedAt).getTime() + TRIAL_DAYS * DAY_MS;
    const msLeft = endMs - Date.now();
    const trialEndsAt = new Date(endMs).toISOString();
    if (msLeft > 0) {
      return {
        entitled: true,
        reason: "trial",
        trialEndsAt,
        trialDaysLeft: Math.ceil(msLeft / DAY_MS),
      };
    }
    return { entitled: false, reason: "none", trialEndsAt, trialDaysLeft: 0 };
  }
  // No profile yet (hasn't onboarded) → nothing to gate here.
  return { entitled: false, reason: "none", trialEndsAt: null, trialDaysLeft: null };
}

/**
 * Gate for paid features:
 *   - billing disabled → always allowed (pre-launch / testing)
 *   - billing enabled  → allowed with a live subscription OR an active free trial
 */
export async function isEntitled(): Promise<boolean> {
  return (await getEntitlement()).entitled;
}
