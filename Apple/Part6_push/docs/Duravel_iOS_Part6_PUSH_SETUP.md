# Duravel iOS — Part 6: Push Notifications Setup (APNs + Capacitor 6)

> Scope: getting native APNs push working inside the Capacitor 6 shell that loads
> `https://app.duravel.app`. This doc covers Apple Developer config, the Xcode
> project changes, and the Capacitor plugin wiring. The runtime TS lives in the
> companion files; the send path lives in the edge function.
>
> **Levi todo items are called out inline as `⚠️ LEVI:` and collected in the
> Part 6 summary. Nothing here can be done from the cloud sandbox — it all needs
> your Apple Developer account + a Mac with Xcode.**

---

## 0. Architecture at a glance

```
                       ┌─────────────────────────────┐
  APNs device token →  │  Capacitor native shell     │
                       │  @capacitor/push-notif...   │
                       │   registration.ts (priming) │
                       └──────────────┬──────────────┘
                                      │ upsert token
                                      ▼
                       ┌─────────────────────────────┐
                       │  Supabase: push_tokens table│  (RLS: owner-only)
                       └──────────────┬──────────────┘
                                      │ read tokens
                                      ▼
   lifecycle event  →   ┌─────────────────────────────┐  APNs HTTP/2 (.p8 JWT)
   (trial-ending etc.)  │  edge fn: send-push         │ ───────────────────────►  APNs → device
                        │  quiet-hours + prefs gate   │
                        └─────────────────────────────┘
```

We use **token-based APNs auth (.p8 key)**, not certificate-based. One key works
for both sandbox (dev) and production, never expires, and covers all your apps —
far less maintenance than `.p12` certs.

---

## 1. Apple Developer Portal

### 1.1 Create the APNs Auth Key (.p8) — ⚠️ LEVI

1. Go to <https://developer.apple.com/account> → **Certificates, Identifiers & Profiles** → **Keys**.
2. Click **＋**, name it e.g. `Duravel APNs Key`.
3. Tick **Apple Push Notifications service (APNs)**. Continue → Register.
4. **Download the `.p8` file** — you can only download it ONCE. Store it in a
   password manager / secrets vault. If lost you must revoke and make a new one.
5. Record three values you'll need for the edge function:
   - **Key ID** — the 10-char ID shown next to the key (e.g. `ABC123DEFG`).
   - **Team ID** — top-right of the portal, or Membership page (e.g. `9XYZ8W7V6U`).
   - **Bundle ID** — `app.duravel` (already our convention).

### 1.2 Enable Push on the App ID — ⚠️ LEVI

1. **Identifiers** → select `app.duravel`.
2. Under **Capabilities**, check **Push Notifications** → Save.
3. (Re)generate provisioning profiles if you use manual signing. With Xcode
   automatic signing this is handled for you when you add the capability (§2.2).

---

## 2. Xcode project changes (Capacitor iOS app)

> These edit `ios/App/App.xcodeproj` + `Info.plist`. Because the cloud sandbox
> can't open Xcode, the exact plist/entitlement snippets are given so you can
> paste them or verify Xcode wrote them. Run `npx cap sync ios` first so the
> plugin is present in the Pods.

### 2.1 Install the plugin (can be done anywhere, committed to repo)

```bash
npm install @capacitor/push-notifications@^6.0.0
npx cap sync ios
```

`@capacitor/push-notifications@6` targets Capacitor 6 and iOS 15 — matches our
conventions.

### 2.2 Add the Push Notifications capability — ⚠️ LEVI (Xcode)

In Xcode: **App target → Signing & Capabilities → ＋ Capability → Push
Notifications**. This creates/updates `ios/App/App/App.entitlements`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>aps-environment</key>
    <string>development</string>  <!-- Xcode flips this to "production" for Release/TestFlight/App Store automatically -->
</dict>
</plist>
```

### 2.3 Add the Background Modes capability + remote-notification

In Xcode: **＋ Capability → Background Modes → tick "Remote notifications"**.
Verify `ios/App/App/Info.plist` contains:

```xml
<key>UIBackgroundModes</key>
<array>
    <string>remote-notification</string>
