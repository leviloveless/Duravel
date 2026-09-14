# The dashboard on iOS

**Written 2026-09-13.** Levi asked for the dashboard "and plan to do so for the
app too". This is that plan. Nothing here is built.

## The one decision that matters

**The native app must not re-derive any of these numbers.**

Every figure on the web dashboard comes from four pure modules — `lib/dashboard/derive.ts`,
`fitness.ts`, `calendar.ts` and `lib/diagnostic/score.ts`. They take plain data
and return plain data: no React, no Supabase client, no `window`. That is not an
accident and it is the whole reason an app is cheap to build here.

A Swift reimplementation of `fitnessSeries` would be a second opinion about an
athlete's fatigue, and the two would drift the first time anybody touched a
constant. This repo has learned that lesson eleven times under the name
"work vs total", and once already this month when two surfaces read different
sources for the same weekly number.

So: **the shell renders `duravel.app` in a `WKWebView` (already the plan,
Capacitor 6), and the derivations stay in TypeScript, server-side.** The native
layer owns only what a web view cannot do.

## What the native layer actually owns

| Native             | Why it cannot be web                                                                                   |
| ------------------ | ------------------------------------------------------------------------------------------------------ |
| HealthKit read     | No web API. Feeds the existing ingestion pipeline via `/api/ingest/healthkit`, which is already built. |
| Push notifications | Session reminders on the morning of. `lib/push/*` already exists; the shell supplies the APNs token.   |
| Offline program    | A race-week athlete in a car park with no signal still needs today's session.                          |
| Sign in with Apple | Guideline 4.8 — mandatory now that Google sign-in ships.                                               |
| Deep links         | Universal Links are already served from `duravel.app/.well-known/apple-app-site-association`.          |

## Screens, in build order

1. **Today** — the one screen that justifies the app. Today's sessions, tap to
   log, nothing else. Render from the same `/dashboard` data; strip the charts.
2. **This week** — the existing week strip, full-bleed. Already responsive.
3. **Calendar** — `/calendar` works at 400px today (verified). Ship as-is.
4. **Fitness / fatigue / form** — the chart is server-rendered SVG with no
   client JS, so it renders in a web view unchanged. No native charting library.
5. **Log a session** — the one screen worth considering native, because it wants
   the keyboard and haptics. Measure the web version first.

## What has to change on the web side first

- **Offline.** A service worker caching the current week's program JSON. The app
  manifest exists (`app/manifest.ts`); nothing caches yet.
- **A JSON endpoint for today.** The shell's widget and notification body need
  today's sessions without parsing HTML. `/api/today` returning the same shape
  `ThisWeek` renders from.
- **Auth in a web view.** Supabase's PKCE flow works, but Sign in with Apple has
  to hand its credential to the same session — the reason the auth work is
  sequenced before the shell, not after.

## Sequence

Web offline + `/api/today` → Capacitor shell pointing at `duravel.app` →
HealthKit → push → Sign in with Apple → TestFlight.

⚠️ Every step after the shell is blocked on **Developer Program enrolment
(D-U-N-S)**, which has been the open blocker since July. Nothing in this plan
changes that.
