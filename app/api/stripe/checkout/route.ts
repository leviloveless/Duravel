import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getStripe } from "@/lib/stripe";
import { env } from "@/lib/env";
import { customTierIsPurchasable, pricesFromEnv } from "@/lib/stripe-prices";
import type { Plan } from "@/lib/subscription";

/**
 * POST /api/stripe/checkout  { plan: "monthly" | "annual" | "custom_monthly" }
 *
 * Creates a Stripe Checkout Session (subscription mode) for the signed-in user
 * and returns its URL; the client redirects the browser to it. We stamp the
 * user's id onto the session (client_reference_id + metadata) and the
 * subscription (subscription_data.metadata) so the webhook can map Stripe events
 * back to a HyroxAI user without a separate lookup.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  // The wire value names the PRICE the athlete clicked, which is a tier and an
  // interval together; `plan` and `tier` are separated again on the way into the
  // database by the webhook, from the price id. Keeping one value here means the
  // client never gets to assert its own tier — it names a button, the price it
  // maps to is decided server-side, and Stripe tells the webhook what was
  // actually paid for. That is the only ordering in which a client cannot grant
  // itself an entitlement.
  type Selection = Plan | "custom_monthly";
  let selection: Selection | undefined;
  try {
    const body = await request.json();
    if (body?.plan === "monthly" || body?.plan === "annual" || body?.plan === "custom_monthly")
      selection = body.plan;
  } catch {
    /* fall through to 400 */
  }
  if (!selection) {
    return NextResponse.json(
      { error: "plan must be 'monthly', 'annual' or 'custom_monthly'" },
      { status: 400 },
    );
  }

  // "This plan is not on sale yet" and "billing is broken" are two different
  // things and used to answer with the same 500 and the same opaque sentence.
  //
  // The custom tier's price genuinely does not exist yet, so a request for it is
  // an ordinary, expected outcome rather than a server fault — the pricing page
  // will not offer a checkout button for it while that is true, so anything
  // reaching here is a stale tab or a direct caller. It gets a 409 and a sentence
  // a person can act on, because a 5xx would put a real visitor in front of
  // "something went wrong" for a state that is entirely under our control and
  // completely normal.
  //
  // A missing monthly or annual price id stays a 500: those are LIVE and paid
  // for, so their absence is a genuine misconfiguration of a running product and
  // should read as an outage, not as a polite decline.
  const prices = pricesFromEnv();
  if (selection === "custom_monthly" && !customTierIsPurchasable(prices)) {
    return NextResponse.json(
      {
        error:
          "The custom plan isn't available to buy yet — we're still setting it up. " +
          "The monthly and annual plans are ready now.",
      },
      { status: 409 },
    );
  }

  const priceId =
    selection === "annual"
      ? prices.annual
      : selection === "custom_monthly"
        ? prices.customMonthly
        : prices.monthly;
  if (!priceId) {
    return NextResponse.json({ error: "Billing is not configured" }, { status: 500 });
  }

  const origin =
    env.NEXT_PUBLIC_SITE_URL ?? request.headers.get("origin") ?? "http://localhost:3000";

  // Reuse an existing Stripe customer if we already have one for this user, so a
  // returning subscriber doesn't create a duplicate customer record.
  const { data: existing } = await supabase
    .from("subscriptions")
    .select("stripe_customer_id")
    .eq("user_id", user.id)
    .maybeSingle();

  const stripe = getStripe();
  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    line_items: [{ price: priceId, quantity: 1 }],
    ...(existing?.stripe_customer_id
      ? { customer: existing.stripe_customer_id }
      : { customer_email: user.email ?? undefined }),
    client_reference_id: user.id,
    subscription_data: { metadata: { user_id: user.id } },
    metadata: { user_id: user.id, plan: selection },
    allow_promotion_codes: true,
    success_url: `${origin}/dashboard?checkout=success`,
    cancel_url: `${origin}/pricing?checkout=cancelled`,
  });

  return NextResponse.json({ url: session.url });
}
