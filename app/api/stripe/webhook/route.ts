import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { getStripe } from "@/lib/stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import { env } from "@/lib/env";

/**
 * POST /api/stripe/webhook
 *
 * Stripe -> HyroxAI event sink. Verifies the signature against the RAW request
 * body, then upserts the `subscriptions` table via the service-role client
 * (RLS-bypassing). This is the ONLY writer of entitlement state, so a user can
 * never grant themselves a subscription.
 *
 * Point a Stripe webhook endpoint at this route and subscribe it to:
 *   checkout.session.completed
 *   customer.subscription.created
 *   customer.subscription.updated
 *   customer.subscription.deleted
 */

// Always run server-side against the untouched request body; never cache.
export const dynamic = "force-dynamic";

function planFromPriceId(priceId: string | null): "monthly" | "annual" | null {
  if (!priceId) return null;
  if (priceId === env.STRIPE_PRICE_ANNUAL) return "annual";
  if (priceId === env.STRIPE_PRICE_MONTHLY) return "monthly";
  return null;
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

  const { error } = await admin.from("subscriptions").upsert(
    {
      user_id: userId,
      stripe_customer_id:
        typeof sub.customer === "string" ? sub.customer : sub.customer.id,
      stripe_subscription_id: sub.id,
      status: sub.status,
      price_id: priceId,
      plan: planFromPriceId(priceId),
      current_period_end: periodEndUnix
        ? new Date(periodEndUnix * 1000).toISOString()
        : null,
      cancel_at_period_end: sub.cancel_at_period_end,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" },
  );
  if (error) {
    console.error(`[stripe] failed to upsert subscription for ${userId}: ${error.message}`);
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
