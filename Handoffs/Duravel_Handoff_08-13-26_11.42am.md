# Duravel Handoff — 2026-08-13, 11:42am CT

## What this session did

1. Verified the previous session's three commits **live** on duravel.app.
2. Closed the open intensity-distribution question with an engine change.
3. Fixed the stale `hyroxai/` path in `CLAUDE.md`.

Base `fd916a8`. The engine change is **applied to the worktree, md5-verified 5/5, NOT committed.**

## 1. Live verification of `fd916a8` — all three changes confirmed

- **Sync all sources:** `Imported 9 workouts (Strava 9, Oura 0).` Both providers pulled — Oura's leg had never had a caller outside Settings. Link banner **(2) → (7)** with no manual reload. Console clean, survived a reload.
- **liftType:** `Fall prep` contained its own control group — weeks 1–2 were `Full/Power/Lower` (the bug) while weeks 4–5 were `Full/Power/Full @ 12–15 reps` (correct, including the light day the buggy weeks lost). After regenerating: **zero "Lower body lift" in 16 weeks.**
- **Hybrids:** all 8 stations in race order behind full 1000 m runs, Pro loads correct (202/153 kg sleds, 2×32 kg carry, 30 kg bag, 9 kg ball), phase ramp confirmed base→build (wall balls 30 → 45, skierg 300 → 425 m), timing now `10/53/5 = 68 min` base and `10/56/5 = 71` build instead of a flat 55.

Test subject for the regeneration was `ZZ DELETE ME - warmup test`. **`Fall prep` was deliberately NOT regenerated.**

## 2. THE INTENSITY FIX — a hybrid is the week's threshold session

### Finding

Breaking the 39.1% down by source across 192 weeks (5 bands × 3 experience levels):

```
hard (threshold or harder)   39.1% of weekly mileage
  - inside hybrids            20.8%
  - separate quality runs     18.3%
long                          22.0%
easy                           8.2%   ← the actual problem
weeks over 30% hard        166/192
weeks with a hybrid           168, of which 109 ALSO carried a quality run
```

Easy running at **8.2%** is the number that matters. Because hybrid mileage counts against the week's target, a week doing both a hybrid and a threshold run pays for the duplicate stimulus out of its easy volume — the only thing left to shrink.

### Rule

**A hybrid credits the THRESHOLD anchor, and only that.** The interval survives, because VO2 work is a stimulus steady race-pace running does not provide at any volume. Substituting like for like, not cutting quality wholesale.

Every changed week reads:

```
[long, threshold, interval]  →  [long, interval, easy]
```

Two parts, both in `lib/engine/slots.ts`:

1. `buildRunSlots` gains a `hybridCount` parameter; when the week has a hybrid it stops seeding the `threshold` anchor.
2. The filler pool switches to `"aerobic"` emphasis in that case — **without this the fix does nothing visible**, because the build/peak filler pool offers `tempo`/`interval` and would simply reintroduce the session that was just credited. There is a test for exactly this.

An **explicit** `threshold` bias from the needs analysis still wins — preferences beat defaults, per the standing repo rule.

### Result

| | before | after |
|---|---|---|
| hard share of mileage | 39.1% | **31.1%** |
| — quality runs | 18.3% | 10.3% |
| — hybrid | 20.8% | 20.8% |
| long | 22.0% | 22.2% |
| **easy** | **8.2%** | **19.6%** |
| weeks over 30% hard | 166/192 | 116/192 |

**The mileage target was deliberately NOT raised.** The substitution alone more than doubled easy volume without changing total load; raising the target would push weeks against the band hour ceiling for no additional gain. The residual 31% is roughly two-thirds hybrid — that share is Levi's full-runs design choice, and it cannot go lower without changing the hybrid itself.

### Scope control

Gated on `guaranteeQuality`, i.e. athletes on an explicit weekly-hours band — the same gate the seeded anchors already use. **Legacy no-band programs, including every golden-HYROX fixture, are byte-identical.** There is a test that sweeps all four phases × three run counts to prove the credit never fires on the legacy path.

## 3. Files

| file | state |
|---|---|
| `lib/engine/slots.ts` | modified — the rule |
| `lib/engine/time-budget-skeleton.test.ts` | modified — baseline-move rationale in the header |
| `lib/engine/__snapshots__/time-budget-skeleton.test.ts.snap` | modified — 8 snapshots updated |
| `CLAUDE.md` | modified — `hyroxai/` path + `app.duravel.app` 404 note |
| `lib/engine/hybrid-covers-threshold.test.ts` | **NEW** — 8 tests |

Patch: `_to_delete/session28-hybrid-covers-threshold.patch` (already applied).

## 4. Verification

- `npx vitest run` → **1052/1052**, 102 files (was 1044; +8)
- `npx tsc --noEmit` → clean
- `npx next build` → **Compiled successfully**
- `prettier --check` on every touched file, compared against a pristine `main` clone first — clean; only the brand-new test file was `--write`-formatted
- `git diff | grep "^-"` → 6 removed lines, every one intentional. **No prettier churn.**
- **Golden-HYROX oracle: unchanged.** The band-snapshot test moved deliberately — HYROX and DEKA move, **triathlon does not**, which is the tell the change landed where it was aimed (only station-hybrid sports have hybrids). Session counts and day placement are identical; only run TYPES moved.
- New test file against a pristine `main` clone: **2 of 8 fail** (the two encoding new behaviour), 6 pass (the invariants that must not break).

## 5. To commit

```
npm test
git add lib CLAUDE.md
git commit -m "engine: a hybrid is the week's threshold session"
git push
```

⚠️ **Check `git status --short` first.** On 08-12 an earlier `git add` left files staged and a later unrelated `git commit` swept a whole feature into a commit named "handoffs". Nothing is staged right now.

Then recalculate **Fall prep** — it will pick up all four changes at once (full/power/full, race-structure hybrids, restored easy volume, honest hybrid timing).

## 6. Notes

- **The device bridge dropped mid-session and came back.** Files written before the drop survived. When it is down, deliver via SendUserFile; when it returns, re-verify md5s before assuming anything applied. A patch delivered as an attachment does **not** apply itself — the 08-13 commit attempt found nothing staged because the patch had never been run.
- All four modified files are **LF** on disk and md5-matched `git show HEAD:` exactly, so the patch applied cleanly. (`lib/generation/stations-assemble.test.ts` remains the known CRLF exception.)
- **Vercel MCP is 403 on this project** — verify deploys through the live site.
- `Duravel_Roadmap_Planned_vs_Actuals.html` still has uncommitted pre-08-12 edits and was not updated.

## Still open

- 3 duplicate Strava activities to delete by hand (no API can).
- The 17%-of-weeks-over-target finding — still unexamined.
- Triathlon `h30_40` peak weeks land ~490 min short — Levi's choice.
- `app.duravel.app` 404s; the iOS Capacitor shell targets it. Open blocker.
- Lifecycle email system built + committed since 07-17 but `EMAIL_ENABLED` has never been set — it has sent nothing. Biggest built-but-dormant asset in the repo.
- Backlog #17: hyresult.com scraping (legal/ToS call), push notifications (infra), equipment + training-frequency fields (safe to build).
