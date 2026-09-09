import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { getStripe } from "@/lib/stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import { env } from "@/lib/env";
import { sendEmail } from "@/lib/email/send";
import type { ReceiptProps } from "@/lib/email/templates/types";

/**
 * POST /api/stripe/webhook
 *
 * Stripe -> Duravel event sink. Verifies the signature against the RAW request
 * body, then upserts the `subscriptions` table via the service-role client
 * (RLS-bypassing). This is the ONLY writer of entitlement state, so a user can
 * never grant themselves a subscription.
 *
 * Also (07 go-live): sends the receipt email on a paid invoice (failure-isolated so a
 * mail hiccup never fails the webhook / triggers a Stripe retry), and stamps
 * `subscriptions.canceled_at` when a subscription is canceled.
 *
 * Point a Stripe webhook endpoint at this route and subscribe it to:
 *   checkout.session.completed
 *   customer.subscription.created
 *   customer.subscription.updated
 *   customer.subscription.deleted
 *   invoice.payment_succeeded   (or invoice.paid)
 */

// Always run server-side against the untouched request body; never cache.
export const dynamic = "force-dynamic";

function planFromPriceId(priceId: string | null): "monthly" | "annual" | null {
  if (!priceId) return null;
  if (priceId === env.STRIPE_PRICE_ANNUAL) return "annual";
  if (priceId === env.STRIPE_PRICE_MONTHLY) return "monthly";
  if (priceId === env.STRIPE_PRICE_CUSTOM_MONTHLY) return "monthly";
  return null;
}

/**
 * The PRODUCT LEVEL a price buys, as opposed to its billing interval.
 *
 * Deliberately fails closed: an unrecognised price id — a new one created in the
 * Stripe dashboard before the env var is set, say — reads as `standard`, so the
 * worst case is a customer who paid for custom and has to wait for a redeploy.
 * The reverse default would hand the tier to everyone the moment a price id
 * drifted, and this webhook is the only thing standing between a price and an
 * entitlement.
 */
function tierFromPriceId(priceId: string | null): "standard" | "custom" {
  if (priceId && priceId === env.STRIPE_PRICE_CUSTOM_MONTHLY) return "custom";
  return "standard";
}

