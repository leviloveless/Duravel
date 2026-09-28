import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getStripe } from "@/lib/stripe";
import { stripeCustomerExists } from "@/lib/stripe-customer";
import { env } from "@/lib/env";

/**
 * POST /api/stripe/portal
 *
 * Opens the Stripe Billing Portal so the user can update their card, switch plan,
 * or cancel. Returns the portal URL for the client to redirect to.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { data: sub } = await supabase
    .from("subscriptions")
    .select("stripe_customer_id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!sub?.stripe_customer_id) {
    return NextResponse.json({ error: "No billing account found" }, { status: 404 });
  }

  const origin =
    env.NEXT_PUBLIC_SITE_URL ?? request.headers.get("origin") ?? "http://localhost:3000";

  const stripe = getStripe();
  // Recorded under the other Stripe mode (the July test pass): there is no
  // billing account under this key, so answer as if none were recorded.
  if (!(await stripeCustomerExists(stripe, sub.stripe_customer_id))) {
    return NextResponse.json({ error: "No billing account found" }, { status: 404 });
  }
  const portal = await stripe.billingPortal.sessions.create({
    customer: sub.stripe_customer_id,
    return_url: `${origin}/dashboard`,
  });

  return NextResponse.json({ url: portal.url });
}
