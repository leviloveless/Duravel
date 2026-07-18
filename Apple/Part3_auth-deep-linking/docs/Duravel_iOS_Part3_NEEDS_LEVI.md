# Needs Levi — Part 3 (Auth, session, deep linking)

These require your accounts, secrets, or a product decision. I can't do them
from the sandbox. Grouped by system.

## Apple Developer
- [ ] Enable **Sign In with Apple** on the `app.duravel` App ID.
- [ ] Create a **Services ID** (`app.duravel.signin`) + a **Sign in with Apple
      key (.p8)**; record Team ID, Key ID. (One-time `.p8` download.)
- [ ] Give me / paste your **10-char Team ID** so the AASA + entitlements are
      final — placeholder `TEAMID` is in
      `apple-app-site-association.json` (2 spots) and must be replaced.
- [ ] Add Associated Domains + Sign in with Apple capabilities to the target
      (or use the provided `Duravel.entitlements`) and refresh provisioning.

## Supabase
- [ ] Enable the **Apple provider**; set **Client IDs** to
      `app.duravel,app.duravel.signin` (the bundle id MUST be there or native
      token exchange fails with audience mismatch).
- [ ] Add the Apple client-secret JWT (rotate ≤ 6 months).
- [ ] Add redirect URLs: `https://app.duravel.app/auth/callback` and
      `duravel://auth/callback`.
- [ ] Deploy the **`delete-account`** Edge Function and
      `supabase secrets set SERVICE_ROLE_KEY=…`.
- [ ] Run `account-deletion.sql` — **but first reconcile the table names**
      (`workouts`, `workout_sessions`, `programs`, `program_enrollments`,
      `progress_logs`, `subscriptions`, `profiles`) with the real schema.
- [ ] Confirm the storage bucket name (`user-uploads`) or tell me the real one.

## Web app (hyroxai / Next.js on Vercel)
- [ ] Serve the AASA at
      `https://app.duravel.app/.well-known/apple-app-site-association`
      (route handler snippet in `AASA_DEPLOY.md`) — no `.json` extension,
      `application/json`, 200, no redirect.
- [ ] Build the `/settings/account` + `/settings/account/delete` pages per
      `account-deletion-plan.md`.
- [ ] Confirm the confirm/reset email templates point at
      `https://app.duravel.app/...` paths that the AASA `components` cover
      (`/auth/*`, `/reset-password*`, `/confirm*`). Adjust either side to match.

## Decisions I made (override if wrong)
- Session stored in **Keychain** (not plain UserDefaults) — see README rationale.
- **Immediate hard delete** for accounts (no grace period). Say the word if you
  want a "pending_deletion + purge after N days" window instead.
- Assumed **Supabase/Stripe (web) billing**, so account deletion should cancel
  the **Stripe** subscription — NOT yet wired (needs Stripe secret in the Edge
  Function). Right now deletion removes the account but does **not** stop a live
  Stripe renewal. **This is the one gap that could get 5.1.1(v) flagged or bill
  a deleted user** — decide: cancel-in-function (preferred) vs. tell-user-to-
  cancel-first. Likely finished in Part 4/5.
- Assumed **PKCE** email-link flow (router also handles implicit).

## To verify on a real device (can't be done in sandbox)
- Apple sign-in end-to-end (simulator is unreliable); name captured on first
  sign-in; "Hide My Email" relay address works with Resend.
- Universal Link taps open the app (not Safari) after AASA is live + reinstall.
- Cold-launch from a `duravel://` link and from an email confirm link route
  correctly.
- Session survives force-quit + relaunch (Keychain persistence).
