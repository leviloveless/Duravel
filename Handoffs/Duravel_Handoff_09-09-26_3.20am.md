# Duravel handoff — 2026-09-09, 3.20am

## What landed

Two commits, on top of the other session's `7eb1025` + `4e25a9b`:

- **`3bcd47b` — volume grows by sessions, not by session length**
- **`3746fa4` — custom tier: design your own training week ($39.99/mo)**

`HEAD` = `3746fa4`. **TWO commits ahead of `origin/main` = `4e25a9b`. PUSH PENDING.**

(The loose ref `.git/refs/remotes/origin/main` reads `4e25a9b`, so `7eb1025` and
`4e25a9b` ARE already pushed — memory's "origin/main = 3faa55c" was stale. Ignore
`.git/packed-refs`, which still carries an ancient `c3cb90a`.)

1,445 tests pass, `tsc` clean, `next build` clean — verified in the cloud clone on
a tree proven byte-identical to the device (`git rev-parse HEAD^{tree}` matches
`c5315fb33ca9782bf72d6a8e52a7445dec30e8de` on both sides). `npx vitest` cannot run
on the device under Linux bash — `node_modules` is a Windows install.

## The headline finding

The long-run inversion was an **accounting bug, not a sizing bug**. A run entry
was modelled as `work + overheadMi`, which for a rep-based run silently omits the
recovery jogging between reps. An interval session the model thought was 3.03 mi
was really 3.3. Every floor and ceiling meant to keep the long run on top was
correct and measuring the wrong number.

    a quality run out-measures the long run   89% -> 0.5% of weeks
    worst ratio                               2.95x -> 1.06x

This is the WORK vs TOTAL shape for the **ninth** time. Recovery miles are a third
currency alongside work and overhead.

## ⚠️ The one thing that needs your decision

Two instructions given on consecutive days now pull against each other, and both
are in the tree:

- **09-08, to me:** a week that cannot hold its miles reports what it delivers.
- **09-09, to the other session:** "when there are leftover miles to place, add
  them onto the easy runs" — the miles must be placed, and `anchorLongRun`'s last
  resort accepts an overrun rather than losing them.

Measured like-for-like on one audit:

| tree | weeks where a run beats the long run | worst |
|---|---|---|
| `3faa55c` (before either) | 89% | 2.95x |
| `4e25a9b` (the other session alone) | 29% | 4.06x |
| my work alone | **0.5%** | **1.06x** |
| **both — what is committed** | 2% | 1.74x |

`anchorLongRun` owns the whole 0.5% -> 2% move (proved by env-guarding it and
re-running). **But it is load-bearing** — it holds the long run near its ceiling,
and without it only 5 of 15 weeks reach >=85 min. **Do not just delete it.**

**Your call: is a long run pinned near 90 min most weeks worth 17 weeks in 818
where another run passes it?**

## Blocking the custom tier from being sellable

1. **Apply migration `0045_subscription_tier.sql`** (adds `subscriptions.tier`).
2. **Create the $39.99/mo price in Stripe** and set `STRIPE_PRICE_CUSTOM_MONTHLY`.

Until both are done the tier is code-complete and unbuyable. Nothing else breaks
without them — `tierFromPriceId` fails closed, so every existing subscriber stays
exactly where they are.

## Also worth knowing

- The annual price disagrees with itself: **$119.99** in `pricing-plans.tsx` vs
  **$159.99** in `docs/plans/stripe-payments-plan.md`. Settle it before a third
  number goes live.
- In week 1 of a HYROX program the **hybrid** (6.0 mi) can still out-measure the
  long run (5.3). The ordering rule covers quality RUNS only — a different rule if
  you want it.
- Fixed a latent bug the tier would have exposed: `saveCoachSession` and
  `updateProgramData` left the stored skeleton behind, so `adapt-week` planned
  against sessions no longer on the calendar.
- Fixed two bare `donor.distanceMiles = ...` writes in `anchorLongRun` that
  bypassed the rep snapping — they shipped a "4 x 1km" text against a stored
  2.2 mi once the budget tightened.
- `C:\dev\duravel\_to_delete\` holds `merge.patch` and `upstream.diff` — safe to
  empty (the bridge cannot delete files).

## Next

0. **Push `3bcd47b` + `3746fa4`**, then live-verify: a lift day's title + the
   four-station power day, a synced session's planned-vs-actual, a long run
   against its week's interval, and the new cross-training line on a short run.
0b. Migration 0045 + the Stripe price.
0c. The `anchorLongRun` decision above.

Full detail in project memory: `duravel-volume-by-sessions-and-custom-tier`.
