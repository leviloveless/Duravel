# Duravel Handoff — 2026-08-06 8:23am CT

## STATUS: patch 21 APPLIED to the worktree, md5-verified (2/2), **NOT committed**. Base `102cb3f`.

**956/956 vitest (950 + 6 new) · `tsc` clean · `next build` clean.**

```
_to_delete/session21-autopost.patch   strava auto-post posts the WHOLE session + the missing test
```

```
cd C:\dev\duravel
git add lib
git commit -m "strava: the auto-post reports the whole session, not just its main set"
git push
```

No oracle move, no snapshot churn — the diff is one file plus one new test file.

---

## 0. Patch 20 was already committed + pushed

`102cb3f` — *"engine: no pass ever puts a third session on a day"* — is on `main`, and
`origin/main` matches. The memory index still said "UNCOMMITTED" at session start; that was stale
and has been corrected.

## 1. ✅ VERIFIED LIVE: the Strava auto-post title

The last untested path in the Strava feature, carried over from patches 19 and 20. **Done.**

Logged week 1 / Thursday (threshold run, Done · RPE 5) on duravel.app. The auto-post fired and
created Strava activity **`19626903555`**:

```
Week 1 - Thursday - Threshold Run
Warm up: 12 min easy (~0.9 mi) @ 13:20/mi
Work: 1 x 1 mile at 8:00/mi (4:58/km)
Cooldown: 8 min easy (~0.6 mi) @ 13:20/mi
```

Title AND description are exactly the manual-button format. `fd4b58b` is confirmed end to end.
The contrast is visible in the activity list — the Wed 8/5 auto-post directly above it still reads
`Duravel Run — Week 1`, the old format.

**The Strava feature now has no unverified path.**

## 2. 🔴 Found by the verification: the auto-post under-reported the workout

That same activity posted as **`1.00 mi / 8:00`**. The session is **2.5 mi / 28 min** — and the
description the SAME call wrote says so (12 + 8 + 8 = 28; 0.9 + 1.0 + 0.6 = 2.5). The activity
contradicted its own text on the page.

`strava-autopost.ts` read the raw fields:

```ts
function plannedDurationMin(s)   { return s.durationMin }     //   8 — WORK only
function plannedDistanceMiles(s) { return s.distanceMiles }   // 1.0 — WORK only
```

On a run those two are the **main set**. Warmup and cooldown live in `RUN_WARMUP_COOLDOWN` /
`overheadMiles`, and the totals are `sessionTiming(s).total` / `sessionMiles(s)` — the same figures
the program table and the result card already display. Same class as the quality-run rep bug
("title says 1.8mi but the workout is 3.8"): work distance shipped where total distance belonged.

**Lifts were worse.** A lift carries no `durationMin` at all, so it fell through to a hardcoded
`?? 45` when `sessionTiming` says a strength session is a fixed **60**. Every auto-posted lift has
been 15 minutes short.

### The fix

- `plannedDurationMin` / `plannedDistanceMiles` now delegate to `sessionTiming` / `sessionMiles`.
- Extracted **`buildAutoPostActivity(ctx, startLocalIso)`** — pure, returns the exact
  `ManualActivityInput`. `autoPostSessionToStrava` keeps the gating + token half. This is what made
  the payload assertable at all; the repo uses no `vi.mock` anywhere, so the seam had to become
  pure rather than mocked.
- Athlete actuals still win over the plan (unchanged).

### The test that was missing

`lib/wearables/strava-autopost.test.ts` — 6 cases. **Nothing covered `strava-autopost.ts` before
this**, which is exactly why both the 08-05 title bug and this one reached production. The fixture
IS Levi's week-1 Thursday session, so it asserts against numbers actually observed on Strava.

Verified as a real guard: reverting only the two helper bodies fails **2 of 6** —
`expected 480 to be 1680` (8 min vs 28) and `expected 2700 to be 3600` (45 min vs 60).

## 3. 🟡 Found on the way, NOT fixed: the activity is stamped 5 hours late

`createManualActivity` is called with `startLocalIso: new Date().toISOString()` — a **UTC** string
in a field Strava documents as **local**. Logged at 8:12am CDT, the activity landed on Strava at
**1:12 PM**. Every auto-posted activity has this offset.

It cannot be fixed properly from the server: **Duravel stores no per-user timezone.**
`supabase/migrations/0019` already flags the same gap for the calendar-day rate limit ("no per-user
timezone is stored yet"). Options, all Levi's call:

1. Add `profiles.timezone`, captured from the browser at onboarding — fixes this AND lets the
   adaptation limit reset at the athlete's local midnight instead of 00:00 UTC.
2. Send the browser's local ISO string in the log POST and pass it through.
3. Leave it — activities are stamped by post time either way, and a manual activity has no GPS
   track to disagree with.

## ▶️ NEXT
1. Commit + push patch 21.
2. Decide §3 (timezone) and §4 of the 08-05 handoff (clamp legacy day counts, or leave frozen).
3. `applyPostBRaceRecovery` bluntly rearranges the front of the week.

## 🟡 STILL OPEN
- Per-user timezone (§3) — blocks both the Strava start time and local-midnight adapt resets.
- Legacy day-count clamp + the legacy band back-fill — both need Levi.
- `applyPostBRaceRecovery` ignores day preferences when it rearranges.
- Triathlon h30_40 delivery audit.
- iOS parked — no Xcode project, needs a Mac + Apple enrollment, MANIFESTs point at a dead `hyroxai/`.
- Lifecycle email: code ready, needs `EMAIL_ENABLED` + `RESEND_API_KEY` + DNS.
- `BILLING_ENABLED` still uses the old strict env parser — move it onto `envFlag()`.
- hyresult: price hyroxresultapi.com / the Apify scraper before building one.

## Process notes
- **Verifying a feature live is how you find the bug next to it.** The title check passed on the
  first try; the 1.00 mi sitting beside a description that said 2.5 is what was actually worth the
  session. A code-only review would have confirmed the title and never looked at the numbers.
- **Read the result back through the app's own sync when you can't log in to the provider.** Strava
  wasn't signed in in Chrome; `Sync now` re-imported the just-created activity and Duravel's
  Activity page showed `Thu, Aug 6 · 8 min · 1.00 mi` — enough to spot the bug before Levi signed
  in. Note Duravel does NOT store the provider's activity name, so the title itself still needed
  Strava.
- **The repo has no `vi.mock` anywhere.** To test a seam that does network + Supabase, extract the
  pure payload builder rather than introducing mocking to the codebase.
- Prove a new regression test by reverting ONLY the fix and watching the specific cases fail.
- Cloud clone `git clone https://github.com/leviloveless/Duravel.git` + `npm install` ≈ 2 min.
- `git status` on the mounted device repo times out (>45s); `git rev-parse HEAD` / `origin/main` is
  the fast way to check whether work is pushed.
- Never run `prettier --write lib/` — format edited files BY NAME.
- `git apply` on the device is still the only git command safe from the cloud; the
  `unable to unlink … Operation not permitted` warning is harmless — md5 both files after.
