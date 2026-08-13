# Duravel Handoff — 2026-08-06 11:13am CT

## STATUS: patch 24 APPLIED to the worktree, md5-verified (8/8), **NOT committed**. Base `627464a`.

**998/998 vitest · `tsc` clean · `next build` clean. No snapshot moved.**

```
_to_delete/session24-hybrid-warmup.patch
```

```
cd C:\dev\duravel
git add lib components
git commit -m "hyrox: the hybrid warm-up is a prescribed jog, and its miles count toward the week"
git push
```

No migration for patch 24.

### 🔴 BLOCKER CARRIED OVER: migration 0040 is NOT applied

`supabase/migrations/0040_self_posted_activities.sql` still needs running in the Supabase SQL
editor. Verified live at 11:10am: the program page still reads **"Synced workouts ready to link (4)"**
and Duravel's own auto-posts still show a **Link** button instead of "Posted by Duravel".

The code is behaving *correctly* — `getUserActivities` selects `self_posted` defensively, gets a
missing-column error, and falls back to the narrow select, so the site is exactly as it was
pre-patch rather than broken. **Patch 23 cannot be verified until 0040 runs**, and its backfill is
what clears the auto-posts already sitting in that list.

---

## 1. 🏃 Patch 24 — the HYROX warm-up (all three of your answers implemented)

Your choices: **counts against the target** · **10 min jog + 5 min cooldown** · **jog only**.

`sessionTiming` has always budgeted 10 min before and 5 min after a hybrid — that is where the
55–75 min total came from. Nobody was ever told to RUN them and the distance counted toward nothing.

- `HYBRID_WARMUP` / `HYBRID_COOLDOWN` (10 / 5) are now named constants, and `sessionTiming` derives
  its hybrid numbers from them, so the prescription, the session length and the mileage cannot drift.
- `hybridOverheadMiles(easyPaceMinPerMile)` mirrors `runOverheadMiles` exactly — **including
  rounding each leg separately**, so the two figures printed add up to the number counted. There is
  a test for precisely that.
- `hybridWarmupLine` / `hybridCooldownLine` reuse `overheadLine`, the same builder the quality runs
  use, so a hybrid warm-up reads identically to a threshold run's:
  `Warm up: 10 min easy (~0.9 mi) @ 10:33/mi`.
- `stampHybridOverhead` writes `overheadMiles` + `warmup` + `cooldown` in reconcile.
- `sessionMiles` counts a hybrid's overhead. `week-card.tsx` shows the two lines around the station
  list; `prescriptionLines` puts them either side of the elements, so **Strava gets them free**.

### ⚠️ The one non-obvious decision, and the measurement behind it

Feeding the overhead into the run BUDGET (`RM`) vs. letting only the convergence loop absorb it
looks like a wash. It is not — measured over **540 non-race weeks** (4 bands × 3 experience × 3 day
counts × 16 weeks) against a pristine `main` clone:

| | weeks off target | worst miss | total sessions |
|---|---|---|---|
| `main` (no warm-up counted) | 90 | +4.5 mi | 5465 |
| overhead in convergence ONLY | **141** | **+5.9 mi** | 5516 |
| **overhead in the run budget (shipped)** | **90** | **+4.1 mi** | 5483 |

Letting the budget see it keeps mileage honesty exactly where `main` had it — the worst miss even
improves — and adds 18 sessions instead of 51. Runs shrink to make room, as intended.

**Note the pre-existing finding in that table: 90 of 540 weeks (17%) already miss their stated
mileage target, all of them OVER, worst +4.5 mi.** That is not new and patch 24 does not worsen it,
but it is real and nobody has looked at it. Worth a session on its own.

### One test fixture changed — read the reasoning before assuming it was fudged

`reconcile.test.ts` "never removes or alters a planned lift, run or hybrid" ran at a 12.5-mile
target with a 6-mile long run AND a hybrid that is now ~6.4 miles on its feet. There is genuinely no
room for the interval and threshold runs, so `sizeRuns` **correctly** consolidates one away — that is
the documented consolidation path, which has its own coverage. The target is now 14, which restores
the test's actual intent (leave a week alone when there IS room). The assertion itself is unchanged.

