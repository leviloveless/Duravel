# Duravel Handoff — 2026-08-06 10:30am CT

## STATUS: patch 23 APPLIED to the worktree, md5-verified (7/7), **NOT committed**. Base `1219d4a`.

**990/990 vitest · `tsc` clean · `next build` clean. No snapshot moved.**

```
_to_delete/session23-selfposted.patch
```

### ⚠️ APPLY THE MIGRATION FIRST

`supabase/migrations/0040_self_posted_activities.sql` — run it in the Supabase SQL editor **before**
the deploy finishes. It also carries a **backfill** that retro-marks the auto-posts already sitting
in the link-suggestion list.

```
cd C:\dev\duravel
git add lib app supabase
git commit -m "strava: an activity Duravel posted is never a link candidate for the session that produced it"
git push
```

---

## 0. ✅ Patch 22 verified LIVE — both fixes work

Migration 0039 applied, `1219d4a` pushed and deployed. Three Strava activities for the same Thursday
threshold run tell the whole story:

| activity | Strava stamp | numbers | what it shows |
|---|---|---|---|
| `19626903555` — logged 8:12am, 08-05 code | **1:12 PM** | 8:00 / 1.00 mi | both bugs, before |
| `19628136284` — Levi's re-log ~9:54am | **2:54 PM** | 30:00 / 2.55 mi | patch 21 live; timezone still UTC |
| `19628388163` — logged 10:15am | **10:15 AM** | 30:00 / 2.55 mi | **both fixes live** |

**The middle row is the valuable one.** Levi's re-log ran the new code and still came out UTC —
because `profiles.timezone` was NULL: nothing had yet loaded a page carrying `<TimezoneSync>`, so it
took the UTC fallback exactly as designed. The next page load fired the backfill, and the very next
log came out local. The fallback AND the backfill both confirmed, which one test alone could not have
shown.

(Levi has 3 duplicate Strava activities from testing — safe to delete any of them.)

## 1. 🔴 Found while testing: Duravel offered its OWN post as the session's evidence

The program page showed:

```
Synced workouts ready to link (4)
  Run · Thu, Aug 6 · 1.00 mi · 8 min
  Matches your Threshold run on Thursday · Week 1.   [Confirm match]
```

That "Run" is the activity **Duravel wrote to Strava** when the threshold run was logged. Sync
imported it back; `suggest-data.ts` filtered candidates on nothing but *unlinked + same calendar
day*, so it matched Duravel's own post to the very session that produced it.

**Why it matters.** Confirm that match and the session's **actuals become the planned numbers**.
Adherence, readiness and the weekly adaptation would then read a perfectly-executed week regardless
of what the athlete actually did — the plan becomes its own evidence. Worse, the suggestion still
carried the pre-patch-21 `1.00 mi`, so it would have written an actual that was not just circular
but wrong.

Nothing in the schema could tell the two apart: `wearable_activities` stores no name and no manual
flag, and `activityToRow` never captured one.

### The fix

- **Migration 0040** adds `wearable_activities.self_posted boolean not null default false`, plus a
  partial index and a **backfill**. `raw` already holds the entire Strava payload, so the existing
  auto-posts are identifiable after the fact: `raw->>'manual'` is true (Duravel always uses the
  manual endpoint; a watch recording never is) AND the name matches Duravel's two title formats
  (`^Week [0-9]+ - ` or `Duravel %`). The name condition is what spares an athlete's own manual
  Strava entries, which stay linkable.
- **`markSelfPosted(userId, provider, externalId)`** in `activity-ingest.ts` writes a stub row the
  moment the activity exists on Strava — before any sync can import it. ⚠️ `self_posted` is
  deliberately NOT in `activityToCanonicalRow`, so the later sync upsert's `ON CONFLICT DO UPDATE`
  never clobbers it.
- **`isLinkCandidate(a)`** in `suggest-data.ts` — pure, exported, used by BOTH the same-day
  suggestions and the hand-link list. A self-posted activity is never either.
- The **Activity page** still lists it (it IS on Strava — hiding it would be dishonest) but renders
  "Posted by Duravel" where the Link control would be.

`lib/wearables/self-posted.test.ts` — 5 cases, all fail on `main`. One pins that a MISSING flag reads
as linkable, so a deploy landing before 0040 behaves exactly as today rather than hiding every
activity from the link UI.

**Deploy-order safety:** `getUserActivities` selects `self_posted` defensively and retries without it
on error — otherwise a deploy ahead of the migration would 400 and blank the whole Activity page.
Same pattern as the `profiles.timezone` read in 0039.

## 2. 🟡 Found, NOT fixed — every re-log creates a NEW Strava activity

Three activities now exist for one workout. `createManualActivity` has no idempotency: each
`POST /api/logs` with status `completed` posts again. The manual "To Strava" button doesn't have this
problem — it finds its own previous title line and rewrites in place (`replaceWorkoutBlock`).

Fix would be: store the created activity id against the log row (program/week/day/sessionIndex) and
`PUT` that activity instead of `POST`ing a new one when the same session is re-logged. Deliberately
left out of patch 23 to keep it to one concern. **Levi's call whether it's worth doing** — it only
bites athletes who edit a log after the fact.

## ▶️ NEXT
1. Apply 0040, commit + push patch 23. Then reload the program page and confirm the
   "Synced workouts ready to link" banner no longer offers Duravel's own posts.
2. Decide §2 (auto-post idempotency).
3. Triathlon h30_40 delivery audit (~490 min short at peak) — still the next planned engine item.

## 🟡 STILL OPEN
- Auto-post idempotency (§2).
- The legacy BAND back-fill (distinct from the 08-06 day clamp) — still needs Levi.
- 120 two-lift days remain on the bandless legacy path, by the patch-22 scope decision.
- iOS parked — its unapplied `notification_prefs.sql` declares a rival `timezone`; it should read
  `profiles.timezone`.
- Lifecycle email: code ready, needs `EMAIL_ENABLED` + `RESEND_API_KEY` + DNS.
- `BILLING_ENABLED` still uses the old strict env parser — move it onto `envFlag()`.
- hyresult: price hyroxresultapi.com / the Apify scraper before building one.

## Process notes
- **Verifying a fix live found the next bug again — twice running.** Patch 21 came out of verifying
  patch 19's title; patch 23 came out of verifying patch 22's timestamp. The pattern is that the
  verification puts you on the screen where the *neighbouring* feature is visibly wrong. Budget for
  it: a live check is not a 2-minute confirmation step.
- **`raw jsonb` is a free retroactive column.** Every Strava activity already stores its full
  payload, so `self_posted` could be backfilled for activities imported months ago without any
  re-sync. Check `raw` before concluding that historical data can't be classified.
- **Prettier churn again, in 2 of 6 files** (a collapsed multi-line import, a re-wrapped `??`
  expression). The `git diff | grep "^-"` check caught both. Do it on every patch.
- **Re-check `origin/main` before packaging when Levi has been working.** The first packaging attempt
  produced a 23-file patch because HEAD still predated his patch-22 commit; `git reset --mixed
  origin/main` cut it to the 7 files that were actually new.
- `git status` on the mounted repo still times out (>45 s); `git rev-parse HEAD` is the fast check.
