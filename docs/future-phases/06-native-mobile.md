# Duravel — Native Mobile (Capacitor) + App Store / Play Store: Design & Build Spec

**Status:** Preparatory design for a future phase. Research + design only — no code, migrations, Stripe, or deployment changes are made by this document.
**Scope area:** Native iOS/Android app (Capacitor wrapper) + store-distribution path.
**Date:** 2026-07-15
**Owner:** Levi (solo founder)
**Repo:** `C:\dev\duravel` (Next.js 16 App Router, React 19, TS strict, Supabase, Vercel).

---

## 0. Corrections incorporated from the prior draft (read first)

This version keeps the prior draft's structure but fixes the following, which materially change the build:

1. **Duravel is not a reader app.** Apple's reader-app carve-out (magazines/news/books/audio/music/video) explicitly excludes fitness/training services. We do **not** file for the External-Link-Account entitlement. We rely instead on **3.1.3(b) Multiplatform Services** (worldwide) and the **post-*Epic* US anti-steering changes to 3.1.3** (US storefront, since May 2025). (Unchanged from draft — restated because it is load-bearing.)
2. **Region gating must not depend on server IP geolocation.** IP geo is unreliable and does not equal the user's *App Store storefront*, which is what Apple's rules actually key on. We read the device **storefront country** natively (StoreKit `SKStorefront.countryCode` on iOS; Play billing country on Android), report it to the server, and let the server stay authoritative. IP is only a fallback. This removes the draft's fragile "request geolocation" dependency.
3. **Notification architecture is a hybrid, not "all server push + cron."** Deterministic, time-of-day reminders (session reminder, morning readiness nudge) ship as **on-device local notifications** (`@capacitor/local-notifications`), scheduled/refreshed on each app open + sync. Only **event-driven** notifications (weekly review ready, wearable auto-link, trial expiry) go through **remote push**. This deletes ~90% of the timezone-slotting cron complexity the draft carried and removes an entire class of DST bugs.
4. **`device_push_tokens` uniqueness was wrong.** A push token identifies a *device*, not a user. On logout→login on a shared device the token must move to the new user. Uniqueness is on **`token`**, with `user_id` reassigned on re-register. `unique(user_id, token)` (draft) leaks stale enabled rows.
5. **Timezone had two sources of truth** (`profiles` and `notification_preferences`). Consolidated to **one column on `profiles`**.
6. **Offline read of SSR/RSC content is not "M."** With the remote-URL WebView pattern, the "Today/This week" screens are server-rendered remote HTML that a WebView cannot trivially cache offline. Real offline read needs a small **snapshot JSON endpoint** cached on-device + a lightweight client render. Effort re-sized up, and it is a candidate to **drop from MVP** if the OAuth/shell work runs long.
7. **Trial-expiry push must exclude already-converted users** (Stripe webhook may have written entitlement mid-trial). Added as an explicit guard.
8. **Org-account verification (D-U-N-S) timelines** apply to *both* Apple and Google now, and gate submission, not just Apple.

---

## 1. Goal & Why Now

### Goal
Ship a native iOS and Android app that is a **thin, native-enhanced shell around the existing Next.js 16 web app**, distributed **free** on the App Store and Google Play, with:

- Subscriptions still sold on the **web** (Stripe, already live) to keep 100% of revenue where store rules allow.
- Native capabilities a PWA can't match: **notifications** (local + remote push), **home-screen presence**, **clean OAuth/deep-link round-trips** (Strava, Supabase magic link), and **light offline read** of the current program / today's session.
- **Zero engine or AI changes** and **zero new billing writer** — the Stripe webhook remains the sole entitlement writer; `BILLING_ENABLED` still gates program generation and the weekly-review "Apply".

### Why now
1. **Retention needs notifications.** The core loop is *plan → log actual → adapt*. It is driven by readiness check-ins and weekly reviews, both of which need a nudge. iOS Safari web-push is unreliable and permission-hostile; a native shell is the only durable way to reach the user. This is the single highest-leverage retention lever for a training app.
2. **The store-policy window is favorable.** Since May 2025 the US storefront allows external links/buttons to web checkout with no IAP and no special entitlement (post-*Epic* 3.1.3). Worldwide, 3.1.3(b) already lets a web-subscribed user use the app. This de-risks "sell on web."
3. **It sits on the critical path anyway.** The LLC needed to register the existing-but-unregistered Apple Developer account is a prerequisite for *any* native ambition (triathlon/Ironman expansion, HealthKit/Apple Watch). Forming it now unblocks everything downstream.
4. **Low marginal cost, high optionality.** Capacitor reuses ~100% of the web UI. The incremental build is a shell, a notification pipeline, and store paperwork — weeks, not months.

