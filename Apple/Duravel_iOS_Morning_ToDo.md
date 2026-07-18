# Duravel iOS — Morning To-Do

Good morning, Levi. The overnight build (Parts 1–7) is done and every artifact is in the chat. This is the one list that pulls together everything that needs **you** — a human with a Mac, an Apple account, and a few decisions. It's ordered so you can work top-to-bottom. Nothing below can be done from the cloud sandbox; that's why it's on you.

**How to use this:** Do **Section A** first (hard blockers — some have lead time, start those immediately). Then **Section B** (wire the code together on a Mac). Then **Section C** (TestFlight → submission). Check boxes as you go.

Rough time: Section A is mostly waiting on Apple + gathering assets (spread over days); Sections B and C are ~a focused day once A clears.

---

## SECTION A — Hard blockers only you can clear

These gate everything. Several have external lead time — **kick off A1, A6, A7 first thing** because they involve other parties or approvals.

### A1. Enroll in the Apple Developer Program 🔴 *(start now — has lead time)*
- [ ] Finish the **D-U-N-S number** (you said it's in flight — chase it; can take days).
- [ ] Enroll at developer.apple.com/programs ($99/yr). Org enrollment needs the D-U-N-S; individual enrollment doesn't but puts a personal name on the listing. Decide which you want.
- [ ] Confirm enrollment is **active** and you can reach App Store Connect. Nothing else in C can happen until this is live.

### A2. Get a Mac with Xcode 🔴
- [ ] A Mac (owned, borrowed, or a cloud Mac like MacStadium/Scaleway) running current macOS.
- [ ] Install **Xcode** (latest stable) from the Mac App Store, launch once, accept the license, install additional components.
- [ ] Install command-line tools: `xcode-select --install`.
- [ ] Install CocoaPods (`sudo gem install cocoapods`) and Node LTS if not present. (You cannot build, sign, or submit without a Mac — this is unavoidable.)

### A3. Signing — certificates, identifiers, capabilities 🔴
Do this in App Store Connect + the Apple Developer portal (or let Xcode "Automatically manage signing" do most of it once you're signed in with your Developer account).
- [ ] Create the **App ID / Bundle ID**: `app.duravel` (matches the Capacitor config).
- [ ] Create an **Apple Development** (and later **Distribution**) certificate — Xcode can auto-manage.
- [ ] Create/allow **provisioning profiles** (auto-managed is fine for most).
- [ ] Enable these **capabilities** on the App ID (all are used by Parts 3–6):
  - [ ] **HealthKit**
  - [ ] **Push Notifications**
  - [ ] **Sign in with Apple**
  - [ ] **In-App Purchase**
  - [ ] **Associated Domains** (for Universal Links / deep linking)
- [ ] In Xcode → Signing & Capabilities, add the matching capabilities to the **App** target so entitlements are generated.

### A4. Billing decision — IAP vs external 🔴 *(decide before you build the paywall path)*
This is the biggest product/compliance fork (see compliance checklist §3).
- [ ] **DECIDE:** Apple StoreKit **In-App Purchase** (safest, Apple takes commission) **or** external/alternative billing (only viable under specific Apple programs/regions, higher rejection risk).
- [ ] **If IAP:** create two **auto-renewable subscription** products in App Store Connect — Monthly **$19.99**, Annual **$119.99** — in the same subscription group; fill localizations, review screenshot, and set to "Ready to Submit." Then wire the native purchase plugin (Section B) and reconcile entitlements with Supabase/Stripe.
- [ ] **If external:** confirm you qualify, implement the required disclosures/entitlement, and be ready to defend it in review.
- [ ] Whichever you pick, **edit the billing bracket in `review-notes.md`** so the reviewer notes match reality (a mismatch here is an automatic 3.1.1 rejection).

### A5. Confirm the production URL renders in a native webview 🔴
- [ ] Verify **https://app.duravel.app** loads cleanly inside a WKWebView (not just Safari) — no mixed-content blocks, no auth redirect that breaks in a webview, no "open in Safari" dead-ends, safe-area/notch handling OK.
- [ ] Quick check on the Mac: once the project builds (Section B), run it in the Simulator and watch the app.duravel.app load. If anything web-side needs a webview-specific tweak, that's a web (Next.js) fix in your repo.

### A6. Generate the APNs auth key (.p8) 🔴 *(needed for push, Part 6)*
- [ ] In Apple Developer portal → Keys → **create a new key**, enable **Apple Push Notifications service (APNs)**.
- [ ] Download the **.p8** file (**you can only download it once** — store it safely).
- [ ] Note the **Key ID** and your **Team ID**.
- [ ] Put the .p8 + Key ID + Team ID wherever your push sender lives (server / Supabase edge function / provider) per the Part 6 push artifacts.

### A7. Provide a 1024px app-icon source 🔴 *(gather now)*
- [ ] Supply a **1024×1024 PNG**, no alpha/transparency, no rounded corners (Apple rounds them), on-brand (`#0B0B0F` background works well).
- [ ] The build step / an icon tool will generate the full icon set from this one source. Without it you cannot ship.

---

## SECTION B — Integration steps (on the Mac, once A2 is ready)

This is where the Parts 1–6 artifacts become a real Xcode project. Work in your repo at **C:\dev\duravel** (the `hyroxai/` app), then build on the Mac.

### B1. Copy the overnight artifacts into the repo 🟡
- [ ] Save every delivered file from tonight's chat (Parts 1–7) into the repo at the paths noted in each file's header. Roughly:
  - Capacitor config, package additions, `scripts/ios-setup.sh` → repo root / `hyroxai/`
  - Native shell + splash/status-bar assets → `hyroxai/ios/...`
  - Plugin wiring (auth/deep-link, billing, HealthKit, push) → per each part's instructions
  - `PrivacyInfo.xcprivacy` → `hyroxai/ios/App/App/PrivacyInfo.xcprivacy`
- [ ] Commit to the **Duravel** GitHub repo on a branch (e.g. `ios-native`) so it's all version-controlled before you build.

### B2. Run the iOS setup script on the Mac 🟡
- [ ] From the repo on the Mac: `bash scripts/ios-setup.sh` (installs deps, adds the iOS platform, sets bundle id `app.duravel`, app name `Duravel`, min iOS 15, category Health & Fitness, brand background `#0B0B0F`). Read the script once before running.

### B3. Sync Capacitor 🟡
- [ ] `npx cap sync ios` — copies web assets and installs native plugin pods.
- [ ] `npx cap open ios` — opens the project in Xcode.

### B4. Wire each native plugin & capability 🟡
Confirm each Part's plugin is registered and its capability/entitlement is on the target:
- [ ] **Auth + deep linking (Part 3):** Sign in with Apple capability on; Associated Domains entitlement lists `applinks:app.duravel.app`; host the **apple-app-site-association** file on app.duravel.app (`/.well-known/apple-app-site-association`, correct App ID `TEAMID.app.duravel`, no redirect, `application/json`).
- [ ] **Billing (Part 4):** the purchase plugin registered; products from A4 referenced; restore-purchases works; paywall shows the subscription disclosure + Terms/Privacy links.
- [ ] **HealthKit (Part 5):** HealthKit capability on; `NSHealthShareUsageDescription` / `NSHealthUpdateUsageDescription` strings present & truthful; the "Connect Apple Health" user action triggers the permission sheet.
- [ ] **Push (Part 6):** Push Notifications capability on; APNs key (A6) configured on the sender; permission requested contextually; a test push delivers.
- [ ] **Privacy manifest (Part 7):** `PrivacyInfo.xcprivacy` added to the App target under Build Phases → Copy Bundle Resources.

### B5. Two Info.plist keys (easy wins) 🟡
- [ ] `ITSAppUsesNonExemptEncryption = NO` (export-compliance exemption — standard HTTPS only).
- [ ] Confirm the Health usage-description strings are the real reasons, not placeholders.

### B6. App icon + first build 🟡
- [ ] Generate the icon set from the 1024px source (A7) into the asset catalog.
- [ ] **Build & run** in the iOS Simulator, then on a **real device**. Walk the full path: sign in → Home → open a session → connect Apple Health → receive a reminder → view membership. Fix any webview issues surfaced in A5.

---

## SECTION C — TestFlight, then submission

### C1. Archive & upload to TestFlight 🟡
- [ ] In Xcode: select **Any iOS Device**, **Product → Archive**.
- [ ] In the Organizer, **Distribute App → App Store Connect → Upload** (Distribution cert / provisioning auto-managed).
- [ ] Wait for processing in App Store Connect (a few minutes to an hour). Resolve any automated warnings (missing icons, privacy report gaps — the Xcode Privacy report lists any SDK missing a required-reason declaration).

### C2. Internal TestFlight test 🟡
- [ ] Add yourself as an **internal tester**; install via TestFlight on a real iPhone.
- [ ] Verify on-device: HealthKit real data, real push delivery, purchase/restore (sandbox), Sign in with Apple, deep link opens the app, account deletion.
- [ ] (Optional) invite a few external testers for a day if you want extra confidence — external testing needs a light Beta App Review.

### C3. Fill out the App Store listing 🟡
Use the delivered docs:
- [ ] **Metadata** — paste from `app-store-metadata.md`: name `Duravel`, subtitle, promo text, description, keywords, Support/Marketing/Privacy/Terms URLs, category Health & Fitness, **age-rating questionnaire** answers (→ 4+).
- [ ] **Screenshots** — shoot per `screenshots-plan.md`: 6.7" (1290×2796) required + 6.5" (1242×2688); iPhone-only target for v1 (skip iPad); 5–8 shots, paywall prices must match.
- [ ] **App Privacy** — enter the answers from `privacy-nutrition-label.md`; confirm they match `PrivacyInfo.xcprivacy`.
- [ ] **App Review Information** — demo account creds in the Sign-In fields; paste the walkthrough + **4.2 architecture explanation** from `review-notes.md`; edit the billing bracket to match A4.
- [ ] Provision the **demo account** in production: `review@duravel.app`, comped membership, a plan pre-enrolled with completed sessions, non-expiring password.

### C4. Final compliance pass 🟡
Run `compliance-checklist.md` end-to-end. Confirm all 🔴/🟡 items are cleared, especially:
- [ ] Sign in with Apple present (if any social login exists).
- [ ] In-app account deletion reachable.
- [ ] Billing model consistent everywhere (A4).
- [ ] Health disclosure + Privacy Policy naming HealthKit, no iCloud health storage.
- [ ] Export-compliance key set.
- [ ] Webview locked to your own domain; a native feature (HealthKit) demonstrable; no empty/broken states.
- [ ] Support/Privacy/Terms URLs all resolve.

### C5. Submit for review 🟡
- [ ] Attach the TestFlight build to the App Store version.
- [ ] Set pricing/availability (the app is free to download; membership is the subscription).
- [ ] **Submit for Review.** Watch email + App Store Connect. Keep `support@duravel.app` monitored during the review window in case the reviewer asks for a test push or data.
- [ ] If rejected on 4.2, reply in Resolution Center with the architecture explanation and offer a live walkthrough — that's what it's written for.

---

## The five things to start today (everything else waits on these)

1. **Chase the D-U-N-S** and enroll in the Apple Developer Program (A1) — longest lead time.
2. **Line up a Mac** with Xcode (A2).
3. **Decide IAP vs external billing** (A4) — it shapes the paywall and the review notes.
4. **Generate the APNs .p8 key** (A6) and store it safely.
5. **Produce the 1024px app-icon source** (A7).

Once those five are moving, Sections B and C are a focused day of wiring and clicking. All the code, config, metadata, privacy files, and review copy are already written and waiting in the chat.

— Built overnight, Parts 1–7. Go get it on the store.
