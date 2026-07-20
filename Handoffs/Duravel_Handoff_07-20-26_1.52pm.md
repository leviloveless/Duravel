# Duravel — Session Handoff

**Saved:** 2026-07-20 (Mon) 1:52pm ET · **Session type:** Backlog build — tasks #12, #18, #10 (continuing the pipeline session)
**Continues:** `Duravel_Handoff_07-20-26_12.32pm.md` (shared wearable ingestion pipeline, tasks 1–6). Levi ran migration `0029` and pushed the pipeline commits (`9d564ae`, `c25c768`). This handoff covers the next backlog items built after that.

---

## 1. Headline

Worked the remaining backlog in Levi's agreed order. **Three tasks shipped, each committed locally + cloud-verified (unit tests green): #12, #18, #10.** Two commits are **local-only — `git push` needed** (`9d564ae`/`c25c768` were already pushed).

Answered decisions this session: **#10** A/B applies to all sports; **#15/#16** full build, coaching = waitlist-only (manual approval, no instant pay); **#13** VDOT drives running paces only.

---

## 2. What shipped (local commits on `main`, push = **NEEDED**)

- **`3822424`** — #18 subscription week-gate + #12 RPE/feel import.
- **`25ada9f`** — #10 A/B strength exercise rotation.

### #18 — Gate weeks 3+ behind subscription (`3822424`)
- `lib/program-access.ts` (PURE, 4 tests): `gateProgramWeeks(program, entitled, previewWeeks=2)` truncates the weeks array **server-side** so locked weeks never serialize to the client.
- `app/program/[id]/page.tsx`: computes `getEntitlement()` (billing-off / live sub / active trial all = entitled), gates the program, drops the review banner when previewing.
- `components/program/program-view.tsx`: renders a "🔒 N more weeks — Unlock the full program" CTA → `/pricing`.
- Trial-aware by design: trial users see everything; only trial-ended/unsubscribed get the 2-week preview. Nothing gated while `BILLING_ENABLED` is unset.

### #12 — Import RPE + feel from synced activities (`3822424`)
- `lib/wearables/effort.ts` (PURE, 4 tests): `rpeFromStravaExertion` (Strava `perceived_exertion` → 1–10 RPE), `feelFromNote` (`private_note` → capped note), `effortFromActivity` dispatcher (only Strava carries RPE today; Oura/Apple Health return empty).
- `lib/wearables/strava-api.ts`: `fetchActivityDetail` now also returns `perceived_exertion` + `private_note`.
- `lib/wearables/strava-effort.ts`: `fetchStravaEffort(userId, externalId)` — token-aware detail fetch; never throws (best-effort).
- `app/activity/actions.ts` (`linkActivityToSession`): on link, pulls the athlete's RPE/feel and prefills the log **only to fill gaps** (explicit input > existing manual value > synced value — never clobbers a manual entry). Also **widened linking to all pipeline providers** (was strava/garmin only).

### #10 — A/B exercise rotation on strength days (`25ada9f`)
- `lib/schemas.ts`: lift movement gains an optional `exercise` field (back-compat).
- `lib/engine/strength.ts`: `EXERCISE_AB` (two variants per movement pattern) + `pickExercise(pattern, weekNumber)` — odd weeks → A, even → B, so consecutive weeks never repeat the same lift (overuse). 3 new tests.
- `lib/generation/assemble.ts` (`applyStrengthSchemes`): stamps `m.exercise = pickExercise(pattern, week.weekNumber)`.
- `components/program/format.ts` (`movementLine`): leads with the specific exercise name, falls back to the pattern for older programs.
- **Applies to ALL sports incl. HYROX. Golden-HYROX stayed byte-identical — no snapshot regen needed** (the change lives in assembly; `buildSkeleton` emits empty movements, so the frozen skeleton is untouched). The AI prompt is hand-written and doesn't embed the schema, so it's unaffected too.

---

## 3. Verification

- **Pure-logic harness (tasks #12/#18):** `tsc --noEmit` clean + **8 tests green** (program-access 4, effort 4), on top of the 39 pipeline tests (47 total).
- **Full engine harness (task #10):** staged the real `lib/engine` + `lib/generation` + `lib/ai` trees, `npm install`, ran vitest → **27 files / 351 tests pass**, incl. **golden-hyrox byte-identical (no `-u`)**, `strength-assemble`, and the AI prompt snapshot (5 tests). The A/B change is proven not to drift HYROX.
- **Not run:** full `next build` (route/TSX/server-action wiring for #18/#12 imports `@/lib/supabase`, `next/cache`). **Recommend pushing + letting Vercel build these two commits before stacking the big #15/#16 admin build** — they touch the program page + a schema field, so a green Vercel build de-risks the rest.

---

## 4. Next actions
1. **`git push origin main`** — `3822424` + `25ada9f` are local only.
2. Confirm **Vercel build green** (program page + schema change especially).
3. **Remaining backlog order** (Levi's agreed sequence): #7 (verify in-workout logging — likely already built), #9 (plain-language explanations), #8 (onboarding tutorial), #13 (VDOT running paces), **#15/#16 (admin review tool + $350 coaching waitlist — full build, biggest chunk)**, #14 (token-cost tracking), #17 (hyresult race lookup — big; scraping/legal review), #19 (donation tracker). #11 (Aura) = dropped, no API.

## 5. Where things live
- **#18:** `lib/program-access.ts`, `app/program/[id]/page.tsx`, `components/program/program-view.tsx`.
- **#12:** `lib/wearables/{effort,strava-effort,strava-api}.ts`, `app/activity/actions.ts`.
- **#10:** `lib/engine/strength.ts`, `lib/generation/assemble.ts`, `lib/schemas.ts`, `components/program/format.ts`.
- **Git-bridge gotcha (unchanged):** mount can't unlink → `mv .git/*.lock` + `tmp_obj_*` aside before git ops (done). Commits authored as Levi Loveless <levi.loveless@duravel.app>, no AI-vendor references. Push still needs Levi (cloud GitHub egress blocked this session).
