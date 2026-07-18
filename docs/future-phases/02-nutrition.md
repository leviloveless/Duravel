# Duravel — Nutrition Module: Design & Build Spec

**Status:** Preparatory design (future phase) · **Author:** Product + Eng (Levi, solo founder) · **Date:** 2026-07-15
**Scope of this doc:** Research + implementation-ready design. No code written; no migrations applied. New migrations, when built, continue from `0019`.
**Relationship to stack:** Additive only. No changes to the training engine, `programs`, `workout_logs`, adaptation tables, or the Stripe webhook. Rides the existing `BILLING_ENABLED` gate and entitlement model.

---

## 0. What changed vs. the preparatory draft (design corrections)

These are the substantive fixes baked into this version; they are the difference between "plausible" and "buildable."

1. **TDEE double-counting bug fixed.** The draft computed `TDEE = RMR × activity_factor + training_kcal`. Standard activity multipliers (Mifflin "moderately active" ≈ 1.55) **already include exercise**, so adding modeled training energy on top double-counts it. Corrected model: `activity_baseline` is reinterpreted as a **NEAT / non-exercise lifestyle factor only** (sedentary desk ≈ 1.2 → on-feet job ≈ 1.4), and *all* structured-training energy is added separately from the day's plan. This is the whole point of owning the training context; it must not be double-billed. (§5)
2. **Session identity made durable.** `session_ref` cannot be an array index or ad-hoc string into the plan JSON — adaptation rewrites weeks and would orphan/misalign fueling. It must reuse **the same stable session identifier the training engine already assigns and that `workout_logs`/wearable links (0016/0017) key against.** If no such stable id exists yet, minting one is a *prerequisite* task, not part of this module. (§3.5, §9)
3. **Disclaimer is versioned.** A single `disclaimer_ack_at` can't re-prompt when legal copy changes. Store `disclaimer_version` acknowledged; guidance is gated on `ack_version >= current_version`. (§3.1, §6, §9)
4. **Weight-log write conflicts resolved.** `unique(user_id, logged_on)` collides when a wearable and a manual entry land on the same day. Policy: **manual always wins**; wearable upserts only fill an empty day. (§3.2)
5. **Orphaned targets are cleaned up.** When adaptation reshapes a week, `target_date`/`session_ref` rows that no longer correspond to a planned day must be pruned, not left stale. Recompute is a **replace-set per program**, not a blind upsert. (§3.3, §4)
6. **Physiological CHECK constraints added** on height/weight/bodyfat/age so a fat-finger or hostile client can't drive the engine into nonsense (and to bound liability). (§3)
7. **Timezone-correct "today."** `target_date` is a calendar date; "today's fuel" must resolve against the user's timezone, not server UTC. Requires a timezone on the profile (reuse `profiles` if present). (§3.1, §6)
8. **Minors handled explicitly.** Age is derived from `birth_date`; under-18 accounts are blocked from guidance (bright-line scope + liability). (§3.1, §9)
9. **Meal-idea cache is concrete.** Haiku output is cached in a dedicated `nutrition_meal_ideas` table keyed by target + dietary-hash, not hand-waved into a "basis-like column." Rate limiting uses a real store. (§3.6, §4)
10. **Health-data privacy called out.** Bodyweight, body-fat, and dietary data are health-adjacent sensitive data; retention, export, and delete-on-account-deletion (already covered by `on delete cascade`) are explicit. (§9)

---

## 1. Goal & Why-Now

### Goal
Add a **Nutrition module** that turns Duravel from a training-plan engine into a full *train + fuel* system: periodized daily energy/macro targets that track training load, per-session and race-week fueling, hydration guidance, and recovery nutrition — all driven off the same deterministic engine and the same logged-session data that already power adaptation.

**North star:** the athlete opens Duravel the morning of a session and sees not just "what to run" but "what to eat today, what to carry in the session, and what to take afterward" — automatically adjusted when they log a hard or a missed session.

### Why now
1. **The hard part is already built.** Duravel already computes per-day training load: phase (Base/Build/Peak/Taper), session type, duration, intensity/zones, HYROX station work. Daily carbohydrate periodization — the core of every serious endurance-nutrition product (Hexis "Carb Codes," Fuelin fueling windows) — is a *deterministic function of that load*. We produce differentiated output on day one because we own the training context standalone apps have to import or guess.
2. **Load-linked adaptation is the moat.** MyFitnessPal is training-blind; Hexis/Fuelin bolt onto TrainingPeaks via integrations. Duravel has the plan, the logged actuals (`workout_logs`), the wearable feed (`wearable_activities`), and the goal event in one system. Fueling that reconciles to *actual* logged load — not planned — is a feature none of the incumbents ship cleanly.
3. **Monetization fit.** Natural expansion of the existing paid tier: raises willingness-to-pay and retention without a second app, login, or subscription. Slots behind `BILLING_ENABLED`.
4. **Sport-agnostic runway.** Fueling math generalizes almost unchanged HYROX → triathlon/Ironman (long-course is *more* nutrition-limited — the during-race problem is bigger). Building the nutrition data model now, sport-agnostic, de-risks the triathlon bet.
5. **Low marginal AI cost.** Targets are deterministic. Haiku is used only for *variety and phrasing*, the same guardrailed pattern as session content. No new model, no new infra, no new vendor.

