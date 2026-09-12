# Duravel Handoff — 09-11-26, 11.41am

## What shipped

**`d2b9137` — the custom builder reaches triathlon, and onboarding.**
Built on `66493cc`. **NOT PUSHED — Levi must run `git push origin main`.**

Gate: **1,692 tests** (106 new), `tsc` clean, `next build` clean, no new lint
(the 2 errors + 1 warning are pre-existing on `main`).

---

## 1. The hole this closed

A triathlete could author a week in the designer, save it, be billed $39.99 for
the custom tier, and have the engine **ignore every word of it**.

`buildSkeleton` short-circuits to `buildTriathlonSkeleton` before `weekDays` is
ever called, so `assignDaysFromTemplate` — the entire authored-week mechanism —
was unreachable from every triathlon program. Nothing errored. 1,591 tests
passed. **Fifth appearance of "an engine decision silently discarded by the
wiring."**

## 2. How triathlon authoring works now

`triTemplateDays` (`lib/engine/ironman/index.ts`) is the triathlon sibling of
`assignDaysFromTemplate`. It could not reuse the station path because the two
engines budget in different currencies — station weeks in MILES (reconciled
after), triathlon weeks in MINUTES (stamped before the skeleton leaves).

**The founding rule needed no bending.** The athlete says which disciplines and
which days; `fitTriSlotsToTarget` — the same fitter the generated path uses —
still owns every minute. Race weeks and post-A-race weeks never reach the
template.

**Levi's decision: the athlete owns the DISCIPLINE MIX, not just placement.**
Two swims where the engine wanted four is two swims, and the validator says what
it thinks. The *balance* (swim/bike/run share) stays the engine's — that is a
property of the race — while the *counts* are the athlete's.

⚠️ **Every authored slot carries its phase ceiling.** `slotCeiling` falls back to
the athlete's `caps` when a slot is missing from the map, so an authored week
without ceilings would have silently lost the long-ride / long-run / long-swim
caps — the `d4c51e6` bug from the other direction.

## 3. Onboarding

A fifth step, **"Your week"**, tier-gated via `hasTier("custom")`. Non-tier
athletes see the step with a one-line offer and a Skip (as approved). The
template rides to the server in a hidden JSON field.

⚠️ **Adding the fifth step made `validateStep(3)` reachable for the first time.**
The benchmark checks lived in `validateBenchmarks` with a docblock explaining
they could never run there, because Benchmarks was last. They now run from both
places. *A check whose reachability depends on a step being LAST stops running
the day someone adds a step* — the `race-dates.ts` lesson again.

## 4. Bugs found on the way

**(a) A sparse authored week stops progressing.** Six sessions cannot hold 17 h,
so every session pins at its cap; base and build came out identical and nothing
said why. New `week_cannot_carry_hours` warning.

**(b) That warning's first version said "8-minute ceiling".** It read
`bandSessionCap` as a per-session MINUTE cap; it is a per-week SESSION COUNT
(5–8). The message told a triathlete their week topped out at 0.9 h against 20 h.
**Every test around it passed — it read as nonsense only because the sentence was
printed and looked at.** Now takes `maxSessionMinutes` from the caller, and the
prose is asserted in the units a human checks.

**(c) The long-session multiplier stacked on top of an authored size.** Same
statement made twice: a 45-vs-180 ask shipped at 3.7×. Contract now pinned — *the
engine may deliver less spread than asked, never more.*

**(d) LIVE BUG: a recalculate silently deleted the athlete's authored week.**
`updateProgramInputs` rebuilds the whole `input_snapshot` from the form, so
editing any input at all — a race date, a benchmark — dropped `weekTemplate` and
rebuilt the program generically. `weekTemplateChanges` is worse: the form will
never carry it, and it is the history that keeps already-generated weeks reading
the way they were run. Both are carried now.

## 5. Also

- **The triathlon weekend is exempt from `back_to_back_hard_days`** — a brick
  Saturday into a long run Sunday is what every plan does, and the preset was
  raising the warning against itself. Narrow: two hard runs still warn, and a
  HYROX athlete's identical week still warns.
- **New triathlon preset** (`suggestTriTemplate`) — a separate layout, not a
  modifier. 91 tests hold it to the running presets' bar.
- **Swim** added to the designer; choices are now sport-filtered (no sled for a
  triathlete, no swim for a HYROX athlete).

---

## What Levi needs to do

1. **`git push origin main`** — the sandbox has no GitHub credentials.
2. **Create the $39.99 Stripe price → `STRIPE_PRICE_CUSTOM_MONTHLY`.** None of
   this is buyable until that exists.
3. **Fix the live Terms/Privacy placeholders** — duravel.app/terms still says
   *"governed by the laws of [your state/country]"*, names the entity as
   "Duravel" rather than **Duravel LLC**, and describes the product as HYROX-only.

## Still open

- **NOTHING FROM 09-09 ONWARD HAS BEEN VERIFIED LIVE.** Eleven commits now.
- Onboarding's designer context has no `peakMileage` and no `runPaceMin` (no
  program to build a skeleton from; benchmarks still being typed). Both optional,
  both degrade to silence — the size boxes take miles only there.
- Swim caps (Olympic 75 / 70.3 90 / 140.6 120) still the least-measured numbers.
- ~8.9% of weeks still have a hybrid out-measuring the long run, all of it at
  `hybridRunPlan`'s 12 mi/week cliff.
