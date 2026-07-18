# Duravel — App Review Notes

Paste the relevant parts into **App Store Connect → the version → App Review Information → Notes**. Keep the demo credentials in the dedicated **Sign-In Information** fields (not free text), and use the Notes box for the walkthrough and the architecture explanation.

The single biggest rejection risk for Duravel is **Guideline 4.2 (Minimum Functionality)** because the app is a Capacitor webview of `app.duravel.app`. The architecture explanation below is written specifically to preempt that. Read section 4 carefully.

---

## 1. Sign-In Information (demo account)

Enter in the **Sign-In Information** section of App Review Information:

```
Sign-in required:  Yes
Username / Email:  review@duravel.app
Password:          <set a stable password, e.g. DuravelReview!2026>
```

Demo account requirements — make sure BEFORE submitting:

- [ ] The account **exists in production** (app.duravel.app), not just staging.
- [ ] It has an **active, comped membership** so the reviewer sees full functionality without needing to pay. Grant the entitlement server-side (Supabase/Stripe) so all plans, live sessions, and Health features are unlocked. **Do not require the reviewer to complete a real purchase to see core features.**
- [ ] It has **at least one plan already enrolled** (e.g. a HYROX 8-week block) with a few completed sessions, so the Progress and Home screens are populated, not empty.
- [ ] The password does not expire and the account won't be rate-limited or locked during review.
- [ ] Sign in with Apple works for this flow too (reviewers may test it); if SIWA creates a separate account, ensure that account can also reach full functionality, or direct them to use the email/password demo account.

---

## 2. What to write in the Notes box (walkthrough)

```
Thanks for reviewing Duravel.

Duravel is a hybrid-endurance training app (HYROX, DEKA, triathlon). It is a native
iOS app (Capacitor 6) that renders our production web app, app.duravel.app, inside a
native WKWebView and adds native capabilities via native plugins (HealthKit, Push,
In-App Purchase, Sign in with Apple, deep links). See "Architecture" below.

DEMO ACCOUNT
Use the credentials in the Sign-In Information section. This account has an active
membership and a plan already enrolled, so all features are unlocked. You do not need
to make a purchase to see core functionality.

HOW TO REACH KEY FEATURES
- Core training: after sign-in you land on Home / Today's session. Tap the session to
  open the guided workout view (intervals + station work).
- Plans: open the Plans tab to browse HYROX / DEKA / triathlon programs and enrolled plan.
- Progress: the Progress tab shows completed sessions and readiness over time (pre-populated).

- HEALTHKIT: Go to Settings > Apple Health (or the Health card on Home) and tap
  "Connect Apple Health." iOS will show the HealthKit permission sheet. Granting it lets
  the app read workouts / heart rate / activity to adapt the plan. On the Simulator,
  HealthKit data may be empty; if you want to see it populate, please test on a device
  with Health data, or add sample data via Health app > Browse.

- PUSH NOTIFICATIONS: On first launch (or from Settings > Notifications) the app requests
  push permission. Session reminders are delivered via APNs. To trigger one during review,
  enable reminders in Settings > Notifications; a confirmation/test reminder can be sent.
  (If you'd like us to fire a test push to the review device, contact us at the email below.)

- IN-APP PURCHASE: The demo account is already subscribed, so the paywall is not blocking.
  To inspect the purchase flow, open Settings > Membership > "Manage / Upgrade." Products:
  Monthly $19.99, Annual $119.99, configured as auto-renewable subscriptions in App Store
  Connect. [If billing uses StoreKit IAP -> the flow completes via the App Store sheet.
  If billing uses external web purchase per our chosen model -> see the billing note below.]

- SIGN IN WITH APPLE: Available on the sign-in screen alongside email sign-in.

- ACCOUNT DELETION: Settings > Account > "Delete Account" removes the account and data
  (Guideline 5.1.1(v)).

CONTACT
For anything blocking review, reach the founder directly at support@duravel.app — we will
respond quickly and can provision data or fire a test push on request.
```

