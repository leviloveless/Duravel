# Account Deletion — UI / route plan (App Store 5.1.1(v))

Apple requires a user who can create an account to be able to **initiate
deletion of the account and its data from within the app**, not just via a
website or support email. A visible "Delete account" website link is not
sufficient; the flow must be reachable in-app. This plan makes it reachable and
safe.

## Where it lives (route)

Add a route in the web app (which the shell loads):

```
/settings/account            → "Delete account" row (destructive style)
/settings/account/delete     → confirmation screen
```

Both are normal Next.js App Router pages under `hyroxai/app/settings/account/`.
Because the iOS shell loads the live web app, no native screens are needed —
the same pages serve web and iOS.

## The flow (3 taps, irreversible, honest)

1. **Settings → Account.** A clearly labelled, red "Delete account" row at the
   bottom. Not buried behind support chat.
2. **Confirmation screen** explaining, in plain language:
   - This permanently deletes your account and all training data (workouts,
     sessions, programs, progress). It cannot be undone.
   - If you have an active subscription, note its status (see Stripe below).
   - Require a deliberate confirmation: type **DELETE** (or re-authenticate).
     A single tap is too easy to trigger accidentally.
3. **On confirm** → call `deleteAccount()`
   (`Duravel_iOS_Part3_account-deletion-client.ts`), show a spinner, then:
   - Success → sign out, route to `/login` with a "Your account was deleted"
     message.
   - Failure → show the returned error; offer a retry and a support link.

## What gets deleted

Handled by the `delete-account` Edge Function + the CASCADE FKs in
`Duravel_iOS_Part3_account-deletion.sql`:

- `auth.users` row (+ `auth.identities`, sessions) via Auth Admin API.
- All app tables keyed to the user: workouts, workout_sessions, programs,
  program_enrollments, progress_logs, subscriptions, profiles.
- Storage objects under `user-uploads/<uid>/`.

## Subscription handling (IMPORTANT — Needs Levi)

Deleting the Supabase user does **not** cancel a live Stripe subscription. Two
acceptable options, pick one and wire it in:

- **Preferred:** the Edge Function cancels the Stripe subscription (via the
  Stripe secret key) before deleting, so the user isn't billed again.
- **Minimum:** the confirmation screen tells the user their subscription will
  continue until the period ends unless cancelled, and links to cancel first.
  (Apple may still expect deletion to stop future billing — prefer the first.)

Also note: an **in-app-purchase** auto-renewable subscription (if you ever add
StoreKit) can only be cancelled by the user in iOS Settings — you cannot cancel
it server-side. Duravel currently bills via Stripe (web), so this is a Stripe
cancel, not StoreKit — confirm this stays true for the iOS build.

## Grace period (optional, allowed)

Apple permits a short recovery window if you disclose it. If desired, instead of
hard-deleting immediately, mark the account `pending_deletion` with a timestamp
and purge after N days via a scheduled function. The current implementation does
an **immediate hard delete**, which is the simplest compliant option. Flag for
Levi if a grace period is preferred.

## Review notes to include in App Store Connect

- Tell the reviewer exactly where the delete option is:
  "Settings → Account → Delete account".
- Confirm data is deleted, not just deactivated.
