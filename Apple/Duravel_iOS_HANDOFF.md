# Duravel iOS — Handoff to a New Local Session

**Give this file to a fresh Claude/Cowork session running ON your computer** (so it has direct
read/write access to `C:\dev\duravel`). It has everything that session needs to pick up the iOS
build with zero prior context. Paste it in, or point the session at it.

---

## 0. Your mission (for the new session)

Duravel's iOS app was designed and generated across 7 parts during an overnight cloud build.
All artifacts now live under `C:\dev\duravel\Apple\`. **Your job is to integrate those artifacts
into the repo, wire the native plugins, and get the app to a TestFlight build and App Store
submission.** You have local filesystem access; the parts that need macOS/Xcode are called out
explicitly so you know what to hand back to Levi.

Work top-to-bottom through Section 5. Confirm each step; don't blind-overwrite existing repo files.

---

## 1. Product & repo context

- **Product:** Duravel — a live hybrid-endurance training app (HYROX, DEKA, triathlon plans).
- **Web stack:** Next.js + Supabase (auth/data) + Stripe (LIVE billing, $19.99/mo · $119.99/yr) + Resend (email).
- **iOS approach:** a **Capacitor 6 native shell** that renders the production web app
  `https://app.duravel.app` inside a native `WKWebView`, plus native plugins (HealthKit, Push,
  In-App Purchase, Sign in with Apple, deep links / Universal Links).
- **Repo:** GitHub `Duravel`; local path `C:\dev\duravel`; the app lives under `hyroxai/`.
- **Conventions:** app name **Duravel**; bundle id **app.duravel**; min iOS **15**; **Capacitor 6**;
  App Store category **Health & Fitness**; brand background **#0B0B0F**.

---

## 2. Where everything is

