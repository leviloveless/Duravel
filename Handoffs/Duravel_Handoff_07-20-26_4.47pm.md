# Duravel — Session Handoff

**Saved:** 2026-07-20 (Mon) 4:47pm ET · **Session type:** Backlog build — #14, #19, #17 (race lookup) + onboarding wiring
**Continues:** `Duravel_Handoff_07-20-26_3.02pm.md` (#7/#9/#8/#13/#15/#16). This covers the rest of the backlog.

---

## 1. Headline

Backlog is essentially **complete**. This session: #14 (gen-cost analytics), #19 (donation tracker), #17 (HYROX race-result lookup via official API + Ironman/DEKA placeholders + onboarding wiring + equipment/current-days fields). **2 unpushed commits.** Two migrations to apply (0031, 0032).

---

## 2. What shipped

- **`eb22237`** — #14 generation-cost analytics (`/admin/metrics`): avg token cost per create/recalc, by program type/length/#races/input-size. Data was already stamped on `generation_events`; this is the rollup (pure `lib/generation-cost.ts`, 6 tests).
- **`2ad6d9e`** — #19 Race for Impact donation tracker: public `/impact` progress page (IG bio link) + admin editor `/admin/impact`; **migration `0031_fundraiser.sql`** (single editable row, public-read). Pure `lib/fundraiser.ts`.
- **`cab8b40`** — #17 HYROX lookup (initial).
- **`6dda1ca`** — #17 FIX: the lookup URL doubled `/v1` (`/api/v1/v1/...`) → 404; corrected to `/athletes/search`. Errors now surface the upstream HTTP status. Added Ironman + DEKA "coming soon" placeholders on `/tools/hyrox-lookup`.
- **`830d853`** — #17 onboarding wiring (a+b): HYROX lookup auto-fills the goal-time field; new **equipment** + **current-days-per-week** fields (schema + **migration `0032_profile_equipment.sql`** + form + persist). schema-equipment 4 tests.

### #17 race lookup — key facts
- **API: hyroxresultapi.com, HYROX ONLY.** Base `https://hyroxresultapi.com/api/v1` (override `HYRESULT_API_BASE`), Bearer `HYRESULT_API_KEY` (set in Vercel + .env.local). Endpoints: `GET /athletes/search?q=<surname>&first=<given>` → `{id, person_ref}` hits; `GET /athletes/{id}/splits` → result (total_time_ms + splits). Starter tier (30 req/min) — lookup is bounded to 8 hits/search to protect it.
- **Client is DEFENSIVE** (`lib/hyrox-results.ts` reads multiple candidate key names) because the exact splits JSON schema wasn't fully public. **Levi should confirm field names against a live response** — if finish time/splits don't populate, tweak the key lists in `normalizeResult`.
- **DEKA**: no central results source (RACE RESULT's Simple API is per-event, organizer-enabled; no name search). Verdict: **manual entry**; placeholder shipped. **Ironman**: **Athlinks API** (Levi's approval pending) — wire like HYROX when live.
- **Files:** `lib/hyrox-results.ts` (+test), `lib/hyrox-results-api.ts`, `app/api/hyrox-lookup/route.ts`, `components/onboarding/hyrox-lookup.tsx` (reusable, `onPick` callback), `app/tools/hyrox-lookup/page.tsx` (dashboard-linked).

### #17b equipment/current-days
- `Equipment` enum + `ProfileSchema.equipment` / `.currentDaysPerWeek` (both optional). Onboarding form: equipment chips + a current-days input in the Schedule step. Persisted to `profiles` (mig 0032) AND flows into `input_snapshot`. **NOT yet used by generation** — the AI prompt doesn't read them yet (that's the next increment; would need a prompt-snapshot regen). Captured + editable now.

---

## 3. Verification
- Pure suites: 70 tests / 13 files green (incl. generation-cost 6, fundraiser-implicit, hyrox-results 6, schema-equipment 4, admin 3). All new client components tsc-clean under the repo's strict flags (`noUncheckedIndexedAccess` etc.). Index-access swept clean.
- **Not run:** full `next build`. The onboarding form (42KB) edits are localized + type-safe but weren't tsc'd in isolation — **watch the Vercel build** on this one.

## 4. GO-LIVE
1. **`git push origin main`** (2 unpushed: `6dda1ca`, `830d853`).
2. **Apply migrations `0031_fundraiser.sql` + `0032_profile_equipment.sql`** in Supabase.
3. Test the HYROX lookup live (name search) — confirm finish time/splits populate; if a field's off, fix the key list in `lib/hyrox-results.ts`.
4. Set the fundraiser values at `/admin/impact`; link `/impact` from Instagram.

## 5. Remaining / next increments
- **Ironman lookup** via Athlinks (pending API approval) — same pattern as HYROX.
- **Equipment/current-days → generation**: make the AI prompt honor available equipment (needs a prompt-snapshot regen). Currently captured but unused.
- **Push-notification workout reminders** (#17 tail) — separate infra (web push, or native with the iOS lane).
- Roadmap HTML (`Duravel_Roadmap_Planned_vs_Actuals.html`) not refreshed this session — update when convenient.

## 6. Env / migrations this session
- Env added across the day: `STRAVA_WRITE_ENABLED`, `HEALTHKIT_ENABLED`, `ADMIN_EMAILS`, `HYRESULT_API_KEY`, `HYRESULT_API_BASE`.
- Migrations added: `0029` (canonical wearables), `0030` (coaching), `0031` (fundraiser), `0032` (profile equipment). Apply any not yet applied.
- Git-bridge gotcha unchanged (mv `.git/*.lock`+`tmp_obj_*`; push needs Levi). Commits authored as Levi, no AI-vendor references.
