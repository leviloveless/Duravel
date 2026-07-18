# Duravel iOS — Part 3: Auth, secure session & deep linking

Drop-in artifacts for the Capacitor 6 native shell that loads
`https://app.duravel.app`. Everything here ships **inside the web bundle
(`hyroxai/`)** except the iOS config files (entitlements, Info.plist, AASA) and
the Supabase Edge Function / SQL. Nothing was (or can be) compiled or signed in
this environment — these are ready-to-commit sources.

## File map

| File | Goes where | Purpose |
|---|---|---|
| `Duravel_iOS_Part3_supabase-storage-adapter.ts` | `hyroxai/native/` | Keychain-backed (Preferences fallback) storage for supabase-js |
| `Duravel_iOS_Part3_supabase-client.ts` | `hyroxai/native/` | Single supabase client for the shell (PKCE, native storage) |
| `Duravel_iOS_Part3_session-manager.ts` | `hyroxai/native/` | Restore session on launch; refresh on resume; auth events |
| `Duravel_iOS_Part3_apple-sign-in.ts` | `hyroxai/native/` | Native Sign in with Apple → Supabase session |
| `Duravel_iOS_Part3_APPLE_SIGN_IN_SETUP.md` | docs | Apple Developer + Supabase config for Apple sign-in |
| `Duravel_iOS_Part3_deep-link-router.ts` | `hyroxai/native/` | Routes appUrlOpen incl. Supabase email confirm/reset |
| `Duravel_iOS_Part3_native-bootstrap.ts` | `hyroxai/native/` | Single launch entrypoint that wires it all together |
| `Duravel_iOS_Part3_apple-app-site-association.json` | host at `/.well-known/` | Universal Links ownership file |
| `Duravel_iOS_Part3_AASA_DEPLOY.md` | docs | How to serve the AASA from Next.js/Vercel |
| `Duravel_iOS_Part3_Duravel.entitlements` | `ios/App/App/` | Associated Domains + Sign in with Apple entitlements |
| `Duravel_iOS_Part3_Info.plist.snippet.xml` | merge into `ios/App/App/Info.plist` | `duravel://` custom scheme |
| `Duravel_iOS_Part3_delete-account-edge-function.ts` | `supabase/functions/delete-account/index.ts` | Server-side account+data deletion |
| `Duravel_iOS_Part3_account-deletion.sql` | Supabase SQL editor | CASCADE FKs + self-delete RPC |
| `Duravel_iOS_Part3_account-deletion-client.ts` | `hyroxai/native/` | Client call to the deletion function |
| `Duravel_iOS_Part3_account-deletion-plan.md` | docs | UI/route plan for 5.1.1(v) compliance |
| `Duravel_iOS_Part3_NEEDS_LEVI.md` | docs | Everything only Levi can do (accounts, secrets, decisions) |

## Install the npm deps (in `hyroxai/`)

```bash
npm i @capacitor/app @capacitor/preferences \
      @capacitor-community/apple-sign-in \
      @capacitor-community/secure-storage-plugin
npx cap sync ios
```

`@supabase/supabase-js` and `@capacitor/core` are assumed already present.

## Wire-up (one component)

1. Copy the `.ts` files into `hyroxai/native/`.
2. Add a client component that calls `bootstrapNativeShell()` in a `useEffect`
   and render it in `app/layout.tsx` (snippet in `native-bootstrap.ts`).
3. Point the Apple / login buttons at `signInWithApple()`.
4. Add the `/settings/account/delete` pages per the deletion plan.

## Config (iOS project)

1. Add `Duravel.entitlements` to the target and set **Code Signing
   Entitlements** to it (or add the capabilities in Xcode).
2. Merge the Info.plist snippet.
3. Deploy the AASA at `https://app.duravel.app/.well-known/apple-app-site-association`.
4. Deploy the Edge Function and run the SQL.

Then everything Levi-only is in `Duravel_iOS_Part3_NEEDS_LEVI.md`.

## Assumptions made (autonomous run)

- **Keychain over UserDefaults.** The brief said "@capacitor/preferences backed
  by iOS keychain", but Preferences on iOS is UserDefaults (not encrypted). I
  defaulted the session store to a Keychain-backed adapter and kept Preferences
  as the fallback. If you specifically want plain Preferences, swap
  `pickAuthStorage()` to return `PreferencesStorageAdapter`.
- **`detectSessionInUrl: false`** because we route email links ourselves; if the
  web app already relies on Supabase's own URL detection in the browser, keep
  that separate browser client and only use this one in the shell.
- **Table names** (`workouts`, `programs`, `progress_logs`, …) are best-guess
  placeholders — reconcile with the real schema before running the SQL.
- **PKCE flow** assumed for Supabase email links; if the project is still on the
  implicit flow, the router handles both (`?code` and `#access_token`).
