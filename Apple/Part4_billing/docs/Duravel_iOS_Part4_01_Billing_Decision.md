# Duravel iOS — Part 4: Billing Strategy Decision

**Status:** DECISION DOC — recommendation inside, but the IAP-vs-external call is Levi's.
**Date:** 2026-07-18 (overnight autonomous build, Part 4 of 7)
**Scope:** How the Capacitor iOS shell should take money for the $19.99/mo and $119.99/yr subscriptions.

---

## TL;DR

**Recommendation: ship StoreKit In-App Purchase (IAP) for the iOS app, enrolled in the Apple Small Business Program (15%).** Keep Stripe as the single billing engine for the web app. Do **not** rely on an external purchase link inside the iOS binary as the primary path — the earlier finding that the external Stripe payment link converts ~0% on mobile makes it a revenue dead end today, and the rule that would let you use it fee-free is legally unsettled.

The one-line reason: **85% of a conversion that actually happens beats 100% of a conversion that doesn't.**

This is flagged as **Levi's decision** — see "Needs Levi" at the bottom. Everything downstream in Parts 4-7 (product config, entitlement sync, paywall wiring) is built assuming StoreKit IAP, but is structured so a later pivot to external billing is not a rewrite.

---

## 1. The rule that forces the question — App Store Review Guideline §3.1.1

Apple's Guideline **§3.1.1 ("In-App Purchase")** requires that **if you unlock features or functionality within an app** (subscriptions to digital content and services included), **you must use Apple's In-App Purchase system.** You may not, inside the app, direct users to an outside purchasing method or use your own payment mechanism for that digital content.

Duravel is a subscription to a digital service (live/hybrid training content and features) consumed inside the app. That squarely lands in §3.1.1. So a plain "open Stripe checkout in the webview" flow inside the iOS binary is a **rejection risk** unless it uses the specific entitlement described in §3 below.

What §3.1.1 does **not** cover (still fine to sell outside IAP): physical goods, services consumed outside the app (e.g. in-person coaching, physical merch), and person-to-person services. Duravel's core subscription is not one of these, so IAP is the default obligation.

## 2. The commission — what Apple actually takes (2026)

| Path | Apple's cut | Notes |
|---|---|---|
| Standard IAP | **30%** | Default rate for any developer not enrolled in a reduced program. |
| **Small Business Program (SBP)** | **15%** | For developers with **< $1M USD in proceeds/year**. Duravel qualifies today. Enroll before launch. |
| Auto-renewable sub after 1 paid year | 15% | Even outside SBP, a subscriber's *second* year drops to 15% automatically. With SBP you're at 15% from day one, so this doesn't stack — you're just at 15% throughout. |
| US external purchase link | **0% today, legally in flux** | See §3. |

**Bottom line for Duravel:** enroll in the Small Business Program and your effective Apple commission is **15%**, not 30%. Every money number below assumes SBP 15%.

## 3. The US external-purchase-link entitlement — real, but a moving target

After *Epic v. Apple*, US apps gained the right to link out to an external web checkout ("External Purchase Link Entitlement" / the anti-steering remedy). The legal status as of **July 2026**:

- The district court (Judge Gonzalez Rogers) found Apple's proposed 27% external-link fee was designed to make external payments economically unviable and **barred Apple from collecting any commission** on external-link purchases.
- The **Ninth Circuit (Dec 2025)** modified that: Apple *may* charge "a commission based on the costs genuinely and reasonably necessary for coordinating external links, but no more."
- Apple **dropped the external-link fees during appeal**, so **right now the effective US external-link commission is 0%.**
- **April 2026:** the Ninth Circuit reversed Apple's stay; the case is back with the district court to set what "reasonable" fee (if any) Apple may charge. Apple is separately seeking a **Supreme Court** stay.
- **Net:** 0% today, but the number could become non-zero on a court's timeline you don't control, and the entitlement carries friction (see below).

**Friction that comes with the external link even at 0%:**
- Apple requires an approved entitlement, specific link formatting, and a mandatory scare-sheet disclosure ("You're about to leave the app… Apple is not responsible…") before the hand-off. That interstitial measurably depresses conversion.
- The purchase happens in Safari/web context, not a native sheet — exactly the flow that **already converts ~0% for Duravel on mobile** (prior Part finding).
- You still need IAP available anyway for a compliant, low-friction option, or you risk review pushback and you leave the high-intent native buyers with no good path.

So the external link is **not free money** — it's a legally-unstable 0% attached to a checkout experience Duravel has already measured at roughly zero conversion.

## 4. The money math

Assume Small Business Program (15%). Stripe reference fee ≈ 2.9% + $0.30.

### Per-transaction net to Duravel

| Plan | Gross | StoreKit IAP @ 15% (net) | Stripe web @ ~2.9%+30¢ (net) | External link in-app (net, if 0% today) |
|---|---|---|---|---|
| Monthly | $19.99 | **$16.99** | $19.11 | $19.11 |
| Annual | $119.99 | **$101.99** | $116.21 | $116.21 |

Per-transaction, Stripe/external nets more. **But that only matters if the transaction happens.**

### Expected value — the number that actually decides it

Multiply net-per-sale by the realistic mobile conversion rate.

Let `C_iap` = conversion of a native IAP sheet, `C_ext` ≈ 0 (measured) for the external mobile flow.

