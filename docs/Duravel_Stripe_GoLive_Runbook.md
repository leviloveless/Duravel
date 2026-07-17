# Duravel — Stripe Go-Live Runbook

_Last updated: July 14, 2026_

This is the step-by-step to turn on paid billing. The billing **code** is already built and gated behind a single flag (`BILLING_ENABLED`), so nothing is paywalled until the final step. Everything here is operational: creating prices in Stripe, setting env vars in Vercel, wiring the webhook, testing, then flipping the flag.

**Launch prices:** **$19.99 / month** and **$159.99 / year** (no card required for the 14‑day trial — the trial is enforced app‑side, there is deliberately no Stripe trial).

Do the whole thing in **Stripe Test mode first** on a Vercel Preview, verify the checklist, then repeat the price/webhook/env steps with **Live** keys on Production.

---

## 0. What the code already does (so the steps make sense)

- **Checkout** (`/api/stripe/checkout`) creates a subscription Checkout Session for the signed‑in user and redirects them to Stripe. It stamps `client_reference_id` + `metadata.user_id` so the webhook can map the payment back to the user. Promotion codes are enabled.
- **Webhook** (`/api/stripe/webhook`) is the **only** writer of entitlement. It verifies the Stripe signature, then upserts the `subscriptions` table via the service‑role client. It must be subscribed to four events (below).
- **Portal** (`/api/stripe/portal`) opens the Stripe Billing Portal for card/plan/cancel.
- **Entitlement** (`lib/subscription.ts`): a user is entitled if `BILLING_ENABLED !== "true"` (pre‑launch), OR has a live subscription, OR is inside the 14‑day trial. Program **generation** and **weekly‑review "apply"** both return `402 → /pricing` when not entitled.

---

## 1. Prerequisites

- A Stripe account with **Test** and **Live** modes.
- Access to the Vercel project (Environment Variables) and the ability to redeploy.
- The Supabase **service‑role key** already lives in Vercel (used by wearables). Confirm it's set — the webhook needs it: `SUPABASE_SERVICE_ROLE_KEY` (Production + Preview).

---

## 2. Deploy the code changes first

Two small changes were made in this session and need to ship before testing:

1. **Weekly‑review "Apply" is now gated** (`app/api/adapt/apply/route.ts`) — applying an adaptation (a paid Haiku refill) returns `402` when not entitled; **dismiss** and the free **preview** stay open. The review UI (`components/program/adapt-review.tsx`) now sends a `402` to `/pricing`.
2. **Pricing page now shows $19.99/mo** and a corrected "Save 38%" badge (`app/pricing/pricing-plans.tsx`).

`tsc --noEmit` passes. Ship them the usual way from `C:\dev\duravel`:

```
npm run build      # local gate — must pass
git add -A
git commit -m "Billing: gate weekly-review apply behind entitlement; pricing $19.99"
git push           # main → Vercel
```

---

## 3. Create the products & prices in Stripe (Test mode)

Stripe Dashboard → **Products** → **Add product**.

1. **Product:** "Duravel" (or "Duravel Membership"). One product with two recurring prices is cleanest:
   - **Monthly** — Recurring, **$19.99 USD**, billing period **Monthly**. Save → copy the **Price ID** (`price_...`).
   - **Annual** — Recurring, **$159.99 USD**, billing period **Yearly**. Save → copy the **Price ID** (`price_...`).
2. Keep both prices **active**. No trial on the price (the trial is app‑side).

You now have `STRIPE_PRICE_MONTHLY` and `STRIPE_PRICE_ANNUAL`.

> The app maps a Stripe price back to a plan by exact Price‑ID match (`planFromPriceId` in the webhook). If you ever rotate a price, update the env var or the plan will read as `null`.

---

## 4. Configure the Billing Portal

Stripe Dashboard → **Settings → Billing → Customer portal** → activate it. Allow: update payment method, cancel subscription, and (optional) switch between the monthly/annual prices. Save. Without this, `/api/stripe/portal` returns an error.

---

## 5. Set environment variables in Vercel

Project → Settings → Environment Variables. Use **Test** values for Preview first.

| Variable | Value | Scope | Notes |
|---|---|---|---|
| `STRIPE_SECRET_KEY` | `sk_test_...` / `sk_live_...` | Production + Preview | Secret. Server‑only. |
| `STRIPE_WEBHOOK_SECRET` | `whsec_...` | Production + Preview | Secret. From step 6. |
| `STRIPE_PRICE_MONTHLY` | `price_...` (monthly) | Production + Preview | From step 3. |
| `STRIPE_PRICE_ANNUAL` | `price_...` (annual) | Production + Preview | From step 3. |
| `SUPABASE_SERVICE_ROLE_KEY` | (existing) | Production + Preview | Confirm present — webhook writer. |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | `pk_test_...` / `pk_live_...` | All | Optional for the current redirect checkout; harmless to set. |
| `BILLING_ENABLED` | leave **unset** for now | — | Flip to `true` only at the very end (step 8). |

