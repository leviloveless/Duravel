# The iPhone app and Sign in with Apple — setup without a Mac

_2026-09-28. Everything below is done in a web browser. The builds run on Codemagic's Macs._

## What is already in the repo

| Piece | Where |
|---|---|
| The Xcode project (Capacitor 8, Swift Package Manager) | `ios/` |
| App settings: loads `https://duravel.app/dashboard`, `duravel://` link scheme | `capacitor.config.ts` |
| Offline screen shown when duravel.app can't be reached | `ios-shell/index.html` |
| Universal Links + password autofill for duravel.app | `ios/App/App/App.entitlements` |
| Google / Apple sign-in inside the app (opens in an in-app Safari sheet, returns via `duravel://auth/confirm`) | `components/auth/oauth-form.tsx`, `components/native/native-bridge.tsx`, `lib/native/deep-link.ts` |
| "Continue with Apple" on /signup **and** /login | `components/auth/oauth-buttons.tsx` |
| Apple client-secret generator for Supabase | `scripts/apple-client-secret.mjs` |
| The cloud build → TestFlight | `codemagic.yaml` |

The app is a shell around the live site. **A normal web deploy updates the app too** — a new
Codemagic build is only needed when `ios/`, `capacitor.config.ts` or the icon change.

---

## Part A — Sign in with Apple (works on the website too)

### A1. Apple Developer → Identifiers → the App ID

developer.apple.com → Certificates, IDs & Profiles → **Identifiers** → `+` → **App IDs** → App.

- Description `Duravel`, Bundle ID **Explicit** `app.duravel`
- Capabilities: tick **Associated Domains** and **Sign In with Apple** (leave it as a primary App ID)
- Continue → Register. (If `app.duravel` already exists, open it and tick the two capabilities.)

### A2. The Services ID (what the website signs in as)

Identifiers → `+` → **Services IDs**.

- Description `Duravel Sign in with Apple`, Identifier **`app.duravel.signin`** → Register
- Open it, tick **Sign In with Apple** → **Configure**
  - Primary App ID: `app.duravel`
  - Domains and Subdomains: `duravel.app`
  - Return URLs: `https://<your-project-ref>.supabase.co/auth/v1/callback`
    (Supabase → Authentication → Providers → Apple shows this exact "Callback URL" — copy it from there)
- Next → Done → Continue → **Save**

### A3. The Sign in with Apple key

Certificates, IDs & Profiles → **Keys** → `+`.

- Name `Duravel Sign in with Apple`, tick **Sign in with Apple** → Configure → Primary App ID `app.duravel` → Save
- Continue → Register → **Download** the `.p8` (one download only — put it in your password manager) and note the **Key ID** (10 characters).

### A4. Make the client secret (on your Windows PC)

From `C:\dev\duravel`:

```
node scripts/apple-client-secret.mjs --p8 "C:\path\to\AuthKey_XXXXXXXXXX.p8" --team F32S44TWS2 --key <Key ID> --client app.duravel.signin
```

