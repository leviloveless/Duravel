# Duravel — Session Handoff

**Saved:** 2026-07-20 (Mon) 12:32pm ET · **Session type:** Shared wearable ingestion pipeline — tasks 1–6 of Levi's batch
**Continues:** `Duravel_Handoff_07-20-26_11.26am.md` (lifecycle email go-live + result-card growth loop). This session built the shared ingestion pipeline workstream and delivered it to the repo.

---

## 1. Headline

Built the **shared wearable ingestion pipeline** — the "build the foundation once" layer from `docs/future-phases/20` §1 — plus the two growth-loop pieces that plug into it. Tasks **1–6** of Levi's list are done and committed locally as **`9d564ae` on `main`** (27 files, +1884/−70).

**GitHub clone was blocked in the cloud this session**, so everything was written back to the native repo via the device bridge and committed locally. **→ Two go-live steps are yours: `git push origin main` and apply migration `0029` in Supabase.**

The pure logic (dedup, normalize, adherence, readiness recalc, Apple Health normalizer, Strava branding) is covered by **39 new unit tests — all green — and `tsc --noEmit` clean** (run in a cloud vitest harness, since win32 `node_modules` can't run tooling over the Linux bridge).

---

## 2. What shipped (commit `9d564ae`, pushed = **NO — `git push` needed**)

Mapped to the task numbers Levi gave:

**Task 4 — Canonical schema** → `supabase/migrations/0029_canonical_wearables.sql`
- Widens the provider CHECK on all 3 wearable tables to add `whoop` + `apple_health`.
- Extends `wearable_daily` to the canonical daily-metrics shape: `sleep_total_min`, `sleep_deep_min`, `sleep_rem_min`, `sleep_light_min`, `sleep_awake_min`, `readiness_score`, `respiratory_rate`, `vo2max` (all nullable).
- Adds cross-source dedupe columns to `wearable_activities`: `activity_type` (canonical slug), `dedupe_group`, `is_primary` (default true).
- Adds `wearable_oauth_states` (generalized PKCE/state, service-role-only RLS) for WHOOP/Garmin later.
- **Fully additive + idempotent.** `is_primary` defaults true so nothing is hidden until the dedupe pass demotes a confirmed duplicate.

**Task 6 — Shared pipeline + cross-source dedup; Strava refactored onto it**
- `lib/wearables/pipeline.ts` (PURE): `normalizeActivityType` (Strava/Oura/HK → one slug), `dedupeFamily`, `sameSession` (fuzzy: start ±90s, duration ±3%/20s, distance ±2%/50m when both present, family match — cross-provider only), `dedupeActivities` (union-find clustering + source-priority canonical), `PROVIDER_PRIORITY`, `activityToCanonicalRow`.
- `lib/wearables/activity-ingest.ts` (impure): `ingestActivities(userId, provider, normalized[])` — idempotent upsert **then** re-cluster the affected time window and stamp `dedupe_group`/`is_primary`. The ONE place every provider's activities land.
- `strava-sync.ts` + `oura-sync.ts` refactored to call `ingestActivities` instead of upserting the table themselves.
- `activities.ts` read model now filters `is_primary` so a session seen from 2+ sources shows once.

**Task 5 — Normalize + adherence + readiness recalc** (all PURE + tested)
- `lib/wearables/normalize.ts`: `normalizeDailyForDate` / `normalizeDailySeries` — merge multiple providers' daily rows per date by **per-metric source priority** (Oura > WHOOP > Garmin > Apple Health > Strava; §1.5). Health metrics stay provider-separate in storage; merge happens at read time.
- `lib/wearables/adherence.ts`: `computeAdherence(program, logs, throughWeek?)` — planned vs completed/partial/skipped/missed per week + overall, completion rate, logged minutes, by-kind.
- `lib/wearables/readiness-recalc.ts`: `objectiveReadiness(series)` — baseline-relative RHR/HRV prefill (28-day trailing baseline, ≥3 readings) with a standalone 0–100 objective score + human note.
- `app/api/wearables/readiness-prefill/route.ts` upgraded to normalize across all providers then compute the baseline-relative prefill (keeps the legacy `{restingHr, hrv}` keys + adds baseline context).
- `lib/wearables/daily-ingest.ts`: `dailyToRow` maps the extended `NormalizedDaily` (incl. new canonical cols) for upsert.

**Task 3 — Apple Health backend reader** (the part buildable without Xcode/Apple dev)
- `lib/wearables/apple-health.ts` (PURE): `IngestionWorkout` DTO, `HEALTHKIT_SKIP_BUNDLE_IDS` (drops Strava-origin + own writes — belt-and-suspenders vs the client filter), `normalizeHealthKitWorkout`, `normalizeHealthKitBatch`.
- `app/api/ingest/healthkit/route.ts`: the endpoint the native plugin's `healthkit.service.ts` already POSTs to. Zod-validates the batch, records a tokenless `apple_health` connection row, and runs the workouts through the SAME `ingestActivities` dedupe pipeline.
- **Native Swift plugin was already generated** in `Apple/Part5_healthkit/ios/` — it can't be compiled here (needs Xcode + Apple Developer enrollment). The backend it targets now exists.

**Task 2 — Strava activity-write branding**
- `lib/wearables/branding.ts` (PURE): `buildBrandedDescription` — idempotent branded tag block (leading `— Duravel` marker so re-branding never stacks or orphans an old tag).
- `strava.ts`: scope now requests `activity:write` (**existing connections must reconnect** to grant it) + `hasWriteScope` helper.
- `strava-api.ts`: `fetchActivityDetail` + `updateActivityDescription` (`PUT /activities/{id}`, 403 → `strava_write_forbidden`).
- `strava-brand.ts` + `app/api/wearables/strava/brand/route.ts`: opt-in write, gated by `STRAVA_WRITE_ENABLED`; returns `reconnect_required` (409) when the write scope is missing.

**Task 1 — Finish result cards**
- `components/program/result-card-studio.tsx`: added a **Web Share** button (native share sheet with the PNG attached via `navigator.share({files})`, falling back to Download) — completes the growth-loop share action. Session auto-prefill already shipped last session; **race/PR auto-prefill stays deferred (no benchmark/splits data source yet).**

**Env:** `lib/env.ts` adds `STRAVA_WRITE_ENABLED` + `HEALTHKIT_ENABLED` (both optional).

---

## 3. Verification

- **39 unit tests, all green** + **`tsc --noEmit` clean** on the pure modules (`pipeline`, `normalize`, `readiness-recalc`, `adherence`, `apple-health`, `branding`) via a cloud vitest+typescript+zod harness. Tests are committed alongside the code (`*.test.ts`) so they run in CI.
- **Found + fixed a real bug during verification:** the first branding design put the sentinel in the tag's *suffix*, so re-branding orphaned the old session/week prefix — fixed by leading the tag block with the `— Duravel` marker (now idempotent; test covers wk2→wk3 re-brand).
- **Not run here:** full `next build` / the app-route + sync + migration wiring (they import `@/lib/supabase`, `next`, `zod` — not runnable in the harness). Written carefully to mirror existing patterns; **let Vercel build confirm the app compile after push.**

---

## 4. Next actions — YOURS

1. **`git push origin main`** — commit `9d564ae` is local only (cloud GitHub egress was blocked).
2. **Apply migration `0029` in Supabase** — the new code writes/reads the new columns (`activity_type`, `dedupe_group`, `is_primary`, sleep stages, etc.). **The Oura/Strava sync + activities page + readiness-prefill will error until 0029 is applied**, so apply it *with* this deploy, not after.
3. Confirm the **Vercel build** is green.
4. **Strava branding go-live** (when ready): set `STRAVA_WRITE_ENABLED=true`, add a "Share to Strava" button on a completed+linked session that POSTs `/api/wearables/strava/brand`, and prompt users to reconnect Strava (new `activity:write` scope).
5. **Re-sync Oura/Strava** once deployed to backfill `activity_type`/dedupe columns on existing rows (the dedupe pass runs on ingest).

## 5. Tasks 7–19 — NOT done this session (triage)

Deliberately left for a focused pass — several are blocked or need product/pricing/legal calls. Recommended order + notes are in the chat message accompanying this handoff. Headlines: #11 (Aura) is **dead — no public API, use Strava**; #12 (RPE/feeling import from Garmin/Strava/Runna) is a **natural next step now that the pipeline exists**; #17 (hyresult.com race lookup) is a big feature + scraping/legal review; #15/#16 (admin/coaching, $350 1-on-1) need product decisions first.

---

## 6. Where things live
- **Pipeline:** `lib/wearables/{pipeline,activity-ingest,daily-ingest,normalize,adherence,readiness-recalc,apple-health,branding,strava-brand}.ts` (+ `*.test.ts`). Refactored: `strava-sync`, `oura-sync`, `strava`, `strava-api`, `activities`, `types`.
- **Routes:** `app/api/ingest/healthkit/route.ts`, `app/api/wearables/strava/brand/route.ts`, `app/api/wearables/readiness-prefill/route.ts`.
- **Schema:** `supabase/migrations/0029_canonical_wearables.sql`.
- **UI:** `components/program/result-card-studio.tsx` (Web Share).
- **Roadmap:** `Duravel_Roadmap_Planned_vs_Actuals.html` updated (shared-foundation rows → ahead/done; Apple Health + Strava branding notes).
- **Git-bridge gotcha (unchanged):** the mount can't unlink, so git leaves `.git/*.lock` + `tmp_obj_*`; `mv` them aside before git ops (done). Commit authored as Levi Loveless <levi.loveless@duravel.app>, no AI-vendor references.
