# Duravel Handoff — 08-03-26 10:00am

Retest of the experience-tiered caps on `5412837`, plus one fix.

## Retest — "Session cap test"

Athlete profile is HYROX with beginner running experience, so the caps are 90 min per session and 180 min per day.

Across all 16 weeks:

- **Day cap: clean.** Busiest day in the whole program was 145 minutes against a 180 limit. As predicted, the day cap never binds at two workouts a day.
- **Session cap: one violation.** Week 13, Saturday, a Zone 1–2 block at 98 minutes.

## The violation was mine

`splitCardio` bounds every block it creates at the session cap, so blocks are born legal. But `keepPreferredDaysBiggest` — the pass that keeps Sat/Sun the biggest days — GROWS a weekend block by moving minutes into it, and had no cap check at all. It happily pushed a block past the athlete's per-session limit while chasing a rule that ranks below it.

Three guards added:

- The sink is now chosen only from weekend blocks with room left (`durationMin < sessionCap`).
- The amount moved is clamped to that room.
- The "hand the whole block over" path refuses if the merged block would breach the cap.

`sessionCap` is threaded into the function rather than read from a constant.

## Tests

`lib/generation/reconcile.test.ts` gains a rebalancer-cap block: three different week shapes chosen to force the weekend block to grow, asserting no session exceeds the cap in any of them, plus one confirming the exact cardio total still holds.

Verified meaningful by reverting all three guards — the shape sweep fails, and passes again with them restored.

`vitest run` 796 tests passing. `tsc --noEmit` exit 0. `next build` exit 0. No snapshot movement.

## Standing note

This is the third bug found in `keepPreferredDaysBiggest` (wrong-day splice, uncapped growth, and before that the phase-ordering it was written to express). It mutates prescribed sessions to satisfy a soft ordering rule, which makes it the riskiest function in the reconciler. Worth treating any future change there as high-scrutiny, and worth considering whether weekend-biggest is better expressed as a placement preference than as a post-hoc mutation.

## Next

Regenerate and confirm no session exceeds 90 minutes anywhere.
