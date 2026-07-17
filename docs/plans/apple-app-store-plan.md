# Getting Duravel onto the Apple App Store — step plan

_Tasks addition #1. Written July 2026. Duravel is today a Next.js web app on Vercel (duravel.app) selling a $19.99/mo · $159.99/yr subscription with a 14‑day no‑card trial, billed through Stripe. This plan takes it to a shippable iOS app and flags the one decision that dominates the economics: how in‑app subscriptions are paid for._

## The decision that shapes everything: payments

Apple's Guideline 3.1.1 requires that unlocking digital content/subscriptions inside an iOS app use Apple's In‑App Purchase (StoreKit), on which Apple takes 15% (Small Business Program, under $1M/yr — which is where Duravel starts) or 30%. That commission comes straight off Duravel's margin.

As of 2026 there is a second path in the **US** only: following the 2025 court ruling in Epic v. Apple, US App Store apps may include **external purchase links** that send the user to the web (e.g. Duravel's existing Stripe checkout) to pay, and Apple takes **no commission** on those web purchases. Outside the US, external links fall under Apple's StoreKit External Purchase entitlement and Apple still charges an alternative‑payment fee (~12–27%), so most non‑US markets are effectively "IAP or pay a similar fee."

Recommendation for Duravel: **launch US‑first with an external purchase link to the existing Stripe subscription** (keeps 100% of revenue, reuses billing that's already live), and add **StoreKit IAP as a fallback** before expanding internationally. This keeps the single source of subscription truth in Stripe for now (see the Stripe plan doc) and defers IAP complexity until it's actually needed. Whichever path, the entitlement writer stays server‑side.

## Phase 0 — Prerequisites (½ day)

1. Enroll in the **Apple Developer Program** ($99/yr). Enroll as **Duravel LLC** (needs the EIN and a D‑U‑N‑S number for the organization account — the D‑U‑N‑S request is free but can take 1–2 weeks, so start it now; it's already on the Mercury/Apple chain in memory).
2. Create the app record in **App Store Connect** (name "Duravel", primary category Health & Fitness, bundle ID e.g. `app.duravel.ios`).
3. Confirm a Mac with Xcode is available for builds and submission (or a CI Mac / EAS build service if going the Expo route).

## Phase 1 — Choose the app architecture (½ day decision, then build)

Duravel is a working responsive web app, so the fastest credible route is a **native wrapper**, not a rewrite:

- **Recommended: Capacitor** (or Expo + WebView). Wrap duravel.app in a native shell, add a splash screen, app icon, push‑notification capability, and native hooks where they matter (HealthKit, notifications). Fastest path from "web app" to "App Store app."
- **Alternative: React Native / Expo rewrite** of the core flows. Much larger effort; only worth it if the app needs deep native UX. Not recommended for a first submission.
- **Not viable alone: a bare WebView** with no native value — Apple rejects apps that are "just a website" (Guideline 4.2). The wrapper must add native capability (offline, notifications, HealthKit, Sign in with Apple) to clear that bar.

Deliverable of this phase: a Capacitor project that loads the app, plus a list of the native capabilities to add in Phase 2.

## Phase 2 — Make it feel native enough to pass review (1–2 weeks)

4. **App icon + launch screen + adaptive light/dark** assets.
5. **Sign in with Apple** — required by Guideline 4.8 whenever other third‑party/social logins are offered; also just good iOS UX. Wire it into Supabase Auth.
6. **Push notifications** (APNs) for training reminders / streaks — a concrete native reason for the app to exist. Ties into the lifecycle‑email work conceptually but is a separate channel.
7. **HealthKit** (optional but high‑value for an endurance app): read workouts, resting HR, HRV. This is a strong "native value" signal for review **and** directly feeds the new daily resting‑HR/HRV tracker (Tasks #7) and the Strava/Garmin sync surface.
8. **Payments wiring** per the decision above: US external‑link‑out to Stripe checkout using the StoreKit External Purchase Link entitlement, with the server (Stripe webhook) remaining the sole entitlement writer. Build the IAP/StoreKit path second.

## Phase 3 — Compliance & store listing (2–3 days)

9. **Privacy**: complete App Privacy "nutrition labels" (data collected: email, health/fitness, usage), publish a privacy policy URL (duravel.app/privacy) and terms, and add an in‑app **account deletion** path (Guideline 5.1.1(v) requires it for accounts).
10. **Store listing**: screenshots for required device sizes, app description, keywords, support URL, and a marketing subtitle consistent with the "coach‑quality personalization at a fraction of the price" positioning.
11. **Subscription metadata** (only if using IAP): create the auto‑renewable subscription products, group, localized descriptions, and the required "subscription terms" text.

## Phase 4 — Beta, submit, iterate (1–2 weeks incl. review latency)

12. **TestFlight** internal + external beta; dogfood the full onboarding → program → logging loop on a real device.
13. Submit for **App Review**. Budget for at least one rejection round — the most common for a subscription app is 3.1.1 (payments) and 4.2 (minimum functionality); the external‑link and native‑capability work above is what pre‑empts those.
14. On approval, **phased release**, monitor crash/analytics, and fast‑follow fixes.

## Sequencing note

The App Store push is independent of the current top priority (trial‑conversion lifecycle emails + distribution). It's a multi‑week effort with external lead times (D‑U‑N‑S, App Review), so the pragmatic move is to **start Phase 0 now** (enrollment + D‑U‑N‑S are just waiting) and schedule the build work after the lifecycle‑email go‑live. HealthKit in Phase 2 is the highest‑leverage native feature because it compounds with the sync and recovery‑tracking work already in the product.

Sources: [Apple App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/), [StoreKit External Purchase](https://developer.apple.com/documentation/storekit/external-purchase), [RevenueCat — app‑to‑web external purchases](https://www.revenuecat.com/blog/engineering/app-to-web-purchase-guidelines), [Apple alternative‑payment fees in 2026 (Neon)](https://www.neonpay.com/blog/apple-app-store-alternative-payment-fees-what-developers-pay-in-2026).
