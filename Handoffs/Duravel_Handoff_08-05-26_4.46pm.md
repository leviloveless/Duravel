# Duravel Handoff — 2026-08-05 4:46pm CT

## STATUS: patch 18 APPLIED to the worktree, md5-verified (3/3), **NOT committed**. Base `b0e2497`.

**945/945 vitest · `tsc` clean · `next build` clean.**
`.git/index.lock` absent.

```
_to_delete/session18-0805.patch   power days always train lower body, and are never empty
```

```
cd C:\dev\duravel
git add lib
git commit -m "engine: a power day always trains lower body and is never empty"
git push
```

⚠️ **Generation-time. `Fall prep` needs ANOTHER recalculate after this deploys.**

---

## 1. ✅ Patches 13–17 verified LIVE on Levi's own program

Levi recalculated `Fall prep`. Read week 1 end to end in the browser. All three shipped items work:

- **Lift-day priority holds.** Tue = heavy strength (Back Squat / Bench / Pull-Up / Deadlift / OHP /
  Row at 3×5–6 ~78% · Max strength), Wed = power, Fri = light (12–15 reps ~58%). Exactly
  `strength / power / light`.
- **The power day is a real power day.** `Med-Ball Chest Pass — 3 sets × 3 reps — ~45% 1RM · move
  fast — end the set the moment bar speed drops`, rest 2:45. 12 working sets. Compare the
  pre-recalculate version: `Barbell Bench Press — 4 sets × 5–6 reps — ~78% 1RM · 3 RIR · Max
  strength`.
- **"Weekly check-in" tab is live** with the cadence copy and the "only fill these in if you are not
  logging Daily HR/HRV" note.

## 2. 🔴 …and the live read immediately found a regression I had shipped

Levi's Wednesday came back **Med-Ball Chest Pass / Kettlebell High Pull / Push Press / Explosive
Barbell Row** — four UPPER patterns. No jump, no swing, nothing below the waist. For a HYROX athlete
that is the wrong half of the body: sled push, wall balls and burpee broad jumps are all lower-body
triple extension.

A deterministic sweep confirmed it was systematic and that **I caused it in patch 15**, when
`acceptsPattern("power", …)` stopped being a wildcard:

| | before (patch 13) | after patch 15 | after patch 18 |
|---|---|---|---|
| power sessions with movements | 224 | **160** | 432 |
| no squat AND no hinge | 0% | **10%** | **0%** |

Two failures, one cause. Patterns the power day now refuses (chest fly) were part of what used to
fill it, so some sessions came out **empty** and others came out upper-only.

**Fix — `ensurePowerSessionPatterns` (strength.ts), called from `applyStrengthSchemes` right after
the pattern filter:**
- guarantees at least one of `squat` / `hip_hinge`, added at the FRONT (lower-body power wants the
  freshest nervous system);
- alternates squat/hinge by week so consecutive weeks differ;
- seeds a default four-pattern block if filtering left the session empty;
- no-op when the session already trains lower body, and on any non-power session.

432/432 power sessions now carry lower-body work; none empty. Six new tests in
`power-session.test.ts`, including the exact all-upper session Levi's program produced.

⚠️ **`Fall prep` still shows the upper-only Wednesday** — it was recalculated BEFORE this patch.
Recalculate again once it deploys.

## 3. Live-site facts worth keeping
- Host is **`duravel.app`**. `app.duravel.app` returns Vercel `404 DEPLOYMENT_NOT_FOUND`.
- Program pages are `/program/<uuid>`; `/program` 404s. Levi's: `d81ef85c-aad1-41fb-a85f-131d242cdb40`.
- Vercel MCP `list_projects` returns **empty** for team `team_N4cfcDYaIJuPYg36yIredN33` — it cannot
  see this project. Use the browser.
- `Page.captureScreenshot` intermittently times out on this page (it is very long). Retrying the
  screenshot alone works; `get_page_text` is the reliable fallback but truncates at 50k.

## ▶️ NEXT
1. **Deploy patch 18, recalculate `Fall prep` again, re-read Wednesday** — confirm a jump or swing
   leads the power day.
2. **Test "To Strava" on a linked activity** — the title (`Week 1 - Monday - Interval Run`) has been
   verified deterministically and against the live run text, but never against the Strava API.
   Monday Aug 3's interval run is linked and Done, so it is the natural candidate.
3. `assignDays` caps upstream (open since Aug 4).

## 🟡 STILL OPEN
- `assignDays` places sessions without consulting the caps.
- `applyPostBRaceRecovery` bluntly rearranges the front of the week.
- Triathlon h30_40 delivery audit.
- iOS parked — no Xcode project, needs a Mac + Apple enrollment, MANIFESTs point at a dead `hyroxai/`.
- Lifecycle email: code ready, needs `EMAIL_ENABLED` + `RESEND_API_KEY` + DNS.
- hyresult: price hyroxresultapi.com / the Apify scraper before building one.

## Process notes
- **Read the live app.** Two sessions running, and both times the live program overturned something
  I had reasoned my way into — patch 16's structure, then patch 15's pattern filter. The
  deterministic audits are fast and correct but they do not run the AI, and the AI is where the
  all-upper power day came from.
- **When restricting what a session accepts, check what used to fill it.** The empty-power-session
  regression and the upper-only regression were the same edit.
- ⚠️ Never run `prettier --write lib/ components/` — format edited files BY NAME.
- Incremental patches: `/tmp/base14` = HEAD + p13…p17 committed; patch 18 diffs against it.
- md5-compare both sides after every apply. 3/3 this time.
- `_to_delete/` now also holds `session18-0805.patch`.
