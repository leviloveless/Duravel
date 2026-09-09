# Custom program tier ($39.99/mo) — build plan

_Levi, 2026-09-08. Written after mapping the existing billing and generation seams; every path below is a real file._

## Status: not started. This is the plan, not a record.

## What Levi asked for

> "A fully customizable program at $39.99/mo. The user designs a basic training week and the engine builds and periodizes a full-length program from it. They can add a new workout mid-program that gets incorporated into the following weeks. And the program suggests workouts and structures for a selected goal — aerobic base, aerobic capacity, lactate threshold."

Two decisions taken 2026-09-08:

- **The week template is literal, day by day** — not a set of counts. If the authored week violates a program rule, **the user is warned** rather than silently overruled.
- **$39.99 is an upgrade tier above the existing $19.99 plan**, not a replacement.

## The one design rule everything else hangs off

**The template says WHAT and WHERE. It never says HOW MUCH.**

The user authors "Tuesday: threshold run + upper lift. Saturday: long run." They do not author distances or durations. Every volume decision stays with the engine: the mileage progression, the +10% long-run jump cap, the 90-minute long-run ceiling, the 20% quality share, the 3-mile run floor, the deload and taper cuts, the cross-training top-up.

This is what makes the feature buildable in weeks rather than months. Without it, a custom program is a second engine — one with none of the guards, none of the research, and its own bugs. With it, the custom tier is the _same_ engine taking its weekly shape from the athlete instead of from the phase tables, and every guard written since June still applies.

It is also the honest product. What Duravel sells is the periodization, not the grid.

---

## Piece 1 — The tier

### What exists

Billing is live and correct. `app/api/stripe/webhook/route.ts` is the sole entitlement writer, `lib/subscription.ts` holds the entitlement logic, and there are exactly **three** enforcement points:

| Path                                | Gate                                |
| ----------------------------------- | ----------------------------------- |
| `app/api/generate/route.ts:45`      | 402 `payment_required`              |
| `app/api/adapt/apply/route.ts:56`   | 402                                 |
| `app/program/[id]/page.tsx:260,284` | `gateProgramWeeks` → 2-week preview |

### What is missing

**There is no tier concept anywhere.** `isEntitled()` returns a boolean. `Plan` is `"monthly" | "annual"` — an _interval_, not a tier. This is the first time the product needs to know _which_ thing someone bought.

### The change

Keep `plan` meaning interval; add `tier` alongside it, so a custom annual price can exist later without another migration.

**`supabase/migrations/0045_subscription_tier.sql`** (next in sequence after `0044_extra_workouts_strava_activity.sql`; additive and idempotent per `APPLY_NOTES.md`):

```sql
alter table public.subscriptions
  add column if not exists tier text not null default 'standard'
  check (tier in ('standard','custom'));
```

Existing rows default to `standard`, so every current subscriber is unaffected — which is the point of choosing an upgrade tier over a replacement.

**`lib/subscription.ts`**

- `export type Tier = "standard" | "custom"`
- `getEntitlement()` returns `{ entitled, tier, reason, trialEndsAt, trialDaysLeft }`
- `hasTier(tier: Tier)` — `custom` implies `standard`, never the reverse

**`app/api/stripe/webhook/route.ts`** — `tierFromPriceId()` beside the existing `planFromPriceId()`, writing `tier` on the same events. The webhook stays the only writer.

**`lib/env.ts`** — `STRIPE_PRICE_CUSTOM_MONTHLY`.

**Fourth gate** — `app/api/generate/route.ts` must reject a program whose `input_snapshot` carries a `weekTemplate` when the user is not on `custom`. Otherwise the tier is decorative: the template rides in the input snapshot and Recalculate would honour it forever.

**`app/pricing/pricing-plans.tsx`** — third card. Note while in here: the hardcoded annual price is **$119.99** but `docs/plans/stripe-payments-plan.md` says **$159.99**. One of them is wrong and it should be settled before adding a third number.

### Open assumption

**The 14-day trial grants `standard` only.** A trial user who designs a custom program and then loses it on day 15 is a worse experience than never having been offered it. Flag to override.

---

## Piece 2 — The week template

### Schema (`lib/schemas.ts`)

```ts
export const TemplateSessionSchema = z.object({
  kind: z.enum(["run", "lift", "hybrid", "cardio", "swim", "bike"]),
  runType: RunType.optional(), // omitted = "let the phase decide"
  liftType: LiftType.optional(),
});

export const WeekTemplateSchema = z.object({
  days: z
    .array(
      z.object({
        day: TrainingDay,
        sessions: z.array(TemplateSessionSchema).max(MAX_SESSIONS_PER_DAY),
      }),
    )
    .length(7),
});
```

