# CLAUDE.md — Duravel

Project memory for any agent session working in this repo. Read this first.

## What this repo is

Duravel — a live hybrid-endurance training app. Ten sports: HYROX, five DEKA
formats (fit / mile / strong / atlas / ultra), three triathlon distances
(olympic / 70.3 / 140.6), and general fitness.

- **The Next.js app is at the REPO ROOT** — `app/`, `lib/`, `components/`,
  `supabase/`, `scripts/`, `types/`. There is no `hyroxai/` subdirectory and there
  has not been one since the rename. Earlier revisions of this file said the app
  lived under `hyroxai/`; that sent several sessions looking in the wrong place.
- **Stack:** Next.js 16 (App Router, RSC) · React 19 · TypeScript · Supabase
  (Postgres + Auth + RLS) · Stripe · Resend · Vitest · deployed on Vercel.
  Node 20 (`.nvmrc`). Path alias `@/*` → repo root.
- **TypeScript is strict and then some:** `strict`, `noUnusedLocals`,
  `noUnusedParameters`, `noUncheckedIndexedAccess`, `noFallthroughCasesInSwitch`.
  An unused import is a build failure, not a lint warning.
- **Billing:** $19.99/mo · $119.99/yr standard, plus a $39.99/mo custom-program
  tier (`STRIPE_PRICE_CUSTOM_MONTHLY`). Enforcement is gated behind
  `BILLING_ENABLED`; every Stripe/Resend/wearable env var is optional so the app
  boots unconfigured. All env vars are validated at import time by `lib/env.ts`,
  which downgrades to warnings during `next build` and throws at runtime.
- **iOS:** a **Capacitor 6 native shell** rendering `https://duravel.app` in a
  `WKWebView`, plus native plugins (HealthKit, Push, In-App Purchase, Sign in with
  Apple, deep links). **Not integrated yet** — Capacitor is not in `package.json`,
  there is no `ios/` directory, and the only `capacitor.config.ts` in the repo is
  the unintegrated artifact under `Apple/2_iOS_App_Build/ios-artifacts/`.
  ✅ **Host resolved 2026-08-17: the shell loads `duravel.app`.** It was specced
  against `app.duravel.app`, which returns Vercel `404: DEPLOYMENT_NOT_FOUND` — no
  project claims that hostname. Repointing was the fix rather than attaching the
  subdomain, because the web app cannot serve a second host as built:
  `NEXT_PUBLIC_SITE_URL` is a single value and Stripe, the Strava/Oura OAuth
  callbacks and password reset all read `env.NEXT_PUBLIC_SITE_URL ?? request.origin`,
  so env wins and an athlete on the other host is redirected off it mid-flow.
  **Universal Links are served live** from
  `duravel.app/.well-known/apple-app-site-association`
  (`app/.well-known/apple-app-site-association/route.ts`, logic in `lib/apple/aasa.ts`),
  which **404s until `APPLE_TEAM_ID` is set** — deliberate, since Apple's CDN caches
  what it fetches and a `TEAMID` placeholder would cache an invalid association.

## Commands

| Command                           | What it does                                                                                        |
| --------------------------------- | --------------------------------------------------------------------------------------------------- |
| `npm run dev` / `build` / `start` | Next dev / production build / serve                                                                 |
| `npm run test`                    | Vitest — **141 files, 1480 tests, ~70s** (`lib/**/*.test.ts` only)                                  |
| `npm run test:coverage`           | Coverage over `lib/engine/**` + `lib/generation/**`, with thresholds                                |
| `npm run typecheck`               | `tsc --noEmit`                                                                                      |
| `npm run lint`                    | ESLint (`next/core-web-vitals` + `next/typescript`)                                                 |
| `npm run format` / `format:check` | Prettier                                                                                            |
| `npx tsx scripts/preview.ts`      | Prints a deterministic skeleton to stdout — the fastest way to eyeball periodization without the UI |

Tests are node-environment and take dummy Supabase/model env from
`vitest.config.ts`; nothing hits the network. CI (`.github/workflows/ci.yml`) runs
test → build → typecheck, with **lint and `npm audit` non-blocking**.

**State as of 2026-09-09:** in a fresh clone at `HEAD`, `npx eslint .` **crashes**
(`TypeError: Converting circular structure to JSON` out of `@eslint/eslintrc`) —
`eslint-config-next` 16.x ships native flat config and the committed
`eslint.config.mjs` still routes it through the `FlatCompat` eslintrc bridge. A fix
is in flight in the working tree; with it applied ESLint runs and reports ~35 errors
/ ~21 warnings, mostly `no-explicit-any`, `prefer-const` and unused vars. Do not
assume a clean lint tree.

