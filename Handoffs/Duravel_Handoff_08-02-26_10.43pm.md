# Duravel Handoff — 08-02-26 10.43pm

## Scope
Fixed the long-standing `applyPostBRaceRecovery` bug (flagged in the two previous handoffs, then
confirmed live). **Files written to the working tree, uncommitted.** Base verified current
(HEAD `7717e5f`, clean tree) before writing.

## Verification of the previous round (program `f125bbb0-62ef-49a1-9256-bdc42a1b7978`)
Checked weeks 1–13 across base / build / deload / peak / race weeks. **All four original
requirements met:**
- Long run on **Saturday every training week** (1–6, 8, 9, 13).
- **Sunday is the hybrid every week** — no interval the day after the long run.
- Monday (preferred rest day) is rest or a single 60m lift; never the heaviest day.
- Sat + Sun are the two biggest days: wk1 108/102, wk2 124/111, wk4 128/111, wk5 143/121,
  wk8 139/125, wk13 111/**119** — next biggest 45–75m.

Two caveats found:
1. **Deload weeks (3, 6):** Sunday 55m sits ~5m behind the 60m lift days. Saturday still far ahead
   (143 / 118). Cosmetic — the deload trims the cardio surplus so there's less filler to spread.
   Left alone.
2. **Week 8 had `Strength time 0 min`** — an entire Build week with no lifting. Root cause below.

## The bug (now fixed)
`applyPostBRaceRecovery` in `lib/engine/skeleton.ts` overwrites the first three training days of the
week following a B race with rest / easy / easy — and **deleted** whatever was scheduled there.
Levi pins lifts to Tue–Fri, so weeks 8 and 11 (following the B races in weeks 7 and 10) lost every
lift at once → 0 strength minutes.

**Fix:** displaced **lift and hybrid** sessions are re-homed onto the emptiest later day of the same
week (4+ days after the race, so recovery is untouched), respecting the engine's standing rules —
max 2 workouts/day, never two lifts on a day — and re-sorted so the priority workout leads the day.

**Runs are deliberately NOT carried over.** `reconcileWeekVolume` re-sizes whatever runs remain to
hit the week's prescribed mileage exactly, so a dropped run loses no volume; a dropped lift or hybrid
is simply gone. Carrying runs over would double-count the week's mileage.

## Result on Levi's exact config (replayed through skeleton + assemble)
```
wk 7  strength= 60m hybrids=0   (B race week — mini-taper keeps 1 reduced lift, correct)
wk 8  strength=180m hybrids=2   <-- was 0m / 0 hybrids
wk10  strength= 60m hybrids=0   (B race week)
wk11  strength=180m hybrids=2   <-- was 0m / 0 hybrids
wk16  strength=  0m hybrids=0   (A race week — spec cuts lifting entirely, correct)
```

## Verification
- `vitest run lib/engine lib/generation` → **45 files, 498 tests, all pass** (492 + 6 new in
  `lib/engine/post-b-recovery.test.ts`).
- **Exactly one golden snapshot changed, and the delta is `{hybrid: +1}`** — a session that used to
  be deleted is now preserved. Nothing lost, no other fixture touched. (Verified by tallying
  `"kind"` + `"runType"` per snapshot block before accepting the update.)
- Cloud `tsc` with `strict` + `noUncheckedIndexedAccess` → clean.
- Device files **md5-identical** to the tree the 498 tests ran against.

## To finish
```
cd C:\dev\duravel
del ".git\index.lock"
git add -A
git commit -m "engine: post-B-race recovery re-homes displaced lifts/hybrids instead of deleting them"
git push
```
Then regenerate a program and check week 8 shows non-zero Strength time.
Scratch files in `_to_delete\` (f2/f3/fresh/lib-src tgz, tsconfig.*.json) — safe to empty.

## Open items
- Deload-week Sunday ranking (cosmetic, above).
- Nothing else outstanding from the long-run work.
