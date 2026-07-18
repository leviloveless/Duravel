# Duravel iOS — Part 4 (Billing) — Bundle Manifest

Unzips into `C:\dev\duravel` as `Apple\Part4_billing\`. Nothing here overwrites repo files automatically — move each artifact to its destination below.

**Headline:** Recommendation is StoreKit In-App Purchase + Apple Small Business Program (15%). The IAP-vs-external decision is Levi's to confirm — see `docs/…_01_Billing_Decision.md`.

| Bundle path | Final destination in repo | Type | Note |
|---|---|---|---|
| `docs/Duravel_iOS_Part4_00_README.md` | `Apple/Part4_billing/README.md` (or `docs/ios/part4-billing/README.md`) | doc | Index + build order + assumptions. Read first. |
| `docs/Duravel_iOS_Part4_01_Billing_Decision.md` | `docs/ios/part4-billing/Billing_Decision.md` | doc | Decision doc: §3.1.1, 15%/30%/0%, money math, recommendation. Contains "Needs Levi". |
| `docs/Duravel_iOS_Part4_02_Architecture_and_Product_Config.md` | `docs/ios/part4-billing/Architecture_and_Product_Config.md` | doc | StoreKit 2 + RevenueCat, subscription group, product IDs, Stripe→Supabase mapping. |
| `ios/Duravel_iOS_Part4_03_Products.storekit` | `ios/App/App/Products.storekit` | config | Xcode local StoreKit test file. Add to the Run scheme → Options → StoreKit Configuration. Replace `DURAVEL_PLACEHOLDER_*` team/app IDs. |
| `ios/Duravel_iOS_Part4_06_capacitor-iap.ts` | `src/lib/billing/iap.ts` | code | Capacitor RevenueCat client: configure/logIn, offerings, purchase, restore, listener. Set `RC_IOS_API_KEY`. |
| `web/Duravel_iOS_Part4_04_entitlements_schema.sql` | `supabase/migrations/<timestamp>_entitlements.sql` | code (SQL) | Unified `entitlements` table + `my_entitlement()` RPC + RLS. Point existing Stripe sync at it with `source='stripe'` (or use the UNION-view option inline). |
| `web/Duravel_iOS_Part4_05_revenuecat-webhook.ts` | `supabase/functions/revenuecat-webhook/index.ts` | code (edge fn) | Consumes RevenueCat webhooks, writes entitlement, reconciles Stripe (overlap detection), restore-safe. Set `REVENUECAT_WEBHOOK_AUTH` secret. |
| `web/Duravel_iOS_Part4_07_paywall-gate.ts` | `src/lib/billing/paywall-gate.ts` | code | Webview paywall gate: reads Supabase entitlement, suppresses iOS paywall for web subscribers (double-charge guard), buy/restore/watch. Fix the relative import to file 06's final path. |

## Post-unzip checklist
1. Enroll in the **Small Business Program** (App Store Connect → Agreements) — 15% vs 30%.
2. Create subscription group + two products per `docs/…_02`; add `Products.storekit` to the Xcode scheme.
3. Create RevenueCat project: `pro` entitlement, `default` offering, map both products.
4. Run the SQL migration in Supabase; wire your existing Stripe sync to write `source='stripe'`.
5. Deploy the edge function; set the RevenueCat webhook URL + `REVENUECAT_WEBHOOK_AUTH`.
6. `npm i @revenuecat/purchases-capacitor && npx cap sync ios`; drop in `iap.ts` + `paywall-gate.ts`, wire the paywall to `gate()`.
7. Replace all `DURAVEL_PLACEHOLDER_*` values (team ID, app ID, RC keys, Supabase project ref/anon key).

## Placeholders to replace before shipping
`DURAVEL_PLACEHOLDER_TEAM_ID`, `DURAVEL_PLACEHOLDER_APP_ID`, `appl_DURAVEL_PLACEHOLDER_PUBLIC_KEY` (RC iOS key), `DURAVEL_PROJECT.supabase.co`, `DURAVEL_PUBLIC_ANON_KEY`, and the `REVENUECAT_WEBHOOK_AUTH` secret.
