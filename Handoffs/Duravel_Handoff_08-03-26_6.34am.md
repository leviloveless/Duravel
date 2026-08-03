# Duravel Handoff — 08-03-26 6:34am

## What shipped this round

**Extra (unplanned) workouts.** Athletes can now record a workout the program never asked for — on a rest day, or on top of a day that already has sessions. Two ways in, per Levi's spec: attach an already-synced wearable activity, or type it in structured like a real session (type, name, minutes, miles, avg HR, RPE, notes).

Design decisions this implements:

- It is a **log**, not a plan change. Adding an extra never touches `program_data.weeks`, so Recalculate cannot wipe it and the engine's periodization is untouched.
- Extras are **tracked separately**. The week header keeps showing the engine's prescribed cardio/mileage/strength totals; extras get their own line below, labelled "not counted in the totals above".
- Both entry paths are supported (import from the sync API, or structured manual entry).

## Why extras live outside the program blob

Two hard constraints made this the only safe shape:

1. `reconcileWeekVolume` (lib/generation/reconcile.ts) *guarantees* the weekly summary equals the engine's prescribed mileage and cardio exactly. Folding unplanned work into the summary would break that guarantee and make every week's totals unauditable.
2. Recalculate replaces `program_data.weeks` wholesale. Anything stored in the blob would be destroyed on the next recalculation.

`workout_logs` could not be reused: those rows are keyed on a *planned* session's position (`program, week, day, index-within-day`) and the logs API rejects a position with no session behind it — which is precisely why unplanned work had nowhere to go.

## Base

Built on HEAD `d7f5b1e5ee21d4f7c15decb68d1f10df21b53ea7`, working tree clean at start. Base was md5-verified current immediately before write-back (lib/schemas.ts on device matched the untouched copy the work was based on).

## Files

New:

- `supabase/migrations/0038_extra_workouts.sql` — `extra_workouts` table, CHECK constraints mirroring the zod schema, `(program_id, week_number)` index, `unique (program_id, activity_id)` so one synced activity can't be added twice, and four RLS policies (select/insert/update/delete own) mirroring `workout_logs`.
- `lib/extra-workouts.ts` — pure selection/reporting helpers: `extrasFromRows`, `extrasForWeek`, `extrasForDay`, `extraTotals`, `extraTitle`, `extraDetail`, `extraSummaryLabel`.
- `lib/extra-workouts.test.ts` — 16 tests.
- `app/program/extra-actions.ts` — server actions `addExtraWorkout`, `addExtraFromActivity`, `deleteExtraWorkout`. Zod-validated, ownership-checked, and it turns the `23505` unique violation into a readable "already added" message.
- `components/program/extra-workout.tsx` — `ExtraWorkoutList` + `AddExtraWorkout` (synced-activity picker and the structured manual form).

Modified:

- `lib/schemas.ts` — `ExtraWorkoutKind`, `ExtraWorkoutSchema`, `ExtraWorkoutInputSchema` and their inferred types.
- `lib/supabase/queries.ts` — `ExtraWorkoutRow` + `getProgramExtras`, ordered `created_at` ascending so a day's extras render in the order they were logged.
- `app/program/[id]/page.tsx` — loads extras in the existing `Promise.all` (no extra round-trip in series) and maps them through `extrasFromRows`.
- `components/program/program-view.tsx` — `ProgramActivity.extras`, threaded into each `WeekCard`'s `logging`.
- `components/program/week-card.tsx` — extras render in both layouts (mobile stacked list and desktop table), on rest days as well as days with sessions, plus the week-header extras line.

## Implementation notes worth remembering