New `lib/generation/hybrid-warmup.test.ts` — 8 cases, **7 fail on `main`**.

## 2. 📷 Strava images — the answer is NO, at Strava's end

**Strava's public API does not permit attaching a photo to an activity.** Media upload is restricted
to official partners (Zwift/Rouvy tier); third-party apps can write text only. The suggested
workaround everywhere is an image URL in the description, and Strava renders descriptions as plain
text, so it would show as a bare link. Options are: apply for partner access, or don't.

**But the app already generates the image the athlete can attach themselves — this was Levi's
follow-up question and the answer is yes, it ships today.** `result-card-studio.tsx` rasterizes the
card at full export size (1080×1920 story / 1080×1080 square) via `html2canvas` and offers:

- **⬇ Download PNG** — `canvas.toDataURL("image/png")`.
- **↗ Share** — `canvas.toBlob()` → `File` → `navigator.share({files})`, so on a phone it is
  Share → Strava and the athlete attaches it to the post. Falls back to Download automatically.

Reachable from the **Share** link on every session row and the **Result card** button in the program
header. The card is seeded from `sessionSummary().cardData` — the same call that builds the Strava
title and description — so image and post already agree.

**The gap is discovery, not capability:** nothing points the athlete at the card at the moment they'd
want it (right after logging). Levi was offered a nudge on the log confirmation / in the auto-post
description and had not answered when this handoff was written.

⚠️ Server-side card generation is NOT possible today: `autoPostSessionToStrava` runs in a Node route
with no DOM, and `html2canvas` needs `document` + layout. It would take `satori`/`@vercel/og` plus a
rewrite of `result-card.tsx` into a satori-compatible subset (no `<style>` blocks, no CSS variables,
no `radial-gradient` — all of which it currently uses).

## ▶️ NEXT
1. **Apply migration 0040**, then reload the program page and confirm the banner drops from (4) and
   `/activity` shows "Posted by Duravel" on Duravel's own posts.
2. Commit + push patch 24.
3. Decide the result-card nudge (§2).
4. Auto-post idempotency — every re-log still POSTs a NEW Strava activity (3 exist for one workout).
5. The 90-weeks-over-target finding (§1) — pre-existing, unexamined.
6. Triathlon h30_40 delivery audit (~490 min short at peak).

## 🟡 STILL OPEN
- Migration 0040 unapplied; patch 23 unverified.
- Auto-post idempotency.
- 17% of weeks land over their stated mileage target (pre-existing, worst +4.5 mi).
- The legacy BAND back-fill — still needs Levi.
- 120 two-lift days on the bandless legacy path, by the patch-22 scope decision.
- iOS parked; its unapplied `notification_prefs.sql` declares a rival `timezone` column.
- Lifecycle email: needs `EMAIL_ENABLED` + `RESEND_API_KEY` + DNS.
- `BILLING_ENABLED` still on the old strict env parser.
- hyresult: price hyroxresultapi.com / the Apify scraper first.

## Process notes
- **A vanished UI element is not automatically your bug.** The link banner disappeared right after
  the patch-23 deploy, which looked like a perfect confirmation — it was a transient hydration
  artifact (React error #418 in the console; a reload brought it back with all 4 entries). Reload and
  read the console BEFORE claiming either success or a regression. The real state was the opposite of
  what it looked like: nothing was filtered because the migration had not been run.
- **When two variants look identical on one input, sweep before choosing.** The run-budget vs
  convergence-loop question showed zero difference on a single 16-week program and a 51-week
  difference in mileage accuracy across 540.
- **Prettier churn caught a third time** (two re-wrapped `reconcileWeekVolume` calls, one re-wrapped
  function signature). `git diff | grep "^-"` before packaging is now non-negotiable.
- Levi commits mid-session; `git fetch && git reset --mixed origin/main` before packaging every time.
- The device bridge dropped mid-session and the `mcp__remote-devices__*` tools vanished entirely.
  Work already written to disk survived; only the `MEMORY.md` index write was lost, and it was
  delivered as a file instead.
