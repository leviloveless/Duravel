# Duravel Handoff — 2026-08-05 6:21pm CT

## STATUS: patch 19 APPLIED to the worktree, md5-verified (2/2), **NOT committed**. Base `fee0867`.

**945/945 vitest · `tsc` clean · `next build` clean.**
`.git/index.lock` absent.

```
_to_delete/session19-0805.patch   the AUTO-post to Strava now uses Levi's title/description format
```

```
cd C:\dev\duravel
git add lib app
git commit -m "strava: the auto-post uses the same title and workout description as the manual button"
git push
```

---

## 1. ✅ Patch 18 verified LIVE — the power day is right

Recalculated `Fall prep` (twice — the first was before Vercel finished building). Week 1 Wednesday:

```
Trap-Bar Jump          2 × 3 @ ~45% 1RM · move fast — end the set the moment bar speed drops
Med-Ball Chest Pass    2 × 3
Push Press             2 × 3
Explosive Barbell Row  3 × 3
Kettlebell High Pull   3 × 3
```

Lower-body explosive work LEADS the session, and it totals **exactly 12 working sets** —
`MAX_POWER_SESSION_SETS`. Compare two states ago: `Barbell Bench Press — 4 sets × 5–6 reps —
~78% 1RM · 3 RIR · Max strength`.

## 2. ✅ Strava write verified against the REAL API (first time)

Levi approved the live write. Clicked "To Strava" on Monday Aug 3's interval run →
`https://www.strava.com/activities/19585858659`:

```
TITLE:  Week 1 - Monday - Interval Run

DESCRIPTION:
Easy Peasy 4x1km to start off the next training block      <- Levi's own text, PRESERVED

Week 1 - Monday - Interval Run
Warm up: 15 min easy (~1.1 mi) @ 13:20/mi with 3-4 short strides
Work: 4 x 1km at 7:40/mi (4:46/km), with 4:45 of easy JOGGING between reps at 13:20/mi (jog, not walk — keep moving so your heart rate stays up)
Cooldown: 10 min easy (~0.8 mi) @ 13:20/mi
Work:rest 1:1 - your rest equals your work time.
```

Exactly the spec, and the athlete's own note survived above the block.

## 3. 🔴 …and Strava itself exposed the gap: I had fixed the WRONG PATH

Levi's activity list showed, from **Wed 8/5**:

```
Run   Wed, 8/5/2026   Duravel Run — Week 1        <- the AUTO-post
Run   Mon, 8/3/2026   Week 1 - Monday - Interval Run   <- the manual button
```

There are **two** Strava write paths and I had only changed one:

| path | trigger | before patch 19 |
|---|---|---|
| `brandStravaActivity` | the "To Strava" button | ✅ Levi's format (patch 17) |
| `strava-autopost.ts` | **logging a workout** — automatic, default ON | ❌ `Duravel Run — Week 1` + a 4-line program blurb |

Levi's words were *"The **autoupload** to duravel should look like this"* — the auto-post is the path
he actually named, and it was the one still writing the old text. Everything appearing on his Strava
without him pressing anything used the old format.

**Patch 19:** `autoPostSessionToStrava` now calls `sessionSummary` — the same function the manual
button uses — and `AutoPostContext` takes `dayKey`, passed from `app/api/logs/route.ts` as
`input.day` (the PLANNED day, so the title reads off the program rather than off when it happened to
get logged). The bespoke `name` builder and its `KIND_LABEL` map are deleted. One source, one format,
both paths.

⚠️ **This only affects NEW logs.** `Duravel Run — Week 1` (Wed 8/5) and any earlier auto-posts keep
their old titles; re-writing them would mean re-posting each from the workout row.

## ▶️ NEXT
1. **Deploy patch 19, then log a workout** and confirm the auto-created Strava activity comes through
   as `Week N - Day - Workout Name`. That is the last unverified path in the feature.
2. `assignDays` caps upstream (open since Aug 4) — the largest remaining engine item.
3. Consider back-filling old auto-posted activity titles, or leave them.

## 🟡 STILL OPEN
- `assignDays` places sessions without consulting the caps.
- `applyPostBRaceRecovery` bluntly rearranges the front of the week.
- Triathlon h30_40 delivery audit.
- iOS parked — no Xcode project, needs a Mac + Apple enrollment, MANIFESTs point at a dead `hyroxai/`.
- Lifecycle email: code ready, needs `EMAIL_ENABLED` + `RESEND_API_KEY` + DNS.
- hyresult: price hyroxresultapi.com / the Apify scraper before building one.

## Live-site / tooling facts
- Host is **`duravel.app`**; `app.duravel.app` returns Vercel `404 DEPLOYMENT_NOT_FOUND`.
- Program: `/program/d81ef85c-aad1-41fb-a85f-131d242cdb40`. `/program` 404s.
- Vercel MCP `list_projects` returns **empty** for `team_N4cfcDYaIJuPYg36yIredN33`. Use the browser.
- **Vercel takes >2.5 min to build.** A recalculate run too soon silently produces the OLD program
  and looks like a failed fix — that happened once today. Wait, then recalculate.
- `Page.captureScreenshot` times out often on the long program page. Retry the screenshot alone, or
  use `find` (its descriptions include element content — that is how "Trap-Bar Jump" was spotted).
- Recalculate is a two-step: `Recalculate` → inline `Replace current sessions?` → `Yes, recalculate`.

## Process notes
- **Verify against the real external system, not just the code.** The deterministic tests, the unit
  tests and the live Duravel page all passed while Strava was still receiving the old format from the
  auto-post path. Only opening Strava showed it.
- **When a feature has two entry points, change both.** Same lesson as the power-day regression:
  grep for every caller before declaring a format "done".
- Never run `prettier --write lib/ components/` — format edited files BY NAME.
- Incremental patches: `/tmp/base14` = HEAD + p13…p18 committed; patch 19 diffs against it.
- `_to_delete/` now also holds `session19-0805.patch`.
