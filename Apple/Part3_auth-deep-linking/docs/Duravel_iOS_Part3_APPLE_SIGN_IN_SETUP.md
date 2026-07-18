# Sign in with Apple — Configuration (Duravel iOS)

Sign in with Apple is **required** for App Store approval under Guideline 4.8,
because Duravel offers email login (a third-party/social login service). This
doc lists every dashboard step needed for `Duravel_iOS_Part3_apple-sign-in.ts`
to work. Nothing here can be done from the cloud sandbox — these are all
Levi-owned account actions. They are collected in NEEDS_LEVI as well.

## 0. Install the plugin

```bash
npm i @capacitor-community/apple-sign-in
npx cap sync ios
```

The plugin needs no CocoaPod beyond what `cap sync` wires up. It links against
`AuthenticationServices`, which is part of iOS.

## 1. Apple Developer — enable the capability

1. developer.apple.com → Certificates, Identifiers & Profiles → **Identifiers**.
2. Open the App ID for `app.duravel` (create it if the bundle id isn't
   registered yet).
3. Tick **Sign In with Apple** and Save. Leave it as the primary App ID
   (not grouped) unless you already run an Apple sign-in web service.

Regenerate/refresh the provisioning profile after enabling the capability, or
let Xcode's Automatically manage signing handle it.

## 2. Apple Developer — create the Services ID + key (for Supabase)

Supabase verifies the token server-side and (for the web/OAuth fallback) needs
Apple credentials. Create:

1. **Services ID** (Identifiers → `+` → Services IDs).
   - Description: `Duravel Web Auth`
   - Identifier: e.g. `app.duravel.signin` (this becomes Supabase's "Services ID").
   - Enable **Sign In with Apple** → Configure:
     - Primary App ID: `app.duravel`
     - Domains: `app.duravel.app`
     - Return URLs: `https://<YOUR-PROJECT-ref>.supabase.co/auth/v1/callback`
       and `https://app.duravel.app/auth/callback`
2. **Sign in with Apple Key** (Keys → `+`).
   - Enable Sign In with Apple, pick the primary App ID.
   - Download the `.p8` key file (**one-time download** — store it in the
     password manager). Note the **Key ID** and your **Team ID**.

## 3. Supabase — configure the Apple provider

Dashboard → Authentication → Providers → **Apple** → Enable, then fill:

| Field | Value |
|---|---|
| Client IDs | `app.duravel` (bundle id, for the native token flow) **and** `app.duravel.signin` (Services ID, for web) — comma-separated |
| Secret Key (for OAuth) | The signed client secret JWT built from the `.p8` key |
| Team ID / Key ID | From step 2 |

The native `signInWithIdToken` flow validates the token against the **Client
IDs** list — the bundle id `app.duravel` MUST be present there or Supabase
rejects the token with "audience mismatch". This is the single most common
failure; double-check it.

For the "Secret Key", Supabase can generate the client-secret JWT for you if
you paste the `.p8`, Team ID, Key ID, and Services ID; otherwise generate it
with the Supabase CLI / a short script (valid ≤ 6 months, must be rotated).

## 4. Supabase — redirect allow-list

Authentication → URL Configuration → **Redirect URLs**, add:

```
https://app.duravel.app/auth/callback
duravel://auth/callback
```

The custom-scheme entry lets the OAuth web fallback bounce back into the app.

## 5. Xcode — entitlement

Add the **Sign In with Apple** capability in Xcode (Signing & Capabilities tab),
or add it to the entitlements file. See
`Duravel_iOS_Part3_Duravel.entitlements` — it already contains the
`com.apple.developer.applesignin` key.

## 6. Verify

- Build to a real device (Apple sign-in does not run in the simulator before
  iOS 13.5 and is flaky on simulators generally — test on hardware).
- First sign-in: the name should be captured and written to `profiles`.
- Delete the app, reinstall, sign in again: name will be `null` from Apple
  (expected — Apple only returns it once), but the account resolves to the
  same user because the Apple `sub` is stable.
- Test "Hide My Email": Supabase receives an Apple private relay address
  (`...@privaterelay.appleid.com`). Make sure Resend/your transactional email
  is configured so relayed addresses can still receive mail, or gate email
  features gracefully.

## Common rejection / breakage causes

- Bundle id missing from Supabase "Client IDs" → audience mismatch.
- Sign In with Apple button not styled/placed per Apple HIG (must be at least
  as prominent as other login buttons — 4.8 also implies parity of prominence).
- Client secret JWT expired (max 6 months) → web fallback breaks silently.
- No account-deletion path → separate 5.1.1(v) rejection (see account-deletion).