It prints a long token. **It expires in 180 days** (Apple's maximum) — put a reminder on
your calendar for 5 months from today to run the same command again and paste the new one.
When it lapses, Apple sign-in fails for everyone until it is replaced.

### A5. Supabase → Authentication → Providers → Apple

- Enable
- **Client IDs**: `app.duravel.signin,app.duravel`
- **Secret Key (for OAuth)**: the token from A4
- Save

### A6. Supabase → Authentication → URL Configuration → Redirect URLs

Add **`duravel://**`** (keep the existing `https://duravel.app/**`). Without it, sign-in from
the iPhone app fails with a redirect error.

### A7. Let Apple's hidden-email relay deliver your mail

People who choose "Hide My Email" get an `@privaterelay.appleid.com` address. Apple drops mail
to it unless you register who sends it.

Certificates, IDs & Profiles → **Services** → **Sign in with Apple for Email Communication** → Configure → `+`:

- Domain: `send.duravel.app`
- Email address: `coach@send.duravel.app` — plus whatever address Supabase's own emails
  (confirm, reset) come from, if different.

Apple checks SPF on the domain. If the domain fails its check, register the individual addresses — those
are verified by Apple directly.

### A8. Try it on the website

After the next deploy: duravel.app/login → **Continue with Apple**. A new account lands on the
first-login step (/welcome) for date of birth, sex, sport and the Terms, like a Google account does.

---

## Part B — The iPhone app on TestFlight

### B1. Check the Universal Links file is live

Vercel → Settings → Environment Variables: **`APPLE_TEAM_ID` = `F32S44TWS2`** (Production). Then
open `https://duravel.app/.well-known/apple-app-site-association` — it should show JSON with
`F32S44TWS2.app.duravel`. A 404 means the variable is missing (redeploy after adding it).

### B2. App Store Connect → the app record

appstoreconnect.apple.com → Apps → `+` → **New App**

- Platform iOS, Name `Duravel`, Language English (U.S.), Bundle ID `app.duravel`, SKU `duravel-ios`, Full Access

### B3. App Store Connect API key (for Codemagic — a different key from A3)

Users and Access → **Integrations** → App Store Connect API → Team Keys → `+`

- Name `Codemagic`, Access **App Manager** → Generate
- Download the `.p8` (one download only), note the **Issuer ID** (top of the page) and **Key ID**

### B4. Codemagic account and the repo

codemagic.io → sign up **with GitHub** → Add application → pick the `duravel` repository →
project type **Other** / "codemagic.yaml". Codemagic finds `codemagic.yaml` in the repo root
(it must be pushed first).

### B5. Codemagic → Team settings

1. **Team integrations → Developer Portal → Manage keys → Add key**
   - Name: **`Duravel App Store Connect`** — exactly this; `codemagic.yaml` refers to it by name
   - Issuer ID, Key ID, and the `.p8` from B3 → Save
2. **Code signing identities → iOS certificates → Generate certificate**
   - Reference name `Duravel distribution`, type **Apple Distribution**, key `Duravel App Store Connect` → Create
   - Download the `.p12` and its password when offered, store both in your password manager,
     and upload it back if Codemagic asks (Upload certificate → the `.p12` + password).
3. **Provisioning profile** — made on Apple's site, then pulled into Codemagic:
   - developer.apple.com → **Profiles** → `+` → Distribution **App Store Connect** → App ID `app.duravel`
     → the Distribution certificate from step 2 → name `Duravel App Store` → Generate
   - Back in Codemagic: **iOS provisioning profiles → Fetch profiles** → tick `Duravel App Store` → Download selected

### B6. Build

Codemagic → the duravel app → **Start new build** → workflow **iPhone app → TestFlight**. About
15–25 minutes. When it's green, the build appears in App Store Connect → TestFlight after Apple
processes it (another 10–30 minutes).

### B7. Put it on your phone

App Store Connect → TestFlight → **Internal Testing** → `+` → add yourself → install the
**TestFlight** app on your iPhone → accept the invite → Install.

### B8. What to try

- [ ] Opens on the dashboard (or login when signed out)
- [ ] Sign in with email and password
- [ ] Continue with Google — opens a sheet, returns signed in
- [ ] Continue with Apple — same
- [ ] Airplane mode, then open the app → the "Can't reach Duravel" screen; turn it off → it recovers
- [ ] A password-reset email tapped in Mail opens in the app (needs B1)

---

## Before submitting to the App Store (not needed for TestFlight)

- **Icon.** `ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png` is a placeholder
  (a white "D"). Replace it with the real 1024 × 1024 PNG — square corners, no transparency — and rebuild.
  The web icons in `public/` still show the old HyroxAI "HX" mark and should be replaced too.
- **Paying inside the app.** Subscribe / billing opens Stripe in Safari. Apple's rule 3.1.1 covers
  digital subscriptions sold in apps; this needs a decision (US storefront external-purchase link,
  In-App Purchase, or no purchase path in the app) before review.
- **Strava / Oura connect** opens Safari, and the return lands in Safari rather than the app. Fine to
  test around on TestFlight; needs the same in-app sheet treatment as sign-in before release.
- **Push notifications** — web push does not work inside the app; native push is a separate piece of work.
- **Privacy details** in App Store Connect (drafts in `Apple/02_privacy/`) and account deletion
  (already on /profile).