## How a program is built

**The engine is deterministic; the AI only fills content.** Structure, volume and
legality are decided in code. Generated text is never allowed to decide a number.

1. **`buildSkeleton(input)`** — `lib/engine/skeleton.ts`. Pure and deterministic:
   mesocycle allocation, microcycle progression, session slots
   (`lib/engine/slots.ts`), sequencing guards, per-week mileage and cardio targets,
   taper, race weeks.
2. **AI fill** — `lib/ai/generate-week.ts`, one call per mesocycle chunk (batched so
   no response can truncate), Zod-validated with one retry. **Triathlon skips this
   entirely** — `generate-program.ts` builds tri programs straight from the skeleton,
   which already carries per-session durations, zones and types.
3. **`assembleProgram(skeleton, chunks, …)`** — `lib/generation/assemble.ts`. Merges
   chunks onto the skeleton and re-asserts the engine's planned session kinds;
   anything the model got wrong is overwritten, not trusted.
4. **`reconcileWeekVolume(...)`** — `lib/generation/reconcile.ts`, called from
   `assemble.ts`. Rewrites each week so prescribed mileage and cardio minutes are hit
   **exactly**, at fixed formula paces (`lib/engine/paces.ts`).
5. **`verifyProgram(program)`** — `assemble.ts`. Generation fails rather than
   persisting a program that violates an invariant.

**The whole pipeline runs with zero AI output.** `assembleProgram(skeleton, [], …)`
returns a complete, legal program from an _empty_ chunk array. That is what the audit
harnesses in `lib/generation/__hyb.test.ts` and `__tri.test.ts` exploit — they sweep
thousands of athlete combinations (sport × hours band × experience × training days)
offline and print plan-vs-delivered tables. **When you need to know what the engine
actually does across a parameter space, write one of these instead of reasoning about
it.** They are throwaway: delete them when done, because `noUnusedLocals` turns a
leftover helper into a failing `npm run typecheck`.

**Sports** live in `lib/engine/sports/` — `hyrox.ts`, `deka.ts`, `triathlon.ts`,
`general-fitness.ts`, resolved by `getSport(id)` in `index.ts`; the id union is the
`Sport` enum in `lib/schemas.ts`. Long-course triathlon limits: `lib/engine/ironman/`.

**Never break `lib/engine/golden-hyrox.test.ts`** — the snapshot oracle that freezes
HYROX skeleton output. Its baseline has moved twice, deliberately and with sign-off,
each time documented in the file header. A diff you did not intend means your change
is wrong; do not update the snapshot to make a refactor pass.

## Comments explain WHY, at length

House convention, and it is the strongest one here. A comment carries the decision,
the measurement that drove it, and the trap it avoids — not a paraphrase of the line
below it. Read these before writing your first comment:

- `lib/generation/reconcile.ts` — the reconciliation rules, in order, with the
  minimums and the tight-week fallback spelled out.
- `lib/engine/slots.ts` — what the engine decides versus what the AI later fills.
- `lib/engine/golden-hyrox.test.ts` header — records the audit that justified moving
  the baseline (10,675 illegal days across 47,040 weeks; 12,096 weeks byte-identical
  on the paths a real athlete can reach).
- `lib/env.ts`, the `STRIPE_PRICE_CUSTOM_MONTHLY` note — why an env var declared in
  the schema but never read out of `process.env` fails silently and totally.

A comment that restates the code is worse than none.

## Conventions

- App name **Duravel** · bundle id **app.duravel** · min iOS **15** · **Capacitor 6**
- App Store category **Health & Fitness** · brand background **#0B0B0F**
- SQL migrations are numbered under `supabase/migrations/` (0001–0045 plus
  `APPLY_NOTES.md`); apply them **before** deploying code that depends on them. Every
  user-owned table has RLS with `auth.uid()`-scoped policies and the app uses only the
  anon key + user JWT, so Postgres RLS is the single tenancy boundary. The one
  exception is the Stripe webhook, which uses `SUPABASE_SERVICE_ROLE_KEY`.

## 🚨 MANDATORY: Handoff naming + location

**Every session handoff MUST be saved to the repo's `Handoffs/` folder** (Levi's
machine: `C:\dev\duravel\Handoffs`) with the filename format:

```
Duravel_Handoff_MM-DD-YY_H.MMam/pm.md
```

