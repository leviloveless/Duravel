# Duravel handoff — 09-09-26, 9:21am

## What shipped this session (committed on the device, NOT pushed)

    d1799f0  empty _to_delete
    6da7cb1  hours win: a capped-out week lands short and says so
    ---- origin/main ----
    3746fa4  custom tier: design your own training week, and the engine periodizes it
    3bcd47b  volume grows by sessions, not by session length

`3bcd47b` and `3746fa4` are pushed and live-deployable. The two above them are
not. **Push needs you** — the sandbox has no GitHub credentials.

## `6da7cb1` — hours win

Your rule, which settled the tension the volume work had left open:

> "Hours should win; the extra miles going onto easy runs means that if a long
> run and other quality run workouts are already capped, extra miles should go
> to the easy runs; but do not exceed the time cap."

What that changed:

- **The last-resort overrun branch is gone.** It was the only path in the whole
  reconciler that knowingly shipped a session over its time cap. It existed
  because landing short felt worse than landing long; you say it's the other way
  round.
- **It needed no replacement.** The `recPerMi` accounting fix from `3bcd47b` had
  already made the true-up's arithmetic match what `setRunMiles` actually
  writes, so the cases that used to fall through now find a legal home.
- **Both hand-backs are bounded.** They wrote `donor.distanceMiles` directly —
  the same bypass that once shipped a "4 x 1km" text against a stored 2.2 mi.
  They go through `growUnderLong` now.

### The whole-rep snap caught us a third time

Step 3 of the true-up checked `total(r) + drift <= limit` *before* writing, and
the snap overshot the long run anyway. A rep-based run lands on a whole rep, not
where it was asked to, so **any bound checked before the write is a number the
write will not produce**. `growUnderLong` writes, measures, and reverts if it
overshot. Worth expecting a fourth time.

### Numbers

| tree | weeks where a quality run out-measures the long run |
|---|---|
| `3faa55c` (before any of this) | 89% |
| `4e25a9b` (the other session alone) | 29% |
| `3bcd47b` (mine alone) | 0.5% |
| `36138db` (both merged) | 2% |
| **`6da7cb1`** | **0 of 900 (0%)** |

Longest long run still 90 min. 3.71 runs a week.

### One test changed, and it's the interesting part

The sweep had a **flat** mileage tolerance — land within 0.65 mi of target or
fail. A flat tolerance cannot tell a week that genuinely ran out of hours from a
week that leaked the same number of miles. It passes both.

It's conditional now. Within one rep's granularity the week owes no explanation.
Past that it has to show its work: the long run must be **on** the session cap,
and every other run either shoulder-to-shoulder with it or on a cap of its own.
Exactly one case in the sweep takes that branch — a 6-run, 55-mile week where
every run sits at 80–90 minutes. That is what "hours win" looks like.

Gate: 1,445 tests, `tsc --noEmit`, `next build`. `npx eslint` is broken in the
cloud clone (a config-schema crash inside `@eslint/eslintrc`, unrelated to this
change) so lint did not run.

## `d1799f0` — `_to_delete` emptied

That folder existed only because the file bridge couldn't delete. It can now, so
I asked once, you approved, and the folder is gone rather than merely emptied —
101 files, about half of them **tracked**, because a `git add -A` at the repo
root picks it up like any other folder. Stale patches, git lock files a crashed
write left behind, scratch tsconfigs, a few tarballs. Nothing referenced by the
build, the tests or the app; the two old handoffs in there are still in
`Handoffs/` history.

## What's on you

1. **Push** `6da7cb1` + `d1799f0`.
2. **Apply migration 0045** (`subscriptions.tier`) — the custom tier can't work
   without it.
3. **Create the $39.99 Stripe price** → `STRIPE_PRICE_CUSTOM_MONTHLY`.
4. **Settle the annual price**: `pricing-plans.tsx` says $119.99,
   `docs/plans/stripe-payments-plan.md` says $159.99.
5. After the deploy, live-verify: a lift day's title and the four-station power
   day, a synced session's planned-vs-actual, a long run against its week's
   interval run, and the new cross-training line on a short run.

## Still open in the engine

- In week 1 of a HYROX program the **hybrid** can out-measure the long run. The
  ordering rule covers quality *runs* only.
- Below ~18 mi/week a threshold session's 2-rep floor is ~25% of the week
  however the 20% share is set — the floor governs, not the share.
- `sessionLoadMinutes` still uses a flat 45 for hybrids, and that one feeds ACWR.
