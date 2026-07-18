# Duravel iOS — Part 5: HealthKit Integration

**Scope:** How Duravel's Capacitor 6 native shell reads Apple Health / HealthKit
data and feeds it into the existing shared workout-ingestion pipeline.
This doc covers the plugin decision, the entitlement, and the `Info.plist`
usage strings. Permission UX is in `Permission_UX.md`; the ingestion/dedupe
contract is in `Ingestion_Mapping.md`.

---

## 1. Plugin decision — build a thin custom plugin

**Recommendation: ship a small, purpose-built Capacitor plugin (`DuravelHealth`),
not a general-purpose community plugin.**

Rationale:

- **Community options exist but are a poor fit.** The main candidates are
  `@perfood/capacitor-healthkit` (read-focused, actively maintained, Capacitor
  6 compatible) and `cordova-plugin-health` (broad, older, Cordova-bridged).
  Both expose a generic "sample" API. Duravel does not need a generic health
  browser — it needs (a) `HKWorkout` objects with their per-workout summary
  metrics, (b) a handful of daily-context quantity types (resting HR, HRV,
  VO2max), and (c) **background delivery + anchored incremental sync** so new
  Apple Watch workouts land in Duravel without the user reopening the app.
  Background delivery and anchored queries are exactly where the generic
  plugins are weakest or absent.
- **We control the ingestion contract.** The Swift layer can emit workouts in
  the *exact* shape our shared ingestion endpoint already accepts (see
  `Ingestion_Mapping.md`), so the web app does near-zero reshaping.
- **Surface area is small.** ~1 Swift file + 1 registration file + a TS
  definitions file. Maintaining that is cheaper than fighting a third-party
  plugin's abstractions and release cadence for the one feature (background
  workout sync) we most care about.

**Fallback / faster path:** if we want something in TestFlight *this week*
before the custom plugin is hardened, `@perfood/capacitor-healthkit` can cover
the foreground read case (queryWorkouts + querySampleType). Treat that as a
stopgap; it does **not** give us background delivery, so watch workouts would
only sync when the app is foregrounded. The custom plugin in this part
supersedes it. **Do not ship both** — pick one to own the HealthKit
authorization request, because whichever asks first defines the permission
sheet the user sees.

Delivered plugin files:

| File | Role |
| --- | --- |
| `Duravel_iOS_Part5_HealthKitPlugin.swift` | Native plugin: auth, reads, anchored sync, observers, background delivery |
| `Duravel_iOS_Part5_HealthKitPlugin.m` | Objective-C registration so Capacitor sees the plugin + its methods |
| `Duravel_iOS_Part5_definitions.ts` | TypeScript interface + `registerPlugin` binding |
| `Duravel_iOS_Part5_healthkit.service.ts` | Single import surface the web app uses |

---

## 2. Enable the HealthKit capability & entitlement

HealthKit is a *capability* — it needs both an entitlement file and an App ID
that has HealthKit enabled in the Apple Developer portal.

### In the Apple Developer portal
1. Certificates, Identifiers & Profiles → your App ID `app.duravel`.
2. Enable **HealthKit**.
3. Regenerate the provisioning profiles (development + distribution) so they
   carry the capability. If profiles are managed automatically by Xcode, just
   re-run automatic signing after adding the capability below.

### In Xcode
1. Target **App** → **Signing & Capabilities** → **+ Capability** → **HealthKit**.
   This creates/updates `App.entitlements` with the `com.apple.developer.healthkit`
   key. Use the delivered `Duravel_iOS_Part5_App.entitlements` as the reference
   contents.
2. We are **not** requesting Clinical Health Records, so do **not** enable that
   sub-option. Keeping it off avoids an extra App Review justification.
3. **Background Delivery** — to receive `HKObserverQuery` callbacks while the app
   is suspended, HealthKit background delivery must be declared. On the current
   entitlement schema this is the
   `com.apple.developer.healthkit.background-delivery` boolean, already present
   in the delivered entitlements file. Also enable the **Background Modes**
   capability if not already on (no specific mode checkbox is required for
   HealthKit background delivery, but the capability keeps the build config
   explicit).

### Entitlements file (reference)