</array>
```

> Only add `remote-notification`. Do NOT add `fetch`/`processing` unless you
> actually do background fetch — extra modes draw App Review scrutiny.

### 2.4 AppDelegate — register with APNs and forward the token

Capacitor's `PushNotifications` plugin already swizzles the AppDelegate
callbacks, so **you normally do not need to touch `AppDelegate.swift`**. The
plugin forwards `didRegisterForRemoteNotificationsWithDeviceToken` to the JS
`registration` event automatically.

If you have disabled swizzling (`Info.plist` key
`CapacitorPushNotificationsSwizzlingEnabled = NO`), you must manually forward
the token — snippet in `Duravel_iOS_Part6_AppDelegate_reference.swift`. For a
default Capacitor project, leave swizzling on and skip that file.

### 2.5 Presentation while app is foregrounded

By default iOS suppresses banners when the app is in the foreground. Capacitor
exposes this via the JS `PushNotifications` config. In `capacitor.config.ts`:

```ts
import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'app.duravel',
  appName: 'Duravel',
  webDir: 'public', // n/a for remote URL shell, kept for cap tooling
  server: {
    url: 'https://app.duravel.app',
    cleartext: false,
    // allowNavigation kept narrow — see Part 1/2 shell config
  },
  plugins: {
    PushNotifications: {
      // Show alert + play sound + set badge while app is foregrounded.
      presentationOptions: ['alert', 'sound', 'badge'],
    },
  },
};

export default config;
```

---

## 3. APNs environments & tokens

- A **device token is environment-specific.** A token minted against the
  sandbox (dev build, `aps-environment=development`) will 400 `BadDeviceToken`
  if you send it to the production APNs host, and vice-versa.
- We store the token's environment alongside it (`push_tokens.apns_env`) so the
  send path picks the correct APNs host:
  - production: `https://api.push.apple.com`
  - sandbox:    `https://api.sandbox.push.apple.com`
- The client reports its environment from the build (`__DEV__`-style flag). See
  `registration.ts` `resolveApnsEnv()`.

---

## 4. Test checklist (once signed build is on a device) — ⚠️ LEVI

1. Install a **development** build on a physical device (push doesn't work in
   the simulator for real APNs, though iOS 16+ simulators support a limited
   local push via drag-drop `.apns` files for UI testing).
2. Launch → accept the priming sheet → accept the iOS system prompt.
3. Confirm a row lands in `push_tokens` for your `user_id`.
4. From Supabase, invoke `send-push` with your `user_id` and a test payload
   (see edge function README section). Confirm delivery + tap routing to the
   right screen via the Part 3 deep-link handler.
5. Repeat with app backgrounded and terminated.

---

## 5. Files in this part

| File | Purpose |
|------|---------|
| `Duravel_iOS_Part6_PUSH_SETUP.md` | This doc |
| `Duravel_iOS_Part6_push_tokens.sql` | `push_tokens` table + RLS + trigger |
| `Duravel_iOS_Part6_registration.ts` | Priming + permission + register + upsert |
| `Duravel_iOS_Part6_notificationCategories.ts` | Categories + payload types + tap→deep-link routing |
| `Duravel_iOS_Part6_send-push_edgefn.ts` | Supabase edge function: APNs send + quiet-hours + prefs |
| `Duravel_iOS_Part6_apnsProvider.ts` | Provider abstraction (APNs direct / pluggable) |
| `Duravel_iOS_Part6_notification_prefs.sql` | Per-user preference + quiet-hours columns |
| `Duravel_iOS_Part6_AppDelegate_reference.swift` | Only needed if swizzling disabled |
| `Duravel_iOS_Part6_LIFECYCLE_MAPPING.md` | Email→push mapping, cadence, prefs, unsubscribe |
| `Duravel_iOS_Part6_README.md` | Wiring + deploy order |
