# Duravel iOS — Part 4: Recommended Architecture & Product Config

**Scope:** How the StoreKit purchase actually works, what to use to validate it, the exact subscription group / product IDs, and how iOS purchases map onto the entitlements Stripe already grants — so a web subscriber and an iOS subscriber get identical access.

---

## 1. Purchase engine: StoreKit 2 auto-renewable subscriptions

Use **StoreKit 2** (iOS 15+, which matches Duravel's minimum target). StoreKit 2 gives you:
- Async/await Swift APIs and, critically, **`Transaction` objects that are cryptographically signed (JWS)** — you can verify entitlement on-device without a server round-trip.
- Built-in `Transaction.currentEntitlements` and `Transaction.updates` streams for restore and renewal.
- Automatic handling of renewals, billing retry, grace period, refunds, and Ask-to-Buy.

Duravel sells **auto-renewable subscriptions** (not consumables, not non-renewing). Two products in one **subscription group** (monthly + annual) so users can up/downgrade within the group and Apple prorates.

### Why a server is still required
On-device JWS verification is good for *gating the UI instantly*, but the **source of truth for "is this user entitled" must be server-side in Supabase**, because:
- The same account can subscribe on web (Stripe) — the server must unify both.
- Renewals/cancellations/refunds happen while the app is closed; you need server webhooks to keep Supabase current.
- The webview paywall (Capacitor) reads entitlement from your backend, not from StoreKit.

So the flow is: **StoreKit (buy) → receipt/transaction → validation service → webhook → Supabase entitlement → app + webview read Supabase.**

## 2. Validation & webhooks: use RevenueCat (recommended for a solo founder)

**Recommendation: RevenueCat.** For a one-person team it removes the two most error-prone pieces of IAP: server-side receipt validation and the renewal-state webhook plumbing.

What RevenueCat gives you:
- **Managed receipt validation** against Apple (handles the sandbox/prod endpoint switch, the shared secret, and StoreKit 2 signed transactions) — you never hand-parse a receipt.
- **A single entitlement webhook** (`INITIAL_PURCHASE`, `RENEWAL`, `CANCELLATION`, `EXPIRATION`, `BILLING_ISSUE`, `PRODUCT_CHANGE`, etc.) that you consume once in a Supabase edge function (Part 4.4) — instead of polling Apple's App Store Server Notifications V2 and maintaining JWS decoding yourself.
- **Cross-platform entitlement model** that matches exactly what we want: define one entitlement (`"pro"`) and attach both the iOS products AND (optionally) the Stripe products to it. RevenueCat can even ingest Stripe, but we deliberately keep **Supabase as the single source of truth** and treat RevenueCat as the iOS validator + notifier (see §5).
- **Free until ~$2.5k/mo tracked revenue**, then usage-based. At Duravel's stage this is $0.
- First-class **Capacitor / Cordova plugin** (`@revenuecat/purchases-capacitor`) — this is the same plugin we wire in Part 4.5, so purchase + validation come from one SDK.

**Plain-StoreKit alternative (noted, not recommended for now):**
If Levi wants zero third-party billing dependencies, the DIY path is:
- Client buys via StoreKit 2, sends the signed transaction JWS to a Supabase edge function.
- Server verifies the JWS signature against Apple's root certs, then calls the **App Store Server API** to confirm status, and subscribes to **App Store Server Notifications V2** (Apple POSTs `SUBSCRIBED`, `DID_RENEW`, `DID_CHANGE_RENEWAL_STATUS`, `EXPIRED`, `REFUND`, etc. as signed JWS).
- You maintain the Apple in-app-purchase **shared secret / key**, JWS decoding, and the notification endpoint yourself.
- Pros: no RevenueCat, no revenue share. Cons: materially more code and more edge cases (grace periods, billing retry, upgrade proration, sandbox notifications) for a solo founder to own. The Part 4.4 edge function is written to accept **either** source — see that file's `NORMALIZE` layer.

**Verdict:** RevenueCat now; the entitlement schema and edge function are provider-agnostic, so dropping RevenueCat later is a swap of the webhook parser, not a data-model change.

## 3. Product configuration

### Subscription group
- **Group reference name:** `Duravel Membership`
- **Group ID:** assigned by App Store Connect on creation (record it in the config table below).
- Both products live in this one group → users switch tiers with Apple-managed proration, and only one is active at a time.

### Products

| Field | Monthly | Annual |
|---|---|---|
| **Product ID** | `app.duravel.membership.monthly` | `app.duravel.membership.annual` |
| Reference name (ASC) | Duravel Monthly | Duravel Annual |
| Type | Auto-renewable subscription | Auto-renewable subscription |
| Price (target) | $19.99 / month | $119.99 / year |
| Apple price tier | nearest tier to $19.99 | nearest tier to $119.99 |
| Duration | 1 month | 1 year |
| Group | Duravel Membership | Duravel Membership |
| Group level (rank) | 1 | 1 (same level = simple swap) |

> Product IDs use the reverse-DNS bundle prefix `app.duravel.*` to match the app's bundle ID convention. **Product IDs are permanent** — once created in App Store Connect they cannot be reused or renamed, so lock these names now.

### RevenueCat mapping (in the RevenueCat dashboard)
- **Entitlement identifier:** `pro`  ← the single entitlement the whole app checks.
- **Offering:** `default`
  - **Package `$rc_monthly`** → `app.duravel.membership.monthly`
  - **Package `$rc_annual`** → `app.duravel.membership.annual`
- Both products are attached to the `pro` entitlement. The webview paywall (Part 4.5) fetches this offering to render prices, so **prices come from Apple, not hardcoded** — no localization/currency bugs.

### StoreKit config file
`Duravel_iOS_Part4_03_Products.storekit` (delivered alongside) lets Levi test the full purchase/restore flow in Xcode's local StoreKit testing **before** the products are approved in App Store Connect. Add it to the scheme's Run options → StoreKit Configuration.

## 4. Mapping iOS purchases → existing Stripe entitlements

The web app already grants access based on a Stripe subscription. We do **not** want two parallel notions of "is this user a member." Unify on a single internal concept:

```
                    ┌─────────────────────────┐
   Stripe (web) ───▶│                         │
                    │   Supabase:             │
                    │   entitlements table    │──▶ Web app reads this
   Apple/RevenueCat │   (source of truth)     │──▶ iOS webview reads this
   (iOS)        ───▶│   keyed by user_id      │──▶ API/features read this
                    └─────────────────────────┘
```

**The rule:** every feature gate in Duravel — web and iOS — asks Supabase *"does this user have an active `pro` entitlement?"* and never asks a payment provider directly. The `entitlements` row records `source = 'stripe' | 'apple'` for support/analytics, but access is identical regardless of source.

### Identity linkage (the critical join)
The one thing that must be right: **the iOS purchase must attach to the same Duravel `user_id` as the web account.** Because the iOS app is a Capacitor shell loading `app.duravel.app`, the webview already knows the logged-in Supabase `user_id`. We pass that into RevenueCat as the **App User ID** at login:

```ts
await Purchases.logIn({ appUserID: supabaseUser.id }); // RC ties the Apple purchase to the Duravel user
```

So a purchase made in the native sheet is stamped with the Duravel `user_id`, the webhook carries it, and the edge function writes the entitlement to the correct user. No email matching, no guessing.

### Existing Stripe entitlement mapping
| Stripe today | Unified entitlement | iOS equivalent |
|---|---|---|
| `price_...monthly` ($19.99/mo) active sub | `pro` entitlement, `source='stripe'` | `app.duravel.membership.monthly` |
| `price_...annual` ($119.99/yr) active sub | `pro` entitlement, `source='stripe'` | `app.duravel.membership.annual` |
| `past_due` / `canceled` | entitlement expired/inactive | Apple `EXPIRATION` / `BILLING_ISSUE` |

Same product ladder, same access. The Stripe→Supabase sync you already run keeps writing `source='stripe'` rows; the new Apple/RevenueCat webhook writes `source='apple'` rows into the identical table.

## 5. Avoiding double-charge & double-entitlement

Two safeguards, detailed in Part 4.4 and 4.5:
1. **Paywall suppression (client):** before the iOS app shows the native paywall, it checks the current Supabase entitlement. If the user already has active `pro` (e.g. from a Stripe web sub), the paywall is **not shown** and no IAP is offered — so a web subscriber can't accidentally buy a second time on iOS. (Part 4.5)
2. **Reconciliation (server):** the edge function, on any Apple purchase event, checks for an existing active `stripe` entitlement for that user. If found, it records the Apple entitlement but **flags an overlap** for support and does not create a conflicting billing state; access stays single and unified. It never cancels the Stripe sub automatically (that's a support decision), but it surfaces the overlap so Levi can refund one side. (Part 4.4)

Because Apple and Stripe are separate billing rails, you **cannot technically prevent** a determined user from holding both an Apple and a Stripe sub — but you *can* make it nearly impossible in the normal UI (safeguard 1) and *detectable* when it happens (safeguard 2).

---

## Needs Levi (this doc)
- Confirm **product IDs** `app.duravel.membership.monthly` / `.annual` (permanent once created).
- Confirm **RevenueCat** as the validator (free at current scale) vs the plain-StoreKit DIY path.
- Decide **iOS price tiers** — exact-as-possible match to $19.99/$119.99.
- Decide whether iOS gets a **free trial / intro offer** (not present on web today).
