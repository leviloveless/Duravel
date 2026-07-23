# Engine ↔ Research — Batch 6 handoff (final gap-analysis item)

Add DEKA `bandZone3Z` (research 3-zone budget) + `bandLiftCounts` (strength dose
by weekly-hours band) so the DEKA run formats get the same time-budget behavior
HYROX already has: budget-scaled VO2/threshold anchors, band zone targets, the
session cap, the research lift split, and the compromised long run — all gated on
`input.weeklyHours && cfg.bandZone3Z`, so DEKA golden programs are untouched.

## What changed
`lib/engine/sports/deka.ts` — added `bandZone3Z` + `bandLiftCounts` to the three
RUN-based formats only:
- **FIT** (~1 h functional race): HYROX-like shape — 55/25/20 → 88/3/9 easy/gray/hard.
- **MILE** (~1600 m, glycolytic): hard pool ~5 pts higher — 50/25/25 → 83/4/13.
- **ULTRA** (25 km, multi-hour): aerobic-dominant, hard pool ~4 pts lower — 62/22/16 → 90/3/7.
- `bandLiftCounts` identical across the three ([1,1] → [3,4]); the strength dose
  is by training-hours, event-agnostic.

Station-only **STRONG** and **ATLAS** are deliberately left as-is: they're
strength-endurance events that barely run, so the research aerobic-budget /
runner-strength-dose framework doesn't apply. They keep `phaseZoneTargets` and
their fixed lift counts.

All 15 zone rows (3 formats × 5 bands) sum to 100 (checked in-script + a test).

## Tests
- `lib/engine/sports/deka.test.ts` — new "DEKA research band tables" block:
  zone sums = 100, lift ranges valid, STRONG/ATLAS have no band tables, event
  intensity ordering (MILE > FIT > ULTRA hard), hard% falls as budget rises.
- `lib/engine/time-budget-skeleton.test.ts` — added `DEKA FIT @ <band>` snapshots
  across all 5 bands (proves the whole band pipeline runs for DEKA end-to-end).

## Verify (comment-free — Windows CMD safe)
    npm run build
    npm test -- -u
    git add -A
    git commit -m "engine-research batch 6: DEKA band tables (FIT/MILE/ULTRA)"

Expect: golden green; new DEKA FIT band snapshots auto-created by `-u`; new DEKA
band-table tests pass. `lib/admin.test.ts` still fails on missing env —
pre-existing, unrelated.

## Gap-analysis change list — COMPLETE
1. Map research 3-zone → engine 5-zone, budget-scaled (Batch 1). ✓
2. VO2 + threshold guaranteed weekly anchors (Batch 1). ✓
3. Research strength dose: heavy/power by band + experience, ≤2 heavy (Batch 2). ✓
4. No two lifts/day; pair leg lifts with easy cardio (Batch 3). ✓
5. Reconcile session count to hours budget — ~5–6 anchors (Batch 4). ✓
6. Long compromised run as a named session (Batch 5). ✓  [+ skeleton-schema power bugfix]
7. DEKA band tables (Batch 6). ✓

## Remaining (optional / deferred)
- Build Levi's "perfect program" reference case. Needs the profile: event/format,
  weekly-hours band, running/hybrid/lifting experience, training days + day
  preferences, age, benchmarks (5k/10k, 5RM squat/DL/bench, 2k row), race date.
- Optional polish: teach the AI LIFT_GUIDANCE about the dedicated power session.
