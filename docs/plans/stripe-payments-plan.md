# Stripe payments + payment page — plan and current state

_Tasks addition #2. Written July 2026._

## Status: already implemented and LIVE

Stripe was integrated and went live on 2026‑07‑14. This document records the architecture, confirms the payment page exists, and lists the hardening/next steps rather than proposing a build from scratch — the core of the task is done.

### What's already in place

- **Payment page** — `app/pricing/page.tsx` + `app/pricing/pricing-plans.tsx`. Shows the two plans ($19.99/month, $159.99/year — "about $13.33/mo"), a 14‑day no‑card free trial, the feature list, and a checkout button. Returning subscribers see a manage‑subscription state instead.
- **Checkout** — `POST /api/stripe/checkout` creates a Stripe Checkout Session in subscription mode for the signed‑in user, reusing an existing Stripe customer when present, and stamps `client_reference_id` + `subscription_data.metadata.user_id` so webhook events map back to a Duravel user with no extra lookup. Prices resolve from `STRIPE_PRICE_MONTHLY` / `STRIPE_PRICE_ANNUAL`.
- **Billing portal** — `app/api/stripe/portal` opens the Stripe Customer Portal so users self‑serve upgrades, downgrades, payment‑method changes, and cancellation.
- **Webhook** — `app/api/stripe/webhook` is the **sole entitlement writer**: it listens to Stripe subscription lifecycle events and writes the `subscriptions` table (status, plan, customer id, period). The app never grants access from the client. `BILLING_ENABLED=true` gates the flow.
- **Supporting libs** — `lib/stripe.ts` (client), `lib/subscription.ts` (Plan type + entitlement helpers), `lib/env.ts` (validates the Stripe env vars).
- **Pricing** — Stripe holds the Price objects; annual moved to $159.99 on 2026‑07‑17 and `STRIPE_PRICE_ANNUAL` points at it. Existing annual subscribers keep $149 until they resubscribe.

### Architecture principle (keep this)

The server‑side webhook is the single source of subscription truth. Every future payment surface (the iOS app, promo codes, an annual‑upgrade flow) must route entitlement through that webhook, never write access directly from a client. This is what keeps billing correct across web and, later, mobile.

## Remaining / hardening steps

1. **Dunning + failed payments** — confirm the webhook handles `invoice.payment_failed` and `customer.subscription.past_due` (soft‑lock the account, prompt to update card). This overlaps the lifecycle‑email work (a payment‑failed email is one of the planned triggers).
2. **Proration / plan switching** — verify monthly↔annual switches proration behavior through the portal matches intent.
3. **Tax** — enable Stripe Tax if selling into jurisdictions that require sales tax/VAT on digital subscriptions.
4. **Receipts** — wire the receipt email (already a built lifecycle template) to the Stripe `invoice.paid` event when email goes live.
5. **Entity update** — when the Mercury business account opens, repoint Stripe payouts and update the Stripe business entity to Duravel LLC + EIN (this is the commingling‑closing step already tracked in the Mercury post‑approval checklist).

## Interaction with the App Store plan (#1)

On the web, Stripe stays the payment rail with 0% platform fee. Inside a future iOS app, Apple's rules apply: launch US‑first with an **external purchase link** to this same Stripe checkout (no Apple commission as of the 2025 ruling), and add StoreKit IAP as a fallback before international expansion. Either way, entitlement continues to be written server‑side by the Stripe webhook — the iOS app just triggers the same checkout. See `apple-app-store-plan.md`.
