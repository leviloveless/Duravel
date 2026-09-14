# Duravel Handoff — 09-13-26, 6.12pm ET

## Apply

`duravel_round2_0913.patch` (repo root). **Applies on top of the work you already
applied** — do not re-apply the earlier patches.

```
cd C:\dev\duravel
git apply --check duravel_round2_0913.patch && git apply duravel_round2_0913.patch
npm run test          # expect 153 files / 1831 tests (+10 of your own = 1841)
npm run build
```

**No migration this round.** 0046 is still the only one, and you have run it.

Then commit — the staging list in `Handoffs\COMMIT_HELPER.md` still applies, plus
these new paths. Easiest: `git add` the 26 paths this patch touched, or review
`git status` and stage everything except your own four files
(`.env.example`, `lib/engine/stations.ts`, `lib/engine/hybrid-run-floor.test.ts`,
`Tasks/`).

## What's new

**`/diagnostic` — find your limiter.** A questionnaire plus a nine-test battery
that works out which of the seven trainable qualities is costing you the most
time. The verdict is a **library goal**, so it hands straight off to `/library`
filtered by it, and the engine already knows how to periodize it.

The design principle: *the signal is never a raw number, it is a ratio between
two.* A 21-minute 5 k says little on its own — next to a 3:35 kilometre it says
the engine is the problem, next to a 4:10 kilometre it says the top end is. Same
for squat against body weight, jump against height, and a compromised kilometre
against a fresh one. A test with no partner produces no evidence, deliberately.

⚠️ **One design flaw my own tests caught.** Capping each questionnaire answer at
0.5 was not enough: four answers pointing the same way sum to 2.0 and outvoted
any single measurement. An athlete who believed their problem was strength kept
being told it was strength while a 12% heart-rate drift said otherwise — the
exact failure a diagnostic exists to prevent. Questions are now damped once any
real measurement exists.

**`/calendar` — the surface Duravel didn't have.** Month grid with a weekly
summary rail (planned vs completed hours, run miles, program week number).
Straight from your TrainingPeaks screenshot, but rows are Mondays because the
engine's weeks are — otherwise the rail would be meaningless. Shows every ready
program at once, so a HYROX block and a tune-up plan appear together.

**Fitness / Fatigue / Form on the dashboard.** Two EWMAs of daily load (42-day
and 7-day) and their difference — the PMC shape you know.

⚠️ **The units are Duravel's own and the page says so.** TrainingPeaks runs on
TSS, which needs a threshold power or pace; a sled push has neither, and
inventing a TSS for one would be a number with a familiar name and no meaning.
Daily load here is minutes × an intensity weight from the session's goal zone —
the same session-RPE family `lib/engine/load.ts` already uses. A Duravel Fitness
of 60 is **not** a CTL of 60. What transfers is the shape.

**The setup wizard now exists in practice.** That was my miss: `setup_completed_at`
was written and read by nothing, and `/setup` was reachable only from a soft link
at the bottom of `/start`. Signup and OAuth now land on `/setup`, which ends by
sending you to `/start`; the dashboard nudges until the flag is set, naming what
is actually missing rather than nagging in general.

**The two dashboard cards** that were cut for lack of a migration — turns out
they never needed one. `adaptations` and `wearable_activities` have both been
written for months.

**Smaller:** `ProfileRow` now declares the 0046 columns instead of being worked
around with a type guard at each call site; the footer lost its space after
"LLC." a *second* time at a different JSX boundary and is now one template
literal, verified against the rendered DOM rather than by eye.

## Verification

1831 tests in **UTC, America/New_York and Australia/Sydney**. Typecheck clean,
lint clean on everything touched, build clean, and I walked `/diagnostic`
end-to-end in a real browser — answered all eight questions, entered all nine
test results, and confirmed the verdict and its reasoning render.

## Deliberately NOT done — these want your decision

**A second migration (0047).** Three things want schema and I did not want to
hand you a migration you had not seen while you were away:

- **`events`** — user-scoped races, independent of a program. `races` exists but
  is program-scoped, so a race you have not built a block for cannot be recorded.
  Suggested: `id, user_id, name, date, priority (A/B/C), sport, goal_time, notes`.
- **`goals`** — "sub-1:12 at Dallas", "back squat 160". Suggested:
  `id, user_id, title, metric, target, current, due_date, achieved_at`.
- **`profiles.limiter_profile jsonb`** — persisting a diagnostic result so the
  dashboard can show "your limiter: aerobic base" and the engine can weight a
  block toward it. **This is the one with real leverage** — right now the
  diagnostic is a tool you run, not something the product remembers.

**The ATP / season-plan view** from your third screenshot. A year of months with
races, priorities and phases. It is the right idea and it is a big one: it needs
`events` first, and it overlaps with what the engine already decides about
mesocycles. Worth a conversation before anyone builds it.

## Ideas worth stealing next, ranked

1. **Persist the diagnostic and let the engine read it.** A limiter the program
   actually biases toward is a genuine differentiator — TrainingPeaks tells you
   your numbers, it does not change your plan.
2. **A season plan (ATP)** once `events` exists.
3. **Per-session planned-vs-actual on the calendar**, the way the week table
   already does it.
4. **A weekly email** carrying the three curves and one sentence about form.
   `lib/email` is built and gated off; this is the highest-value thing to
   un-gate.
5. **Re-test reminders.** The battery is only useful repeated — a nudge at eight
   weeks to re-run the 5 k and the decoupling run, and a chart of both over time.

## Still open from before

- Enable the **Google provider in Supabase** or the button errors.
- **Sign in with Apple** stays dark until Developer Program enrolment clears.
- Read **`/refunds`** — California's ARL.
- `support@duravel.app` unconfirmed, now on three pages.
- Point **`duravel.app/ios`** somewhere real — the QR encodes it for real.
