# Duravel iOS — Part 5 (HealthKit & wearables) — Bundle Manifest

Unzip into `C:\dev\duravel` → lands as `C:\dev\duravel\Apple\Part5_healthkit\`.
Nothing here is auto-installed into the app; copy each file to its **final
destination** below. `App.entitlements` and `Info.plist` entries must be
**merged** into the existing files, not overwritten.

Repo layout reminder: app lives under `hyroxai/`; iOS project under
`hyroxai/ios/App/App/`; web app source under `hyroxai/src/`. Adjust if your web
source root differs.

| Bundle path | Final destination in repo | Type | Note |
| --- | --- | --- | --- |
| `ios/DuravelHealthPlugin.swift` | `hyroxai/ios/App/App/DuravelHealthPlugin.swift` | code | Native Capacitor plugin: auth, anchored workout sync, HR enrichment, quantity reads, observer + background delivery. |
| `ios/DuravelHealthPlugin.m` | `hyroxai/ios/App/App/DuravelHealthPlugin.m` | code | Capacitor `CAP_PLUGIN` registration; JS name `DuravelHealth` must match `definitions.ts`. |
| `ios/App.entitlements` | `hyroxai/ios/App/App/App.entitlements` | config | **Merge**: `com.apple.developer.healthkit` + `...healthkit.background-delivery`. Xcode may already manage this file. |
| `config/Info.plist.additions.xml` | `hyroxai/ios/App/App/Info.plist` | config | **Merge** the two `<key>` pairs (`NSHealthShareUsageDescription`, `NSHealthUpdateUsageDescription`) into the top-level `<dict>`. Not a standalone file. |
| `web/definitions.ts` | `hyroxai/src/native/health/definitions.ts` | code | Plugin TS interface + `registerPlugin('DuravelHealth', …)`. |
| `web/web.ts` | `hyroxai/src/native/health/web.ts` | code | No-op web implementation (browser fallback) referenced by `definitions.ts`. |
| `web/healthkit.service.ts` | `hyroxai/src/native/health/healthkit.service.ts` | code | **Single import surface** `duravelHealth`: availability, auth, auto-sync, `syncNow`, recovery context, normalization to ingestion DTO, POST `/api/ingest/healthkit`. |
| `web/HealthKitPrimingScreen.tsx` | `hyroxai/src/native/health/HealthKitPrimingScreen.tsx` | code | Explain-before-prompt priming screen (React). Swap inline styles for Duravel design tokens. |
| `docs/README.md` | `hyroxai/docs/ios/part5/README.md` | doc | Part 5 index + integration order + dependencies. |
| `docs/HealthKit_Integration.md` | `hyroxai/docs/ios/part5/HealthKit_Integration.md` | doc | Plugin decision, entitlement, Info.plist strings + privacy copy, App Privacy label notes. |
| `docs/Permission_UX.md` | `hyroxai/docs/ios/part5/Permission_UX.md` | doc | Priming flow, invisible read-denial handling, real-device requirement, Settings deep link. |
| `docs/Ingestion_Mapping.md` | `hyroxai/docs/ios/part5/Ingestion_Mapping.md` | doc | HKWorkout → shared ingestion field map, activity normalization, cross-source dedupe rules vs Strava/Garmin. |
| `MANIFEST.md` | (bundle root — reference only) | doc | This file. |

## Post-copy steps
1. Xcode: enable **HealthKit** + **Background Modes** capabilities on the App target; regenerate provisioning profiles.
2. Apple Developer portal: enable HealthKit on App ID `app.duravel`.
3. Web app: `import { duravelHealth } from '@/native/health/healthkit.service'`; mount `HealthKitPrimingScreen` from onboarding/Settings.
4. Backend: add `POST /api/ingest/healthkit` feeding the existing shared ingestion + cross-source dedupe (see `Ingestion_Mapping.md`).
5. QA on a **real iPhone** (ideally + Apple Watch) — HealthKit does not work in Simulator.

Open decisions are in the run's **Needs Levi** section.
