# iOS Integration & Push Notifications — Implementation Plan

*Why this is a plan and not code: iOS builds require macOS + Xcode (per CLAUDE.md), and this repo's iOS work is generated but not yet integrated. Push notifications need keys and an architecture decision only the owner can make. Everything below is scoped so it can be executed on a Mac (or Codemagic) with no further design work.*

---

## Part A — iOS integration

### Current state
- The app is a **Capacitor 6** native shell rendering `https://duravel.app` in a `WKWebView`, bundle id `app.duravel`, min iOS 15.
- iOS was generated across **7 parts under `C:\dev\duravel\Apple\`** (each with a `MANIFEST.md` naming where its files go). **Not yet integrated into `hyroxai/ios`.**
- Start docs: `Apple\Duravel_iOS_HANDOFF.md`, then `Apple\Duravel_iOS_Morning_ToDo.md`.

### Hard prerequisites (owner-only)
1. A **Mac with Xcode** (or a Codemagic pipeline). Windows cannot archive/sign/upload — full stop.
2. **Apple Developer Program** enrollment (needs the **D-U-N-S** number — tracked as an open blocker).
3. **Signing**: an App ID for `app.duravel`, a distribution certificate, and a provisioning profile.
4. **APNs auth key** (`.p8`) for push (also used in Part B).
5. **1024px app icon**; confirm `duravel.app` renders correctly inside a `WKWebView`.
6. **Billing decision**: Apple IAP vs. external Stripe link — a mismatch is an automatic App Store rejection. Confirm before wiring the paywall.

### Integration sequence (on the Mac)
1. **Inventory** — read every `Apple\PartN\MANIFEST.md`; build the file→destination map into `hyroxai/ios`.
2. **Scaffold** — `npx cap add ios` (if not present); set bundle id, display name, min iOS 15, category Health & Fitness, brand bg `#0B0B0F`.
3. **Integrate the parts** in order: foundation → HealthKit → IAP → Sign in with Apple → deep links → push → submission metadata. **Merge, don't overwrite** `capacitor.config.ts`, `package.json`, `Info.plist` — diff first.
4. **Wire native plugins** to the web app (HealthKit read, push registration handoff, IAP, Sign in with Apple, deep-link routing to `/program/...`).
5. **Build → TestFlight** — archive, sign, upload; smoke-test the WKWebView shell, auth, a program view, and the new Workout view (its native gate `window.Capacitor.isNativePlatform()` should now return true — see below).
6. **Submit** — use the Part 7 App Store metadata, privacy nutrition labels (HealthKit: never to iCloud/ads/sold), and the compliance checklist.

### Web-side readiness (can be done here anytime, no Mac needed)
- The **Workout view** already gates on `window.Capacitor?.isNativePlatform()` with a `?preview` escape — it will light up automatically once the Capacitor runtime is present in the shell. No web change needed.
- Keep the WKWebView locked to the app's own domain; keep in-app account deletion reachable (App Store requirement).

---

## Part B — Push notifications

> ### ✅ STATUS — Web push SHIPPED & wired (2026-07-22)
> The full web-push channel is built, deployed to production, and the send
> pipeline is **verified working end-to-end** (a Settings → test notification
> delivered to a real device). What's live:
> - **Groundwork** — `push_subscriptions` table (migration `0036`), service worker
>   (`public/sw.js`), subscribe/unsubscribe/test routes, `lib/push/send.ts`
>   (VAPID-key-normalizing, best-effort), and the "Workout reminders" toggle in
>   Settings → Connections. VAPID keys set in Vercel; `web-push` installed.
> - **Triggers** — `lib/push/reminders.ts` runs from the daily lifecycle cron
>   (14:00 UTC) firing **workout_due** (unlogged session scheduled today) and
>   **week_review** (Monday, prior week had activity). Dedup via `push_sends`
>   (migration `0037`). Pure detection unit-tested (`lib/push/triggers.test.ts`).
>
> **⏳ One open verification (see the 2026-07-22 handoff):** confirm the cron
> actually fires the reminders in prod — trigger `/api/cron/lifecycle` manually
> (Vercel dashboard → Crons → Run, or curl the real production domain with the
> real `CRON_SECRET`) and check the `pushReminders` summary in the JSON. The
> manual `<app.duravel.app>` curl returned DEPLOYMENT_NOT_FOUND because no Vercel
> project claims that hostname — the deployment is `duravel.app`. (As of 2026-08-17
> the iOS shell points at `duravel.app` too, so there is no second host.)
>
> **Deferred (not started):** per-user quiet hours + smarter send time (needs a
> `profiles.timezone` column); `streak_at_risk` trigger; native APNs (after iOS);
> per-category preference UI.


### Decision to make first (owner)
Two independent channels; pick one or both:
- **Web push** (browsers + installed PWA) — works today on the web app, no App Store. Good for re-engagement now.
- **Native APNs** (iOS app) — requires the integrated iOS app + the `.p8` key. Higher deliverability, home-screen presence.

Recommendation: **ship web-push now** (immediate value, no Apple dependency), then add native APNs when the iOS app lands. Both can share one `push_subscriptions` table and one send path.

### Web-push groundwork (buildable now — ~1 focused session)
All standard, no Apple dependency:
1. **Keys**: generate VAPID keys (`npx web-push generate-vapid-keys`); store `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` in env (public key also exposed to the client).
2. **Dependency**: `npm i web-push`.
3. **DB**: `push_subscriptions` table (user_id, endpoint, p256dh, auth, created_at; RLS: service-role writes, à la `subscriptions`).
4. **Service worker**: `public/sw.js` handling `push` + `notificationclick` (route to `/program/...` or `/dashboard`).
5. **Client**: a "Enable reminders" toggle in Settings → registers the SW, `pushManager.subscribe({ applicationServerKey })`, POSTs the subscription to `/api/push/subscribe`.
6. **API**: `/api/push/subscribe` (store) + a send helper `lib/push/send.ts` (`web-push.sendNotification`). Prune 410/404 endpoints.
7. **Triggers** (reuse the existing lifecycle cron `app/api/cron/lifecycle`): "workout due today", "week review ready", "streak at risk". Gate behind a per-user preference (mirror the Strava opt-out pattern) and quiet hours.

### Native APNs (after iOS integration)
- Capacitor `@capacitor/push-notifications`: register on launch, hand the APNs device token to the SAME `/api/push/subscribe` (add a `platform` column: `web` | `ios`).
- Send via APNs using the `.p8` key (e.g., `node-apn` or a provider). One dispatcher fans out to web-push and APNs by platform.

### What only the owner can do
- Generate/host VAPID keys; obtain the APNs `.p8`; decide channels + notification policy (which events, frequency, quiet hours); the Apple prerequisites in Part A.

---

## Suggested order
1. (Now, no Mac) Web-push groundwork — real re-engagement value immediately.
2. (Mac) iOS integration → TestFlight → submit.
3. (After iOS) Native APNs on the shared subscription/dispatch path.
