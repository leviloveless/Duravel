import "server-only";
import type Stripe from "stripe";
import type { SupabaseClient } from "@supabase/supabase-js";
import { env } from "@/lib/env";
import { getStripe } from "@/lib/stripe";
import { pricesFromEnv, resolvePrice } from "@/lib/stripe-prices";
import { TRIAL_DAYS } from "@/lib/billing-constants";
import { sendEmail, type SendResult } from "../send";
import {
  endingNoticeDue,
  formatCharge,
  formatChargeDate,
  perInterval,
  planLabelFor,
  type TrialNoticeKind,
} from "../trial-notice";
import type { TrialNoticeProps } from "../templates/types";

/**
 * Sends the carded-trial notices (2026-09-28). The rules are pure and live in
 * ../trial-notice.ts; this file is the I/O: read the subscription from Stripe,
 * work out what will actually be charged, and hand one job to `sendEmail`,
 * which does the flag / suppression / idempotency / late re-check.
 *
 * The amount comes from Stripe's invoice PREVIEW for the subscription, so a
 * promo code or tax is reflected — the email states what the card will really
 * be charged. If the preview fails, the price's list amount is used instead.
 */

async function chargeFor(
  stripe: Stripe,
  sub: Stripe.Subscription,
): Promise<{ amount: number; currency: string; interval: string | null }> {
  const price = sub.items.data[0]?.price;
  const interval = price?.recurring?.interval ?? null;
  try {
    const preview = await stripe.invoices.createPreview({ subscription: sub.id });
    return { amount: preview.amount_due, currency: preview.currency, interval };
  } catch {
    return { amount: price?.unit_amount ?? 0, currency: price?.currency ?? "usd", interval };
  }
}

/**
 * One notice for one Stripe subscription. Never throws — a mail problem must not
 * fail a Stripe webhook (Stripe would retry the whole event) or the cron.
 */
export async function sendTrialNotice(
  stripe: Stripe,
  admin: SupabaseClient,
  subscriptionId: string,
  kind: TrialNoticeKind,
): Promise<SendResult | { status: "skipped"; reason: string }> {
  try {
    // Re-read: a webhook payload can be minutes old, and someone who cancelled
    // since must not be told a charge is coming.
    const sub = await stripe.subscriptions.retrieve(subscriptionId);
    const userId = sub.metadata?.user_id;
    if (!userId) return { status: "skipped", reason: "no_user_id" };
    if (sub.status !== "trialing" || !sub.trial_end) {
      return { status: "skipped", reason: "not_trialing" };
    }

    const [{ amount, currency, interval }, profileRes] = await Promise.all([
      chargeFor(stripe, sub),
      admin.from("profiles").select("first_name, timezone").eq("id", userId).maybeSingle(),
    ]);
    const profile = profileRes.data as {
      first_name?: string | null;
      timezone?: string | null;
    } | null;
    const { plan, tier } = resolvePrice(sub.items.data[0]?.price.id ?? null, pricesFromEnv());

    const appUrl = env.NEXT_PUBLIC_SITE_URL ?? "https://duravel.app";
    const props: TrialNoticeProps = {
      kind,
      firstName: profile?.first_name || "there",
      planLabel: planLabelFor(plan, tier),
      priceLine: `${formatCharge(amount, currency)}${perInterval(interval)}`,
      chargeDate: formatChargeDate(sub.trial_end, profile?.timezone ?? null),
      trialDays: TRIAL_DAYS,
      cancelUrl: `${appUrl}/settings`,
      planUrl: `${appUrl}/dashboard`,
      manageUrl: `${appUrl}/settings/email`,
    };

    return await sendEmail({
      userId,
      template: "trial_notice",
      dedup: {
        template: "trial_notice",
        kind,
        subscriptionId: sub.id,
        trialEndUnix: sub.trial_end,
      },
      render: { template: "trial_notice", props },
      trialState: {
        status: sub.status,
        cancelAtPeriodEnd: Boolean(sub.cancel_at_period_end) || sub.cancel_at != null,
        trialEndMs: sub.trial_end * 1000,
      },
      meta: { flow: `trial_notice_${kind}`, subscription: sub.id, trial_end: sub.trial_end },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[email] trial notice (${kind}) failed for ${subscriptionId}: ${message}`);
    return { status: "failed", reason: message };
  }
}

export interface TrialReminderSummary {
  candidates: number;
  due: number;
  sent: number;
  skipped: number;
  failed: number;
  stripeConfigured: boolean;
}

/**
 * Daily backstop for the "ending" notice. Stripe's `trial_will_end` event is the
 * primary trigger; this catches anyone it missed (the event not enabled on the
 * endpoint, a delivery that failed for good). The shared idempotency key means a
 * reminder the webhook already sent is skipped here as a duplicate.
 */
export async function runTrialReminderFlow(
  admin: SupabaseClient,
  nowMs: number,
): Promise<TrialReminderSummary> {
  const summary: TrialReminderSummary = {
    candidates: 0,
    due: 0,
    sent: 0,
    skipped: 0,
    failed: 0,
    stripeConfigured: !!env.STRIPE_SECRET_KEY,
  };
  if (!env.STRIPE_SECRET_KEY) return summary;
  const stripe = getStripe();

  const from = new Date(nowMs).toISOString();
  const to = new Date(nowMs + 4 * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await admin
    .from("subscriptions")
    .select("user_id, stripe_subscription_id, status, current_period_end, cancel_at_period_end")
    .eq("status", "trialing")
    .gte("current_period_end", from)
    .lte("current_period_end", to);
  if (error) {
    console.error(`[email] trial reminder query failed: ${error.message}`);
    return summary;
  }
  const rows = (data ?? []) as Array<{
    user_id: string;
    stripe_subscription_id: string | null;
    status: string;
    current_period_end: string | null;
    cancel_at_period_end: boolean | null;
  }>;
  summary.candidates = rows.length;

  for (const row of rows) {
    const due = endingNoticeDue(
      {
        status: row.status,
        cancelAtPeriodEnd: row.cancel_at_period_end === true,
        trialEndMs: row.current_period_end ? new Date(row.current_period_end).getTime() : null,
      },
      nowMs,
    );
    if (!due || !row.stripe_subscription_id) continue;
    summary.due++;
    let result: { status: string };
    try {
      result = await sendTrialNotice(stripe, admin, row.stripe_subscription_id, "ending");
    } catch (err) {
      console.error(
        `[email] trial reminder: could not read ${row.stripe_subscription_id}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      result = { status: "failed" };
    }
    if (result.status === "sent") summary.sent++;
    else if (result.status === "failed") summary.failed++;
    else summary.skipped++;
  }
  return summary;
}
