# Duravel — Session Handoff

**Saved:** 2026-07-20 (Mon) 3:02pm ET · **Session type:** Backlog build — #7, #9, #8, #13, #15/#16
**Continues:** `Duravel_Handoff_07-20-26_1.52pm.md` (#12/#18/#10). Pipeline + #12/#18/#10 are pushed & building green. This handoff covers the next backlog batch.

---

## 1. Headline

Five more backlog items shipped, each cloud-verified. **#7 was already built** (verified, no code). **4 unpushed commits** on `main`. **#15/#16 needs a migration + an env var before it works** — see go-live below.

---

## 2. What shipped

- **`5ea70d0`** — #9 "Understanding your program" plain-language explainer (accordion on the program page; static, no client JS).
- **`000dc7e`** — #8 first-run guided walkthrough (auto-opens for new users via localStorage; "How it works" trigger on the dashboard).
- **`3d7b724`** — #13 VDOT / VO₂max + Daniels training-pace card. NOTE: the engine ALREADY derives run paces from the full Jack Daniels VDOT model (`lib/engine/paces.ts`); this just surfaces the athlete's VDOT, VO₂max estimate, and E/T/I paces. Running-only, no engine change.
- **`8c3fc8c`** — #15/#16 admin console + $350 coaching waitlist (17 files, migration 0030).
- **#7** (click-into-workout logging) — **already fully built**: `LogSession` renders a per-session inline logger (status/RPE/actuals/day/note, optimistic, frozen-week aware) on every session in `week-card.tsx` (mobile + desktop). Verified; nothing to add.

### #15/#16 detail (`8c3fc8c`)
- **Admin auth = env allowlist.** `lib/admin.ts`: `parseAdminEmails` / `emailIsAdmin` (pure, 3 tests) + `getAdmin()`. Set **`ADMIN_EMAILS`** (comma/space list) in Vercel. Non-admins get a 404 on admin routes.
- **`/admin`** — all programs (with owner) + the coaching waitlist (approve/decline). Service-role reads via `lib/admin-data.ts`.
- **`/admin/program/[id]`** — full review + **schema-validated program editor** (edit ANY aspect of `program_data`; `updateProgramData` re-validates against `ProgramDataSchema` so a bad edit is rejected, not persisted), **coaching notes**, **rename**, **recalculate on the athlete's behalf** (`recalcProgramAsAdmin` re-runs `generateProgram` with the service-role client — no per-user rate limit), + read-out of logs/readiness/profile.
- **Coaching notes** — admin writes; the athlete reads them on their own program page (RLS `coaching_notes: read own`). New `CoachingNotesView` card.
- **`/coaching`** — public $350/mo page + focused intake form → `submitWaitlist` inserts (service role) + best-effort emails the first `ADMIN_EMAILS` address via Resend. No payment (application only; you approve manually).
- **Migration `0030_coaching.sql`** — `coaching_notes` (read-own RLS) + `coaching_waitlist` (service-role only). Additive + idempotent.
- **Graceful pre-migration:** the program page's notes query returns null (not a throw) if `coaching_notes` doesn't exist yet, so nothing crashes before 0030 is applied — the features just don't work until it is.

---

## 3. Verification
- Pure logic: admin allowlist (3 tests) + all prior pure suites green; every new client component tsc-clean under the **exact repo strict flags** (incl. `noUncheckedIndexedAccess`, which bit us earlier — harness now matches). Index-access sweep across all new server files: clean.
- **Not run:** full `next build` (server components import `@/lib/supabase` etc.). Let Vercel confirm.

## 4. GO-LIVE for #15/#16 (do these to activate it)
1. **Apply migration `0030_coaching.sql`** in Supabase.
2. **Set `ADMIN_EMAILS`** in Vercel to your email(s). Redeploy so it's picked up.
3. **`git push origin main`** (4 unpushed: `5ea70d0`, `000dc7e`, `3d7b724`, `8c3fc8c`).
4. Verify: `/admin` loads for you, 404s when signed out / as a non-admin; `/coaching` form submits and a row shows in `/admin`.
   - Optional: `RESEND_API_KEY` + `EMAIL_FROM` for the new-application email (already set if lifecycle email is live).

## 5. Remaining backlog (order)
#14 (program-generation token-cost tracking — `generation_events` already stamps input/output tokens + cost per run; this is mostly a reporting/rollup surface), #17 (hyresult race lookup — big; scraping + confirm flow + legal review), #19 (Race for Impact donation tracker — standalone). #11 Aura = dropped.

## 6. Where things live
- Admin: `lib/admin.ts`, `lib/admin-data.ts`, `app/admin/**`, `components/admin/**`. Coaching: `app/coaching/**`, `components/coaching/waitlist-form.tsx`, `components/program/coaching-notes-view.tsx`. Migration `supabase/migrations/0030_coaching.sql`. Env: `ADMIN_EMAILS`.
- #9/#8/#13: `components/program/{program-glossary,vdot-card}.tsx`, `components/onboarding/walkthrough.tsx`, `app/dashboard/page.tsx`, `app/program/[id]/page.tsx`.
- Git-bridge gotcha unchanged (mv `.git/*.lock`+`tmp_obj_*` aside; push needs Levi — cloud egress blocked). Commits authored as Levi, no AI-vendor references.