- **The desktop table's `rowSpan`.** The day-name cell spans a day's session rows. Extras get their own full-width row underneath, so the day cell is now `rowSpan={sessions.length + extraRow}` and the day's branch returns `[...sessionRows, extraRow]` rather than the bare `sessions.map(...)`. Miss the `+ extraRow` and the whole table shears by one cell.
- **`numeric` comes back as a string.** `distance_miles` is Postgres `numeric`, which supabase-js hands back as a string. `extrasFromRows` coerces it; there's a test pinning `"5.20"` → `5.2`.
- **Invalid rows are dropped, not rendered.** A row that fails `ExtraWorkoutSchema` is omitted — showing half a workout is worse than showing none.
- **Frozen weeks.** A week whose review has been applied is frozen: extras still display but the add/remove affordances disappear, matching how logging already behaves.

## Verification

Run against the real dependency tree (a full copy of the repo with `npm ci`, not the scratch tree):

- `tsc --noEmit` — exit 0, whole project.
- `vitest run` — 78 files, 760 tests, all passing.
- `next build` — exit 0, production build.

Note on process: the full suite was run, not just `lib/engine` and `lib/generation`. That rule exists because `main` once went red for two commits after a scoped run missed a broken prompt snapshot.

`eslint` could not run in the verification copy — the shared config throws `Converting circular structure to JSON` from `@eslint/eslintrc` there. That is an environment/config issue in the copy, not a lint finding, and Vercel builds are unaffected.

## Still to do — action required

**The migration has not been applied.** `supabase/migrations/0038_extra_workouts.sql` needs to be run against Supabase (SQL editor or `supabase db push`). Until it is, the program page will error when it queries `extra_workouts`. Apply it *before* the Vercel deploy finishes.

Then, once deployed: open a program, add an extra workout on a rest day and on a day that already has sessions, confirm the week's prescribed totals are unchanged and the extras line appears, then hit Recalculate and confirm the extras survive.

## Housekeeping

`_to_delete/` on the device holds scratch tarballs, superseded scoped tsconfigs, and swept git lock files. It is untracked but *not* gitignored, so stage explicit paths rather than `git add -A`, or delete the folder.

---

## Addendum — live verification (deploy `3ec8741`)

Migration applied and pushed; Vercel deployment `dpl_DZWQHPGBW5epC2FDRsGCFLM5ZRqC` READY in production for SHA `3ec87415fb822b985d53c93b9642bbf9c7fa56ac`.

Verified on the "Post-B fix test" program:

- The "＋ Add a workout" affordance renders on every day in both layouts, including rest days.
- Added a manual entry on the Monday Aug 3 **rest day** — "Pickup basketball", 45 min, 2.4 mi. It rendered as `Pickup basketball · extra · 45 min · 2.4 mi` with a Remove control, and the week header gained `extra · 1 extra workout · 45 min · 2.4 mi — not counted in the totals above`.
- **The engine's prescribed totals did not move**: cardio 300 min, mileage 12.5 mi, strength 180 min, total 480 min — identical before and after. That is the whole point of storing extras outside the blob, and it holds.
- Remove worked; the entry and the header line both disappeared. Test data cleaned up — the program is back to its pre-test state.

### Bug found and fixed: the day didn't update until a manual reload

Saving an extra called `revalidatePath` server-side, which invalidates the cache but does not by itself cause the client to re-render a server component. The athlete saved a workout and watched nothing happen.

Every other mutation in this codebase goes through `usePostAction`, which ends in `router.refresh()`. `extra-workout.tsx` now follows the same protocol: `useRouter()` + `router.refresh()` after a successful add (both paths — manual and synced-activity) and after a delete. `revalidatePath` stays on the server side; the two work together, the refresh re-fetches what the revalidation invalidated.

Re-verified after the fix: `tsc --noEmit` exit 0, `next build` exit 0, `vitest run` 78 files / 760 tests passing.

### Not yet verified

Recalculate-survival. Extras are stored outside `program_data.weeks`, so they should be untouched by a regeneration, but that has not been exercised against the live app — recalculating burns a generation and rewrites the program, so it was left as a deliberate check rather than run unasked. Worth doing once: add an extra, hit Recalculate, confirm it is still there.
