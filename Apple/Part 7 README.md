# Duravel — Apple / iOS submission files

Drop this whole `Apple/` folder into `C:\dev\duravel\Apple`.

## What's in here (Part 7 — App Store submission package)

```
Apple/
├── Duravel_iOS_Morning_ToDo.md          ← START HERE. The one ordered action list.
├── 01_app-store-listing/
│   ├── app-store-metadata.md            ← name, subtitle, description, keywords, URLs, age rating
│   └── screenshots-plan.md              ← device sizes + the 6–8 shot set with captions
├── 02_privacy/
│   ├── PrivacyInfo.xcprivacy            ← drop into hyroxai/ios/App/App/ (add to App target)
│   └── privacy-nutrition-label.md       ← the App Store Connect "App Privacy" answers
└── 03_review-and-compliance/
    ├── review-notes.md                  ← demo account + §4.2 architecture defense
    └── compliance-checklist.md          ← every Apple gate with status
```

## ⚠️ Note on Parts 1–6

This bundle contains the **Part 7** files only. Parts 1–6 (foundation, native shell,
auth/deep-linking, billing, HealthKit, push) were delivered in earlier chat messages
during the overnight build and are **not** in this session's workspace, so they could not
be re-bundled here automatically. Grab those from their original chat deliveries and place
them alongside this folder per the paths noted in each file's header (mostly under
`hyroxai/ios/...` and the repo root), or ask me to regenerate any of them.

The one file here that is an actual **code artifact** (not a doc) is
`02_privacy/PrivacyInfo.xcprivacy` — its real home in the repo is
`hyroxai/ios/App/App/PrivacyInfo.xcprivacy`. The rest are reference docs you copy from
when filling out App Store Connect.
