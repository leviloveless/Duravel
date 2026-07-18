# Duravel iOS — Part 6 (Push Notifications & Lifecycle) — MANIFEST

Bundle root: `Apple/Part6_push/`. Unzips into `C:\dev\duravel` → lands as
`C:\dev\duravel\Apple\Part6_push`. Nothing was written to your machine; this zip
is the delivery. Copy each file to its **destination path** below.

| Bundle path | Destination in repo | Type | Note |
|---|---|---|---|
| `docs/Duravel_iOS_Part6_README.md` | `docs/ios/part6/README.md` | doc | Start here — file→destination map + deploy order + design decisions |
| `docs/Duravel_iOS_Part6_PUSH_SETUP.md` | `docs/ios/part6/PUSH_SETUP.md` | doc | APNs .p8, Apple portal, Xcode capabilities, `UIBackgroundModes` |
| `docs/Duravel_iOS_Part6_LIFECYCLE_MAPPING.md` | `docs/ios/part6/LIFECYCLE_MAPPING.md` | doc | Email→push mapping, cadence, prefs, quiet hours, unsubscribe |
| `db/Duravel_iOS_Part6_push_tokens.sql` | `supabase/migrations/20260718_0001_push_tokens.sql` | code (SQL) | `push_tokens` table + RLS + `upsert_push_token` RPC. Run **1st** |
| `db/Duravel_iOS_Part6_notification_prefs.sql` | `supabase/migrations/20260718_0002_notification_prefs.sql` | code (SQL) | `notification_preferences` + `push_gate()` + auto-provision trigger. Run **2nd** |
| `db/Duravel_iOS_Part6_scheduled_pushes.sql` | `supabase/migrations/20260718_0003_scheduled_pushes.sql` | code (SQL) | Quiet-hours deferral: `scheduled_pushes` + `next_quiet_end()` + `claim_due_pushes()`. Optional. Run **3rd** |
| `web/Duravel_iOS_Part6_registration.ts` | `src/native/push/registration.ts` | code (TS, client) | Priming + permission + register + token upsert |
| `web/Duravel_iOS_Part6_notificationCategories.ts` | `src/native/push/notificationCategories.ts` | code (TS, client) | Categories, typed payloads, tap→Part 3 deep-link routing. **Fix Part 3 import path** |
| `web/Duravel_iOS_Part6_apnsProvider.ts` | `supabase/functions/send-push/apnsProvider.ts` | code (TS, edge) | APNs HTTP/2 provider (ES256 JWT via Web Crypto), swappable interface |
| `web/Duravel_iOS_Part6_send-push_edgefn.ts` | `supabase/functions/send-push/index.ts` | code (TS, edge) | Send path: prefs+quiet-hours gate, send to tokens, disable dead tokens |
| `ios/Duravel_iOS_Part6_AppDelegate_reference.swift` | `ios/App/App/AppDelegate.swift` (paste §A) | code (Swift, reference) | §A actionable categories; §B only if swizzling disabled |

## Apply order
1. Run the three SQL migrations in order (tokens → prefs → scheduled).
2. Set edge-fn secrets (`APNS_KEY_P8`, `APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_BUNDLE_ID=app.duravel`, optional `SEND_PUSH_INTERNAL_SECRET`), then `supabase functions deploy send-push` (apnsProvider.ts sits beside index.ts).
3. `npm i @capacitor/push-notifications@^6` → `npx cap sync ios` → add Push + Background Modes capabilities in Xcode.
4. Drop the two client TS files under `src/native/push/`; repoint the Part 3 handler import in `notificationCategories.ts`.
5. Paste `AppDelegate` §A for action buttons.
6. Build the Settings Email/Push matrix, then wire the lifecycle fan-out one category at a time.

See `docs/Duravel_iOS_Part6_README.md` → "Known gaps / assumptions" for the items to verify (Part 3 import path, deep-link route shapes, APNs env flag, lifecycle dispatcher hook).