See `Duravel_iOS_Part5_App.entitlements`. Key contents:

```xml
<key>com.apple.developer.healthkit</key>
<true/>
<key>com.apple.developer.healthkit.background-delivery</key>
<true/>
```

> If you later add Clinical Records you would add
> `com.apple.developer.healthkit.access` with an array of record types. We do
> not use it.

---

## 3. Info.plist usage descriptions (required — app crashes without them)

HealthKit **hard-crashes on first access** if the read (and, if you ever write,
the write) usage strings are missing. Duravel currently only **reads**, but we
include the update string too because it is cheap insurance and lets us write
workouts back later (e.g. logging a Duravel session to Apple Health) without a
resubmission surprise.

Add these to `App/Info.plist` (snippet delivered as
`Duravel_iOS_Part5_Info.plist.additions.xml`):

```xml
<key>NSHealthShareUsageDescription</key>
<string>Duravel reads your workouts, heart rate, HRV, VO2 max, resting heart rate, and calories from Apple Health so your training and recovery show up automatically and your coach can tailor your plan. Your health data stays private, is only used to power your Duravel training, and is never sold.</string>

<key>NSHealthUpdateUsageDescription</key>
<string>Duravel can save the workouts you complete in the app back to Apple Health, so all of your training lives in one place. You choose exactly what Duravel is allowed to write.</string>
```

Copy notes (App Review + trust):
- **Say what is read and why**, in plain language, tied to a user benefit
  ("show up automatically", "tailor your plan"). Reviewers reject vague strings
  like "We use HealthKit."
- **Name the data categories** the user will see on the permission sheet
  (workouts, heart rate, HRV, VO2 max, resting HR, calories). Matching the
  string to the sheet reduces the "why is it asking for this?" drop-off.
- **State the privacy posture** ("stays private… never sold"). This maps to our
  App Privacy nutrition label and to real behavior — HealthKit data is not sold
  or used for advertising.

### App Privacy (App Store Connect) — don't forget
Because we read health data, the App Privacy questionnaire must declare **Health
& Fitness** data collection, its purpose (App Functionality / Product
Personalization), whether it's linked to identity (yes — it's tied to the
Duravel account it's ingested into), and that it is **not** used for tracking.
Health data must **never** be used for advertising or shared with data brokers —
that is an App Store guideline violation (§5.1.3) and would get the app pulled.

---

## 4. Runtime environment constraints

- **HealthKit is unavailable on iPad-only builds and in the Simulator's health
  store in a meaningful way.** Always gate on `HKHealthStore.isHealthDataAvailable()`
  and surface a graceful "Apple Health isn't available on this device" state.
- **Real device required for meaningful testing.** The Simulator has no Health
  app data and no watch, so workouts/HRV/VO2max queries return empty and
  background delivery does not fire. QA HealthKit on a physical iPhone paired
  with an Apple Watch.
- **Authorization is per-type and write-visible-only.** For privacy, iOS never
  tells you whether the user *denied* a **read** type — a denied read type just
  returns empty results, identical to "no data". Design the UX around "no data
  yet" rather than trying to detect read-denials (see `Permission_UX.md`).

---

## 5. Wiring into the Capacitor shell (checklist)

1. Add the four delivered plugin files into the iOS project
   (`ios/App/App/` for the Swift + `.m`; the TS files go into the web app under
   `src/native/health/`).
2. Add the entitlement + Info.plist strings (sections 2–3).
3. Enable HealthKit + Background Modes capabilities in Xcode.
4. In the web app, import from the single service surface:
   `import { duravelHealth } from '@/native/health/healthkit.service'`.
5. Call `duravelHealth.isAvailable()` on the settings/onboarding screen; show the
   priming screen (`Permission_UX.md`) before `duravelHealth.requestAuthorization()`.
6. After auth, call `duravelHealth.startBackgroundSync()` once so observers +
   background delivery register; on cold start also run
   `duravelHealth.syncNow()` to pull anything missed.

---

## 6. Open decisions for Levi
Recorded in the run's **Needs Levi** section — summary: confirm bundle/App ID
HealthKit enablement in the portal, confirm we're read-only for v1 (write string
included but unused), and confirm the App Privacy label copy above matches
marketing.
