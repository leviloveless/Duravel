# Duravel iOS — Part 6 README (Push & Lifecycle)

Drop-in artifacts for native push notifications in the Capacitor 6 shell +
optional lifecycle pushes that ride the existing email cadence. Nothing here was
compiled/signed (cloud sandbox constraint) — treat as review-ready source.

## File → destination map

| Artifact | Put it at | Notes |
|---|---|---|
| `Duravel_iOS_Part6_push_tokens.sql` | Supabase migration | run first |
| `Duravel_iOS_Part6_notification_prefs.sql` | Supabase migration | run second (depends on `notif_category` enum used by scheduled_pushes) |
| `Duravel_iOS_Part6_scheduled_pushes.sql` | Supabase migration | optional (quiet-hours deferral); run third |
| `Duravel_iOS_Part6_registration.ts` | `src/native/push/registration.ts` | web app |
| `Duravel_iOS_Part6_notificationCategories.ts` | `src/native/push/notificationCategories.ts` | fix Part 3 import path |
| `Duravel_iOS_Part6_apnsProvider.ts` | `supabase/functions/send-push/apnsProvider.ts` | Deno/Edge |
| `Duravel_iOS_Part6_send-push_edgefn.ts` | `supabase/functions/send-push/index.ts` | Deno/Edge |
| `Duravel_iOS_Part6_AppDelegate_reference.swift` | reference only | paste §A for action buttons |
| `Duravel_iOS_Part6_PUSH_SETUP.md` | docs | APNs + Xcode setup |
| `Duravel_iOS_Part6_LIFECYCLE_MAPPING.md` | docs | email→push wiring |

## Deploy order

1. **DB**: run the three SQL files in order (tokens → prefs → scheduled).
2. **Secrets** (Supabase → Edge Functions → Secrets):
   `APNS_KEY_P8`, `APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_BUNDLE_ID=app.duravel`,
   and optionally `SEND_PUSH_INTERNAL_SECRET`. `SUPABASE_URL` /
   `SUPABASE_SERVICE_ROLE_KEY` are injected automatically.
3. **Edge fn**: `supabase functions deploy send-push` (put apnsProvider.ts
   beside index.ts).
4. **App**: `npm i @capacitor/push-notifications@^6` → `npx cap sync ios` →
   add Push + Background Modes capabilities in Xcode (see PUSH_SETUP §2).
5. **Wire** registration + tap routing in the post-login bootstrap (example at
   the bottom of `registration.ts`); fix the Part 3 import in
   `notificationCategories.ts`.
6. **Settings UI**: build the Email/Push matrix (LIFECYCLE_MAPPING §3) before
   enabling any lifecycle fan-out.
7. **Lifecycle**: add the inline `send-push` call in the dispatcher, one
   category at a time (LIFECYCLE_MAPPING §6).

## Design decisions I made (autonomous — flag if you disagree)

- **Token-based APNs (.p8)** over certificate (.p12) — one key, never expires,
  both environments. Standard for new apps.
- **Direct APNs HTTP/2 from the edge fn** via Web Crypto ES256, behind a
  `PushProvider` interface — no third-party push vendor, no native dep, and
  swappable if you later want OneSignal/Expo. If you'd rather not run your own
  APNs JWT, implement the interface with a vendor SDK and change one line.
- **Upsert via SECURITY INVOKER RPC** so RLS still applies AND a token that
  moves between accounts on one device re-homes cleanly (unique on `token`).
- **Quiet hours = defer, not drop** (except `dropIfQuiet`), so a nudge suppressed
  at 11pm still arrives at 8am. Requires the optional scheduled_pushes worker.
- **marketing opt-IN, everything else opt-out**, master `push_enabled` switch,
  `account` transactional (bypasses quiet hours). Matches email norms.
- **One routing table**: every push tap resolves to a `duravel://` link handled
  by the Part 3 handler — no parallel nav logic.

## Known gaps / assumptions (verify)

- Part 3 handler import path in `notificationCategories.ts` is a guess
  (`../deeplinks/handleDeepLink`) — repoint to the real export.
- Deep-link route shapes (`duravel://session/{id}`, `program/{id}`,
  `account/billing`, `progress/streak`, `home`) assume Part 3's route table.
  If Part 3 used different paths, update `DeepLinks` (client) + `serverFallbackLink`
  (edge fn) to match — they must agree.
- The lifecycle email system's exact event names/dispatch hook are unknown from
  the sandbox; `EMAIL_TO_PUSH` mapping + inline fan-out is pseudocode to adapt.
- `resolveApnsEnv` default returns `production`; set an explicit build flag
  (`__DURAVEL_APNS_ENV__` or `import.meta.env.PROD`) so dev builds report
  `sandbox`, or dev-device tokens will 400 against prod APNs.
- Android is stubbed in the schema (`platform` enum) but not implemented — iOS
  only for this part.
