# CLAUDE.md — Duravel

Project memory for any Claude/Cowork session working in this repo. Read this first.

## What this repo is

Duravel — a live hybrid-endurance training app (HYROX, DEKA, triathlon plans).

- **Web:** Next.js + Supabase (auth/data) + Stripe (LIVE billing, $19.99/mo · $119.99/yr) + Resend.
- **iOS:** a **Capacitor 6 native shell** rendering `https://app.duravel.app` in a `WKWebView`,
  plus native plugins (HealthKit, Push, In-App Purchase, Sign in with Apple, deep links).
- **App lives under** `hyroxai/`. Repo root is `C:\dev\duravel`.

## Conventions

- App name **Duravel** · bundle id **app.duravel** · min iOS **15** · **Capacitor 6**
- App Store category **Health & Fitness** · brand background **#0B0B0F**

## 🚨 MANDATORY: Handoff naming + location

**Every session handoff MUST be saved to `C:\dev\duravel\Handoffs`** with the filename format:

```
Duravel_Handoff_MM-DD-YY_H.MMam/pm.md
```

- `MM-DD-YY` = zero-padded month-day-year (July 18, 2026 → `07-18-26`).
- `_H.MMam/pm` = local (America/New_York) clock time (2:13 pm → `_2.13pm`; 9:05 am → `_9.05am`).
- Full example: **`Duravel_Handoff_07-18-26_2.13pm.md`**.

**Fallback:** if the local repo `Handoffs` folder cannot be written (e.g. the cloud
device-bridge write issue below), save to
`C:\Users\Levi Loveless\OneDrive\Documents\Claude\Projects\Training Program App\Handoffs`
instead **and explicitly notify Levi that the local write failed.** Always attempt the repo
folder first. This is a hard rule — do not invent other names or locations.

## 📍 Living roadmap

`Duravel_Roadmap_Planned_vs_Actuals.html` (repo root; desktop artifact
`duravel-roadmap-planned-vs-actuals`) is the single source of truth for build sequencing:
**Planned** bars vs **Actual** progress across all lanes. **Update its `ROWS`/`MILESTONES`
arrays every session** as work lands. Prior artifact exports live in `docs\artifacts\`.

## 👉 iOS build handoff — START HERE

The iOS app was generated across 7 parts. Everything is under `Apple\`, one folder per part,
each with a `MANIFEST.md` (source-of-truth for where each file goes in the repo).
**The parts are generated but NOT yet integrated into `hyroxai/ios`.**

**If you're picking up the iOS work, read `Apple\Duravel_iOS_HANDOFF.md` first** — it has the
full mission, the integration plan (inventory → integrate → wire → build/TestFlight/submit),
and the open blockers. Then read `Apple\Duravel_iOS_Morning_ToDo.md`.

```
Apple\
├── Duravel_iOS_HANDOFF.md        ← read first
├── Duravel_iOS_Morning_ToDo.md   ← master action list
├── Part1_foundation\  … Part6_push\   (each has a MANIFEST.md)
└── Part7_submission\             (App Store metadata, privacy, review, compliance)
```

## Hard rules (don't break)

- iOS builds (archive/sign/upload) run on **macOS/Xcode or Codemagic only** — never claim a build
  is done from Windows.
- **Merge, don't overwrite** `capacitor.config.ts`, `package.json`, `Info.plist` — show a diff first.
- Billing model (Apple IAP vs external) is an **open decision** — confirm with Levi before wiring
  the paywall; a mismatch is an automatic App Store rejection.
- HealthKit data: never to iCloud, never for ads, never sold.
- Keep the webview locked to the app's own domain; keep in-app account deletion reachable.
- **Never break the golden-HYROX byte-identical test** — HYROX program output must stay frozen.
- **Cloud device-bridge writes to `C:\dev\duravel` may not reach the native Windows git index** —
  verify with `git status`; edit the repo on-computer or via native Git Bash when in doubt.

## Open blockers (owner: Levi)

Developer Program enrollment (D-U-N-S), billing decision, APNs `.p8` key, 1024px app icon,
confirm `app.duravel.app` renders in a `WKWebView`, signing capabilities on App ID `app.duravel`.
Detail in `Apple\Duravel_iOS_Morning_ToDo.md` and `Apple\Part7_submission\...\compliance-checklist.md`.
