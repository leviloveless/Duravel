# Duravel — Go-Live Step-by-Step

_Tailored to exactly where you are now (test-mode billing fully verified; fixes written, not yet committed). Follow top to bottom. Anything in `code font` is copy-paste-able._

**Two ground rules:**
- Never mix test and live Stripe values — a request is one mode at a time.
- Production stays un-paywalled until the very last step of Step 3 (`BILLING_ENABLED=true`).

---

## STEP 1 — Commit this session's fixes

This ships four files: the cancel-recording fix, the account-deletion fix, the DB migration, and the tsconfig exclude. It does **not** turn on billing.

### 1.1 Stop the dev server (avoid a build/dev conflict)
In the terminal running `npm run dev`, press **Ctrl+C** to stop it. (Leave the `stripe listen` terminal alone — it's fine.)

### 1.2 Open a terminal in the repo
```
cd C:\dev\duravel
```

### 1.3 Run the build gate
```
npm run build
```
- **Expected:** it finishes with "Compiled successfully" / no type errors.
- **If it fails:** copy the error to me. (It should pass — we excluded `_phase3_draft`, which was the only thing breaking it.)

### 1.4 Stage ONLY these four files
Do **not** use `git add -A` — your repo has untracked marketing/docs/draft files that must stay out of this commit.
```
git add app/api/stripe/webhook/route.ts app/profile/actions.ts supabase/migrations/0018_subscriptions_fk_auth_users.sql tsconfig.json
```

### 1.5 Confirm exactly four files are staged
```
git status
```
Under **"Changes to be committed"** you should see exactly:
- `modified:   app/api/stripe/webhook/route.ts`
- `modified:   app/profile/actions.ts`
- `modified:   tsconfig.json`
- `new file:   supabase/migrations/0018_subscriptions_fk_auth_users.sql`

If anything else is staged, run `git restore --staged <that file>` before continuing.

### 1.6 Commit and push
```
git commit -m "Billing: record cancel_at (flexible mode); cancel Stripe sub on account delete; subscriptions FK -> auth.users (0018); exclude _phase3_draft"
git push
```

### 1.7 Verify the deploy
- GitHub `main` auto-deploys to Vercel. Open your Vercel dashboard → **duravel** project → **Deployments**, and confirm the newest one (your commit message) reaches **Ready**.
- Nothing changes for users: production `BILLING_ENABLED` is still off, so the code is live but dormant.
- Migration `0018` is already applied to your database (you ran it), and local + prod share one Supabase, so there's no DB step here.

### 1.8 Restart local dev (optional, if you keep testing)
```
npm run dev
```

✅ **Step 1 done when:** the four files are pushed and the Vercel deployment is Ready.

---

## STEP 2 — Verify the account-deletion fix

The code is already written (it's the `app/profile/actions.ts` you just committed). This step just confirms it works. Do it **locally**, where Stripe is configured. Requires: `npm run dev` running with `BILLING_ENABLED=true` and test keys, plus `stripe listen` running.

### 2.1 Make a throwaway subscribed account
1. Sign up a new test account (any email you can log into, or a `+alias`).
2. Complete onboarding.
3. Go to `/pricing` → **Subscribe** (monthly) → pay with test card `4242 4242 4242 4242`, any future expiry, any CVC.

### 2.2 Confirm it's subscribed
- In Supabase → `subscriptions` table, this user has a row with `status = active` and a `stripe_subscription_id`.

### 2.3 Delete the account
- In the app: **Settings → Profile → Delete account** (complete the two-step confirmation).

### 2.4 Verify both sides
- **Stripe test dashboard** → Customers (or Subscriptions): that subscription now shows **Canceled**.
- **Supabase**: the user's rows are gone (`profiles`, `subscriptions` for that id).
- **`npm run dev` terminal**: no `[account] failed to cancel…` error. (If you see one, copy it to me.)

✅ **Step 2 done when:** deleting the account also cancels its Stripe subscription.

---

## STEP 3 — Go live (turn on real billing)

Do this as one focused sitting, when you're ready to accept real money. Everything here is in **live** mode.

### 3.0 Preconditions (do first)
- [ ] Your Stripe account is **activated for live payments** — business details submitted and a **bank account added for payouts**. (Stripe → Settings → Business/Payouts. If the dashboard still shows an "activate/complete your account" banner, finish that first, or live charges will be blocked.)
- [ ] You've decided the tax/merchant-of-record option (the "who handles global sales" choice from earlier). Confirm with your accountant before charging real customers.
- [ ] Step 1 is deployed (the billing code is on production).

### 3.1 Switch Stripe to Live mode
- In the Stripe Dashboard, toggle **Test mode → OFF** (top of the screen). Everything below is done with Test mode off.

### 3.2 Create the live product + prices
1. **Product catalog → Add product.**
2. Name: `Duravel`.
3. Add price #1: **Recurring**, **$19.99 USD**, **Monthly**. Save.
4. On the same product, **Add another price**: **Recurring**, **$149.00 USD**, **Yearly**. Save.
5. Copy both **live** Price IDs (`price_…`) — note which is monthly and which is annual.

### 3.3 Create the live webhook endpoint
1. **Developers → Webhooks → Add endpoint.**
2. Endpoint URL: `https://duravel.app/api/stripe/webhook`
3. Select events (exactly these four):
   - `checkout.session.completed`
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
4. Save → click to reveal the **Signing secret** (`whsec_…`) → copy it.

### 3.4 Enable portal plan-switching (live)
- **Settings → Billing → Customer portal** → under **Subscriptions**, enable **"Customers can switch plans"**, add the **Duravel** product, and check both live prices. Also confirm **cancellation** is allowed. Save.

### 3.5 Set the live env vars in Vercel
Vercel → **duravel** project → **Settings → Environment Variables**. Set each to its **live** value, scoped to **Production** (Preview optional):
- [1] `STRIPE_SECRET_KEY` = `sk_live_…` (mark **Sensitive**)
- [1] `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` = `pk_live_…`
- [1] `STRIPE_WEBHOOK_SECRET` = `whsec_…` (from 3.3; mark **Sensitive**)
- [1] `STRIPE_PRICE_MONTHLY` = live monthly `price_…`
- [1] `STRIPE_PRICE_ANNUAL` = live annual `price_…`
- [1] Confirm `SUPABASE_SERVICE_ROLE_KEY` is present (the webhook needs it).

Update in place if these already hold test values — replace them all with live values so nothing is mixed.

### 3.6 Flip the flag and redeploy
1. In the same Vercel env vars screen, set **`BILLING_ENABLED` = `true`** (Production).
2. Redeploy so the new env applies: Vercel → **Deployments** → newest → **⋯ → Redeploy** (or push any commit). Env changes only take effect on a fresh deployment, and `NEXT_PUBLIC_*` bakes in at build time.

### 3.7 Smoke test with a real card
- [1] On `duravel.app`, as a real (or fresh) account whose trial has ended, click **Subscribe** → complete checkout with a **real card**.
- [1] Stripe → **Developers → Events** (or the webhook's delivery log): the four events show **200**.
- [1] Supabase `subscriptions`: a row with `status = active`, correct `plan`/`price_id`, future `current_period_end`.
- [1] `/pricing` shows the "You're subscribed" state; generating a program works.
- [1] Open **Manage billing** → the portal loads; try **switch plan** and **cancel**.
- [1] **Refund yourself:** Stripe → Payments → that payment → **Refund**. (Refunding doesn't remove access mid-period, which is fine.)

### 3.8 If anything goes wrong — rollback
- Set **`BILLING_ENABLED`** back to unset (or anything ≠ `true`) in Vercel and **redeploy**. Billing instantly turns off for everyone; existing subscriptions are untouched. Debug, then re-flip.

✅ **Go-live done when:** a real card subscribes, the webhook writes the row, entitlement flips, and the portal works — then you've refunded your test charge.

---

## Quick reference — what each piece is
- **`BILLING_ENABLED`**: the master switch. Off = nobody paywalled. On = trial/subscription enforced.
- **Webhook**: the only thing that writes entitlement. If a subscription "doesn't take," check the webhook's event log for a non-200 first.
- **All-or-nothing modes**: secret key, publishable key, and both price IDs must all be the same mode (all test, or all live). Mixed = "No such price" errors.
