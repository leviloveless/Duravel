# Duravel iOS — Master Build Plan (overnight autonomous build)

**Started:** 2026-07-17 ~23:15 EDT · **Owner:** Levi · **Builder:** Claude (autonomous)
**Goal:** Take Duravel from a live Next.js web app to an **App-Store-ready iOS
app**, doing every piece of work that does not require Levi's Mac, Apple account,
or manual decisions — and cleanly listing what does.

---

## 0. What this is (and isn't)

**Approach: Capacitor native shell.** Per the Duravel mobile roadmap, iOS = a
[Capacitor](https://capacitorjs.com) app wrapping the existing Next.js codebase,
plus native plugins that add real device value (HealthKit, push, in-app
purchase, haptics, secure storage). This is the fastest credible path to the App
Store for a solo founder and reuses ~100% of the product you already shipped.

**Why not a from-scratch native (SwiftUI) app?** It would duplicate the entire
web product, double every future feature's cost, and blow the timeline — with no
user-facing benefit for a training-log/plan app. Capacitor is the right call
until a feature genuinely needs native rendering.

**What I cannot do autonomously (→ your morning to-do):** compile in Xcode, sign,
run on a device, enroll in the Apple Developer Program (needs the D-U-N-S you
already have in flight), create App Store Connect records, upload a build, or
make the IAP-vs-web-billing business call. I produce **drop-in code, config, and
docs**; you integrate them into `C:\dev\duravel` and drive the Mac/Apple steps.

**Delivery constraint:** this cloud session can't write through to
`C:\dev\duravel` (known device-bridge limitation), and your computer is asleep
overnight, so every part **delivers its files into the chat** (SendUserFile).
In the morning you copy them into the repo. Where a durable copy is reachable,
files are also written to the `Training Program App` OneDrive folder.

---

## 1. Global conventions (used by every part — keep consistent)

| Thing | Value |
|---|---|
| App display name | **Duravel** |
| Bundle identifier | **`app.duravel`** (reverse-DNS of duravel.app) |
| Apple app category | Health & Fitness |
| Web stack | Next.js (App Router) · Supabase (auth + DB) · Stripe (web billing, live) · Resend (email) |
| Repo | GitHub **Duravel** · local `C:\dev\duravel` · web app under `hyroxai/` |
| Hosted web URL | `https://app.duravel.app` *(assumption — confirm the production domain)* |
| Capacitor load mode | **Remote-shell first** (`server.url` → hosted app) + native plugins, with a documented path to bundled/offline later (Part 1 §Decision D1) |
| Min iOS target | iOS 15.0 |
| Native plugins in scope | HealthKit, Push (APNs), IAP/StoreKit, StatusBar, SplashScreen, Haptics, Preferences (secure storage), App (deep links), Browser |
| Deep-link scheme | `duravel://` + Universal Links on `app.duravel.app` |

---

## 2. The 7 parts (1 per hour)

Each part is self-contained, produces named artifacts into the chat, and ends by
noting anything that needs Levi.

1. **Foundation & architecture** *(done in the kickoff session)* — approach
   decision, `capacitor.config.ts`, dependency + folder plan, iOS setup script,
   Info.plist key list, `.gitignore`, load-mode decision, minimum-functionality
   (App Store 4.2) risk plan.
2. **Native shell & UX polish** — splash + app-icon set spec, status-bar & safe
   areas, dark mode, haptics, keyboard/scroll behavior, offline + error screen,
   pull-to-refresh, iOS gesture/back handling, web↔native bridge helper, loading
   states.
3. **Auth, secure session & deep linking** — Supabase auth inside the Capacitor
   webview (session persistence via secure storage), **Sign in with Apple**
   (required by App Store §4.8 if any third-party login is offered), Universal
   Links + `duravel://` scheme, email confirm/reset deep links, **account
   deletion** flow (required by §5.1.1(v)).
4. **Monetization / billing strategy** — the big decision: **StoreKit IAP** vs
   external web billing. Recommended architecture, StoreKit 2 subscription
   product config, server-side receipt validation + entitlement sync to
   Supabase/Stripe, restore-purchases, price parity, and the App Store rules that
   force the choice.
5. **HealthKit & wearables** — HealthKit entitlement + permission UX, data types
   (workouts, HR, HRV, VO₂max, resting HR), read/observer queries, background
   delivery, mapping into the existing ingestion pipeline (dedupe vs Strava/
   Garmin), privacy copy.
6. **Push notifications & lifecycle** — APNs + Capacitor Push setup, permission
   priming, notification categories/deep-links, tie-in to the (gated) lifecycle
   email system so cadence is consistent, quiet hours, token storage in Supabase.
7. **App Store submission package + final to-do** — App Store Connect metadata
   (name, subtitle, keywords, description, promo), privacy nutrition labels +
   `PrivacyInfo.xcprivacy` manifest, screenshot plan, review notes, TestFlight
   plan, full compliance checklist, and the **consolidated morning to-do**
   superseding the preliminary one below.

---

## 3. Architecture decisions (locked unless Levi overrides)

- **D1 — Webview load mode:** ship v1 as a **remote shell** (`server.url` = the
  hosted app) so the native app always matches production and needs no rebuild
  per web change. Mitigate App Store §4.2 "minimum functionality" by shipping
  real native features (HealthKit, push, IAP, haptics) and a native offline
  screen. Migrate to a bundled/static front-end only if review pushes back or
  offline becomes a priority. *(Reversible; documented in Part 1.)*
- **D2 — Auth:** reuse Supabase web auth in the webview; add Sign in with Apple to
  satisfy §4.8 and reduce friction. Persist the session in the iOS keychain via
  Capacitor Preferences/SecureStorage.
- **D3 — Billing:** **defaults to StoreKit IAP** for App Store compliance
  (Apple requires IAP for digital subscriptions consumed in-app). External-link
  entitlement is a fallback. Final call is Levi's (Part 4 lays out the money math
  — Apple's 15–30% vs the ~0% conversion seen on the external Stripe link).
- **D4 — One codebase:** the iOS project lives in the same repo under `ios/`
  (Capacitor-generated), committed alongside `hyroxai/`.

---

## 4. Preliminary morning to-do (Part 7 will finalize)

Hard blockers only you can clear:

1. **Apple Developer Program** — enroll ($99/yr); needs the D-U-N-S (already in
   flight per the LLC/Mercury/Apple chain). Nothing ships without this.
2. **A Mac + Xcode** — required to build, sign, and archive. (No cloud CI can
   fully replace it for first submission; options in Part 7.)
3. **Signing** — Apple Developer certificate + provisioning profile + App ID with
   HealthKit, Push, Sign in with Apple, and In-App Purchase capabilities.
4. **Billing decision (D3)** — StoreKit IAP vs external. This gates Part 4's final
   wiring.
5. **Confirm production web URL** (`app.duravel.app`?) and that it's reachable/CORS-
   clean from a native webview.
6. **Secrets** — APNs key (.p8), HealthKit is entitlement-only, App Store Connect
   API key for CI, Stripe/Supabase keys already exist.
7. **Assets** — final 1024² app icon source + brand colors for splash (Part 2
   generates the full set from a source you approve).

---

*Parts 2–7 are scheduled hourly. Each arrives in the chat as its own run with its
own artifacts. This plan is the source of truth they build against.*
