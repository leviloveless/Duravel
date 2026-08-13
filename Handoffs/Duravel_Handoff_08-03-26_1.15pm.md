# Duravel Verification — 08-03-26 1:15pm

Retest of `7bdebf6` on a fresh no-rest-day program ("Recovery accounting test"). No code changed this round.

## The reported session, corrected

    Warm up: 15 min easy (~1.4 mi) @ 10:33/mi with 3-4 short strides
    Work: 4 x 1km at 8:07/mi (5:02/km), with 5:00 of easy JOGGING between reps
          at 10:33/mi (jog, not walk — keep moving so your heart rate stays up)
    Cooldown: 10 min easy (~0.9 mi) @ 10:33/mi
    Work:rest 1:1 - your rest equals your work time.

    Warmup 15m | Work 35m | Cooldown 10m | TOTAL 60m

Work reads 35 minutes (20 of reps + 15 of recovery) against the 20 it used to show, and the session totals 60 rather than 45. Warmup and cooldown carry minutes, distance and pace. Work:rest is unchanged.

## Weekly totals

Week 1 running mileage now reads **19.7 mi** against the 12.5 it showed before — the work target is still 12.5, the rest is warmup, cooldown and recovery jogging that was always being run and never counted. Mileage ramps 19.7 → 24.8 across the block.

## All 16 weeks

- **Session cap**: clean. Longest session in the program is exactly 90 minutes, despite every quality session growing by its recovery.
- **Day cap**: clean. Busiest day 151 against 180.
- **No day carries two filler blocks.**
- **Empty day beside a doubled day**: weeks 3, 6, 9, 12 — all Deload, which is intended.
- **Weekend biggest**: weeks 11 (124 vs 115) and 13 (135 vs 94) miss it; 7, 10 and 16 register only because a race week's weekend total is 0. Same known structural limit — both weekend days already at two sessions, so no filler can be added there without breaching the session cap.

## One consequence worth a decision

Mileage and cardio are now treated differently, and both are defensible, but you should know which you have:

- **Mileage** — the target is a WORK target. Counting overhead RAISED the reported total (12.5 → 19.7) and left the quality volume untouched. That was your explicit choice.
- **Cardio** — the target is a TOTAL-TIME budget, and the reconciler still hits it exactly. So counting recovery did not raise the total; it displaced filler. Week 1 is still 300 minutes, but with less Zone 1–2 cross-training in it, because ~15 minutes of that budget is now correctly attributed to recovery jogging.

Concretely, week 1 went from `wed: lift + cardio` to `wed: lift` — one filler block dropped out.

Whether that is right depends on what 300 means. If it is "the time you should spend training", the new behaviour is a correction: you were previously doing ~320 while being told 300. If it is meant to be quality-and-filler on top of whatever recovery costs, cardio should be treated like mileage and the target raised instead. Currently it is the former.

## Not verified

The HR calibration module is still unwired — no live data path yet, so nothing about it is exercised by this program.