- `MM-DD-YY` = zero-padded month-day-year (July 18, 2026 → `07-18-26`).
- `_H.MMam/pm` = local (America/New_York) clock time (2:13 pm → `_2.13pm`; 9:05 am → `_9.05am`).
- Full example: **`Duravel_Handoff_07-18-26_2.13pm.md`**.

**Fallback:** if the local repo `Handoffs` folder cannot be written (e.g. the cloud
device-bridge write issue below), save to
`C:\Users\Levi Loveless\OneDrive\Documents\Claude\Projects\Training Program App\Handoffs`
instead **and explicitly notify Levi that the local write failed.** Always attempt the
repo folder first. This is a hard rule — do not invent other names or locations.

## 📍 Living roadmap

`Duravel_Roadmap_Planned_vs_Actuals.html` (repo root; desktop artifact
`duravel-roadmap-planned-vs-actuals`) is the intended source of truth for build
sequencing: **Planned** bars vs **Actual** progress across all lanes. Update its
`ROWS`/`MILESTONES` arrays and its `TODAY` constant every session as work lands.
Prior artifact exports live in `docs/artifacts/`.

**It is currently stale** — `TODAY` still reads `2026-08-06`, the last content refresh
was 2026-07-21, and it still refers to `hyroxai/ios`. Treat its percentages as a
historical snapshot, not as current status, until someone refreshes it.

## 🔌 Wearables & data integrations

All providers feed one shared ingestion pipeline (`lib/wearables/pipeline.ts` and
`ingest.ts`) — spec in `docs/future-phases/20-multi-source-health-integrations.md`.
**Garmin Connect Developer Program is PAUSED to new applications (2026-07-18, no
reopen date)** — parked; re-apply when it reopens (weekly reminder set). Pivot order:
**Oura (build first) → WHOOP (start app-approval early + resolve its ToS retention
limit) → Apple Health (ships with the iOS app; needs a custom Capacitor plugin)**.
**Aura dropped** — no public API (it's a data sink); use the live Strava import
instead. Legacy Garmin build spec (still valid, parked): `docs/future-phases/11-garmin.md`.

## 👉 iOS build handoff — START HERE

The iOS app was generated across 7 parts, all under `Apple/`. **The parts are
generated but NOT integrated — there is no `ios/` directory in the repo.**

**If you're picking up the iOS work, read `Apple/Duravel_iOS_HANDOFF.md` first** — it
has the full mission, the integration plan (inventory → integrate → wire →
build/TestFlight/submit), and the open blockers. Then `Apple/Duravel_iOS_Morning_ToDo.md`.

The folder naming is inconsistent — parts 1 and 7 are not `PartN_` folders, and only
parts 2–6 carry a `MANIFEST.md` (the source of truth for where each file goes in the
repo):

```
Apple/
├── Duravel_iOS_HANDOFF.md          ← read first
├── Duravel_iOS_Morning_ToDo.md     ← master action list
├── Part 1 README.md  ·  1_Training_Program_Specs/  ·  2_iOS_App_Build/   (part 1)
├── Part2_native-shell/ … Part6_push/                (each has a MANIFEST.md)
└── Part 7 README.md  ·  01_app-store-listing/  ·  02_privacy/
    ·  03_review-and-compliance/                     (part 7 — App Store submission)
```

## Hard rules (don't break)

- iOS builds (archive/sign/upload) run on **macOS/Xcode or Codemagic only** — never
  claim a build is done from Windows.
- **Merge, don't overwrite** `capacitor.config.ts`, `package.json`, `Info.plist` —
  show a diff first.
- Billing model (Apple IAP vs external) is an **open decision** — confirm with Levi
  before wiring the paywall; a mismatch is an automatic App Store rejection.
- HealthKit data: never to iCloud, never for ads, never sold.
- Keep the webview locked to the app's own domain; keep in-app account deletion reachable.
- **Never break the golden-HYROX byte-identical test** — HYROX program output must stay frozen.
- **Cloud device-bridge writes to `C:\dev\duravel` may not reach the native Windows git
  index** — verify with `git status`; edit the repo on-computer or via native Git Bash
  when in doubt.

## Open blockers (owner: Levi)

Developer Program enrollment (D-U-N-S), billing decision, APNs `.p8` key, 1024px app
icon, confirm `duravel.app` renders in a `WKWebView`, signing capabilities on App ID
`app.duravel`. Detail in `Apple/Duravel_iOS_Morning_ToDo.md` and
`Apple/03_review-and-compliance/compliance-checklist.md`.
