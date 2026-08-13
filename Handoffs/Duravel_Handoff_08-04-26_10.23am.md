# Duravel Handoff — 2026-08-04 10:23am ET (Zone 1–2 cardio, part 2)

## STATUS

- **`5681bf3` (45-min Z1–2 floor) — PUSHED by Levi. `origin/main` == `5681bf3`.** Deploying.
- **Follow-up change (drop sub-15-min remainders) — VERIFIED, IN THE WORKTREE, NOT COMMITTED.**
  A stale `.git\index.lock` blocks committing over the cloud bridge (bridge can't delete files).
  **Levi: two commands, below.**

## 🚨 DO THIS FIRST (Windows, native shell in `C:\dev\duravel`)

```
del .git\index.lock
git commit -m "engine: drop sub-15-min cardio remainders instead of shipping a token block" -- lib/generation/reconcile.ts lib/generation/reconcile.test.ts
git push origin main
```

The two files in the worktree are byte-identical to the cloud-tested versions
(`reconcile.ts` md5 `52ebf90308c72c0deee8b07fe369e9b2`,
`reconcile.test.ts` md5 `a3e2a3eae32617235f01992674aef668`).
Patch also saved at `_to_delete\cardio-drop.patch` (md5 `9cfcb9b3181165a8ac2e78ece82f22f1`)
if you'd rather re-apply it cleanly.

Also in `_to_delete\`: `index.lock.bak`, `next-index-9.lock.bak`, `cardio45.patch` — junk, delete
with the folder.

## What the follow-up changes

Levi approved the open question from the 10:11am handoff. New constant
`MIN_MEANINGFUL_CARDIO = 15` in `lib/generation/reconcile.ts`: **a cardio gap under 15 minutes is
not filled at all.** When a week's runs already cover almost all the prescribed cardio, the
leftover used to be emitted as its own block — a 9-minute "session" on the calendar — purely to
keep the weekly total exact. The total is now allowed to land those few minutes short. **Every
gap at or above 15 minutes is still hit exactly**, so nothing else moves.

Audit, 480 deterministic weeks: **token blocks (<15 min) 16 → 0**; weeks landing under target
193 → 209, each by <15 min. **838/838 vitest, tsc clean, prettier clean.**

## Combined effect of both commits (vs `32f1d99`)

| metric | before | after |
|---|---|---|
| sub-45 **standalone** Z1–2 blocks | **162** | **0** |
| token blocks (<15 min) | 16 | **0** |
| aerobic days / week | 4.76 | 4.69 |
| lift days paired with cardio | 91% | 89% |

Rule as shipped: **Z1–2 blocks ≥45 min standalone; ≥30 only when sharing a day with a run or
hybrid (brick); a lift day is NOT paired; surplus splits for frequency (90 → 45+45); leftovers
under 15 min are dropped.**

## Retest after the deploy (both commits)

Generation-time — **existing programs need a Recalculate.** On the Test program, weeks that had
30-minute Tue/Wed/Fri Z1–2 blocks should come back as 45+ blocks (fewer of them), Saturday's
block next to the long run unchanged.

## Latent finding — NOT touched, worth a look later

The audit surfaced something bigger and **pre-existing**: across those 480 deterministic weeks,
**193 weeks (40%) already landed UNDER their prescribed `targetCardioMinutes` on `main` before
any of this — the worst by 626 minutes.** The reconciler's docstring claims the cardio total is
exact; in cramped weeks (few training days, 2-session/day cap, session caps) it simply cannot
place the prescribed minutes and silently comes up short. Same shapes also produce a handful of
over-cap blocks (150–490 min) via the "pile the overflow onto the last block" fallback. Neither
is caused by this session's change (both directions improved slightly). Worth deciding whether
the engine should size `targetCardioMinutes` to what the athlete's days can actually hold.

## Roadmap

`Duravel_Roadmap_Planned_vs_Actuals.html` — the "HYROX credible full" row note now lists the
session-quality rules (day placement 08-02, lift separation + mileage + manual paces 08-03/04,
45-min Z1–2 floor 08-04). Written to the repo file, **uncommitted**; the desktop artifact
`duravel-roadmap-planned-vs-actuals` was not re-pushed.