After editing env vars, **redeploy** (env changes don't apply to existing deployments). `NEXT_PUBLIC_*` values are baked at build time.

---

## 6. Configure the webhook endpoint

Stripe Dashboard → **Developers → Webhooks → Add endpoint**.

- **Endpoint URL:** `https://<your-preview-or-prod-domain>/api/stripe/webhook`
  - Production: `https://duravel.app/api/stripe/webhook`
- **Events to send** (exactly these four):
  - `checkout.session.completed`
  - `customer.subscription.created`
  - `customer.subscription.updated`
  - `customer.subscription.deleted`
- Save → reveal the **Signing secret** (`whsec_...`) → set it as `STRIPE_WEBHOOK_SECRET` (step 5) → redeploy.

> For local testing you can instead run `stripe listen --forward-to localhost:3000/api/stripe/webhook` and use the CLI's `whsec_...`.

---

## 7. Test checklist (Test mode, `BILLING_ENABLED=true` on the Preview)

Temporarily set `BILLING_ENABLED=true` on the **Preview** environment and redeploy, so the paywall is actually enforced while you test. Use Stripe test card **4242 4242 4242 4242**, any future expiry/CVC.

- [ ] **Subscribe (monthly):** `/pricing` → Subscribe monthly → Stripe Checkout → pay → redirected to `/dashboard?checkout=success`.
- [ ] **Webhook landed:** Stripe → the event shows `200`; Supabase `subscriptions` row exists for your user with `status=active`, correct `plan`, `price_id`, `current_period_end`.
- [ ] **Entitled:** `/pricing` now shows the "You're subscribed" state; program generation and weekly‑review **Apply** work.
- [ ] **Portal:** "Manage billing" opens the Stripe portal and returns to `/dashboard`.
- [ ] **Cancel:** cancel in the portal → webhook updates the row (`cancel_at_period_end=true`, later `status=canceled`); access persists until period end, then generation/apply return `402 → /pricing`.
- [ ] **Annual:** repeat Subscribe with the annual toggle; confirm `plan=annual`.
- [ ] **Trial → paywall:** on a fresh account, set `profiles.trial_started_at` back ~15 days (SQL) → generation and review **Apply** return `402` and land on `/pricing`; **dismiss** on the review still works; subscribing restores access.
- [ ] **Promo code (optional):** a test promotion code applies at checkout.

When all green, remove the temporary Preview `BILLING_ENABLED` if you don't want the Preview paywalled.

---

## 8. Go live (Production)

1. Recreate the **products/prices** in **Live** mode (step 3) → new live `price_...` IDs.
2. Add the **Live** webhook endpoint on `https://duravel.app/api/stripe/webhook` (step 6) → live `whsec_...`.
3. Set the **Live** values in Vercel Production: `STRIPE_SECRET_KEY=sk_live_...`, `STRIPE_WEBHOOK_SECRET` (live), `STRIPE_PRICE_MONTHLY`/`STRIPE_PRICE_ANNUAL` (live IDs), publishable key (live).
4. Confirm `SUPABASE_SERVICE_ROLE_KEY` is set on Production.
5. **Flip the switch:** set `BILLING_ENABLED=true` on Production → **redeploy**.
6. Smoke test with a real card (you can refund yourself): one monthly subscribe → webhook `200` → row written → portal → cancel.

---

## 9. Rollback

If anything misbehaves after launch, set `BILLING_ENABLED` back to **unset** (or anything other than `"true"`) and redeploy. Entitlement immediately returns to "everyone allowed" (`billing_off`) — nothing is paywalled, existing subscriptions are untouched, and you can debug without blocking users.

---

## Notes / gotchas specific to this codebase

- **No Stripe trial.** The 14‑day trial is app‑side (`profiles.trial_started_at`). Don't add a trial to the Stripe price or users would get two trials.
- **Webhook is the sole entitlement writer.** A user can never grant themselves a subscription; reads are RLS‑scoped. If entitlement looks wrong, check the webhook delivery + the `subscriptions` row, not the client.
- **`current_period_end`** is read defensively across Stripe API versions (subscription item vs subscription). No `apiVersion` is pinned — the SDK inherits your account default; keep the account API version and the installed `stripe` package roughly in step.
- **Price‑ID mapping is exact‑match.** Rotating a price without updating the env var makes `plan` read `null`.
- **`NEXT_PUBLIC_SITE_URL`** (Production, no trailing slash) is used for Checkout/Portal redirect URLs; it's already set for the app.