### Hard blocker (unchanged)
Native ship is gated on **forming an LLC** to register the Apple Developer account. Work below is sequenced so all engineering proceeds in parallel with entity/legal work; store submission is the last step.

---

## 2. User-Facing Scope

### MVP (v1 — "Companion")
Value proposition: *"Your Duravel training on your phone, with reminders."*

- **Authenticated app shell** wrapping the live web app (Supabase Auth session persists in the native WebView).
- **Notifications**, opt-in, for a small high-signal set:
  - Weekly review ready — *remote push* ("Your plan for next week is ready to review").
  - Pre-session reminder — *local notification* ("Today: 5×1km @ threshold + wall balls").
  - Morning readiness nudge — *local notification*.
  - Wearable sync completed / synced activity auto-linked to a planned session — *remote push*.
  - Trial-expiry reminders (day 11 / day 13) — *remote push*, deterministic, drives web conversion; suppressed once entitlement exists.
- **Deep links / universal links**: tapping a notification opens the exact screen (today's session, weekly review, a specific log). OAuth and magic-link redirects return cleanly into the app.
- **Light offline read** (*at-risk for MVP — see §9*): last-synced current-week + today's session cached and viewable read-only. Offline **logging is out of MVP**.
- **Native niceties**: splash screen, app icon, status-bar theming, pull-to-refresh, safe-area handling, "open in browser" for account/billing.
- **Store-compliant billing UX** (see §7): outside the US the binary shows **no purchase path, no prices, no upgrade buttons** — a neutral "Manage your subscription at duravel.com" that opens the system browser. Inside the US, an explicit "Subscribe on the web" link is allowed.
- **Account deletion** reachable in-app (already built on web; required by 5.1.1(v)).

### Later (v2+)
- **Offline logging** with a queued-write/idempotent sync layer (optimistic local log → background sync → engine ingest). High value: gyms/tracks have poor signal.
- **Native workout logger** screen (fast, offline-first, big-tap targets) — the strongest "beyond a repackaged website" differentiator for guideline 4.2.
- **Apple Health / Google Health Connect** read integration (HR, workouts, sleep, HRV) → writes `workout_log`/readiness signals directly, complementing Strava. Native-only, and a major reason the app is worth more than a PWA.
- **Apple Watch / Wear OS** companion (glance at today's session; start/stop; live HR). Large.
- **Live Activities / Dynamic Island** (iOS) and Android ongoing notification during a session.
- **Home-screen widgets** ("today's session", "days to race").
- **Rich/actionable notifications** (log RPE straight from the notification).
- **Localized store presence** and triathlon/Ironman modules once that line lands.

### Explicitly out of scope (all versions, for now)
- In-app purchase / Apple or Google billing (we sell on web).
- Any native re-implementation of the **engine** or **generation** pipeline — stays server-side.
- Real-time coaching / person-to-person services (would forfeit store carve-outs and raise health-data scrutiny).

---

## 3. Data Model / Schema Changes

New migrations continue from **0019**. All tables get RLS: users read/write only their own rows; the **service-role admin client** is the only writer for send-side/audit tables. The Supabase client is **untyped** — queries cast with `as` per existing convention. `next build` is the real gate; add vitest coverage for the `sendPush`/quiet-hours/dedupe logic (pure functions).

### 0019 — `device_push_tokens`
Per-**device** push registration. One user → many devices; one device token → at most one active user.

```
device_push_tokens
  id              uuid pk default gen_random_uuid()
  user_id         uuid not null references auth.users(id) on delete cascade
  platform        text not null check (platform in ('ios','android'))
  provider        text not null check (provider in ('apns','fcm'))
  token           text not null                       -- APNs device token or FCM registration token
  app_version     text
  os_version      text
  device_model    text
  storefront      text                                -- device App Store / Play storefront country (e.g. 'US')
  enabled         boolean not null default true       -- flipped false on unregister / 410 / UNREGISTERED
  last_seen_at    timestamptz not null default now()
  created_at      timestamptz not null default now()
  updated_at      timestamptz not null default now()
  unique (token)                                      -- token is device-scoped; reassign user_id on re-register
```
Indexes: `(user_id, enabled)`, `(token)`.
RLS: owner may `select`/`insert`/`update` rows where `user_id = auth.uid()` (so the app registers from its own session); service role full access for send + invalidation.
**Registration semantics:** upsert on `token`; on conflict, overwrite `user_id`, `enabled=true`, refresh metadata (`last_seen_at`, versions, `storefront`). This is how a shared device correctly moves from user A to user B on logout→login.

### 0020 — `notification_preferences`
Per-user category toggles + quiet hours. Defaults opt users **in** to essential nudges with granular disable. Kept as its own table (not columns on `profiles`) so categories can grow without bloating `profiles`.

```
notification_preferences
  user_id                 uuid pk references auth.users(id) on delete cascade
  push_enabled            boolean not null default true    -- master switch; mirrors OS permission state
  weekly_review           boolean not null default true
  session_reminder        boolean not null default true
  session_reminder_time   time     not null default '17:00'  -- local; tz lives on profiles
  readiness_nudge         boolean not null default true
  readiness_nudge_time    time     not null default '07:00'  -- local
  sync_events             boolean not null default true
  trial_billing           boolean not null default true
  quiet_hours_start       time                                 -- nullable; both null = no quiet hours
  quiet_hours_end         time                                 -- may wrap past midnight (start > end)
  updated_at              timestamptz not null default now()
```
RLS: owner read/write own row. Seed a row on first app open (upsert).
**Note:** quiet-hours evaluation must handle the wrap case (`start=22:00`, `end=07:00`) — a "now within quiet hours" check is `(start <= end) ? (now>=start && now<end) : (now>=start || now<end)`. Local time-based reminders are on-device (§4), so quiet hours are enforced client-side for those and server-side for remote push.

### 0021 — `notification_log`
Send-side audit + idempotency for **remote push only** (local notifications never touch this table). Written **only** by the service role.

```
notification_log
  id              uuid pk default gen_random_uuid()
  user_id         uuid not null references auth.users(id) on delete cascade
  category        text not null   -- 'weekly_review' | 'sync' | 'trial'
  dedupe_key      text not null   -- see below; MUST be unique per intended send
  title           text
  body            text
  deep_link       text            -- HTTPS universal-link path the tap opens, e.g. '/review/{id}'
  provider        text            -- 'apns' | 'fcm'
  status          text not null default 'queued'  -- queued|sent|failed|skipped
  provider_msg_id text
  error           text
  created_at      timestamptz not null default now()
  sent_at         timestamptz
  unique (user_id, dedupe_key)
```
`dedupe_key` examples: `weekly_review:{program_id}:{week_index}`, `sync:{wearable_activity_id}`, `trial:{profile_id}:day13`. For anything recurring, include the discriminator (week, activity id, or day marker) so the unique constraint doesn't block legitimate future sends.
RLS: service role only. (If we later add an in-app notification center, grant owner `select`.)

### 0022 — `profiles` additions (ALTER)
Native context + region billing UX + single timezone source.

```
alter table profiles
  add column timezone             text,            -- IANA, e.g. 'Europe/London'; single source of truth
  add column push_opt_in_at       timestamptz,     -- first OS permission grant
  add column last_mobile_platform text,            -- 'ios' | 'android'
  add column last_mobile_version  text,
  add column app_store_region     text;            -- device storefront country for billing-UI gating (StoreKit/Play), NOT IP
```
If `profiles.timezone` already exists in an earlier migration, reuse it and drop the add.

**No changes** to `programs`, `workout_logs`, `adaptations`, `readiness_checkins`, `subscriptions`, `wearable_activities`. The v2 offline-logging feature will add a device-local queue (SQLite/IndexedDB via `@capacitor/preferences` or a SQLite plugin) plus a `client_generated_id uuid` on `workout_logs` for idempotent replay — deferred to that phase, not migrated now.

---

## 4. API / Route + Server-Action Changes

Philosophy: **the mobile shell reuses existing pages and server actions unchanged.** New surface is limited to (a) push registration, (b) a remote-push send pipeline, (c) native-context config, (d) an offline snapshot endpoint, and (e) deep-link/OAuth redirect hardening.

### New route handlers (App Router `route.ts`)
- **`POST /api/push/register`** — body `{ token, platform, provider, appVersion, osVersion, deviceModel, storefront }`. Authenticated via the WebView's Supabase session. Upserts `device_push_tokens` (on-conflict-token, reassign user), sets `profiles.push_opt_in_at`, records `app_store_region`/`last_mobile_*`, upserts default `notification_preferences`. Returns 204.
- **`POST /api/push/unregister`** — marks the token `enabled=false` (logout or OS opt-out).
- **`GET /api/mobile/config`** — returns native runtime config:
  `{ billingUiMode: 'us_external' | 'multiplatform_hidden', billingEnabled, minSupportedVersion, featureFlags }`.
  `billingUiMode` is derived **server-side** from the device-reported `storefront` (authoritative), with IP as a low-trust fallback. Default when uncertain = `multiplatform_hidden` (bias to compliance). Keeps store-rule logic server-authoritative and testable.
- **`PATCH /api/notification-preferences`** — update toggles/quiet hours (route handler chosen over server action for the native settings screen's simplicity).
- **`GET /api/mobile/snapshot`** — **new for offline read.** Returns a compact JSON payload for the current program week + today's session (already-computed engine output, no recompute). The shell caches it in `@capacitor/preferences`; an offline banner renders it read-only. This exists because SSR/RSC pages can't be cached offline by the WebView (see §9). Cheap to build on top of existing queries.
- **(v2) `POST /api/logs/sync`** — batched offline-log replay keyed by `client_generated_id` for idempotent ingest; triggers a **debounced** adaptation recompute (not per-row).

### New server-side send module (`lib/notifications/*`)
- `sendPush(userId, { category, title, body, deepLink, dedupeKey })` — service-role. Checks `notification_preferences` (category + master switch + quiet hours), inserts `notification_log` with `dedupe_key` (unique = idempotency; on conflict → `skipped`), fans out to all `enabled` tokens for the user, calls the provider (APNs HTTP/2 with `.p8` token auth, or FCM HTTP v1), records status, and **invalidates dead tokens** (APNs `410` / FCM `UNREGISTERED` → `enabled=false`).
- **Copy is deterministic/templated — never Haiku.** No AI in the notification path: controls cost, latency, correctness. (Optional far-future: Haiku-personalized copy behind a flag.)
- **Local-notification scheduling helper (client side, `lib/notifications/local.ts`):** on each app open/foreground/sync, cancel + reschedule the next 7 days of session-reminder and readiness-nudge local notifications from the cached program, honoring per-category toggles, per-category time, and quiet hours. This is what removes the cron scheduler for time-based reminders.

### Hook points (call `sendPush` from existing flows — no new triggers)
- **Weekly review generation:** after a review is produced, `sendPush(userId, { category:'weekly_review', deepLink:'/review/{id}', dedupeKey:'weekly_review:{program_id}:{week}' })`. Naturally gated by `BILLING_ENABLED` because no review is generated when the "Apply" path is disabled.
- **Wearable sync / auto-link:** when a synced Strava activity auto-links to a planned session, fire a `sync` push. (v2 Health Connect/HealthKit ingest reuses this hook.)
- **Trial expiry (day 11 / day 13):** scheduled (daily cron, §7), reads `profiles.trial_started_at`. **Guard:** skip any user with an active/complete subscription (entitlement written by the Stripe webhook) — do not nudge someone who already paid. Drives remaining users to **web** checkout.
- **Session / readiness reminders:** **not** server sends — on-device local notifications (above).

### Auth / deep-link changes (mostly config)
- **Universal Links (iOS)** + **App Links (Android)**: host `/.well-known/apple-app-site-association` and `/.well-known/assetlinks.json` on the Vercel domain so `https://duravel.com/...` opens the app. Store-preferred, no custom-scheme phishing warnings, and makes every `deep_link` a normal HTTPS path. (Both files must be served with correct content-type and no redirect; verify via Apple's AASA validator and `adb` App Links verification.)
- **OAuth round-trips:** Strava OAuth and Supabase magic-link/OAuth must return into the app. Add the app's universal-link callback and a fallback custom scheme `duravel://auth/callback` to the Supabase redirect allow-list. Use Capacitor's `App` URL-open listener + `@capacitor/browser` (system browser / `SFSafariViewController`) for the OAuth leg so cookies/session land correctly, then hand back to the WebView.
- **Note on the remote-URL pattern:** because the WebView loads `https://duravel.com` directly, it is a **normal first-party origin** — Supabase auth cookies "just work" there (no `capacitor://localhost` cookie problems). The residual risk is only the external-browser OAuth hop, which is why we prototype it first.
- **Capacitor bridge on the remote page:** with `server.url` pointing at Vercel, Capacitor injects its native bridge into the remote page, so the web app can call `PushNotifications`/`LocalNotifications`/`Browser` plugins and obtain the device token to POST to `/api/push/register`. The web bundle must include the Capacitor runtime and feature-detect `Capacitor.isNativePlatform()` so the same code is a no-op in a plain browser.
- **Native-context signal to server components:** the shell appends `X-Duravel-Native: ios|android` (Capacitor HTTP interceptor) so **server components conditionally render** — specifically to hide Stripe checkout buttons/prices in `multiplatform_hidden` mode and swap the "Manage subscription" affordance for a system-browser link. Server-side rendering is the cleanest enforcement point for store billing rules.

### Middleware
Reuse existing `middleware.ts` (Supabase session refresh). Add: pass-through of the native header, and a lightweight **min-version** check that returns a "please update" interstitial for builds below `minSupportedVersion`.

---

## 5. Engine / AI Implications

**Effectively none — by design.** This is the strongest argument for Capacitor.

- The **deterministic engine** (`lib/engine/*`: periodization Base/Build/Peak/Taper, mesocycles/microcycles, zone distribution, exact volume reconciliation, HR-zone cascade, HYROX station pacing, strength, ACWR/monotony/readiness/session-RPE signals) is untouched. Notifications are a *delivery* layer over existing outputs.
- **Haiku generation** (`lib/generation/*`) is untouched and **not** in the notification path (copy is templated).
- **Adaptation loop intact:** "linking a synced wearable workout = writing a `workout_log`," so v2 **Apple Health / Health Connect** ingestion also just writes `workout_log`/`readiness_checkins` rows — the adaptation engine consumes native-sourced data with **zero engine changes**, exactly like Strava today. HRV/sleep can later enrich readiness scoring, but that's an engine-side decision independent of the shell.
- **Validation unchanged:** any new server-written data still flows through existing Zod validation and reconciliation.
- **Cost:** no new Anthropic spend from mobile; push volume is small and provider-side free.

One forward-looking note: if v2 offline logging lets a burst of queued logs arrive at once, the weekly-adaptation trigger should **debounce/batch** rather than recompute per row. That's a generation-orchestration tweak (already reflected in `/api/logs/sync` above), not an engine change, and is deferred with the offline feature.

---

## 6. UX Outline

### Shell structure
- **Single WebView** hosting the live Next.js app via `server.url`. Native chrome limited to splash, status bar, system dialogs.
- **First-run flow:** open → (if logged out) auth via system browser → back into app → **notification-permission priming screen** (native "why we ask" *before* the OS prompt, to protect opt-in rate) → OS permission → register token + schedule local notifications.
- **Navigation:** reuse the web app's nav. Android hardware back mapped to WebView history; iOS edge-swipe works within WebView.

### Key screens (reused web routes, native-tuned)
1. **Today / Home** — today's session, readiness check-in entry, quick "log" CTA. Cached snapshot for offline read.
2. **Program** — current week/microcycle view; horizontally scannable.
3. **Weekly Review** — the adaptation review; "Apply" remains `BILLING_ENABLED`-gated. Push deep-links straight here.
4. **Log** — workout logging (web form in MVP; native offline-first logger in v2).
5. **Settings → Notifications** — native toggles mapping to `notification_preferences` (weekly review, session reminder + time, readiness nudge + time, sync, trial), quiet hours, auto-detected timezone (written to `profiles.timezone`).
6. **Account** — profile, **Delete Account** (5.1.1(v)), and a region-appropriate **subscription affordance**:
   - **US (`us_external`):** "Manage / subscribe at duravel.com" → system browser to the Stripe-hosted flow.
   - **Non-US (`multiplatform_hidden`):** "Manage your subscription on the web" (no price, no "subscribe/upgrade/buy" verb, no plan comparison) → system browser to the account page only.

### Notification UX
- Priming screen with concrete value ("We'll remind you when next week's plan is ready and before hard sessions").
- Actionable notifications (v2): "Log RPE" / "Snooze" (requires registered notification categories).
- Quiet hours respected: client-side for local notifications, server-side in `sendPush` for remote push.

### Offline UX (MVP, at-risk)
- Cached "Today" + "This week" (from `/api/mobile/snapshot`) render with a subtle "Offline — showing last synced" banner. Network actions (logging, applying reviews) disabled with a tooltip until reconnect.

### Store-rule UX guardrails (must-haves)
- No pricing, "subscribe/upgrade/buy", or plan comparison anywhere in the **non-US** binary/render.
- External links open the **system browser**, never an in-app web view, for the purchase leg.
- Account deletion reachable in ≤ 2 taps from Settings.

---

## 7. Third-Party Services + Rough Costs

| Item | Service | Cost | Notes |
|---|---|---|---|
| Apple Developer Program | Apple | **$99/yr** | Requires the LLC + D-U-N-S to register the existing account. Hard blocker. |
| Google Play Developer | Google | **$25 one-time** | Org account also needs D-U-N-S + verification now; cleaner than a personal account. |
| Push — Apple | **APNs** (HTTP/2, `.p8` token auth) | **Free** | Token-based auth = one key for all apps/environments. |
| Push — Android | **FCM (Firebase Cloud Messaging) HTTP v1** | **Free** | Recommendation: **FCM for Android, direct APNs for iOS** (avoids a Firebase dependency for iOS). FCM-for-both is acceptable to simplify sending. |
| Capacitor + plugins | `@capacitor/core`, `push-notifications`, `local-notifications`, `app`, `browser`, `preferences`, `splash-screen`, `status-bar` | **Free / OSS** | Note the added `local-notifications` plugin vs the draft. |
| Optional managed push | OneSignal / Knock / Courier | **$0–$99/mo** | Not needed at MVP volume; own `sendPush` + one daily cron suffices. Revisit only if marketing/segmentation push grows. |
| Scheduler | **Vercel Cron** (single **daily** job for trial-expiry) | Included in current Vercel plan | Much lighter than the draft: no hourly timezone-slot cron, because time-based reminders are on-device local notifications. Alternative: Supabase `pg_cron` + `pg_net`. |
| Native build/CI | Local **Xcode + Android Studio** (Mac required for iOS) | Local = free | Solo founder starts local. Cloud build (Appflow/EAS-style) optional later. |
| OTA updates | Appflow Live Updates / `@capgo/capacitor-updater` | **$0–$?/mo** | **Not needed for MVP:** the remote-URL pattern means web deploys ship instantly with no OTA layer. A real advantage. |
| LLC formation | State + registered agent | **~$50–$500 + agent fee** | Varies by state. On the critical path for submission only. |
| Mac for iOS builds | Hardware | Sunk/existing or new | Required to build/submit iOS. Budget if not owned. |

**Recurring cost floor:** ~$99/yr (Apple) + $25 once (Google) + $0 notifications. Biggest non-cash costs: a Mac and LLC formation.

### Store-policy service notes (the important part)
- **Reader-app entitlement: not applicable.** Duravel isn't a reader app; the entitlement excludes fitness/training. Do **not** file for it.
- **Worldwide — 3.1.3(b) Multiplatform Services:** a web-subscribed user may use the app. The app **must not** advertise, link to, or show pricing for external purchase *outside the US*. The non-US binary shows no purchase path. Well-trodden (Netflix/Spotify posture).
- **US — post-*Epic* 3.1.3 (May 2025):** anti-steering removed on the US storefront; the app **may** include external buttons/links to web checkout, no IAP, no entitlement. The US render shows an explicit "Subscribe on the web" link; links use `https` and open the default browser.
- **Guideline 4.2 minimum functionality:** a bare web wrapper risks rejection, and the remote-URL pattern draws *extra* 4.2 scrutiny. Our concrete native mitigations — **local + remote notifications, universal-link deep links, offline cached read (snapshot), native settings**, and later Health/offline-logging/widgets — are the "beyond a repackaged website" features. Ship at least **notifications + native settings + deep links** in MVP; add snapshot offline-read if schedule allows.
- **Guideline 5.1.1(v) account deletion:** already built; ensure it's reachable in-app.
- **Privacy Nutrition Labels + Play Data Safety:** declare **Health & Fitness** (workouts, HR, readiness), **Identifiers** (user id, device token), **Contact Info** (email), **Usage/Diagnostics**. No third-party ad SDKs → declare **"Data Not Used to Track You"** and **"Data Linked to You."** Health data must not be used for advertising or sold, and needs a privacy policy (Apple Health & Fitness privacy rules; Play Health Connect policy for v2). Prepare both forms before submission.

---

## 8. Domain / Training-Science Basis

The shell doesn't change the science, but **notification cadence is a behavioral surface** and must respect the training model:

- **Readiness-driven autoregulation.** The engine uses readiness check-ins, session RPE, ACWR, and monotony to drive revisions. A **morning readiness nudge** is scientifically load-bearing: subjective readiness captured *before* the session is most predictive; an evening prompt corrupts the signal. Hence default `readiness_nudge_time` 07:00 local and timezone-awareness are functional requirements, not cosmetics — and delivering them as *on-device local notifications* guarantees correct local timing regardless of server availability.
- **Pre-session reminders and adherence.** Periodization only works if the prescribed zone distribution is executed. Reminders that surface the specific session ("5×1km @ threshold") improve adherence to the intended intensity distribution, which is what keeps the ACWR and zone math valid.
- **Avoiding notification-induced monotony/over-nudging.** Training monotony (Foster) is a real overtraining/injury signal; notifications must not push users to train through low-readiness days. Readiness copy stays neutral ("How are you feeling today?") — never "don't skip." The engine, not the notification, decides load. Quiet hours and category granularity protect recovery (sleep is a recovery input the engine may later read via Health).
- **v2 Health integration is genuinely additive.** HealthKit / Health Connect can supply **HRV, resting HR, sleep** — inputs that sharpen readiness scoring and the personalized HR-zone cascade the engine already implements (custom bands → threshold HR → resting HR → sex-specific %HRmax). This is why the native app is strategically worth more than a PWA, and it routes through existing `workout_log`/readiness ingestion with no engine rewrite.

---

## 9. Risks & Open Questions

**Technical**
1. **Next.js 16 App Router inside Capacitor.** Server components, server actions, and route handlers can't be cleanly static-exported. **Decision: MVP uses the remote-URL pattern** (`server.url` → Vercel). Pros: 100% feature parity, SSR/RSC/actions work, instant updates via web deploy, no OTA. Cons: needs network on cold start, and a purely-remote shell draws **more 4.2 scrutiny** (hence mandatory native features). *Security note:* `server.url` loads remote content into the native shell — enforce HTTPS only, consider ATS/network-security-config hardening; do not ship a debug `cleartext` config.
2. **Offline read is harder than it looks (re-scoped).** A WebView pointed at remote SSR pages **cannot** cache those pages offline. Real offline read requires the **`/api/mobile/snapshot` JSON endpoint + a small client render + `@capacitor/preferences` cache** — not "just cache the page." Re-sized to **M–L**. If Phase 1 runs long, **drop offline-read from MVP** and keep notifications + deep links as the 4.2 justification; add snapshot in an early v1.1.
3. **Session/cookie + OAuth hop.** With remote-URL the WebView origin is `duravel.com`, so Supabase cookies work natively; the residual risk is the external-browser OAuth leg (Strava, magic link) handing back cleanly. **Prototype this first — highest-uncertainty integration.**
4. **Push token lifecycle** (reinstalls, rotation, multi-device, logout, shared device) — handled by `unique(token)` + on-conflict user reassignment + 410/UNREGISTERED invalidation, but needs real-device testing.
5. **Local-notification freshness.** Local notifications are scheduled from the cached plan; if the plan changes server-side while the app is closed, the queued reminder can be stale. Mitigate by rescheduling on every foreground/sync and keeping the reminder copy generic enough that a same-day change is rare. Acceptable for MVP.

**Policy / business**
6. **App Review rejection under 4.2** (thin wrapper) or for billing UX. Mitigate with the native feature set and strict non-US no-purchase rendering. Budget **1–3 review cycles** and 1–2 weeks of back-and-forth. *Open question:* accept the browser-hop conversion friction to keep 100% of revenue — almost certainly yes; consider a small US A/B once external links are live.
7. **Storefront detection accuracy for `billingUiMode`.** Device storefront (StoreKit/Play) is far better than IP but still needs a conservative default = **hide purchase UI** when uncertain. Bias to compliance over showing a US CTA to a non-US user.
8. **LLC / Apple + Google org verification timeline.** Entity formation → D-U-N-S (can take 1–2 weeks) → Apple *and* Google org verification (days each). The gating dependency for submission. Start immediately, in parallel.
9. **Health-data compliance (v2).** Apple Health rules, Play Health Connect policy, privacy-policy updates, stricter review once Health integration lands.

**Open questions to resolve before build kickoff**
- Remote-URL vs. a future static companion route group? → **Remote-URL for MVP;** revisit for v2 offline logging.
- Offline-read in MVP or v1.1? → **Ship if Phase 1 has slack; otherwise defer,** since notifications alone satisfy 4.2.
- FCM-for-both vs. direct-APNs + FCM? → **FCM Android + direct APNs iOS** (no Firebase dep on iOS), unless we want the single sender.
- Vercel Cron vs. Supabase `pg_cron`? → Either; **Vercel Cron** (one daily trial-expiry job) if logic stays in the Next app.
- Global at launch or **US-first**? → **US-first soft launch** to exploit the friendlier anti-steering rules and validate, then widen.

---

## 10. Effort Estimate (S/M/L) + Phased Build Plan

**Sizing key:** S ≈ ≤2 days · M ≈ ~1 week · L ≈ 2+ weeks (solo).

### Phase 0 — Legal/Entity + Accounts (parallel; blocks submission only)
- Form **LLC**; obtain **D-U-N-S**; register/verify the existing **Apple Developer** account. **[L, mostly waiting]**
- Create **Google Play** developer (org) account + verification. **[S–M, mostly waiting]**
- Draft/refresh privacy policy; prepare **Privacy Nutrition Labels** + **Play Data Safety** answers. **[S]**

### Phase 1 — Capacitor shell (engineering, starts now, no LLC needed)
- Add Capacitor; configure **remote-URL** load; splash/status bar/safe areas; Android back-button + iOS gestures; HTTPS-only hardening. **[M]**
- Capacitor bridge on the remote page + `Capacitor.isNativePlatform()` feature detection; `X-Duravel-Native` header + server-component conditional rendering to **hide non-US purchase UI**; `/api/mobile/config` + `billingUiMode` from device storefront. **[M]**
- Universal Links / App Links (`apple-app-site-association`, `assetlinks.json`); **OAuth + magic-link round-trip via system browser**; Supabase redirect allow-list. **[M]** — *prototype first; highest risk.*
- Reachable in-app **account deletion** (verify 5.1.1(v)). **[S]**
- **Offline snapshot** (`/api/mobile/snapshot` + client cache + banner). **[M–L]** — *ship if slack; else defer to v1.1.*

### Phase 2 — Notification pipeline (engineering)
- Migrations **0019–0022** (+ vitest for quiet-hours/dedupe pure logic). **[S]**
- APNs (`.p8`) + FCM setup; `@capacitor/push-notifications` + `@capacitor/local-notifications`; priming screen; `/api/push/register` + `/unregister`; token invalidation. **[M]**
- `lib/notifications/sendPush` (prefs/quiet-hours/dedupe + `notification_log` + dead-token invalidation). **[M]**
- **On-device local-notification scheduler** for session + readiness reminders (reschedule on foreground/sync). **[S–M]**
- Remote-push hooks into **weekly-review generation** and **wearable-sync**; deterministic templated copy. **[S]**
- **One daily Vercel Cron** for trial-expiry push (with converted-user guard). **[S]**
- Native **Notifications settings** screen. **[S]**

### Phase 3 — Store submission (needs Phase 0 complete)
- iOS build in Xcode; TestFlight internal; screenshots, metadata, privacy labels; **App Review** (budget 1–3 cycles on 4.2/billing). **[M]**
- Android build; internal testing track; Data Safety; Play review. **[M]**
- **US-first** soft launch; monitor conversion (browser-hop friction), crash/auth. **[S, ongoing]**

### Phase 4 — Post-launch differentiators (later; de-risks 4.2 further + real value)
- **Offline logging** with queued/idempotent sync (`client_generated_id`, `/api/logs/sync`, debounced adaptation). **[L]**
- **Native offline-first logger** screen. **[M]**
- **Apple Health / Health Connect** ingestion → `workout_log`/readiness (engine untouched). **[L]**
- Widgets / Live Activities / actionable notifications. **[M–L each]**
- Watch / Wear OS companion. **[L]**

**Critical path:** Phase 0 (LLC → D-U-N-S → org verification) gates only Phase 3. Phases 1–2 are fully buildable now. Recommended sequence: **prototype the OAuth/session round-trip first** (biggest unknown) → shell → notification pipeline → submit **US-first** once the entity clears. Total engineering to first US submission (excluding waiting): roughly **3–5 focused solo weeks**, plus review latency.

---

## Appendix — Key policy citations
- Apple **reader-app** definition & External-Link-Account entitlement (excludes real-time person-to-person fitness/training; primary content = magazines/news/books/audio/music/video): developer.apple.com/support/reader-apps/
- **App Review Guidelines** (3.1.1 IAP, 3.1.3(b) Multiplatform Services, 4.2 minimum functionality, 5.1.1(v) account deletion): developer.apple.com/app-store/review/guidelines/
- **US anti-steering / external-link changes (May 2025, *Epic* injunction)**, 3.1.3 / 3.1.1(a): developer.apple.com/news/ and coverage at 9to5mac.com/2025/05/01/
- **Privacy Nutrition Labels** and health-data rules: developer.apple.com/app-store/app-privacy-details/ ; Apple Health & Fitness Apps Privacy notice
- **Capacitor + Next.js SSR** (remote-URL vs. static-export tradeoffs): Capacitor docs on `server.url`; Next.js SSR-with-Capacitor community writeups
- **Capacitor Push / Local Notifications (APNs/FCM)**: capacitorjs.com/docs/apis/push-notifications ; capacitorjs.com/docs/apis/local-notifications ; capacitorjs.com/docs/guides/push-notifications-firebase
- **Google Play Data Safety & Health Connect policy**: support.google.com/googleplay/android-developer/ (Data safety, Health Connect)
