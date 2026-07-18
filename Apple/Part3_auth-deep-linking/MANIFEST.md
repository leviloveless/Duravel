# Duravel iOS — Part 3 (Auth, secure session & deep linking) — MANIFEST

Unzip into `C:\dev\duravel`. This bundle lands as
`C:\dev\duravel\Apple\Part3_auth-deep-linking\`. Copy each file to its **repo
destination** below (paths are relative to the repo root `C:\dev\duravel\`).
`hyroxai/native/` is a suggested home for the shared shell TS modules — adjust
to match the project's import alias (`@/native/...`).

| Bundle path | Repo destination | Type | Note |
|---|---|---|---|
| `web/Duravel_iOS_Part3_supabase-storage-adapter.ts` | `hyroxai/native/Duravel_iOS_Part3_supabase-storage-adapter.ts` | code | Keychain-backed (Preferences fallback) storage adapter for supabase-js |
| `web/Duravel_iOS_Part3_supabase-client.ts` | `hyroxai/native/Duravel_iOS_Part3_supabase-client.ts` | code | Single supabase client for the shell (PKCE, native storage, detectSessionInUrl off) |
| `web/Duravel_iOS_Part3_session-manager.ts` | `hyroxai/native/Duravel_iOS_Part3_session-manager.ts` | code | Restore session on launch; refresh on resume; auth-change fan-out |
| `web/Duravel_iOS_Part3_native-bootstrap.ts` | `hyroxai/native/Duravel_iOS_Part3_native-bootstrap.ts` | code | Single launch entrypoint; mount via a client component in `app/layout.tsx` |
| `web/Duravel_iOS_Part3_apple-sign-in.ts` | `hyroxai/native/Duravel_iOS_Part3_apple-sign-in.ts` | code | Native Sign in with Apple → `signInWithIdToken` |
| `web/Duravel_iOS_Part3_deep-link-router.ts` | `hyroxai/native/Duravel_iOS_Part3_deep-link-router.ts` | code | Routes `appUrlOpen` incl. Supabase confirm/reset links |
| `web/Duravel_iOS_Part3_account-deletion-client.ts` | `hyroxai/native/Duravel_iOS_Part3_account-deletion-client.ts` | code | Client call to the `delete-account` Edge Function |
| `web/Duravel_iOS_Part3_apple-app-site-association.json` | served at `hyroxai/app/.well-known/apple-app-site-association/route.ts` (see AASA_DEPLOY.md) | config | Universal Links ownership file — serve with NO `.json` extension, `application/json`. Replace `TEAMID` |
| `ios/Duravel_iOS_Part3_Duravel.entitlements` | `hyroxai/ios/App/App/Duravel.entitlements` | config | Associated Domains + Sign in with Apple entitlements |
| `ios/Duravel_iOS_Part3_Info.plist.snippet.xml` | merge into `hyroxai/ios/App/App/Info.plist` | config | `duravel://` CFBundleURLTypes — MERGE keys, don't replace |
| `config/Duravel_iOS_Part3_delete-account-edge-function.ts` | `hyroxai/supabase/functions/delete-account/index.ts` | code | Server-side account+data deletion (service role) |
| `config/Duravel_iOS_Part3_account-deletion.sql` | run in Supabase SQL editor (source-control at `hyroxai/supabase/migrations/`) | script | CASCADE FKs + `delete_my_account_data()` RPC |
| `docs/Duravel_iOS_Part3_README.md` | `Apple/Part3_auth-deep-linking/` (reference) | doc | Overview, install, wire-up, assumptions |
| `docs/Duravel_iOS_Part3_NEEDS_LEVI.md` | reference | doc | All account/secret/decision items only Levi can do |
| `docs/Duravel_iOS_Part3_APPLE_SIGN_IN_SETUP.md` | reference | doc | Apple Developer + Supabase config for Apple sign-in |
| `docs/Duravel_iOS_Part3_AASA_DEPLOY.md` | reference | doc | How to serve the AASA from Next.js/Vercel |
| `docs/Duravel_iOS_Part3_account-deletion-plan.md` | reference | doc | UI/route plan for App Store §5.1.1(v) |

## Install deps (in `hyroxai/`)
```
npm i @capacitor/app @capacitor/preferences \
      @capacitor-community/apple-sign-in \
      @capacitor-community/secure-storage-plugin
npx cap sync ios
```

See `docs/Duravel_iOS_Part3_README.md` for full wire-up and
`docs/Duravel_iOS_Part3_NEEDS_LEVI.md` for the Levi-only checklist.
