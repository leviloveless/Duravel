# Duravel iOS — Part 4 of 7: Billing Strategy & Implementation Design

Autonomous overnight build. This part decides **how the iOS app takes money** and gives you drop-in artifacts to implement it. Nothing here was compiled or signed (cloud sandbox) — these are real, review-ready TS/SQL/config + docs to drop into `C:\dev\duravel`.

## The decision, in one line
**Ship StoreKit In-App Purchase, enrolled in Apple's Small Business Program (15%). Keep Stripe for web. Unify entitlements in Supabase.** The external-link path converts ~0% on mobile (prior finding) and its fee is legally unsettled — 15% of real sales beats 100% of ~none. **This is your call — see "Needs Levi."**

## Files in this part
| # | File | What it is |
|---|---|---|
| 00 | `Duravel_iOS_Part4_00_README.md` | This index |
| 01 | `Duravel_iOS_Part4_01_Billing_Decision.md` | Decision doc: §3.1.1, 15%/30%/0%, money math, recommendation |
| 02 | `Duravel_iOS_Part4_02_Architecture_and_Product_Config.md` | StoreKit 2 + RevenueCat, subscription group, product IDs, Stripe mapping |
| 03 | `Duravel_iOS_Part4_03_Products.storekit` | Xcode local StoreKit test config (both products) |
| 04 | `Duravel_iOS_Part4_04_entitlements_schema.sql` | Supabase unified-entitlements schema + RPC + RLS |
| 05 | `Duravel_iOS_Part4_05_revenuecat-webhook.ts` | Supabase edge function: consume purchase webhooks, reconcile Stripe, restore |
| 06 | `Duravel_iOS_Part4_06_capacitor-iap.ts` | Capacitor IAP client: purchase / restore / offerings |
| 07 | `Duravel_iOS_Part4_07_paywall-gate.ts` | Paywall gating for the webview (reads Supabase, blocks double-charge) |

## How it fits together
```
  iOS native sheet (StoreKit 2 via RevenueCat plugin)         Web (Stripe checkout, unchanged)
            │  buy / restore                                          │
            ▼                                                         ▼
   RevenueCat validates receipt                            Stripe webhook (existing)
            │  webhook                                                │
            ▼                                                         ▼
   Supabase edge fn (file 05) ──────────►  Supabase `entitlements` (file 04)  ◄─────── (source='stripe')
                                                     │  single source of truth
                                                     ▼
                                     my_entitlement() RPC → paywall gate (file 07)
                                                     │
                                    web app + iOS webview both read has_pro
```

## Suggested build order for Levi
1. Enroll in the **Small Business Program** (App Store Connect → Agreements).
2. Create the **subscription group + two products** (file 02 spec); add the `.storekit` file (03) to the Xcode scheme for local testing.
3. Create a **RevenueCat** project, add the `pro` entitlement + `default` offering, map the two products (file 02).
4. Run the **SQL** (04) in Supabase; point your existing Stripe sync at `entitlements` with `source='stripe'` (or use the UNION view option noted in the file).
5. Deploy the **edge function** (05); set the RC webhook URL + auth token.
6. Add `@revenuecat/purchases-capacitor`, drop in files **06 + 07**, wire the paywall to `gate()`.
7. Test the full buy/restore loop in the StoreKit local environment, then in Sandbox.

## Assumptions I made (flag if wrong)
- iOS prices should match web as closely as Apple tiers allow ($19.99 / $119.99).
- No free trial on iOS (web has none today).
- RevenueCat is acceptable as a dependency (free at current scale).
- Product IDs `app.duravel.membership.{monthly,annual}` are fine to lock in.

## Needs Levi
See the consolidated list printed at the end of the session and in file 01. The headline item is **the IAP-vs-external decision itself** — I defaulted to StoreKit IAP and built everything on it, but flagged it as yours to confirm.