> ⚠️ **Billing line depends on your Part-4 decision.** Before you submit, delete whichever billing bracket doesn't apply and state the truth. If Apple sees IAP-style pricing but the app takes payment on the web for digital content, that's a **3.1.1 rejection**. The morning to-do makes this decision a hard blocker.

---

## 3. Notification / permission timing guidance

Reviewers sometimes reject if a permission prompt appears with no context. Confirm:

- HealthKit prompt is **triggered by a user action** ("Connect Apple Health"), not auto-fired on launch, and the `NSHealthShareUsageDescription` string clearly states why.
- Push prompt is contextual (after explaining reminders) or at a sensible first-run moment, with a soft pre-prompt if possible.
- The app still functions if the reviewer **denies** Health and Push — nothing should hard-block on those permissions.

---

## 4. Architecture explanation — preempting a Guideline 4.2 rejection

This is the section that keeps Duravel from being bounced as "just a website in a wrapper." Include it in the Notes box (or as an attachment) verbatim, adapted to what's actually true.

```
ARCHITECTURE & MINIMUM FUNCTIONALITY (re: Guideline 4.2)

Duravel is not a generic web-page wrapper. It is a native iOS application that combines
our web-based training experience with native iOS capabilities that only make sense on
device:

1. HEALTHKIT INTEGRATION (native): Duravel reads the user's workouts, heart rate, and
   activity from Apple Health via a native HealthKit plugin and uses that data to adapt
   the training plan and compute readiness. This is a native capability, not available to
   a website, and is central to the product.

2. PUSH NOTIFICATIONS (native, APNs): Session reminders and coaching nudges are delivered
   through native push. Users manage them in iOS Settings and in-app.

3. NATIVE IN-APP PURCHASE / MEMBERSHIP: Membership is handled through [StoreKit in-app
   purchase / our compliant billing model], with native entitlement handling.

4. SIGN IN WITH APPLE (native): First-class native authentication.

5. DEEP LINKING / ASSOCIATED DOMAINS (native): Universal Links open specific plans and
   sessions directly in the app.

6. OFFLINE-AWARE, APP-LIKE UX: Native splash, status-bar theming, safe-area handling, and
   a controlled webview limited to our own domain (not an open browser) provide a
   packaged, app-specific experience rather than general web browsing.

The web layer renders our training content; the native layer provides device-integrated
functionality (Health, Push, IAP, SIWA, deep links) that materially exceeds a repackaged
website. Duravel delivers ongoing value to a defined audience of hybrid-endurance athletes
and is not a marketing page, a repackaged web catalog, or a single-function utility.

If the review team has any concern about minimum functionality, we're glad to walk through
the native integrations live — please contact support@duravel.app.
```

Practical tips to make 4.2 approval easier:

- Make sure at least one **clearly native** feature is demonstrable in the reviewer's session (HealthKit connect flow is the strongest; push is second). If HealthKit can't populate on their test device, offer to send a test push so *something* native is observed.
- The webview must be **locked to your domain** (no open external browsing) — reviewers dislike apps that are effectively Safari.
- Ensure the app **doesn't show broken/empty states** — the demo account's pre-populated data covers this.

---

## 5. Attachments to include (optional but helpful)

- A short screen-recording (30–60s) showing sign-in → Home → open session → connect Apple Health → a reminder. Reduces back-and-forth.
- This notes file's architecture section as a PDF if the Notes box feels cramped.

---

## 6. Pre-submission review-notes checklist

- [ ] Demo account exists in **production**, comped membership, plan pre-enrolled, non-expiring password.
- [ ] Billing bracket in the notes edited to match the actual (IAP vs external) decision.
- [ ] HealthKit, Push, IAP, SIWA, account-deletion paths all reachable and described.
- [ ] Architecture / 4.2 explanation included.
- [ ] App functions when Health/Push are denied.
- [ ] Support email monitored during review window.
