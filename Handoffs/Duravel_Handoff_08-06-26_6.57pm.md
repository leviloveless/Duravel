# Duravel Handoff — 2026-08-06 6:57pm ET

## STATUS: patch 25 PUSHED (`853d19a`) + VERIFIED LIVE. Patch 26 APPLIED, md5-verified 4/4, **NOT committed**.

**1014/1014 vitest · `tsc` clean · `next build` clean.**

```
_to_delete/session26-selfposted-ingest.patch
```

```
cd C:\dev\duravel
git add lib supabase
git commit -m "strava: an activity Duravel posted is claimed on import, not only when we create it"
git push
```

**Then run migration `0042_self_posted_backfill_rerun.sql`** — it clears the two rows showing in
the link banner right now.

> ⚠️ As with patch 25: the two NEW files were written whole via `device_commit_files`, not patched
> (the bridge cannot unlink). `lib/wearables/self-posted.ts` · `supabase/migrations/0042_….sql` are
> already on disk and md5-matched. `git add lib supabase` picks them up.

---

## 1. ✅ Patch 25 verified live — two saves, ONE activity

Logged week-1 Monday Zone 1–2 cardio **Done / RPE 5**, then re-saved it as **RPE 7**.

- `/activity` gained **exactly one** new row: `Workout · Thu, Aug 6 · 45 min · Posted by Duravel`.
  Under the old code that would have been two. `sport_type` is `Workout`, which is correct for
  `cardio` in `KIND_TO_SPORT`.
- The **result-card nudge fired**: *"Nice work — share it?"* with the Result card button, bottom of
  screen, dismissible, self-clearing.
- Migration 0041 applied cleanly; no console errors; the page renders normally.

**⚠️ NOT verified from here: the `— Duravel · duravel.app` footer.** Duravel stores no provider
activity NAME (only type/duration/distance/HR), so the footer cannot be read back through the app.
It is heavily unit-tested, but someone has to look at that Workout activity on Strava and confirm
the footer is present exactly ONCE. **Still outstanding — ask Levi.**

## 2. 🔴 THE LIVE CHECK FOUND THE NEXT BUG — a backfill is point-in-time

Right after `Sync now`, the link banner went **(2) → (4)**:

```
Synced workouts ready to link (4)
  Run · Thu, Aug 6 · 2.55 mi · 30 min
  Matches your Zone 1–2 cardio on Thursday · Week 1.   [Confirm match]
  Run · Thu, Aug 6 · 2.55 mi · 30 min      ← the same, twice
```

Both are **Duravel's own posts** — the threshold-run re-logs from this morning. Why they slipped:

- They were created BEFORE patch 23 shipped `markSelfPosted`, so they were never claimed at source.
- They were imported into `wearable_activities` only when `Sync now` ran, which was **AFTER** 0040's
  backfill. A backfill is a one-time `UPDATE`; it can only flag rows that exist when it runs.

Result: the exact plan-as-its-own-evidence loop 0040 was written to close, reopened by timing alone.

### The fix (Levi chose both halves)

- **`lib/wearables/self-posted.ts` — `looksSelfPosted(provider, raw)`**, a PURE predicate mirroring
  0040's SQL exactly: `manual === true` **AND** the name matches `^Week \d+ - ` or `^Duravel `.
  Strava only — a name-shaped heuristic on Oura or Apple Health could only produce false positives,
  since there is no endpoint we post to there.
- **Wired into `ingestActivities`** as step 1b, so a pre-patch-23 post imported at ANY future point
  is claimed on arrival. This is the durable half.
- **Migration 0042** repeats the idempotent `UPDATE` to clear what has already landed.

⚠️ **The SQL predicate and the TS predicate must stay in step.** If they drift, the backfill and the
ingest path disagree about which activities are Duravel's — which is how this bug existed at all.
There is a test pinning the edge cases (`Week1 -` without the space, lowercase `week`, bare
`Duravel`) precisely to catch drift.

⚠️ **Deliberately a separate `UPDATE`, not a column on the upsert row.** The upsert must NEVER carry
`self_posted`, or `ON CONFLICT DO UPDATE` would reset an already-claimed activity to `false` on every
re-sync. Step 1b only ever sets `true`.

The known, accepted risk is unchanged from 0040: an athlete's own MANUAL Strava entry that they
happen to title `Week 3 - …` would be flagged and stop being linkable. Both conditions must hold, so
a device-recorded activity is never affected.

## 3. 🧪 Tests

`lib/wearables/self-posted.test.ts` grows from 5 to 11 cases. Be honest about the guard: on a
pristine `main` clone the file fails to load at all (`Cannot find module './self-posted'`) — it fails
by ABSENCE of the new module, not because main computes a different answer.

## ▶️ NEXT
1. Commit + push patch 26, run migration 0042, reload the program page and confirm the banner drops
   back to **(2)**.
2. **Look at the new Workout activity on Strava** and confirm the `— Duravel · duravel.app` footer is
   there exactly once. This is the last unverified piece of patch 25.
3. Delete the three duplicate Run activities by hand on Strava (no API can do it).
4. **The 90-weeks-over-target finding** — Levi picked this as the next real piece of work. 90 of 540
   audited non-race weeks land OVER their stated mileage, worst +4.5 mi. Pre-existing, unexamined.
   Not started.
5. Triathlon h30_40 audit — needs Levi's call.
6. Fix `CLAUDE.md`'s stale `hyroxai/` path; decide what to do about `app.duravel.app`.

## 🟡 STILL OPEN
- Patch 26 uncommitted; migration 0042 unapplied.
- The patch-25 footer unverified on Strava.
- Three orphan duplicate activities on Strava.
- `app.duravel.app` resolves to no deployment — blocks the iOS shell as specced.
- 17% of weeks land over their stated mileage target.
- The legacy BAND back-fill — still needs Levi.
- 120 two-lift days on the bandless legacy path.
- iOS parked; its unapplied `notification_prefs.sql` declares a rival `timezone` column.
- Lifecycle email: needs `EMAIL_ENABLED` + `RESEND_API_KEY` + DNS.
- `BILLING_ENABLED` still on the old strict env parser.
- hyresult: price hyroxresultapi.com / the Apify scraper first.

## Process notes
- **"Verify it live" found the next bug for the FOURTH time in two days.** Patch 21 came out of
  verifying patch 19; patch 23 out of verifying patch 22; the `app.duravel.app` 404 out of verifying
  patch 23; and now patch 26 out of verifying patch 25. Budget a real slot for verification — it is
  not a two-minute confirmation step, it is where the bugs are.
- **A ONE-TIME BACKFILL IS NOT A FIX, it is a cleanup.** Anything that arrives after it runs is
  unprotected. When writing a migration that backfills, ask immediately: *what claims the rows that
  show up tomorrow?* If the answer is "nothing", the durable half belongs in code.
- **Prettier churn caught a FIFTH time.** It wanted to re-wrap a pre-existing `slug:` line in
  `activity-ingest.ts`. `main` already fails `prettier --check` on that file, so the warning was NOT
  mine — I restored the file from a backup and confirmed `git diff | grep "^-"` produced ZERO removed
  lines. **Check the file against the pristine `main` clone before believing prettier is complaining
  about your edit.**
- `git reset --mixed origin/main` after Levi's push cleanly rebased the dirty cloud worktree onto
  `853d19a` with the working tree intact — the documented recipe worked exactly as written.