- **External link expected value per paywall view** ≈ $19.11 × ~0 ≈ **~$0.**
- **StoreKit IAP expected value per paywall view** ≈ $16.99 × `C_iap`, where `C_iap` is a normal mobile-app paywall rate (industry ballpark 1.5%–5% of paywall views for fitness apps, higher for warm/trial-converted users).

Even at a pessimistic `C_iap` = 2%, IAP expected value ≈ **$0.34 per paywall view** vs **~$0** external. The native path wins by the entire revenue, not by a margin.

### The 15% "tax" framed correctly

The choice is **not** "keep 100% (external) vs keep 85% (IAP)." Because external mobile conversion ≈ 0, the real choice is:

> **15% of the sales you actually make (IAP)  vs  ~0 sales at a nominally lower fee (external).**

Paying Apple 15% to *unlock a working mobile checkout* is cheap. The 15% is effectively a customer-acquisition / payment-conversion cost, and it's a good one.

### When external billing WOULD be worth revisiting
- If/when a court **fixes external-link commission at a durable low number (0% or near it)** AND
- Duravel builds a **de-frictioned** external flow that actually converts on mobile (e.g. account-linked one-tap web checkout, deep-link return, saved card) — i.e. solve the ~0% problem first, and
- Volume is high enough that 15% × revenue > the engineering + support cost of running two live billing rails on mobile.

Until those hold, external-in-app is a distraction. Revisit at scale, not at launch.

## 5. The recommendation (and why)

**Ship StoreKit IAP, Small Business Program (15%), as the iOS purchase path. Keep Stripe as the web billing engine and the single source of truth for entitlements in Supabase.** Reasons:

1. **§3.1.1 compliance with the least friction** — a native purchase sheet is the lowest-risk, highest-converting compliant option.
2. **The money math favors it decisively** once you weight by real mobile conversion (~0% external).
3. **Legal certainty** — 15% SBP is a known, stable rate; the 0% external number is contingent on ongoing litigation you don't control.
4. **Best mobile UX** — native Face ID / one-tap purchase and Apple-managed renewals, restores, refunds, and family sharing.
5. **Solo-founder operational cost** — Apple handles tax/VAT remittance, dunning, chargebacks, and card updates on the IAP side; you don't build any of that for mobile.

**Trade-offs you're accepting (be honest about them):**
- You give up ~15% of iOS gross vs. what Stripe would net *if* external converted (it doesn't today).
- You now run **two billing systems** (Stripe web + StoreKit iOS) and must keep entitlements unified — that's what Part 4 items 3-5 solve.
- Apple owns the renewal relationship for iOS purchasers (you can't directly refund or comp them; you point them to Apple / manage via the store).
- Price changes and free trials for iOS go through App Store Connect config, not just a Stripe dashboard toggle.

## 6. Guardrails that keep the door open

The downstream design (Parts 4.3–4.5) is built so this is reversible:
- **Entitlements live in Supabase, keyed to the user — not to the payment provider.** Access is granted by an internal `entitlement` record; whether it was created by Stripe or by Apple is just a `source` column. Swapping or adding a billing rail later doesn't touch the gating logic.
- **The paywall reads entitlement state, not "did they buy via X."** So a future external-billing pivot is a new writer into the same table, not a rewrite.
- **No double-charge by construction:** before showing the iOS paywall, the app checks existing Supabase entitlement (which already reflects any active Stripe sub) and suppresses the paywall for users who already pay on web. See Part 4.5.

---

## Needs Levi (this doc)

1. **THE CALL: StoreKit IAP vs external link.** Default recommendation is **StoreKit IAP + Small Business Program (15%)**. I've built all downstream artifacts on that assumption. If you want to gamble on the external-link entitlement instead, say so and I'll re-plumb — but I'd advise against it given the measured ~0% mobile conversion and the unsettled legal fee.
2. **Enroll in the Apple Small Business Program** (App Store Connect → Agreements). This is the difference between 15% and 30% and must be done before/at launch. Confirm Duravel is under $1M/yr proceeds (it is) and enroll.
3. **RevenueCat vs plain StoreKit 2** for receipt validation + webhooks — recommendation is RevenueCat for a solo founder (see Part 4.2). Costs $0 under RevenueCat's free tier until ~$2.5k/mo tracked revenue. Confirm you're OK adding it as a dependency.
4. **iOS pricing parity** — do you want iOS prices identical to web ($19.99 / $119.99), or use Apple price tiers that land near those? Apple tiers are close but not always exact. Default: match as closely as Apple tiers allow.
5. **Free trial on iOS?** Web pricing doesn't mention a trial. If you want an introductory offer (e.g. 7-day free trial) on iOS, it's configured in the subscription group — tell me and I'll add it to the product config.

**Sources (App Store rules & legal status):**
- [Apple App Store alternative payment fees, 2026 — Neon Commerce](https://www.neonpay.com/blog/apple-app-store-alternative-payment-fees-what-developers-pay-in-2026)
- [Ninth Circuit modifies Epic injunction, Apple may charge external-link fee — MacRumors, Dec 2025](https://www.macrumors.com/2025/12/11/apple-app-store-fees-external-payment-links/)
- [Epic wins reversal of stay in App Store fee battle — MacRumors, Apr 2026](https://www.macrumors.com/2026/04/29/epic-games-wins-reversal-app-store-fee-battle/)
- [Apple anti-steering ruling & monetization strategy — RevenueCat](https://www.revenuecat.com/blog/growth/apple-anti-steering-ruling-monetization-strategy)
