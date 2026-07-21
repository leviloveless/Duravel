# Duravel Handoff — 07-21-26 3.57pm

## Session focus
Three program features, all written to the working tree (UNCOMMITTED). Prior commits today: `268ff97` (Phase 0), `fd00563` (Phase 1 + gate), plus the tradeoff-card commit.

## ⚠️ Verify + migrate before pushing
```
npm run build           # exercises all new routes/components (tests unaffected)
npm test                # golden-hyrox still green; no engine logic changed
# APPLY the new migration for the Strava toggle:
supabase db push        # adds profiles.strava_autopost (default true)
```

## 1. Tabbed program view + session tracker
- NEW `components/program/program-tabs.tsx` (client) — tab bar (horizontal-scroll on mobile), renders active tab only.
- NEW `components/program/session-tracker.tsx` (server) — program-wide completion grid (one square/session, colored completed/partial/skipped/missed/upcoming) + % headline. Exports `groupLogsByWeek`.
- `components/program/program-view.tsx` — added optional `hideSummary` prop (guards the internal WeekSummaryTable so it can live in its own tab).
- `app/program/[id]/page.tsx` — the stacked cards are now `<ProgramTabs>`: **Program** (ProgramView, hideSummary) · **Tracker** · **Pace plan** (hyrox/deka/tri pacing + projection) · **VDOT** · **Readiness** · **Daily HR/HRV** · **Weekly summary** (standalone WeekSummaryTable) · **Budget** (TimeBudgetCard). Tabs are conditional (pace only if a plan exists, vdot only if runPaces, budget only if weeklyHours). CoachingNotes stays above tabs, Glossary below.

## 2. Strava auto-upload on log (create activity; default-ON opt-out)
- NEW migration `0035_strava_autopost.sql` — `profiles.strava_autopost boolean default true`. **Must apply.**
- `lib/wearables/strava-api.ts` — added `createManualActivity` (`POST /activities`, sport_type/elapsed/distance/description; 403 → `strava_write_forbidden`).
- NEW `lib/wearables/strava-autopost.ts` — `autoPostSessionToStrava`: gated by `STRAVA_WRITE_ENABLED` + Strava connected + `activity:write` scope + not opted-out; maps session kind → sport_type; builds a branded activity from actuals (fallback planned); **never throws** (best-effort).
- `app/api/logs/route.ts` — on a completed/partial log, awaits `autoPostSessionToStrava` (guarded); added `name` to the program select.
- NEW `components/settings/strava-autopost-toggle.tsx` + `setStravaAutopost` action in `app/settings/connections/actions.ts`; connections page renders the toggle when `STRAVA_WRITE_ENABLED` + configured.
- Requires the athlete to have reconnected Strava for the `activity:write` scope (existing reconnect prompt covers this).

## 3. Mobile Workout view (check-off → one completion log)
- NEW `app/program/[id]/workout/[week]/[day]/page.tsx` — server route; loads the day's sessions.
- NEW `components/program/workout-view.tsx` (client) — check off each element; RPE quick-select; "Complete workout" → `POST /api/logs` (status completed, per session). **Native-gated** via `window.Capacitor?.isNativePlatform()` with a `?preview` escape for web testing; shows a friendly fallback on web. No new DB (per decision).
- `components/program/week-card.tsx` — added a "Workout view" link in the **mobile** (`md:hidden`) day header (naturally mobile-scoped), linking to the new route.

## Commit (from Windows CMD)
```
cd C:\dev\duravel
git add app/program components/program/program-tabs.tsx components/program/session-tracker.tsx ^
        components/program/workout-view.tsx components/program/program-view.tsx components/program/week-card.tsx ^
        app/api/logs/route.ts lib/wearables/strava-api.ts lib/wearables/strava-autopost.ts ^
        app/settings/connections/actions.ts app/settings/connections/page.tsx ^
        components/settings/strava-autopost-toggle.tsx supabase/migrations/0035_strava_autopost.sql ^
        Handoffs/Duravel_Handoff_07-21-26_3.57pm.md
git commit -m "feat: tabbed program view + session tracker, Strava auto-upload, mobile Workout view"
```
(`git add app/program` covers the page edit + the new workout/ route. Push needs Levi. Lock → `del .git\index.lock`.)

## Follow-ups / notes
- Native gating uses Capacitor detection; the iOS app isn't integrated yet, so on web the Workout view shows the fallback (use `?preview` to see it). Revisit when `hyroxai/ios` is wired.
- Strava create-activity uses `start_date_local = now` (approximation) and estimates elapsed_time from actuals/planned duration; refine if you want exact session timestamps.
- Optional polish still open: guardrails (single-session jump cap, concurrent interference, impact routing); dedupe the 3 budget-copy tables; Resend delivery of the science PDF.
