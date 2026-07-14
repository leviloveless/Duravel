import Stripe from "stripe";
import { env } from "@/lib/env";

/**
 * Server-side Stripe client (billing / monetization).
 *
 * SERVER ONLY — never import into a Client Component; STRIPE_SECRET_KEY must stay
 * off the browser. Billing env vars are optional at boot so the app still runs
 * before Stripe is configured; the first use here throws a clear error if the
 * key is missing. Lazily instantiated and cached.
 */
let _stripe: Stripe | null = null;

export function getStripe(): Stripe {
  if (_stripe) return _stripe;
  if (!env.STRIPE_SECRET_KEY) {
    throw new Error(
      "STRIPE_SECRET_KEY is not set — configure the Stripe env vars to enable billing.",
    );
  }
  // No hard-pinned apiVersion: inherit the account default from the Stripe
  // Dashboard so the bundled SDK types and the account stay in lockstep.
  _stripe = new Stripe(env.STRIPE_SECRET_KEY, { typescript: true });
  return _stripe;
}