No distances. No durations. No zones. An omitted `runType` means "the engine picks one appropriate to the phase" — so a user who wants a hard Tuesday without caring which kind of hard still gets base/build/peak progression on that slot.

`GenerationInput` gains `weekTemplate: WeekTemplateSchema.optional()`. It flows into `EngineInput` through `toEngineInput` (`lib/engine/skeleton.ts:611`) and reaches `buildSkeleton`.

### How it drives the engine

`buildSkeleton` currently calls, per week:

```ts
days: assignDays(
  trainingDays,
  phase,
  microWeek,
  runningExp,
  hybridExp,
  race,
  prefs,
  pos,
  bias,
  counts,
  targetMileage,
);
```

Add a sibling, `assignDaysFromTemplate(template, phase, microWeek, race, pos, counts, targetMileage)` in `lib/engine/slots.ts`, selected when a template is present. **Periodization applies to the template as a set of modifiers — it is not repeated verbatim 16 times:**

| Microcycle                      | What happens to the template                                                                    |
| ------------------------------- | ----------------------------------------------------------------------------------------------- |
| loading (`rebound`, `increase`) | as authored                                                                                     |
| `deload`                        | drop one run and one hybrid, exactly as `planWeek` does today                                   |
| `taper`                         | shed ~40% of sessions by `slotPriority` ascending, keeping the long run and one quality session |
| `race`                          | template ignored entirely — `raceWeekSlots(priority)` owns an A/B race week, as today           |

Run types with no `runType` are filled from `runFillers(phase, pos)`, so the authored shape still progresses base → build → peak. Types the user _did_ specify always win.

Everything downstream is untouched: `applySequencingGuards`, `capSessionsPerDay`, the race overlay, `applyPostBRaceRecovery`, `reconcileWeekVolume`, `applyStrengthSchemes`.

### The risk to watch

`lib/engine/golden-hyrox.test.ts` asserts byte-identical HYROX skeletons and `lib/ai/prompts.test.ts` is a byte-identical prompt oracle. **The template path must be completely inert when no template is supplied.** That is the acceptance criterion for Piece 2: every existing test passes untouched, and the golden fixtures are not re-baselined.

---

## Piece 3 — The validator (this is the feature)

Levi's requirement: _"if the chosen design violates a program rule, the user should be warned."_

The rules already exist as code — `applySequencingGuards`, `separateLifts`, `spaceHardRunAfterLongRun`, `capSessionsPerDay`, `runsForMileage`, `bandSessionCap`. What they have never had is a **voice**. A validator that explains, in the athlete's own week, why the engine wants something different is the single most defensible reason this tier costs twice the standard one. It is a coach showing its work.

**`lib/engine/template-validate.ts`** — pure, no I/O:

```ts
type Severity = "blocking" | "warning" | "note";
interface TemplateIssue {
  severity: Severity;
  code: string;
  message: string;
  day?: TrainingDay;
}
export function validateTemplate(t: WeekTemplate, ctx: TemplateContext): TemplateIssue[];
```

| Severity     | Meaning                                                                                            | Examples                                                                                                                                                                                       |
| ------------ | -------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **blocking** | the engine cannot produce a legal program                                                          | more than 2 sessions on a day; fewer than 3 training days; no long run in a week that prescribes mileage                                                                                       |
| **warning**  | legal, but the engine is being asked to do something it advises against — **the user may proceed** | back-to-back hard days; two lifts on consecutive days; a hard run the day after the long run; no rest day; more sessions than the stated hours band supports; **too few runs for the mileage** |
| **note**     | informational                                                                                      | no quality session this week; fewer hybrids than the sport suggests                                                                                                                            |

That "too few runs for the mileage" warning is the volume doctrine surfaced, and it should be quoted to the user close to Levi's own framing:

> Four runs for 30 miles a week means 7-mile runs. Doubling a single session's length roughly doubles injury risk; adding sessions at a familiar length costs little or nothing. Six runs would carry the same 30 miles.

Runs live in the designer as the user builds (client) **and** server-side at submit — a client-side-only validator is not a validator.

---

## Piece 4 — The designer UI

`app/program/new/custom/` — a 7-day grid, sessions added per day, at most two a day, with the issue list live beside it.

