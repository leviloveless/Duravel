import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getStripe } from "@/lib/stripe";
import { env } from "@/lib/env";
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

  const priceId =
    selection === "annual"
      ? env.STRIPE_PRICE_ANNUAL
      : selection === "custom_monthly"
        ? env.STRIPE_PRICE_CUSTOM_MONTHLY
        : env.STRIPE_PRICE_MONTHLY;
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
