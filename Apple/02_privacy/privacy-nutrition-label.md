# Duravel — App Privacy "Nutrition Label" Mapping

This is the plain-English translation of `PrivacyInfo.xcprivacy` into the answers you enter in **App Store Connect → App Privacy**. The manifest file and this label must agree — Apple cross-checks them. Fill the App Privacy section using the tables below.

---

## Step 0 — The gate question

> **Do you or your third-party partners collect data from this app?**
> **Answer: Yes.**

You collect account data, health data, purchase data, and usage/diagnostics. You must disclose each.

---

## Step 1 — Data types collected

For each type Apple asks three things: (1) is it **collected**, (2) is it **linked to the user's identity**, (3) is it used to **track** them. Duravel does **not** track (no cross-app/cross-company advertising or data brokering), so "Used for tracking" is **No** everywhere.

| App Store data category | Specific type | Collected? | Linked to identity? | Used to track? | Purpose |
|---|---|---|---|---|---|
| **Health & Fitness** | Health | Yes | Yes | No | App Functionality (adapt plans, show progress) |
| **Health & Fitness** | Fitness | Yes | Yes | No | App Functionality |
| **Contact Info** | Email Address | Yes | Yes | No | App Functionality (account) |
| **Contact Info** | Name | Yes | Yes | No | App Functionality (profile) |
| **Identifiers** | User ID | Yes | Yes | No | App Functionality + Analytics |
| **Identifiers** | Device ID | Yes | Yes | No | App Functionality (push delivery) |
| **Purchases** | Purchase History | Yes | Yes | No | App Functionality (entitlement/membership) |
| **Usage Data** | Product Interaction | Yes | Yes | No | App Functionality + Analytics |
| **Diagnostics** | Crash Data | Yes | No | No | App Functionality (stability) |

> If you ship **without** any analytics SDK at launch, you may drop the "Analytics" purpose and the Crash Data row — but only if nothing in the app or your web backend records it. Since app.duravel.app is your own web app and likely logs some product interaction server-side, keeping Usage Data disclosed is the safe, honest answer.

---

## Step 2 — How each maps to what the user sees

The label that renders on your App Store page will group into three headers:

**"Data Used to Track You"** → *(empty — Duravel tracks nothing)*

**"Data Linked to You"**
- Health & Fitness
- Contact Info (email, name)
- Identifiers (user ID, device ID)
- Purchases
- Usage Data

**"Data Not Linked to You"**
- Diagnostics (crash data)

---

## Step 3 — The health-data specifics (Apple asks extra)

Health & Fitness data has additional obligations under **App Store Review Guideline 5.1.3** and the HealthKit terms:

1. **You must not use HealthKit data for advertising or data-mining, and must not sell it.** → Duravel doesn't. Confirm in your Privacy Policy in plain words: *"We never sell your health data or use it for advertising."*
2. **Health data must not be stored in iCloud.** → Confirm your sync path (Supabase, not iCloud key-value store) does not route HealthKit samples into iCloud.
3. **Your Privacy Policy must specifically describe HealthKit data handling.** → The Privacy Policy at `https://duravel.app/privacy` must name HealthKit and describe what you read (workouts, heart rate, activity), why, where it's stored, and how to delete it.
4. **NSHealthShareUsageDescription / NSHealthUpdateUsageDescription** strings must be present in `Info.plist` (delivered in Part 5) and describe the real reason.

---

## Step 4 — Account & deletion disclosure

Because Duravel has account creation, Apple requires (Guideline 5.1.1(v)) that users can **delete their account from within the app**, not just deactivate. Your App Privacy section and your support page should point to the in-app deletion path. (Tracked in the compliance checklist.)

---

## Step 5 — Answers cheat-sheet (copy into App Store Connect)

```
Do you collect data?  → Yes

HEALTH & FITNESS
  Health          → Linked, no tracking, App Functionality
  Fitness         → Linked, no tracking, App Functionality
CONTACT INFO
  Email Address   → Linked, no tracking, App Functionality
  Name            → Linked, no tracking, App Functionality
IDENTIFIERS
  User ID         → Linked, no tracking, App Functionality + Analytics
  Device ID       → Linked, no tracking, App Functionality
PURCHASES
  Purchase History→ Linked, no tracking, App Functionality
USAGE DATA
  Product Interaction → Linked, no tracking, App Functionality + Analytics
DIAGNOSTICS
  Crash Data      → Not linked, no tracking, App Functionality

Used for tracking anywhere? → No
```

---

## Consistency checklist (manifest ↔ label)

- [ ] Every `NSPrivacyCollectedDataType` in the manifest has a matching row entered in App Store Connect.
- [ ] Nothing is declared "tracking" in either place (both say No).
- [ ] Privacy Policy URL live and names HealthKit explicitly.
- [ ] `Info.plist` health usage strings present and truthful.
- [ ] In-app account deletion path exists and is reachable.
- [ ] If an analytics/crash SDK is added later, update BOTH the manifest and this label.