Everything from Parts 1–7 is under `C:\dev\duravel\Apple\`, one folder per part:

```
C:\dev\duravel\Apple\
├── Duravel_iOS_Morning_ToDo.md      ← Levi's master action list (read this first)
├── Part1_foundation\
├── Part2_native-shell\
├── Part3_auth-deep-linking\
├── Part4_billing\
├── Part5_healthkit\
├── Part6_push\
└── Part7_submission\                ← App Store metadata, privacy, review notes, compliance
```

**Each `PartN_*` folder contains a `MANIFEST.md`** — a table listing every file and its real
destination in the repo (e.g. `hyroxai/ios/App/App/...`, `scripts/...`, `hyroxai/capacitor.config.ts`).
**The MANIFESTs are your source of truth for where each file belongs.** Files under a part's
`docs\` subfolder are reference only and stay under `Apple\`.

> ⚠️ Note: `Part7_submission` files are mostly App Store Connect reference docs (metadata,
> screenshot plan, review notes, compliance checklist). The one real code artifact there is
> `PrivacyInfo.xcprivacy`, which belongs at `hyroxai/ios/App/App/PrivacyInfo.xcprivacy`.

---

## 3. What you (local session) CAN and CANNOT do

**Can do locally on Windows:**
- Read/verify all `Apple\` artifacts and MANIFESTs.
- Copy files to their repo destinations; merge config (`capacitor.config.ts`, `package.json`).
- Run `npm install`, `npx cap add ios`, `npx cap sync ios`, git operations.
- Host/verify the web-side files (e.g. `apple-app-site-association` on app.duravel.app).
- Fill out App Store Connect content from the Part 7 docs.

**CANNOT do on Windows — needs macOS + Xcode:**
- Compile, sign, archive, or upload the build. **iOS builds only run on macOS.**
- Debug interactively in the iOS Simulator.
- Path around this: either a Mac with Xcode, OR a cloud CI service. **Codemagic is the best fit**
  because it supports Capacitor natively — point it at the repo and it builds/signs/uploads to
  TestFlight without Levi touching a Mac. A rented cloud Mac (MacinCloud/MacStadium) is the
  fallback for the interactive webview check. (This was researched; treat it as decided guidance.)

So: do all the repo integration and config locally, get the project to the point where a single
`archive` on macOS/CI produces the build, and hand that final build step to Levi/CI.

---

## 4. Open decisions & hard blockers (only Levi can clear these)

These gate submission — surface them early, don't try to invent answers:

1. **Billing: IAP vs external — UNDECIDED.** Digital subscription consumed in-app defaults to
   Apple StoreKit In-App Purchase (guideline 3.1.1). Levi must decide IAP vs an external/
   alternative billing model. This changes the paywall wiring AND the review notes. Do not ship
   with a mismatch (Stripe web-checkout for in-app digital content = automatic 3.1.1 rejection).
2. **Apple Developer Program enrollment** — needs the D-U-N-S number (was in flight). No App
   Store Connect access until active.
3. **APNs `.p8` auth key** — Levi generates in the Apple Developer portal (for push).
4. **1024px app-icon source** — Levi provides (no alpha, no rounded corners).
5. **Confirm `app.duravel.app` renders correctly in a `WKWebView`** — highest webview risk; needs
   a device/Simulator check. Any fixes here are web-side (Next.js) changes in the repo.
6. **Signing** — App ID `app.duravel` with capabilities: HealthKit, Push, Sign in with Apple,
   In-App Purchase, Associated Domains. Certs/profiles via Xcode "auto-manage" once enrolled.

Full detail is in `Apple\Duravel_iOS_Morning_ToDo.md` (Sections A/B/C) and
`Apple\Part7_submission\...\compliance-checklist.md`.

---

## 5. Your ordered plan

**Phase 1 — Inventory & verify (local, do first)**
1. `dir C:\dev\duravel\Apple` and read `Duravel_iOS_Morning_ToDo.md` end-to-end.
2. Open every `PartN_*\MANIFEST.md`; build a consolidated list of `source → destination` copies.
3. Sanity-check the repo state: is `hyroxai/` present? Is there already an `ios/` platform folder?
   Is Capacitor installed in `package.json`? Report what exists vs. what the manifests expect.

**Phase 2 — Integrate artifacts into the repo (local)**
4. On a new git branch (e.g. `ios-native`), copy each file to its MANIFEST destination.
   **Merge, don't overwrite** for `capacitor.config.ts`, `package.json`, `Info.plist` — show Levi a
   diff before applying anything destructive.
5. Place `PrivacyInfo.xcprivacy` at `hyroxai/ios/App/App/PrivacyInfo.xcprivacy`.
6. Add the two Info.plist keys: `ITSAppUsesNonExemptEncryption = NO`, and confirm the HealthKit
   usage-description strings are real, not placeholders.
7. Put the web-side files (e.g. `apple-app-site-association`) where they belong and confirm the
   route serves them as `application/json` with no redirect.
8. Commit the integration on the branch.

**Phase 3 — Capacitor wiring (local; build itself is macOS/CI)**
9. `npm install`, then `npx cap sync ios`. Resolve plugin/pod expectations.
10. Verify each part's plugin is registered and its capability is declared on the App target:
    auth + Sign in with Apple + Associated Domains (Part 3), billing/IAP per the decision (Part 4),
    HealthKit + usage strings (Part 5), Push + APNs (Part 6).
11. Generate the app-icon set from Levi's 1024px source into the asset catalog.

**Phase 4 — Build → TestFlight → submit (macOS/CI — hand to Levi/Codemagic)**
12. Archive on macOS/Xcode or via Codemagic; upload to TestFlight.
13. Internal TestFlight test on a real iPhone: HealthKit real data, real push, purchase/restore
    (sandbox), Sign in with Apple, deep link opens app, in-app account deletion.
14. Fill App Store Connect from `Part7_submission`: metadata, screenshots (6.7" + 6.5", iPhone-only
    v1), App Privacy answers (must match `PrivacyInfo.xcprivacy`), review notes (demo account +
    §4.2 architecture defense), age rating.
15. Provision the review demo account in **production**: comped membership, a plan pre-enrolled with
    completed sessions, non-expiring password.
16. Run the compliance checklist end-to-end, then submit.

---

## 6. Gotchas / do-not-break list

- **§4.2 minimum functionality** is the top rejection risk (it's a webview shell). The native
  plugins are what clear it — make sure HealthKit connect is demonstrable to the reviewer. The
  architecture defense is already written in `Part7_submission\...\review-notes.md`; keep it.
- **Lock the webview to your own domain** — no open external browsing (reads as "just Safari").
- **HealthKit data**: never to iCloud, never for ads, never sold. Privacy Policy at
  duravel.app/privacy must name HealthKit explicitly.
- **In-app account deletion** is mandatory (5.1.1(v)) — must be reachable in the shipped app.
- **Sign in with Apple** required if any social login is offered.
- **Billing consistency** — whatever Levi decides, make the app, the pricing copy, and the review
  notes all say the same thing.
- **Don't claim the build is done from Windows** — the archive/sign/upload step is macOS/CI only.

---

## 7. First message you should send back to Levi

After Phase 1, report: (a) what the repo actually contains vs. what the manifests expect, (b) any
missing files or mismatches, (c) the consolidated copy plan you're about to run, and (d) confirm
the billing decision (blocker #1) before you wire the paywall. Then proceed once he confirms.

---

*Context: this handoff summarizes a 7-part overnight build. The authoritative details live in the
files under `C:\dev\duravel\Apple\` — especially the per-part `MANIFEST.md` files, the
`Duravel_iOS_Morning_ToDo.md`, and `Part7_submission\...\compliance-checklist.md`. When in doubt,
read those rather than assume.*