Reuse rather than rebuild:

- `components/admin/session-fields.tsx` — already the shared session field editor
- `DayPills` (`app/onboarding/onboarding-form.tsx:171`) — the day multiselect
- The existing intake still collects profile, benchmarks, hours and goal; the custom flow _replaces the schedule step_, not the whole wizard

### Goal presets

`suggestTemplate(goal, trainingDays, weeklyHours, exp) → WeekTemplate` for Levi's three goals — the empty-canvas problem solved with one click, then edited:

| Goal                  | Shape                                                                                                     |
| --------------------- | --------------------------------------------------------------------------------------------------------- |
| **Aerobic base**      | frequency-first: every run easy/Z2 bar one, long run at ~a third of the week, at most one quality session |
| **Aerobic capacity**  | two quality sessions, interval-biased, long run held at its third, easy fill between                      |
| **Lactate threshold** | two quality sessions, threshold/tempo-biased, long run, easy fill                                         |

These are tables, not intelligence. The value is that they are _correct starting points_ and the user immediately sees what a good week looks like before touching it.

---

## Piece 5 — Adding a workout mid-program

> "The ability to add a new workout mid-program that is incorporated into the following weeks."

Two different operations, and conflating them is the trap:

1. **This week only** — already shipped and user-facing: `app/program/extra-actions.ts`, the `extra_workouts` table. Nothing to do.
2. **From here on** — amend the template from week N forward. This is the feature.

### What exists

`saveCoachSession` (`app/admin/actions.ts:97`) and `components/admin/program-form-editor.tsx` already add, remove and swap sessions on any day of a stored program, schema-validated. It is admin-only behind `getAdmin()`.

### The bug to fix first

`saveCoachSession` and `updateProgramData` recompute `week.summary` but do **not** re-run `reconcileWeekVolume`, `applyStrengthSchemes` or `verifyProgram`, and never touch the stored `skeleton`. An edited program therefore diverges from its own skeleton, and the next Recalculate silently discards the edit. This has to be fixed before the capability is exposed to paying users — it is currently masked only because admins know to expect it.

### The change

**Template history on the program**, so an amendment is a fact about the plan rather than a patch on top of it:

```sql
-- 0046_program_week_templates.sql
alter table public.programs
  add column if not exists week_templates jsonb;
-- [{ "fromWeek": 1, "template": {...} }, { "fromWeek": 9, "template": {...} }]
```

`amendTemplate(programId, fromWeek, template)`:

1. Validate; blocking issues refuse
2. Append to `week_templates`
3. Rebuild the skeleton for weeks **≥ fromWeek only** — completed weeks are history and are never rewritten
4. Regenerate and splice those weeks, reusing the pattern `lib/generation/adapt-week.ts:347` already uses for a single week (`weeks.map(w => w.weekNumber === target ? newWeek : w)`, and the same on `skeleton.weeks`)
5. Re-run `verifyProgram`

The rolling four-week long-run history that feeds `longRunCapMiles` is computed from the weeks preceding the rebuild, so the jump cap keeps working across an amendment with no special handling. That falls out of the existing design.

---

## Sequencing

| Phase | Work                                                                                                                                    | Gate to move on                                                                   |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| **1** | `WeekTemplateSchema`, `template-validate.ts`, `assignDaysFromTemplate`, threading through `toEngineInput`/`buildSkeleton`. Guard tests. | Full suite green **with the golden fixtures untouched**                           |
| **2** | Migration 0045, Stripe price, tier-aware entitlement, fourth gate, pricing card                                                         | A `custom` user can reach a template-bearing generate; a `standard` user gets 402 |
| **3** | Designer UI, live validation, goal presets                                                                                              | Levi can author a week and see warnings                                           |
| **4** | Fix the skeleton-divergence bug; `week_templates`; `amendTemplate`; rebuild-from-week-N                                                 | An amendment survives a Recalculate                                               |
| **5** | Build Levi a custom program and train on it                                                                                             | —                                                                                 |

Phase 1 before 3 (the UI needs the validator). Phase 2 is independent and can run in parallel. Phase 4 last — it is the only piece that touches stored programs.

## What this plan deliberately does not do

- **No second engine.** The template chooses shape; the engine owns every number.
- **No user-authored distances or durations.** The moment those are accepted, the volume doctrine, the jump cap and the session floors are all advisory, and the product's actual value is gone.
- **No silent overruling.** Where the engine must deviate — a taper week, a race week, a blocking issue — it says so.
