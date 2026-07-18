# Duravel iOS — Part 5: HealthKit & Wearables (index)

Drop-in artifacts for HealthKit integration in the Capacitor 6 native shell.
Everything here is scoped to Part 5. Cannot be compiled/signed in the build
sandbox — these are real, ready-to-add files + docs.

## Files

**Docs**
- `Duravel_iOS_Part5_HealthKit_Integration.md` — plugin decision (thin custom
  `DuravelHealth` plugin), HealthKit capability/entitlement, Info.plist usage
  strings + privacy copy, App Privacy label notes, wiring checklist.
- `Duravel_iOS_Part5_Permission_UX.md` — explain-before-prompt priming screen,
  request flow, the invisible read-denial quirk, real-device requirement,
  Settings deep-link recovery path.
- `Duravel_iOS_Part5_Ingestion_Mapping.md` — HKWorkout → shared ingestion schema
  field map, activity-type normalization, and the cross-source **dedupe rules**
  vs Strava/Garmin (start-time + duration + distance tolerances, source
  priority, race handling).

**iOS native (add to `ios/App/App/`)**
- `Duravel_iOS_Part5_HealthKitPlugin.swift` — the plugin: availability, auth,
  anchored incremental workout sync, per-workout HR enrichment, quantity reads
  (resting HR, HRV SDNN, VO2max, energy, distance), observer + background
  delivery.
- `Duravel_iOS_Part5_HealthKitPlugin.m` — Capacitor registration.
- `Duravel_iOS_Part5_App.entitlements` — HealthKit + background-delivery keys.
- `Duravel_iOS_Part5_Info.plist.additions.xml` — NSHealthShare/UpdateUsageDescription.

**Web app (add under `src/native/health/`)**
- `Duravel_iOS_Part5_definitions.ts` — plugin TS interface + `registerPlugin`.
- `Duravel_iOS_Part5_web.ts` — no-op web implementation (browser fallback).
- `Duravel_iOS_Part5_healthkit.service.ts` — **single import surface**
  (`duravelHealth`): availability, auth, auto-sync, `syncNow`, recovery context,
  normalization to the ingestion DTO, POST to `/api/ingest/healthkit`.
- `Duravel_iOS_Part5_HealthKitPrimingScreen.tsx` — priming screen React component.

## Suggested file placement (rename off the prefix)
```
ios/App/App/
  DuravelHealthPlugin.swift
  DuravelHealthPlugin.m
  App.entitlements            (merge with existing)
  Info.plist                  (merge the two usage strings)

src/native/health/
  definitions.ts
  web.ts
  healthkit.service.ts
  HealthKitPrimingScreen.tsx
```

## Integration order
1. Enable HealthKit + Background Modes capabilities in Xcode; add entitlement +
   Info.plist strings.
2. Add the Swift + `.m` files; build once on a real device.
3. Add the TS files; `import { duravelHealth } from '@/native/health/healthkit.service'`.
4. Show `HealthKitPrimingScreen` from onboarding/Settings; on connect it calls
   `enableAutoSync()` + `syncNow()`.
5. Build `/api/ingest/healthkit` to feed the existing shared ingestion +
   cross-source dedupe (see Ingestion_Mapping.md).

## Depends on
- **Part 2 native bridge** — the service talks to the native plugin; if Part 2
  provides a bridge helper, swap the direct plugin import (public API unchanged).
- **Existing shared ingestion pipeline** — HealthKit is one more source into it.

See the run's **Needs Levi** section for the open decisions.