async function upsertFromSubscription(sub: Stripe.Subscription) {
  const admin = createAdminClient();
  const userId = sub.metadata?.user_id;
  if (!userId) {
    console.warn(`[stripe] subscription ${sub.id} has no user_id metadata; skipping`);
    return;
  }

  const item = sub.items.data[0];
  const priceId = item?.price.id ?? null;
  // `current_period_end` lives on the subscription item in recent API versions
  // and on the subscription in older ones — read defensively across versions.
  const periodEndUnix: number | null =
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (item as any)?.current_period_end ?? (sub as any).current_period_end ?? null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cancelAt = (sub as any).cancel_at as number | null | undefined;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const canceledAtUnix = (sub as any).canceled_at as number | null | undefined;
  const isCanceled = sub.status === "canceled" || cancelAt != null;

  const { error } = await admin.from("subscriptions").upsert(
    {
      user_id: userId,
      stripe_customer_id: typeof sub.customer === "string" ? sub.customer : sub.customer.id,
      stripe_subscription_id: sub.id,
      status: sub.status,
      price_id: priceId,
      plan: planFromPriceId(priceId),
      tier: tierFromPriceId(priceId),
      current_period_end: periodEndUnix ? new Date(periodEndUnix * 1000).toISOString() : null,
      // Flexible billing mode (new API default) records a portal cancellation in
      // `cancel_at` and leaves `cancel_at_period_end` false; classic mode uses the
      // boolean. Treat either as "scheduled to cancel".
      cancel_at_period_end: Boolean(sub.cancel_at_period_end) || cancelAt != null,
      // Cancellation timestamp (win-back timing). Set when canceled; cleared on
      // reactivation so a resubscribe doesn't keep a stale stamp.
      canceled_at: isCanceled
        ? new Date((canceledAtUnix ?? Math.floor(Date.now() / 1000)) * 1000).toISOString()
        : null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" },
  );
  if (error) {
    console.error(`[stripe] failed to upsert subscription for ${userId}: ${error.message}`);
  }
}

/** Resolve the subscription id off an invoice across API versions. */
function invoiceSubscriptionId(invoice: Stripe.Invoice): string | null {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const anyInv = invoice as any;
  const direct = anyInv.subscription;
  if (typeof direct === "string") return direct;
  if (direct?.id) return direct.id;
  const nested = anyInv.parent?.subscription_details?.subscription;
  if (typeof nested === "string") return nested;
  if (nested?.id) return nested.id;
  const line = anyInv.lines?.data?.[0];
  const lineSub =
    line?.subscription ?? line?.parent?.subscription_item_details?.subscription ?? null;
  if (typeof lineSub === "string") return lineSub;
  if (lineSub?.id) return lineSub.id;
  return null;
}

function formatAmount(amountCents: number | null, currency: string | null): string {
  const value = (amountCents ?? 0) / 100;
  try {
    return value.toLocaleString("en-US", {
      style: "currency",
      currency: (currency ?? "usd").toUpperCase(),
    });
  } catch {
    return `$${value.toFixed(2)}`;
  }
}

function formatRenewal(periodEndUnix: number | null): string {
  if (!periodEndUnix) return "your next billing date";
  return new Date(periodEndUnix * 1000).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** Send the receipt for a paid invoice. Fully failure-isolated (never throws). */
async function handleInvoicePaid(stripe: Stripe, invoice: Stripe.Invoice): Promise<void> {
  try {
    const invoiceId = invoice.id;
    if (!invoiceId) return;

    const subId = invoiceSubscriptionId(invoice);
    let sub: Stripe.Subscription | null = null;
    let userId: string | null = null;
    if (subId) {
      sub = await stripe.subscriptions.retrieve(subId);
      userId = sub.metadata?.user_id ?? null;
    }
    if (!userId) {
      console.warn(
        `[stripe] invoice ${invoiceId} paid but no user_id resolvable; skipping receipt`,
      );
      return;
    }

    const item = sub?.items.data[0];
    const priceId = item?.price.id ?? null;
    const plan = planFromPriceId(priceId);
    const planLabel =
      plan === "annual" ? "Duravel Annual" : plan === "monthly" ? "Duravel Monthly" : "Duravel";

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const periodEndUnix: number | null =
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (item as any)?.current_period_end ??
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (invoice as any).period_end ??
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (invoice as any).lines?.data?.[0]?.period?.end ??
      null;

    // First name for the greeting (service email; resolve from profiles via admin).
    const admin = createAdminClient();
    const { data: profile } = await admin
      .from("profiles")
      .select("first_name")
      .eq("id", userId)
      .maybeSingle();
    const firstName = (profile as { first_name?: string | null } | null)?.first_name ?? "there";

    const appUrl = env.NEXT_PUBLIC_SITE_URL ?? "https://duravel.app";
    const props: ReceiptProps = {
      firstName,
      planLabel,
      amount: formatAmount(invoice.amount_paid, invoice.currency),
      renewalDate: formatRenewal(periodEndUnix),
      planUrl: `${appUrl}/dashboard`,
      invoiceUrl: invoice.hosted_invoice_url ?? `${appUrl}/settings`,
      billingPortalUrl: `${appUrl}/settings`,
      manageUrl: `${appUrl}/settings/email`,
    };

    await sendEmail({
      userId,
      template: "receipt",
      dedup: { template: "receipt", invoiceId },
      render: { template: "receipt", props },
      meta: { flow: "receipt", invoice: invoiceId },
    });
  } catch (err) {
    // Never fail the webhook over a receipt — Stripe would retry the whole event.
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[stripe] receipt send failed for invoice ${invoice.id}: ${message}`);
  }
}

export async function POST(request: Request) {
  if (!env.STRIPE_WEBHOOK_SECRET) {
    return NextResponse.json({ error: "Webhook not configured" }, { status: 500 });
  }
  const signature = request.headers.get("stripe-signature");
  if (!signature) {
    return NextResponse.json({ error: "Missing signature" }, { status: 400 });
  }

  const rawBody = await request.text();
  const stripe = getStripe();

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    const message = err instanceof Error ? err.message : "invalid signature";
    return NextResponse.json(
      { error: `Webhook signature verification failed: ${message}` },
      { status: 400 },
    );
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        if (session.mode === "subscription" && session.subscription) {
          const subId =
            typeof session.subscription === "string"
              ? session.subscription
              : session.subscription.id;
          const sub = await stripe.subscriptions.retrieve(subId);
          // Backfill user_id from the session if the sub metadata is empty.
          if (!sub.metadata?.user_id && session.client_reference_id) {
            sub.metadata = { ...sub.metadata, user_id: session.client_reference_id };
          }
          await upsertFromSubscription(sub);
        }
        break;
      }
      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        await upsertFromSubscription(event.data.object as Stripe.Subscription);
        break;
      }
      case "invoice.payment_succeeded":
      case "invoice.paid": {
        await handleInvoicePaid(stripe, event.data.object as Stripe.Invoice);
        break;
      }
      default:
        // Acknowledge unhandled types so Stripe stops retrying them.
        break;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "handler error";
    console.error(`[stripe] handler failed for ${event.type}: ${message}`);
    return NextResponse.json({ error: "handler error" }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}
