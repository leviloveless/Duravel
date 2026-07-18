# Duravel — App Store Compliance Checklist

Every item Apple will check, with a current status and what's left to do. Status legend:

- ✅ **Done** — artifact delivered / already handled in Parts 1–6.
- 🟡 **Action needed** — Levi (or a build step) must complete it before submission.
- 🔴 **Decision/blocker** — must be resolved or the app will be rejected.

---

## 1. Sign in with Apple — 🟡 Action needed

**Rule:** If the app offers any third-party or social login (Guideline 4.8 / 4.0), it must **also** offer Sign in with Apple, OR use only email-based first-party sign-in that meets Apple's data-minimization criteria.

- Duravel uses Supabase auth. If Google/social login is offered anywhere, SIWA is **mandatory**.
- Part 3 delivered the auth + deep-linking artifacts; SIWA capability must be enabled on the App ID and wired.

**To close:**
- [ ] Enable "Sign in with Apple" capability on the App ID (see morning to-do A/signing).
- [ ] Confirm SIWA button present on the sign-in screen and functional against production.
- [ ] Confirm SIWA "Hide My Email" relay works (email routing via Supabase).

---

## 2. Account deletion (in-app) — 🟡 Action needed

**Rule (5.1.1(v)):** Apps that support account creation must let users **initiate account deletion from within the app** — not just deactivate, not "email us."

- [ ] Settings → Account → **Delete Account** exists, reachable in the shipped webview.
- [ ] Deletion removes the account and associated personal + health data server-side (Supabase), or clearly explains any legally-retained data.
- [ ] The path is described in App Review notes and on the support page.

---

## 3. In-App Purchase / billing model — 🔴 Decision/blocker

**Rule (3.1.1):** Digital content/subscriptions consumed in the app must use Apple's IAP **unless** they qualify for an exception (e.g., "reader" apps, or external-purchase entitlements in specific regions). Duravel membership unlocks in-app digital features → default expectation is **StoreKit IAP**.

- Stripe is currently LIVE on the web at $19.99/mo · $119.99/yr.
- Part 4 delivered billing artifacts, but the **IAP-vs-external decision is unresolved**.

**Two paths — pick one (this is the blocker):**
1. **StoreKit IAP:** create matching auto-renewable subscription products in App Store Connect ($19.99/mo, $119.99/yr), wire the native purchase plugin, reconcile entitlements with Supabase. Apple takes its commission. Lowest rejection risk.
2. **External / alternative billing:** only viable under specific Apple programs/regions and with the required disclosures/entitlements. Higher rejection risk; must be set up correctly or it's an automatic 3.1.1 rejection.

**To close:**
- [ ] **DECIDE** path 1 or 2 (see morning to-do A).
- [ ] If IAP: products created, in "Ready to Submit," prices match app copy, restore-purchases works, subscription disclosure + Terms/Privacy links on the paywall.
- [ ] Review notes billing bracket edited to match reality.

---

## 4. Health-data disclosure (HealthKit) — 🟡 Action needed

**Rule (5.1.3 + HealthKit terms):** No using HealthKit data for advertising/data-mining, no selling it, no storing it in iCloud; Privacy Policy must describe HealthKit handling; usage strings required.

- [ ] `NSHealthShareUsageDescription` / `NSHealthUpdateUsageDescription` present & truthful in Info.plist (Part 5).
- [ ] HealthKit capability enabled on the App ID.
- [ ] Privacy Policy at duravel.app/privacy **explicitly** names HealthKit, what's read, why, storage, deletion.
- [ ] Health samples are **not** written to iCloud.
- [ ] Privacy manifest (`PrivacyInfo.xcprivacy`, delivered) declares Health/Fitness data types — ✅ delivered, needs to be added to the target.

---

## 5. Privacy manifest & nutrition label — 🟡 Action needed

**Rule:** `PrivacyInfo.xcprivacy` required (required-reason APIs + collected data types); App Privacy answers must match.

- ✅ `PrivacyInfo.xcprivacy` delivered (Part 7).
- ✅ Nutrition-label mapping delivered (Part 7).
- [ ] Add the manifest to the App target (Copy Bundle Resources).
- [ ] Enter matching App Privacy answers in App Store Connect.
- [ ] After `npx cap sync`, verify no third-party SDK is missing a required-reason declaration (archive → Privacy report).

---

## 6. Export compliance / encryption — 🟡 Action needed

**Rule (Export Compliance):** Every submission answers the encryption question. Duravel uses only standard HTTPS/TLS (exempt), so you can claim the standard exemption.

**To close (set once in Info.plist to skip the per-build prompt):**
- [ ] Add `ITSAppUsesNonExemptEncryption = NO` to Info.plist (app uses only exempt standard encryption — HTTPS/TLS).
- [ ] Confirm no custom/proprietary cryptography is bundled. (If ever added, this answer changes and a CCATS/self-classification may be needed.)

```xml
<key>ITSAppUsesNonExemptEncryption</key>
<false/>
```

---

## 7. Age rating — ✅ Done (answers provided) / 🟡 enter in ASC

- ✅ Age-rating questionnaire answers provided in `app-store-metadata.md` → expected **4+**.
- [ ] Enter them in App Store Connect and confirm the resulting rating.
- [ ] Confirm "No" to Made-for-Kids; target audience adults.

---

## 8. Guideline 4.2 — Minimum functionality (webview shell) — 🔴 Watch closely

**Rule (4.2):** App must not be a repackaged website; must provide native, app-like value.

- ✅ Native plugins across Parts 1–6 (HealthKit, Push, IAP, SIWA, deep links) provide the native value.
- ✅ Architecture explanation drafted in `review-notes.md` to preempt rejection.
- [ ] Webview locked to your own domain (no open external browsing).
- [ ] At least one native feature clearly demonstrable to the reviewer (HealthKit connect flow).
- [ ] No broken/empty states in the demo account.

---

## 9. Other standard gates — mixed

| Item | Status | Note |
|---|---|---|
| Support URL live | 🟡 | duravel.app/support must resolve |
| Marketing URL | 🟡 | duravel.app (optional) |
| Privacy Policy URL live + health language | 🟡 | duravel.app/privacy — required |
| Terms of Use / EULA | 🟡 | duravel.app/terms or Apple standard EULA |
| Subscription disclosure in description + on paywall | 🟡 | text provided in metadata; must also appear on paywall |
| App icon 1024px, no alpha, no rounded corners | 🔴 | Levi must provide 1024px source (morning to-do A) |
| Launch screen / splash | ✅ | Part 2 native shell |
| Associated Domains (Universal Links) | 🟡 | capability + apple-app-site-association on app.duravel.app |
| Production URL renders in native webview | 🔴 | must confirm app.duravel.app loads in WKWebView (morning to-do A) |
| APNs auth key (.p8) for push | 🔴 | Levi must generate (morning to-do A) |
| Demo account (comped, pre-populated) | 🟡 | provision in production before submit |
| Data collection honest & minimal | ✅ | manifest + label consistent |

---

## 10. Submission-gating summary

**Hard blockers (🔴) that will stop submission or cause rejection:**
1. Billing IAP-vs-external decision (§3).
2. 1024px app-icon source (§9).
3. Confirm app.duravel.app renders in a native webview (§9 / 4.2).
4. APNs .p8 key generated (§9).
5. 4.2 minimum-functionality demonstrable (§8) — mitigated by native plugins + review notes.

**Everything else is 🟡 mechanical** — enable capabilities, enter ASC answers, add two Info.plist keys, add the manifest to the target, provision the demo account. All of it is captured, ordered, in `Duravel_iOS_Morning_ToDo.md`.
