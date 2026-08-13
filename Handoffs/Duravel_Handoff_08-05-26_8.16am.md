# Duravel Handoff — 2026-08-05 8:16am CT

## STATUS: patch 16 APPLIED to the worktree, md5-verified (7/7), **NOT committed**. Base `c218ac5`.

**940/940 vitest · `tsc` clean · `next build` clean.**
`.git/index.lock` absent.

```
_to_delete/session16-0805.patch   power work moved to the FRONT of the heavy day
```

```
cd C:\dev\duravel
git add lib components
git commit -m "engine: explosive work opens the heavy lift day instead of owning a day it cannot be placed on"
git push
```

⚠️ **Generation-time. Existing programs need a RECALCULATE.**

Patches 13–15 are committed and pushed (`c218ac5`).

---

## 1. 🔴 The standalone power day could not be placed — so it stopped being a day

Levi asked whether the power day should move. It should have, and it could not be fixed by moving it.

**The measurement, across 496 generated power sessions (3 bands × 3 experience × 4 day-counts):**

| | baseline | after relabelling |
|---|---|---|
| stacked with a Zone 4+ session same day | 31% | 31% |
| lands the day after the heavy full lift | 29% | 29% |
| compromised either way | **43%** | **42%** |

I built a full `placePowerOnFreshDays` pass — whole-week scoring, kSubsets search over which lift day
carries the power session, guarded so it could never break Levi's heavy-lift spacing rule — and it
bought **four sessions out of 496.** It was reverted. ~100 lines is not worth 1%.

**Why it can't work:** two heavy days must sit ≥2 calendar days apart, and the long run and hybrid
anchors are pinned. Whatever lift day is left over is the squeezed one *by construction*. Choosing
which day gets the label cannot create a fresh day that doesn't exist.

⚠️ **Recorded because it cost real time:** the FIRST version used greedy pairwise swaps and made
things actively WORSE — 43% → 54% — because relabelling one day to "full" silently created a new
"day after heavy" violation for a *different* power day. Only whole-assignment scoring catches that.
Then a second version, correctly weighted, still only reached 42%. **Sweep before you build, not
after.**

## 2. ✅ What shipped instead — `powerBlock`

Levi chose "front of the heavy day". Explosive work is now the OPENING BLOCK of the week's one heavy
full-body session:

```
mon · full
  POWER  Kettlebell Swing  4 × 3 @57% 1RM · rest 2:45
  POWER  Box Jump          4 × 3 @57% 1RM · rest 2:45
  POWER  Wall Ball         4 × 3 @57% 1RM · rest 2:45
         Front Squat  3 × 4-5
         Romanian Deadlift  3 × 4-5
         … heavy work follows
```

Both failure modes are now **impossible by construction**: it is always the first thing done, always
on a day the athlete arrived fresh for, and it can never follow yesterday's heavy lift because it IS
the heavy day.

Design decisions worth knowing:

- **`powerBlock` is a separate schema field, deliberately NOT part of `movements`.** The weekly
  set-volume passes key off `movements[].pattern`; a power squat and a heavy squat in one array would
  be summed as one pattern and the power sets rewritten to hit a *strength* target — inflating the
  exact thing that has to stay low.
- **The skeleton still plans `[full, power, full]` and must keep doing so.** Those `power` slots are
  what hold the heavy days apart; `separateLiftDays` / `spreadFullLiftTypes` space the week using
  exactly that distinction. I tried collapsing every lift day to `full` and it broke Levi's hard rule
  — two heavy days landed consecutively in the first three weeks. The spacing stays skeleton-side;
  only the CONTENT changed. A planned `power` day now becomes a LIGHT full-body day at assembly.
- **Deduped against the day's own work.** A week landed "Push Press" in BOTH the block and the heavy
  movements — same movement, two different intents. `powerBlockFor` takes an `avoid` set.
- **Block size 3 in base/build, 2 in peak/taper**; empty on deload and race weeks, same rule as the
  plyometrics.
- Rendered in `session-card.tsx` (lime left-border block above the movements, with the velocity cue)
  and in `workout-view.tsx` (prefixed `Power:` lines, listed first).

**Audit over 432 assembled weeks:** 100% of non-recovery weeks carry a block · 0 stray standalone
power sessions · 0 blocks on a non-heavy day · 0 weeks with >2 heavy days · 0 consecutive heavy pairs.

### 🟡 The trade-off Levi should know about
The week goes from *heavy + power + light* to *heavy(+power block) + light + light*. Total per-pattern
volume is unchanged (`applyWeeklySetVolume` still distributes the weekly target), but there is **one
maximal-strength exposure a week instead of one heavy plus one explosive day.** That follows Levi's
own 2026-08-04 rule ("when a week carries more than one full-body lift, the LATER one runs light"),
but it is a real shift in intensity distribution and worth eyeballing on a generated program.

## 3. ⬜ Live verification — NOT DONE, blocked

Levi chose "live-verify on Vercel" as the next step. It could not be completed:
- `list_projects` for team `team_N4cfcDYaIJuPYg36yIredN33` returned **empty** — the Duravel project
  isn't visible to the Vercel MCP connection.
- `switch_browser` timed out: no connected Chrome responded within 2 minutes. Two browsers are
  registered (Browser 1 and Browser 2, both Windows) but neither answered.

**This is the top item for the next session.** Everything verified so far has come from deterministic
audits with NO AI in the loop. What still needs eyes on a real generated program:
1. the power block renders correctly and reads well;
2. equipment substitutions (patch 13) behave for a dumbbell-only and a bodyweight-only athlete;
3. starting volume responds to `currentDaysPerWeek` (patch 13);
4. the light/heavy day mix looks right after §2's change.

## 🟡 STILL OPEN
- **`assignDays` places sessions without consulting the caps.** Correct today by downstream cleanup,
  not by construction. This is also the only place a fresh day for explosive work could ever come
  from, if §1 is ever revisited.
- `applyPostBRaceRecovery` still bluntly rearranges the front of the week.
- Triathlon h30_40 delivery audit (tri-only now).
- iOS — parked; blocked on a Mac + Apple Developer enrollment, and the MANIFESTs point at a
  `hyroxai/` directory that no longer exists.
- Lifecycle email — code ready; needs `EMAIL_ENABLED`, `RESEND_API_KEY` and DNS from Levi.
- hyresult — consider licensing hyroxresultapi.com or the Apify scraper instead of building one.

## Process notes
- ⚠️ **Never run `prettier --write lib/ components/`.** It reflowed **130+ files** I had not touched.
  The patch was rebuilt by copying ONLY the seven intended files into the incremental base, which
  excludes the noise automatically. Format the files you edited, by name, nothing else.
- **Incremental patches need a real base.** `/tmp/base14` = HEAD + p13 + p14 + p15, each committed;
  patch 16 is `git diff` against that. Diffing the working tree against `HEAD` would fold earlier
  patches in and conflict on the device.
- md5-compare both sides after every apply. 7/7 this session.
- `_to_delete/` now also holds `session16-0805.patch`.