### Competitive landscape (research summary)
- **Hexis** — closest analog. "Carb Codes" periodize low/med/high carb days to training strain; session + intra-workout fueling; wearables/food tracking added over time; guidance-first then tracking; consumer sub (~$15–20/mo). ([endurance.biz](https://endurance.biz/2023/industry-news/inside-the-brand-hexis-personalised-nutrition-platform/), [hexis.live](https://hexis.live/))
- **Fuelin** — human-coach-led, nutrition embedded *into* TrainingPeaks workouts; higher, coaching-inclusive price. Validates "nutrition on the training calendar" but is service-heavy — the opposite of solo-founder-scalable. ([TrainingPeaks](https://www.trainingpeaks.com/partners/fuelin/), [endurance.biz](https://endurance.biz/2024/industry-news/fuelin-integrates-nutrition-information-directly-into-trainingpeaks-coaching-platform/))
- **MyFitnessPal / MacroFactor / Carbon** — best-in-class *logging* + adaptive-TDEE, but training-blind. We don't compete on food-database breadth; we compete on *training-linked targets* and optionally *import* their logging strength via a food API.

**Strategic takeaway:** ship **guidance-first** (like Hexis's early product), keep full food-diary tracking as an optional later layer, and lean entirely on the training context we already own.

---

## 2. User-Facing Scope

### MVP (v1) — "Fueling guidance, zero food logging"
The MVP produces guidance and does **not** require logging a single food item. This is the guidance-first wedge; it sidesteps the biggest cost/UX sink (food databases) and much of the liability surface.

1. **Nutrition profile & onboarding** — bodyweight, height, age (from `birth_date`), sex, optional body-fat %, dietary pattern (omnivore/vegetarian/vegan/pescatarian/other), allergens/exclusions (free-text + common flags), primary goal (perform / lose fat / maintain / gain), and a coarse **non-exercise** activity baseline. Weight editable/trackable over time. Ends with a versioned disclaimer gate.
2. **Daily fueling target** — per program day: total energy (kcal) + macro split (carb/protein/fat, g), **periodized to that day's training load** (rest / low / moderate / high / race). Presented as a "fuel day type" badge, analogous to Hexis Carb Codes.
3. **Per-session fueling** — for sessions above a duration/intensity threshold: pre (timing + carb g), during (carb g/hr, fluid mL/hr, sodium mg/hr for qualifying long sessions), post recovery (carb + protein g, timing window).
4. **Hydration guidance** — daily baseline fluid target + per-session fluid/sodium, with an optional one-time **sweat-rate self-test** (weigh-in/weigh-out) to personalize.
5. **Race-week / event fueling** — taper-week carb adjustments, carb-loading protocol for qualifying events (>90 min), race-morning meal, during-race plan tied to expected event duration and (HYROX) station structure.
6. **AI meal ideas (guardrailed)** — Haiku example meals/snacks that *hit the deterministic targets* and respect dietary flags. Framed as examples, regenerable, cached.
7. **Guidance surfaced in-context** — fueling strip on each training-session card + a dedicated Nutrition tab.

### Later (v2+)
- **Food logging (opt-in)** — log meals vs. targets via a food-database API (barcode + search). Unlocks adherence signals.
- **Adaptive energy** — MacroFactor-style: reconcile logged intake + weight trend to refine the TDEE estimate over time (deterministic expenditure-model correction).
- **Nutrition → adaptation feedback** — chronic under-fueling / low carb availability as a *readiness signal* into the existing engine (extends `adaptations`/`readiness_checkins`, no rearchitecture).
- **Supplement & gut-training planner** — progressive during-session carb tolerance ("train the gut") toward race-day g/hr.
- **Grocery/shopping list & recipe depth**, wearable calorie reconciliation, RED-S/low-energy-availability screening (strong medical framing).
- **Multi-sport fueling** — triathlon brick/long-course during-race fueling (reuses the v1 during-session engine).

### Explicitly out of scope (all versions, unless an RDN is retained)
Clinical/therapeutic diets, medical nutrition therapy, eating-disorder treatment, prescriptive weight targets for minors, pregnancy nutrition. Bright lines of Registered Dietitian scope of practice ([CDR 2024 Scope & Standards](https://www.cdrnet.org/vault/2459/web/Scope%20Standards%20of%20Practice%202024%20RDN_FINAL.pdf)). See §9.

---

## 3. Data Model / Schema Changes

New migrations continue from **`0019`**. All tables get **RLS** (owner-only via `auth.uid()`), matching existing patterns. The Supabase client is untyped, so server queries cast with `as`; define matching TS types in `lib/nutrition/types.ts`. Physiological CHECK constraints are defense-in-depth against bad/hostile input and a small liability hedge — the deterministic engine re-clamps regardless.

**Design principles**
- **Store inputs and output snapshots, derive the rest.** Persist the *inputs* (nutrition profile, weight history) and the *engine output snapshots* (per-day targets + per-session fueling attached to a program), so any target is reproducible and auditable — mirroring how the engine already snapshots program structure via `engine_version`.
- **Reuse existing identity.** Per-session fueling references the **stable session id the training engine already assigns** (the same identity `workout_logs` / wearable links resolve against). No engine schema changes.

### 3.1 `0019_nutrition_profiles.sql`
```sql
create table public.nutrition_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  sex text not null check (sex in ('male','female')),        -- BMR eqn input; matches engine %HRmax convention
  birth_date date not null,                                  -- age derived; required (Mifflin needs it; also minor-gating)
  height_cm numeric(5,1) check (height_cm between 90 and 260),
  bodyweight_kg numeric(5,2) check (bodyweight_kg between 30 and 300),  -- latest snapshot; history in weight_logs
  bodyfat_pct numeric(4,1) check (bodyfat_pct between 3 and 60),        -- optional; enables Katch-McArdle/Cunningham
  dietary_pattern text not null default 'omnivore'
    check (dietary_pattern in ('omnivore','vegetarian','vegan','pescatarian','other')),
  excluded_foods text[] not null default '{}',               -- allergens/dislikes for AI prompt filtering
  primary_goal text not null default 'perform'
    check (primary_goal in ('perform','lose_fat','maintain','gain')),
  goal_rate_kg_per_week numeric(3,2)                         -- signed; server clamps, never trusts client
    check (goal_rate_kg_per_week between -1.00 and 0.75),
  neat_baseline text not null default 'light'               -- NON-EXERCISE lifestyle only (see §5); training added separately
    check (neat_baseline in ('sedentary','light','moderate','active')),
  timezone text not null default 'UTC',                     -- resolves "today" for the Today card; reuse profiles.tz if present
  units text not null default 'metric' check (units in ('metric','imperial')),
  disclaimer_version integer,                               -- version acknowledged; guidance gated on >= current
  disclaimer_ack_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id)
);
alter table public.nutrition_profiles enable row level security;
create policy "own nutrition_profile" on public.nutrition_profiles
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
```
**Notes.** `neat_baseline` intentionally renamed from `activity_baseline` and capped at `active` (no `very_active`): its multiplier must reflect *non-exercise* life only, because structured training is added from the plan (§5). Minor-gating: server rejects guidance generation when `age < 18`. Weight editing updates this snapshot *and* writes a `weight_logs` row in the same action.

### 3.2 `0020_weight_logs.sql`
```sql
create table public.weight_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  logged_on date not null,
  bodyweight_kg numeric(5,2) not null check (bodyweight_kg between 30 and 300),
  source text not null default 'manual' check (source in ('manual','wearable')),
  created_at timestamptz not null default now(),
  unique (user_id, logged_on)                               -- one canonical weight per day
);
alter table public.weight_logs enable row level security;
create policy "own weight_logs" on public.weight_logs
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
```
**Conflict policy.** Manual entries are authoritative. Server-side upsert: `on conflict (user_id, logged_on)` — a `manual` write always overwrites; a `wearable` write uses `where weight_logs.source = 'wearable'` (i.e. never clobbers a manual value). The 7-day EMA of `bodyweight_kg` (not the raw daily value) feeds the engine and the v2 adaptive-energy loop.

### 3.3 `0021_nutrition_targets.sql` — per-day engine output snapshot
```sql
create table public.nutrition_targets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  program_id uuid not null references public.programs(id) on delete cascade,
  target_date date not null,
  fuel_day_type text not null
    check (fuel_day_type in ('rest','low','moderate','high','race')),
  kcal integer not null,
  carb_g integer not null,
  protein_g integer not null,
  fat_g integer not null,
  fluid_ml integer,                                         -- daily baseline hydration
  sodium_mg integer,                                        -- daily baseline
  basis jsonb not null default '{}',                        -- {bmr, neat_kcal, training_kcal, tdee, eqn, carb_g_per_kg, deficit_applied,...} for audit + UI "why"
  engine_version text not null,                             -- reproducibility, mirrors program snapshots
  computed_from text not null default 'planned'            -- 'planned' | 'actual' (reconciled to logged load)
    check (computed_from in ('planned','actual')),
  created_at timestamptz not null default now(),
  unique (user_id, program_id, target_date)
);
alter table public.nutrition_targets enable row level security;
create policy "own nutrition_targets" on public.nutrition_targets
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create index nutrition_targets_program_date_idx on public.nutrition_targets (program_id, target_date);
create index nutrition_targets_user_date_idx    on public.nutrition_targets (user_id, target_date);  -- "today" across programs
```
**Orphan handling.** Recompute for a program is a **replace-set within the affected date range**: compute the new target set, upsert present dates, and `delete` rows for dates in range that are no longer in the plan (adaptation can shorten/shift weeks). `computed_from` distinguishes plan-based defaults from post-hoc reconciliation to *actual* logged load, so the UI can honestly say "adjusted from your logged session."

### 3.4 `0022_session_fueling.sql` — per-session pre/during/post plan
```sql
create table public.session_fueling (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  program_id uuid not null references public.programs(id) on delete cascade,
  session_id text not null,                                 -- STABLE engine session id (same one workout_logs/wearable links resolve); NOT a JSON index
  session_date date,
  pre jsonb not null default '{}',    -- {carb_g, timing_min_before, notes}
  during jsonb not null default '{}', -- {applies:boolean, carb_g_per_hr, fluid_ml_per_hr, sodium_mg_per_hr, total_carb_g}
  post jsonb not null default '{}',   -- {carb_g, protein_g, window_min}
  engine_version text not null,
  created_at timestamptz not null default now(),
  unique (user_id, program_id, session_id)
);
alter table public.session_fueling enable row level security;
create policy "own session_fueling" on public.session_fueling
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
```
**Prerequisite.** This table is only sound if the training engine exposes a **stable, persisted session id**. If sessions are currently addressed positionally inside the plan JSON, mint a stable id first (a Phase-A blocker task, §10). Same replace-set + orphan-delete discipline as `nutrition_targets`.

### 3.5 `0023_sweat_tests.sql` — hydration personalization
```sql
create table public.sweat_tests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  tested_on date not null,
  duration_min integer not null check (duration_min between 20 and 360),
  pre_weight_kg numeric(5,2) not null check (pre_weight_kg between 30 and 300),
  post_weight_kg numeric(5,2) not null check (post_weight_kg between 30 and 300),
  fluid_consumed_ml integer not null default 0 check (fluid_consumed_ml between 0 and 5000),
  urine_loss_ml integer not null default 0,                 -- optional correction
  conditions text check (conditions in ('hot','temperate','cold')),
  sweat_rate_ml_per_hr integer,                             -- computed server-side, stored for reuse
  created_at timestamptz not null default now()
);
alter table public.sweat_tests enable row level security;
create policy "own sweat_tests" on public.sweat_tests
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
```
Server computes `sweat_rate_ml_per_hr = ((pre−post)*1000 + fluid_consumed_ml − urine_loss_ml) / (duration_min/60)`; latest test personalizes per-session fluid/sodium.

### 3.6 `0024_nutrition_meal_ideas.sql` — AI cache (MVP)
```sql
create table public.nutrition_meal_ideas (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  target_id uuid not null references public.nutrition_targets(id) on delete cascade,
  diet_hash text not null,                                  -- hash(dietary_pattern + excluded_foods) → invalidates on diet change
  ideas jsonb not null,                                     -- Zod-validated Haiku output (array of {title, items, kcal, macros})
  model text not null default 'haiku',
  created_at timestamptz not null default now(),
  unique (target_id, diet_hash)
);
alter table public.nutrition_meal_ideas enable row level security;
create policy "own nutrition_meal_ideas" on public.nutrition_meal_ideas
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
```
Caches example meals per target + diet fingerprint so a re-render never re-hits Haiku; "Regenerate" overwrites the row. Bounds AI spend to genuinely new targets.

### 3.7 `0025_nutrition_logs.sql` — **v2, deferred.** Ships only when food logging is built.
```sql
create table public.nutrition_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  logged_on date not null,
  meal_slot text check (meal_slot in ('breakfast','lunch','dinner','snack','intra_session')),
  food_ref text,                                            -- external food-API id or 'custom'
  description text,
  kcal integer, carb_g numeric(6,1), protein_g numeric(6,1), fat_g numeric(6,1),
  fluid_ml integer, sodium_mg integer,
  workout_log_id uuid references public.workout_logs(id) on delete set null,  -- ties intra/post fuel to the session
  created_at timestamptz not null default now()
);
alter table public.nutrition_logs enable row level security;
create policy "own nutrition_logs" on public.nutrition_logs
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create index nutrition_logs_user_date_idx on public.nutrition_logs (user_id, logged_on);
```

**No changes to `programs`, `workout_logs`, or engine tables.** Nutrition references them by FK only. The existing "synced workout = a `workout_log`" property means logged/synced load already flows into target reconciliation with zero engine changes.

---

## 4. API / Route + Server-Action Changes

Follow existing App Router conventions (server components + server actions; route handlers only for external callers/webhooks). Every mutation re-checks auth and, for gated features, `BILLING_ENABLED` + entitlement. **Writes use the user-scoped client so RLS enforces ownership** (no need for the service-role admin client here — nutrition never writes another user's rows and never touches entitlement).

### Server actions (`app/(app)/nutrition/actions.ts`)
- `saveNutritionProfile(input)` — Zod-validated upsert into `nutrition_profiles`. Clamps `goal_rate_kg_per_week` server-side. Rejects if derived age < 18. Sets `disclaimer_version` + `disclaimer_ack_at` on acknowledge.
- `logWeight(input)` — upsert `weight_logs` per the manual-wins policy (§3.2); updates the profile snapshot; recomputes the current-day target basis (cheap, single day).
- `generateNutritionTargets(programId)` — **gated (`BILLING_ENABLED` + active entitlement)**. Guard: returns a "complete your nutrition profile" state if no acknowledged profile exists. Runs the deterministic engine over the program's day plan; **replace-set** writes `nutrition_targets` + `session_fueling` (upsert present, delete orphaned). Idempotent. Mirrors program-generation gating.
- `regenerateMealIdeas(targetId)` — **gated**. Reads cache by `(target_id, diet_hash)`; on miss, calls Haiku with engine numbers as hard constraints, Zod-validates, writes `nutrition_meal_ideas`. **Rate-limited** (see below).
- `saveSweatTest(input)` — inserts `sweat_tests`, computes `sweat_rate_ml_per_hr`, refreshes hydration guidance.
- `(v2) logFood(input)` / `deleteFoodLog(id)` — writes `nutrition_logs`; optional `workout_log_id` link.

**Rate limiting.** `regenerateMealIdeas` needs a real store, not in-memory (Vercel is serverless/stateless per invocation). Use a lightweight counter — either Supabase (a `nutrition_ai_usage` row per user/day) or Upstash Redis if already in the stack. Cap e.g. N regenerations/day/user; the cache absorbs everything else.

### Reconciliation hook (no new endpoint)
When a `workout_log` is written or a Strava/wearable activity is linked (existing flow), recompute targets for the **affected days only** so fueling reflects *actual* load (`computed_from='actual'`), not just planned. **Reuse the existing weekly-review "Apply" path**: nutrition target regeneration becomes an additional step of the same gated Apply action, inheriting the webhook-as-sole-writer entitlement discipline. Ad-hoc single-log recomputes stay cheap (bounded day range) and are **inline, not fanned out** to avoid chattiness. **The Stripe webhook remains the sole writer of entitlement**; nutrition actions only *read* it.

### Route handlers
- `app/api/nutrition/food-search/route.ts` — **v2 only.** Thin server-side proxy to the chosen food-database API (keeps key server-side; adds caching + rate limiting). Not needed for MVP.
- **No new webhook. No changes to the Stripe webhook.**

### Data fetching
Server components read `nutrition_targets` / `session_fueling` directly (RLS-scoped) for the Nutrition tab and to hydrate the fueling strip on session cards. The "today" query resolves the date in `nutrition_profiles.timezone`. Untyped client → cast with `as NutritionTarget[]` etc., types hand-written in `lib/nutrition/types.ts`.

---

## 5. Engine / AI Implications

### The split is identical to training: **deterministic owns the numbers, Haiku owns the words.**

#### Deterministic nutrition engine — `lib/nutrition/engine/*`
A pure, unit-tested (vitest) module mirroring `lib/engine/*`. Inputs: nutrition profile + weight EMA + the program's per-day load descriptors already produced by the training engine. Outputs: `nutrition_targets` + `session_fueling`. Components:

1. **Resting metabolic rate (RMR).** Default **Mifflin–St Jeor** (best-validated general equation). When body-fat % is present, use **Katch–McArdle / Cunningham** (fat-free-mass based), more accurate in lean, muscular athletes; meta-analysis favors FFM-based equations in athletes when FFM is known ([RMR-in-athletes review, PMC](https://pmc.ncbi.nlm.nih.gov/articles/PMC10687135/)). Record the equation used in `basis`.
2. **Expenditure — no double-counting (corrected).**
   `TDEE(day) = RMR × NEAT_factor + training_kcal(day)`
   where **`NEAT_factor` covers non-exercise life only** (sedentary ≈ 1.2 → active job ≈ 1.4), and `training_kcal(day)` is modeled from that day's planned (or, after reconciliation, logged) session using the engine's existing duration × intensity/zone model and bodyweight (MET-equivalent). This is strictly better than a flat "active" multiplier *because we have the day's actual plan* — but only if training energy is added exactly once. On rest days `training_kcal = 0`.
3. **Carbohydrate periodization ("fuel day type").** Carb in **g/kg bodyweight** scaled to that day's load — "fuel for the work required":
   - Rest/low ≈ 3–5 g/kg · Moderate ≈ 5–7 g/kg · Hard/high-volume ≈ 6–10 g/kg · Race-prep/loading (event >90 min) ≈ 10–12 g/kg for 36–48 h. ([GSSI carbohydrate guidelines](https://www.gssiweb.org/sports-science-exchange/article/dietary-carbohydrate-and-the-endurance-athlete-contemporary-perspectives))
   The `fuel_day_type` badge is derived from the resulting g/kg band.
4. **Protein.** ≈ 1.4–2.0 g/kg/day, biased higher on hard/recovery days and in a fat-loss deficit (preserves lean mass). ([Sports Med 2025 review](https://link.springer.com/article/10.1007/s40279-025-02203-8))
5. **Fat.** Remainder of energy after carb + protein, **floored ≈ 0.8–1.0 g/kg** so it's never driven implausibly low on high-carb days.
6. **Energy goal offset (guardrailed).** Apply goal deficit/surplus as a **bounded** adjustment to TDEE: **hard floor at/above RMR** (never prescribe below RMR), deficit caps, and **deficits suppressed in Peak/Taper/race weeks**. `goal_rate_kg_per_week` is clamped server-side; guardrails are engine logic, never client input.
7. **During-session fueling.** For qualifying sessions (duration/intensity threshold): **carb 30–90 g/hr** scaled to duration/intensity (30–60 g/hr for 1–2.5 h; up to ~90 g/hr via glucose:fructose for longer/hard efforts, with a "train the gut" ramp); fluid from the latest sweat test or a sensible default; **sodium ~300–700 mg/hr** (individualized when a sweat test exists). ([GSSI carbs](https://www.gssiweb.org/sports-science-exchange/article/dietary-carbohydrate-and-the-endurance-athlete-contemporary-perspectives); [sodium review](https://link.springer.com/article/10.1186/s44410-025-00011-9))
8. **Post-session recovery.** ≈ 1.0–1.2 g/kg/hr carb for hard/depleting sessions + ≈ 0.3 g/kg protein within a ~1–2 h window; scaled down for easy sessions.
9. **Race-week protocol.** Taper reduces training carb but *raises* pre-race loading; race-morning meal (1–4 g/kg, 1–4 h prior); during-race plan from expected event duration and (HYROX) station structure. Built **sport-agnostic** so long-course triathlon (bike vs. run intake, longer durations) reuses it without a rewrite.
10. **Reconciliation.** Same philosophy as `lib/generation/*` reconciling mileage to engine targets: macros must sum to the energy total within tolerance; the engine reconciles rounding so displayed grams are internally consistent (`carb_g*4 + protein_g*4 + fat_g*9 ≈ kcal`).

**Reproducibility & versioning.** Stamp `engine_version` on every row (as programs do). A bumped nutrition-engine version + recompute regenerates deterministically. **Golden/snapshot tests** pin representative athlete profiles → expected targets so a version bump's diff is reviewable.

#### AI (Haiku) — narrow, guardrailed, optional
Used **only** for: (a) example meals/snacks that hit an *already-computed* target and respect exclusions; (b) natural-language phrasing of the plan. Same pattern as session content:
- Numbers come from the engine and are passed *into* the prompt as hard constraints; Haiku never invents targets.
- Output is **Zod-validated**; on failure, fall back to a deterministic template ("no meal ideas right now" rather than wrong ones).
- Dietary exclusions/allergens injected into the prompt *and* re-checked against output where feasible (string match on excluded terms).
- Cost bounded by the `nutrition_meal_ideas` cache + rate limit. No new model or provider.

**Net engine impact:** additive. No changes to the training engine's periodization, zones, or adaptation math. Nutrition consumes the training engine's day descriptors read-only.

---

## 6. UX Outline

- **Onboarding (one-time):** short nutrition-profile form (weight/height/birth date/sex, goal, dietary pattern + exclusions, NEAT baseline, timezone). Ends with a **versioned disclaimer acknowledgment gate** — guidance is not shown until `disclaimer_version` matches current. Under-18 → blocked with an explanatory message.
- **Nutrition tab (primary surface):**
  - *Today card* — resolved in the user's timezone: fuel-day-type badge (Low/Moderate/High/Race), kcal + macro rings (carb/protein/fat in g), hydration + sodium line, and an expandable **"why"** (BMR eqn, NEAT kcal, training kcal, carb g/kg, any deficit applied). If reconciled to a logged session, a "adjusted from your logged session" note. Transparency is a trust *and* liability asset.
  - *Session fueling* — pre / during / post blocks on each qualifying session, shown here and inline on the **training session card** ("Fuel: 60 g carb + 500 ml/hr").
  - *Meal ideas* — AI example meals hitting today's target, labeled "examples," with a regenerate button (rate-limited; served from cache otherwise).
  - *Week view* — a strip of fuel-day-types alongside the training week, so periodization tracking load is visible.
- **Race-week mode:** inside taper/race week of the goal event, the tab switches to a countdown fueling plan (loading days, race-morning meal, during-race plan).
- **Weight & sweat test:** lightweight weight-log entry (with 7-day-trend line) and an optional guided sweat-rate self-test.
- **Settings:** edit profile, dietary exclusions, units, re-show/re-acknowledge disclaimer, **export my nutrition data**, delete (covered by account-level cascade).
- **(v2) Food log:** add-meal flow (search/barcode), progress-vs-target rings, adherence over time.
- **Empty/gated states:** non-subscribers see the *structure* and a sample day (marketing surface) with a paywall on generation — consistent with existing `BILLING_ENABLED` gating of program generation. Profile-incomplete users see a "finish your nutrition profile" CTA rather than a broken tab.

---

## 7. Third-Party Services + Rough Costs

| Need | MVP (guidance-first) | v2 (food logging) | Notes / cost |
|---|---|---|---|
| **Food/nutrition database** | **None** | Required | MVP avoids entirely — major cost/scope saving. |
| **AI meal ideas** | Anthropic Haiku (existing) | same | Marginal; short, cached completions, rate-limited. No new vendor. |
| **Hosting/DB** | Supabase + Vercel (existing) | same | Additive tables only; negligible incremental cost. |
| **Billing** | Stripe (existing) | same | Rides the existing paid tier; no new Stripe objects. |
| **Rate-limit store** | Supabase counter (existing) | same | Or Upstash if already present; ~$0. |
| **RDN review (one-time)** | Recommended pre-launch | — | Small fixed professional fee; large liability reduction. |

**Food-database options for v2 (research)**
- **USDA FoodData Central** — free, no usage limits, includes Branded Foods; weak on restaurant/international; no first-class barcode UX. Great zero-cost base layer. ([Spike roundup](https://www.spikeapi.com/blog/top-nutrition-apis-for-developers-2026))
- **Open Food Facts** — free/open, ~2.8M products, **barcode search**; crowd-sourced/variable quality. ([Spike roundup](https://www.spikeapi.com/blog/top-nutrition-apis-for-developers-2026))
- **Nutritionix** — large verified branded/restaurant DB, barcode + NL food parsing; commercial pricing (paid tiers, low-hundreds $/mo at scale). Best UX, highest cost.
- **Edamam** — restrictive free tier; pricing scales steeply. ([Spike roundup](https://www.spikeapi.com/blog/top-nutrition-apis-for-developers-2026))

**Recommendation:** if/when food logging ships, start with **USDA FoodData Central + Open Food Facts (both free)** behind our own `food-search` proxy; add Nutritionix only if branded/restaurant coverage becomes a retention blocker. Keeps MVP at ~$0 incremental third-party cost and defers all food-data spend to a validated-demand moment.

---

## 8. Domain / Training-Science Basis

All numeric targets in §5 trace to sports-nutrition literature, so the engine is defensible and citable in-product ("why this number"):

- **Daily carbohydrate periodization ("fuel for the work required"):** 3–12 g/kg/day scaled to load; 10–12 g/kg for 36–48 h before events >90 min. ([GSSI — Dietary Carbohydrate and the Endurance Athlete](https://www.gssiweb.org/sports-science-exchange/article/dietary-carbohydrate-and-the-endurance-athlete-contemporary-perspectives))
- **During-exercise carbohydrate:** 30–90 g/hr by duration/intensity; glucose:fructose to exceed ~60 g/hr and improve absorption/GI comfort; "train the gut" progression. ([GSSI multiple transportable carbs](https://www.gssiweb.org/sports-science-exchange/article/sse-108-multiple-transportable-carbohydrates-and-their-benefits))
- **Post-exercise refuel:** ≈ 1.0–1.2 g/kg/hr carb for ~4 h after depleting sessions; co-ingested protein for adaptation/recovery. ([GSSI carbs](https://www.gssiweb.org/sports-science-exchange/article/dietary-carbohydrate-and-the-endurance-athlete-contemporary-perspectives))
- **Protein:** endurance athletes need ≈ 1.4–2.0 g/kg/day, higher during hard training and energy restriction. ([Protein Nutrition for Endurance Athletes, Sports Med 2025](https://link.springer.com/article/10.1007/s40279-025-02203-8))
- **Sodium & hydration:** individualize to sweat losses; practical during-exercise sodium ≈ 300–700+ mg/hr (higher for salty sweaters / long hot events); personalize via sweat-rate testing rather than fixed doses. ([Sodium intake review, 2025](https://link.springer.com/article/10.1186/s44410-025-00011-9))
- **RMR estimation:** Mifflin–St Jeor as robust default; fat-free-mass equations (Katch–McArdle/Cunningham) preferable when body composition is known. ([RMR prediction in athletes, meta-analysis](https://pmc.ncbi.nlm.nih.gov/articles/PMC10687135/))
- **Product validation:** Hexis (Carb Codes, load-linked periodization) and Fuelin (nutrition embedded in the training calendar) confirm the model and the market. ([Hexis](https://endurance.biz/2023/industry-news/inside-the-brand-hexis-personalised-nutrition-platform/), [Fuelin](https://www.trainingpeaks.com/partners/fuelin/))

---

## 9. Risks & Open Questions

### Dietary-advice liability (highest priority)
- **Framing:** everything is **general wellness/performance information and personalized *estimates*, not medical nutrition therapy or individualized dietetic care.** MNT and therapeutic-diet prescription fall within **Registered Dietitian scope of practice** and are state-regulated ([CDR 2024 Scope & Standards](https://www.cdrnet.org/vault/2459/web/Scope%20Standards%20of%20Practice%202024%20RDN_FINAL.pdf); [ANA — regulations by profession](https://www.theana.org/nutrition-regulations-by-professions/)). Duravel is a training-and-fueling *guidance* tool.
- **Mitigations built into this spec:** versioned disclaimer gate (`disclaimer_version` + `disclaimer_ack_at`) before any guidance; "estimates, consult a professional/physician" copy; **no** clinical/therapeutic diets or medical-condition handling; **hard under-fueling guardrails** (energy floor ≥ RMR, deficit caps, no aggressive cuts in Peak/race weeks) to avoid enabling disordered patterns or RED-S; **under-18 accounts blocked**; no diagnostic language. **One-time RDN review** of the engine's default ranges + disclaimer copy before launch (small fixed cost, large risk reduction).
- **Terms/insurance:** update ToS to cover nutrition; confirm liability insurance covers fitness/nutrition guidance.

### Health-data privacy
Bodyweight, body-fat, and dietary data are health-adjacent sensitive data. Covered: RLS owner-only; `on delete cascade` from `auth.users` guarantees deletion on account removal; a **data-export** action in Settings. Confirm the privacy policy enumerates nutrition/weight data and its purpose.

### Product / engineering
- **Session-id prerequisite (blocker).** `session_fueling.session_id` must reuse a **stable engine session id**. If sessions are addressed positionally today, minting a durable id is a **Phase-A prerequisite**, else fueling desyncs on every adaptation.
- **TDEE accuracy vs. individual variation.** Estimated TDEE is ±10–20% person-to-person. Mitigate: frame as a starting estimate; (v2) adaptive correction from weight EMA + logged intake. *Open:* ship adaptive-energy in v2 or later?
- **Recompute triggers & cost.** Recomputing on every logged/synced workout could be chatty. Decision: **inline, bounded day-range recompute** on Apply and on ad-hoc logs; no fan-out. Revisit if volume grows.
- **Scope creep into food logging.** Food diaries are a deep, thankless build (DB quality, barcode UX, entry friction). Hard commitment to guidance-first; logging only after guidance retention is proven.
- **Wearable calorie conflicts.** Devices report their own burn; ours differs. Decision: **show ours only in v1, labeled as an estimate**; reconcile/blend later if warranted.
- **Multi-program.** "Active program" identified via the existing `programs` status/active flag; targets keyed by `program_id`; Today card resolves the active program then today's date in the user's timezone.
- **`noUncheckedIndexedAccess` / untyped Supabase.** Hand-written TS types + `as` casts; `next build` is the gate; vitest for pure engine logic.

### Open questions to resolve before build
1. Retain an RDN for a one-time engine/disclaimer review? (**Recommended.**)
2. Does the training engine already expose a stable session id, or must we mint one first? (**Blocker for §3.4.**)
3. Nutrition gets its own price bump or rides the current $19.99/$149 tier? (**Lean: included, for retention.**)
4. Under-fueling signals into the adaptation engine in v2 — how conservatively? (Medical-framing sensitive.)
5. Which food API(s) for v2, and at what coverage threshold do we pay for Nutritionix?

---

## 10. Effort Estimate + Phased Build Plan

**T-shirt sizing** (solo founder; `next build` gate; vitest for pure logic).

| Phase | Scope | Size |
|---|---|---|
| **Phase 0 — Session-id prerequisite** | Confirm/mint a stable, persisted training-session id (the identity `workout_logs`/wearable links already resolve). Blocks `session_fueling`. | **S** (or 0 if it already exists) |
| **Phase A — Foundations** | Migrations `0019–0023` + `0024` (meal-ideas cache); `nutrition_profiles` + onboarding form + versioned disclaimer gate + minor-gating; weight logging (manual-wins) with trend; sweat-test table; TS types. No engine yet. | **S–M** |
| **Phase B — Deterministic nutrition engine** | `lib/nutrition/engine/*`: RMR (Mifflin + Katch–McArdle), **corrected TDEE (NEAT + training, no double-count)**, carb/protein/fat periodization, energy-goal guardrails, per-session pre/during/post, hydration + sodium, race-week protocol, macro↔energy reconciliation. Full vitest + golden/snapshot tests. `generateNutritionTargets` action (gated, replace-set + orphan cleanup). | **L** |
| **Phase C — Surfacing + AI meal ideas** | Nutrition tab, Today card with "why" (timezone-correct), session-card fueling strip, week view, race-week mode; Haiku meal ideas (Zod-validated, guardrailed, cached, rate-limited); sweat-rate test flow. | **M** |
| **Phase D — Reconciliation** | Hook bounded-range target recompute into the existing weekly Apply path (and ad-hoc logs) so fueling tracks *actual* logged/synced load (`computed_from='actual'`). | **S** |
| **Phase E (v2, later) — Food logging** | `0025_nutrition_logs`, `food-search` proxy over USDA + Open Food Facts, add-meal UX, adherence views. | **L** |
| **Phase F (v2+, later) — Adaptive energy + adaptation feedback** | Weight-EMA/intake-based TDEE correction; optional low-energy-availability signal into the adaptation engine (medical-framing gated). | **M–L** |

**Recommended sequencing:** 0 → A → B → C → D ships the complete guidance-first MVP (≈ S + S/M + L + M + S of net-new work), fully behind `BILLING_ENABLED`, with **zero incremental third-party cost** and **no training-engine changes**. Validate retention/willingness-to-pay before committing to the L-sized food-logging build (E) and the adaptive layer (F).

**Definition of done for MVP (Phases 0–D):** an authenticated, entitled, adult user completes a nutrition profile, acknowledges the current-version disclaimer, and sees load-periodized daily targets (energy computed without double-counting training) + per-session and race-week fueling for their active program — updating within a bounded day-range when they log or sync a workout, resolving "today" in their timezone — all reproducible from stored inputs + stamped `engine_version`, all pure logic unit-tested with golden snapshots, `next build` green.

---

### Sources
- [GSSI — Dietary Carbohydrate and the Endurance Athlete](https://www.gssiweb.org/sports-science-exchange/article/dietary-carbohydrate-and-the-endurance-athlete-contemporary-perspectives)
- [GSSI — Multiple Transportable Carbohydrates](https://www.gssiweb.org/sports-science-exchange/article/sse-108-multiple-transportable-carbohydrates-and-their-benefits)
- [Sodium intake for athletes: review and recommendations (2025)](https://link.springer.com/article/10.1186/s44410-025-00011-9)
- [Protein Nutrition for Endurance Athletes (Sports Med, 2025)](https://link.springer.com/article/10.1007/s40279-025-02203-8)
- [RMR prediction equations in athletes — systematic review/meta-analysis (PMC)](https://pmc.ncbi.nlm.nih.gov/articles/PMC10687135/)
- [Hexis — inside the brand (endurance.biz)](https://endurance.biz/2023/industry-news/inside-the-brand-hexis-personalised-nutrition-platform/)
- [Fuelin × TrainingPeaks integration](https://www.trainingpeaks.com/partners/fuelin/) · [endurance.biz](https://endurance.biz/2024/industry-news/fuelin-integrates-nutrition-information-directly-into-trainingpeaks-coaching-platform/)
- [Top Nutrition APIs for Developers 2026 (Spike)](https://www.spikeapi.com/blog/top-nutrition-apis-for-developers-2026)
- [CDR 2024 Scope & Standards of Practice for the RDN](https://www.cdrnet.org/vault/2459/web/Scope%20Standards%20of%20Practice%202024%20RDN_FINAL.pdf) · [ANA — Nutrition Regulations by Profession](https://www.theana.org/nutrition-regulations-by-professions/)
