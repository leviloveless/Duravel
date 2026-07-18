# Duravel iOS — Part 1: Foundation & Architecture

*Autonomous build, part 1 of 7. Produces the Capacitor scaffold plan + drop-in
config. Integrate into `C:\dev\duravel` in the morning.*

---

## 1. Decision D1 — how the webview loads (locked, reversible)

**Ship v1 as a remote shell.** `capacitor.config.ts` sets `server.url` to the
hosted production app. The native binary is a thin shell; the product is your
live Next.js app, so a web deploy updates the app instantly with no resubmission.

Trade-offs and mitigations:

- **App Store §4.2 "minimum functionality"** — Apple rejects apps that are "just a
  website." *Mitigation:* v1 ships four real native capabilities — HealthKit
  import (Part 5), push (Part 6), StoreKit IAP (Part 4), and native
  haptics/splash/offline (Part 2). That is comfortably above the 4.2 bar for a
  Health & Fitness app.
- **Offline** — a remote shell needs a network. *Mitigation:* a native offline
  screen + retry (Part 2). Full offline is a later bundled-build migration.
- **Migration path** — if review pushes back or offline becomes a priority, move
  the front-end to a Capacitor-bundled build (`webDir` + API calls to the same
  backend). The plugin code from Parts 2–6 is unchanged by that switch.

## 2. Repo layout (added to the existing repo)

```
C:\dev\duravel\
  hyroxai/                 # existing Next.js app (unchanged)
  ios/                     # Capacitor-generated Xcode project (committed)
  capacitor.config.ts      # → from ios-artifacts/capacitor.config.ts
  package.json             # + Capacitor deps (see §4)
  scripts/ios-setup.sh     # → from ios-artifacts/ios-setup.sh
```

Run Capacitor from the repo root (or from `hyroxai/` if you prefer the config to
live with the web app — keep it consistent with where `package.json` is).

## 3. iOS setup script

`ios-artifacts/ios-setup.sh` contains the exact commands to install Capacitor,
add the iOS platform, and generate `ios/`. Run it **on the Mac** after copying
the config in. It is idempotent-ish; read the comments before running.

## 4. Dependencies to add (`package.json`)

```jsonc
{
  "dependencies": {
    "@capacitor/core": "^6.1.0",
    "@capacitor/ios": "^6.1.0",
    "@capacitor/app": "^6.0.0",
    "@capacitor/haptics": "^6.0.0",
    "@capacitor/keyboard": "^6.0.0",
    "@capacitor/preferences": "^6.0.0",
    "@capacitor/browser": "^6.0.0",
    "@capacitor/splash-screen": "^6.0.0",
    "@capacitor/status-bar": "^6.0.0",
    "@capacitor/push-notifications": "^6.0.0"
  },
  "devDependencies": {
    "@capacitor/cli": "^6.1.0"
  }
}
```
*HealthKit (Part 5) and StoreKit IAP (Part 4) use community/native plugins named
in those parts. Versions pinned to Capacitor 6; bump together if you move to 7.*

## 5. `Info.plist` keys the app will require (assembled across parts)

Add as each capability lands; listed here so nothing is missed:

- `NSHealthShareUsageDescription`, `NSHealthUpdateUsageDescription` — HealthKit (Part 5)
- `NSUserTrackingUsageDescription` — only if any analytics/ATT is added
- `NSMotionUsageDescription` — if motion/step data is read
- `UIBackgroundModes` → `remote-notification` — push (Part 6); `processing`/
  HealthKit background delivery (Part 5)
- `NSCameraUsageDescription` / `NSPhotoLibraryUsageDescription` — only if
  profile-photo upload is enabled
- `CFBundleURLTypes` → `duravel` scheme; Associated Domains → `applinks:app.duravel.app` (Part 3)
- `SKAdNetworkItems` — only if ads/attribution (not currently planned)

## 6. `.gitignore` additions

```
# Capacitor / iOS
ios/App/Pods/
ios/App/App/public/
ios/.build/
DerivedData/
*.xcuserstate
ios/App/App.xcworkspace/xcuserdata/
```
Commit the `ios/` project itself (App target, Info.plist, entitlements); ignore
Pods and build output.

## 7. Capabilities the App ID must enable (for §3 signing, your to-do)

HealthKit · Push Notifications · Sign in with Apple · In-App Purchase ·
Associated Domains. Enable all five on the App ID now so provisioning profiles
don't need regenerating mid-build.

## 8. What Part 1 hands to Part 2

A working config that loads the app and the plugin dependency list. Part 2 builds
the native shell UX (icons, splash, insets, offline, haptics) on top of this.

## 9. Needs Levi

- Confirm production URL (`app.duravel.app`) and that it renders without
  X-Frame/CSP issues in a native webview.
- Decide whether Capacitor config/`package.json` lives at repo root or in
  `hyroxai/` (I assumed root).
