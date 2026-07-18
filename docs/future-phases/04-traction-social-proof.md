# Duravel — Traction, Reviews & Social Proof
### Implementation-Ready Design & Build Spec
**Author:** Product + Engineering (prep phase) · **Date:** 2026-07-15 · **Status:** Final — ready for phased build · **Owner:** Levi (solo founder)

> **Scope note.** This is a *future-phase* spec: it defines the design, schema, and build plan so the work can start cleanly when prioritized. It is grounded in the current stack (Next.js 16 App Router, React 19, TypeScript strict, Supabase + RLS, Anthropic Haiku, Vercel, Stripe web billing live). Nothing here changes the deterministic engine or the Haiku generation pipeline; the feature *reads* their outputs.

---

## 0. What changed from the prep draft (corrections folded in)

The prep draft was directionally right but had concrete defects that would have failed `next build` or broken at migration time. This final resolves them:

1. **Migration order was invalid.** `testimonials` (draft 0019) declared an FK to `race_results` (draft 0021) — a forward reference Postgres rejects. **Fixed:** `race_results` now ships **first** (0019), then `testimonials` (0020). Full renumbered set in §3.
2. **Migration count vs. appendix mismatch** (body said 0019–0022; appendix listed a 0023). **Fixed:** canonical set is **0019–0024** (six migrations), enumerated once in §3.
3. **`SECURITY DEFINER` view details were hand-wavy.** Added the exact ownership/grant/`security_invoker` semantics needed for the anon read path to actually bypass row-owner RLS safely (§3.6).
4. **Aggregate "min-N gate" had no mechanism.** Implemented as a `HAVING count(*) >= :min_n` view so it returns zero rows below threshold — no client trust required (§3.6).
5. **Missing operational columns/edge cases** added: post-approval **re-moderation on edit**, **rate limiting**, **consent artifact reference** for manual imports, **indexes**, **`updated_at` trigger**, **audit column `body_original`**, admin-notification, and a decision on **race double-counting in ACWR** (§3, §4, §5).
6. **Haiku cost line corrected.** Draft used $0.25/$1.25 per MTok (Haiku 3 era). Current Haiku pricing is higher; recomputed and still **well under $1/mo** at this scale (§7).
7. **Effort realism.** Admin queue + FTC disclosure rendering + ISR/on-demand revalidation + definer-view wiring against an **untyped** Supabase client is more than the draft's optimistic "S" items imply. Re-sized in §10 with the risk called out.
8. **Admin gating decision made** (env allowlist now, `profiles.is_admin` later) so Phase A isn't blocked on an open question (§4.2, §11).

---

## 1. Goal & Why-Now

### Goal
Build a **first-party** system to **collect, moderate, store, and display** credible social proof — star/text testimonials, **engine-verified athlete results** (PRs, race finishes, adherence), and opt-in shared stats — across the marketing surface (landing, pricing, a public `/proof` page) and inside the product (post-result and post-race prompts). It must:

- produce **trustworthy** proof for a brand-new, low-user solo product;
- be **legally defensible** under the 2024 FTC Reviews & Testimonials Rule from day one;
- cost **~$0** at current scale;
- pass the real gate: **`next build`** green, pure logic **vitest**-covered.

### Why now
- **Billing is live** ($19.99/mo, $149/yr, 14-day no-card trial via `profiles.trial_started_at`). The **trial→paid** moment is exactly where proof moves revenue. Conversion-page proof is now directly revenue-linked, not vanity.
- **Structural proof advantage.** Duravel already logs *actual performance vs. plan* (`workout_logs`), adaptation signals (`adaptations`, `readiness_checkins`), and PRs derivable from the engine. Testimonials can be **verified, quantified, and auto-suggested from real data** ("You cut 4:12 off your projected HYROX time — share it?"). Competitors bolting on Senja/Trustpilot cannot consume engine data; this is hard to fake and hard to copy.
- **Cold-start is the actual problem.** Few users → no proof → suppressed conversions → few users. Breaking that loop is a first-order growth task, not polish (§9).
- **Cheap to seed now, expensive later.** Every early race logged is a proof asset. Capturing consent + testimonial *at the emotional moment of the result* only works if the plumbing exists first.
- **Regulatory clock.** The FTC Rule (effective Oct 2024, enforcement ramping; civil penalties adjusted annually into the ~$50k/violation range) makes fake/insider/gated reviews a real liability. Compliant-by-schema is far cheaper than a retrofit.

### Non-goals (this phase)
- Public many-to-many review feed / community wall with replies.
- Third-party review **syndication** (Google/Trustpilot rich stars) — deferred (§7).
- Referral/affiliate mechanics — adjacent, separate spec (hooks noted in §2 Later).
- Video/photo testimonials — Phase C (needs Supabase Storage + image moderation).

---

## 2. User-Facing Scope

### MVP (Phase A + B)
1. **Post-result testimonial prompt.** When the engine flags a freshly logged workout as a **PR**, a **race result**, or a **program completion** (or a milestone streak), an in-app card invites a short rating + written testimonial and an explicit opt-in to display.
2. **Verified-result attach.** The testimonial can carry a **verified stat** derived from the user's own data (e.g., "HYROX Simulation 1:07:44, −4:12 vs. plan"), user-toggled on/off. Verification is a **server-side fact**, never user-typed.
3. **Consent & attribution control.** User picks display-name form (full / first + last initial / initials / anonymous), optional city/region, and toggles whether each verified stat shows — with a **live preview** of the published card.
4. **Lightweight moderation queue.** Every submission lands `pending`. A one-screen founder admin approves / rejects / edits-for-typos (never edits substance; original retained), sets `featured`/rank, and assigns display surfaces.
5. **Display surfaces:**
   - Landing "Wall of Proof" strip (approved, featured-first) → "See all".
   - Pricing page inline proof adjacent to the trial CTA (2–3 highest-trust, prefer verified-stat).
   - Public `/proof` page (all approved, filterable by sport — HYROX now).
6. **Aggregate rating widget** ("4.8 · 23 athletes") — shown **only** once a configurable **min-N** (default **8**) is met, to avoid "5.0 from 1 review".
7. **FTC-compliant disclosures** rendered automatically: incentive disclosure when applicable, insider ("Duravel team/friend") tag when applicable, and a **"results not typical"** line **proximate** to any quantified claim.

### Later (Phase C+)
- **Email review requests** (post-race, post-program) via the existing Phase-3 lifecycle-email track once `resend` imports resolve.
- **Video/photo testimonials** (finish-line/medal shots) in Supabase Storage + image moderation.
- **App-store ratings deep-link** once native mobile ships (blocked on LLC → Apple Developer registration).
- **Coach/affiliate & B2B proof** case-study objects (ties to the untracked engine-licensing / white-label docs).
- **Third-party syndication** (Google Business, Trustpilot) + schema.org `Review`/`AggregateRating` rich snippets.
- **Referral loop**: sharing a verified result mints a trackable invite link.
- **Sport-tagged walls** once triathlon/Ironman launches (reuse `event_type`).

---

## 3. Data Model / Schema Changes

New migrations continue from **0019**. The Supabase client is **untyped** → queries cast `as`; centralize row types in `lib/proof/types.ts` to contain drift. **RLS on every new table.** FKs follow the `auth.users` convention (per 0018). All tables get an `updated_at` where mutable, maintained by a shared trigger.

**Canonical migration set (order matters — no forward FKs):**

| # | File | Creates |
|---|---|---|
| 0019 | `0019_race_results.sql` | `race_results` (referenced by testimonials) |
| 0020 | `0020_testimonials.sql` | `testimonials` (core) + `updated_at` trigger |
| 0021 | `0021_testimonial_stats.sql` | `testimonial_stats` (verified facts) |
| 0022 | `0022_testimonial_prompts.sql` | `testimonial_prompts` (dedupe/suppression) |
| 0023 | `0023_consent_versions.sql` | `consent_versions` (compliance audit) |
| 0024 | `0024_public_views_and_rls.sql` | `SECURITY DEFINER` views + all RLS policies + grants + indexes |

> RLS policies and grants are consolidated into 0024 so the read/write surface is reviewed in one place; table-creation migrations enable RLS (`alter table … enable row level security`) but the *policies* live in 0024. (Enabling RLS with no policy = deny-all, which is the safe intermediate state.)

### 3.1 — 0019 `race_results`
First-class race object (the app logs workouts but has no race entity; races are the strongest proof). A linked race also feeds adaptation via the existing `workout_logs` path — see the **double-count guard** in §5.

```
race_results
  id                   uuid pk default gen_random_uuid()
  user_id              uuid not null references auth.users(id) on delete cascade
  event_type           text not null default 'hyrox'      -- future: 'triathlon','ironman','marathon','running'
  event_name           text null
  event_date           date null
  division             text null                           -- 'open','pro','doubles','relay'
  finish_time_sec      integer null check (finish_time_sec is null or finish_time_sec > 0)
  placing              integer null
  field_size           integer null
  is_pr                boolean not null default false
  verified_source      text not null default 'self_reported'
                         check (verified_source in ('self_reported','strava_linked','manual_admin'))
  workout_log_id       uuid null references workout_logs(id) on delete set null
  wearable_activity_id uuid null references wearable_activities(id) on delete set null
  created_at           timestamptz not null default now()
  updated_at           timestamptz not null default now()
```
Indexes: `(user_id, event_date desc)`, `(workout_log_id)`.

### 3.2 — 0020 `testimonials` (core)
```
testimonials
  id                 uuid pk default gen_random_uuid()
  user_id            uuid null references auth.users(id) on delete set null
                       -- nullable so proof survives account deletion (anonymized); see §11 Q1
  source             text not null default 'in_app'
                       check (source in ('in_app','email','manual_import','beta_interview'))
  rating             smallint null check (rating between 1 and 5)
  body               text null check (body is null or char_length(body) <= 1500)
  body_original      text null            -- immutable snapshot of user's words (FTC authenticity); set on first admin copy-edit
  headline           text null check (headline is null or char_length(headline) <= 120)
  -- attribution / consent
  display_name       text null            -- PRE-RENDERED per display_name_style at submit time; no raw PII in public path
  display_name_style text not null default 'first_last_initial'
                       check (display_name_style in ('full','first_last_initial','initials','anonymous'))
  display_location   text null            -- optional "Austin, TX"
  -- lifecycle
  status             text not null default 'pending'
                       check (status in ('pending','approved','rejected','archived'))
  featured           boolean not null default false
  featured_rank      smallint null        -- ordering for featured slots; null = unranked
  surfaces           text[] not null default '{}'   -- subset of {landing,pricing,proof}
  -- provenance / compliance
  incentivized       boolean not null default false
  incentive_note     text null            -- what was offered, if anything (audit; internal)
  consent_version_id uuid null references consent_versions(id)
  consent_at         timestamptz null
  consent_artifact   text null            -- for manual_import: pointer to stored written consent (URL/ref)
  is_insider         boolean not null default false   -- founder/friends/family (FTC insider disclosure)
  moderation_note    text null            -- internal only (rejection audit trail)
  moderated_by       uuid null references auth.users(id)
  moderated_at       timestamptz null
  -- linkage to proof
  program_id         uuid null references programs(id) on delete set null
  race_result_id     uuid null references race_results(id) on delete set null
  created_at         timestamptz not null default now()
  updated_at         timestamptz not null default now()
```
Indexes: `(status, featured, featured_rank)` (display query), `gin (surfaces)` (surface filter), `(user_id)`, partial `where status='approved'`.
Trigger: `set_updated_at` before update.
**Re-moderation rule (enforced in server actions, §4):** any owner edit to `body`/`headline`/`rating`/attribution on an *approved* row resets `status='approved' → 'pending'` and clears surfaces until re-approved.

### 3.3 — 0021 `testimonial_stats` (verified, engine-sourced facts)
Separate table so a testimonial carries 0..N machine-verified stats, each independently toggleable and re-verifiable. Values are **written server-side from engine/log data**, never accepted from the client.
```
testimonial_stats
  id             uuid pk default gen_random_uuid()
  testimonial_id uuid not null references testimonials(id) on delete cascade
  stat_key       text not null
                   check (stat_key in ('hyrox_sim_time','pr_delta_sec','program_adherence_pct',
                                       'threshold_pace_improvement','race_finish_time','weeks_trained'))
  label          text not null      -- human string rendered at verify time, e.g. '−4:12 vs. plan'
  numeric_value  numeric null       -- machine value for sorting/aggregation
  unit           text null          -- 'sec','pct','min_per_km'
  source_table   text not null      -- 'workout_logs'|'race_results'|'programs'|'adaptations' (provenance; polymorphic, no FK)
  source_row_id  uuid null          -- provenance pointer (validated in code, not by FK)
  verified_at    timestamptz not null default now()   -- SNAPSHOT time; the published number is frozen here
  visible        boolean not null default true
```
Index: `(testimonial_id, visible)`. Note: `stat_key` is constrained to the whitelist so a typo can't smuggle an unverifiable claim onto a card.

### 3.4 — 0022 `testimonial_prompts` (dedupe / suppression)
Prevents nagging; records which proof-eligible events already prompted and the outcome.
```
testimonial_prompts
  id               uuid pk default gen_random_uuid()
  user_id          uuid not null references auth.users(id) on delete cascade
  trigger_type     text not null
                     check (trigger_type in ('pr','race','program_complete','milestone_streak'))
  trigger_ref_id   uuid null        -- workout_log / race_result / program id
  status           text not null default 'shown'
                     check (status in ('shown','dismissed','snoozed','submitted','suppressed'))
  shown_at         timestamptz not null default now()
  next_eligible_at timestamptz null
  unique (user_id, trigger_type, trigger_ref_id)
```
`suppressed` = "don't ask again for this trigger_type" (enforced by a `trigger_ref_id is null` sentinel row per type, or a check against any `suppressed` row of that type for the user).

### 3.5 — 0023 `consent_versions` (compliance audit)
Resolves the draft's open question by making consent legally reconstructable without git archaeology.
```
consent_versions
  id           uuid pk default gen_random_uuid()
  version      text not null unique          -- e.g. 'proof-consent-v1'
  body         text not null                 -- full plain-language consent copy shown to the user
  effective_at timestamptz not null default now()
  retired_at   timestamptz null
```
`testimonials.consent_version_id` FKs here. Seed `proof-consent-v1` in the migration.

### 3.6 — 0024 Public read path + RLS + grants

**Public views (marketing surfaces read these via the anon key — no auth, no PII).**

- `public_testimonials` — **`SECURITY DEFINER`** (i.e. created with default `security_invoker = false`), owned by a privileged role (the migration runs as the Supabase owner), returning **only** `status='approved'` rows with **whitelisted display columns** (`id, headline, body, rating, display_name, display_location, is_insider, incentivized, featured, featured_rank, surfaces, event_type_tag, created_at`). It **omits** `user_id`, `moderation_note`, `incentive_note`, `body_original`, `consent_*`. Because the view runs with the owner's rights, it bypasses the deny-by-default RLS on the base table *for exactly the approved, whitelisted projection* — this is the intended, tight escape hatch. Grant `select` to `anon, authenticated`.
- `public_testimonial_stats` — join view exposing `testimonial_id, stat_key, label, unit, numeric_value` for `visible=true` stats of approved testimonials. Grant `select` to `anon, authenticated`.
- `public_testimonial_aggregate` — `select count(*)::int as n, round(avg(rating),1) as avg_rating from testimonials where status='approved' and rating is not null having count(*) >= 8`. **Returns zero rows below the threshold**, so the badge is structurally impossible to render early. (Make `8` a single literal, or a `settings` row, so it's tunable — see §11 Q6.)

> **Wiring caveats to honor at build time:** (a) views must live in the `public` schema so PostgREST/`supabase-js` can select them via the anon key; (b) confirm `security_invoker` is **not** set to true on these views (Postgres 15+ default is false = definer-style, which is what we want here); (c) grant `select` explicitly — enabling RLS on base tables does not auto-expose the view.

**RLS policies (base tables):**

- **`testimonials`**
  - `SELECT`: owner may read own rows (`user_id = auth.uid()`). Public reads go **only** through `public_testimonials` (definer view) — no anon `SELECT` grant on the base table.
  - `INSERT`: `authenticated` where `user_id = auth.uid()`; a `BEFORE INSERT` trigger (or column defaults + a `WITH CHECK`) forces `status='pending'`, `featured=false`, `surfaces='{}'`, and ignores any client-supplied moderation fields.
  - `UPDATE` by owner: **only** to (a) withdraw consent → `status='archived'`, or (b) edit their own `body/headline/rating/attribution` (which the server action re-sets to `pending`). `WITH CHECK` forbids owner-setting `featured`, `surfaces`, `status='approved'`, or moderation columns.
  - Moderation writes (`status`, `featured`, `featured_rank`, `surfaces`, `moderated_by/at`, copy edits) → **service-role admin client only** (no anon/auth policy grants them).
- **`testimonial_stats`**: **no** client `INSERT/UPDATE/DELETE` (service-role only — facts must be server-verified). No base-table public read; exposed via `public_testimonial_stats`.
- **`race_results`**: owner CRUD on own rows; `verified_source` may transition to `strava_linked`/`manual_admin` **server-side only** (`WITH CHECK` pins owner writes to `self_reported`).
- **`testimonial_prompts`**: owner `SELECT/INSERT/UPDATE` own rows.
- **`consent_versions`**: `SELECT` to `authenticated` (so the submission UI can show current copy); writes service-role only.

---

## 4. API / Route + Server-Action Changes

Next.js 16 App Router. **Server actions** for authed mutations; **route handlers** only where an external URL is required. Public reads go through **server components** hitting the definer views.

### 4.1 Server actions — `lib/testimonials/actions.ts`
- `submitTestimonial(input)` — authed. **Zod-validates** rating/body/headline/attribution/consent. Forces `status='pending'`, `source='in_app'`; stamps `consent_version_id`/`consent_at`. **Renders `display_name` server-side** from `display_name_style` (never trusts a client-supplied display string). If the user opted to attach stats, calls `attachVerifiedStats()` — does **not** trust client stat values. Marks the matching `testimonial_prompts` row `submitted`. **Rate-limited** (e.g. ≤3 submissions / user / 24h) to blunt spam. On edit of an already-`approved` row, re-sets `pending` and clears surfaces (§3.2).
- `attachVerifiedStats(testimonialId, statKeys[])` — **server-only, service-role.** Re-derives each requested stat from `workout_logs`/`race_results`/`programs`/`adaptations` **at submit time** via `lib/proof/deriveStats`, writes `testimonial_stats` with `numeric_value`, `label`, `source_table`, `source_row_id`, `verified_at`. Never accepts numbers from the client. If a stat can't be re-derived (data changed/removed), it is silently omitted, not guessed.
- `withdrawTestimonial(id)` — owner-only; `status='archived'`, removed from all surfaces; triggers `revalidatePath` for public pages. Honors FTC/GDPR takedown.
- `dismissPrompt(promptId, action)` — `dismissed | snoozed | suppressed`; `snoozed` sets `next_eligible_at` (default +30d); `suppressed` blocks that trigger type.
- `recordRaceResult(input)` — creates a `race_results` row; if a `wearable_activity_id`/`workout_log_id` is supplied, sets `verified_source='strava_linked'`. **Does not** itself write load into ACWR (see §5 guard).

### 4.2 Admin actions — `lib/testimonials/admin.actions.ts` (service-role)
Gated by an **`isAdmin()`** check — **not** `BILLING_ENABLED`. **Decision:** ship Phase A with an **env allowlist** of `auth.uid()`s (`ADMIN_USER_IDS`) to avoid a schema dependency; add `profiles.is_admin boolean not null default false` later if a second admin is ever needed (§11 Q2).
- `moderateTestimonial(id, {status, moderation_note})` — always writes `moderation_note` on reject (audit trail; FTC no-suppression defensibility). Stamps `moderated_by/at`.
- `setFeatured(id, {featured, featured_rank, surfaces})`.
- `editDisplayCopy(id, {headline, body})` — typo/length only. **On first edit, snapshots the current `body` into `body_original`** (immutable) to preserve authentic-wording defensibility; substance edits are policy-forbidden.
- `importManualTestimonial(input)` — `source in ('manual_import','beta_interview')`; **requires `consent_artifact`** (pointer to stored written consent).
- All admin actions that change visibility call `revalidatePath('/','/pricing','/proof')` so approvals surface without a redeploy.
- **Founder notification** (Phase B, cheap): new `pending` submission → a lightweight ping (email via Resend in Phase C, or a Slack/Discord webhook now if one exists) so the queue isn't polled blindly.

### 4.3 Route handlers
- `POST /api/testimonials/prompt-eligible` — internal; called from the post-log flow to check/insert a `testimonial_prompts` row (dedupe on the unique key). *May be a server action instead*; use a route handler only if the logging path already is one.
- `GET /api/proof/aggregate` — optional cached JSON for client badges (ISR `revalidate ≈ 3600`); otherwise render server-side from `public_testimonial_aggregate`.
- **Later (Phase C):** `GET /r/[token]` email review-request landing — deferred with `resend`.

### 4.4 Reads (server components)
Landing / pricing / `/proof` read `public_testimonials` + `public_testimonial_stats` + `public_testimonial_aggregate` at ISR time: `export const revalidate = 3600`. **No PII** in the payload. Moderation/withdrawal triggers **on-demand `revalidatePath`** so proof changes appear without a redeploy.

### 4.5 Interaction with `BILLING_ENABLED`
Testimonial **collection, display, and moderation are NOT gated** by `BILLING_ENABLED` — proof must render to logged-out/trial visitors to drive conversion. Only nuance: **verified-stat attach** requires the user to have generated a program (a trial/paid feature). Trial users can produce full proof; a hypothetical free-forever non-generator can still leave a **text/star** testimonial but has no engine stats to attach.

---

## 5. Engine / AI Implications

The deterministic engine (`lib/engine/*`) and Haiku pipeline (`lib/generation/*`) need **no structural change**. New code lives in `lib/proof/*` and only *reads* engine/log outputs.

### 5.1 Engine (read-only signal extraction) — new `lib/proof/*`
- **`detectProofEvent(log, program, history)`** — pure, deterministic, **vitest-covered** classifier returning `pr | race | program_complete | milestone_streak | none`. Reuses existing PR logic, adaptation signals, and volume reconciliation. No AI. This is the prompt trigger.
- **`deriveStats(userId, event)`** — pure functions computing whitelisted `stat_key`s from `workout_logs`/`programs`/`adaptations`/`race_results`:
  - `pr_delta_sec` — actual vs. engine-projected time for the session/station.
  - `program_adherence_pct` — logged vs. planned volume (engine already reconciles mileage/cardio).
  - `threshold_pace_improvement` — change in formula-based threshold pace across mesocycles.
  - `weeks_trained`, `race_finish_time`, `hyrox_sim_time`.
  These are **facts** → the FTC-safe part of any quantified claim. Heavily unit-tested (a wrong "verified" number is worse than none).
- **ACWR double-count guard (resolves draft open-Q5).** A race is stored in `race_results` as *metadata*; the training **load** for ACWR/monotony lives in the single linked `workout_log` row. `recordRaceResult` must **not** insert a second load-bearing log. Rule: **one race = at most one `workout_log`**; `race_results` references it, never duplicates it. Add a vitest asserting a linked race contributes load exactly once.

### 5.2 AI (Haiku) — optional, tightly bounded, human-in-the-loop
- **Never** let Haiku author or embellish a published testimonial (fake-review / AI-authored-testimonial risk under the FTC Rule). The athlete's words stay the athlete's words (`body_original` preserves them).
- **Permitted, Zod-validated, advisory-only uses:**
  1. **Moderation triage assist** — Haiku classifies a pending submission for profanity / PII / medical claims / off-topic and returns a **structured flag + reason**. Founder still decides. Short prompt, sub-cent.
  2. **Prompt micro-copy suggestion** — turns a **verified** stat into a neutral suggested headline the user can accept/edit/discard ("Cut 4:12 off my HYROX sim in 8 weeks"). Guards: the number must come from `testimonial_stats`; the copy is user-editable and **must be affirmatively kept** by the user; it is clearly theirs to endorse; it is never auto-published.
- Consistent with the house rule: **deterministic engine owns the numbers; Haiku only touches language**, and here Haiku's language is advisory.

---

## 6. UX Outline

### In-app collection
- **Trigger card** (post-log confirmation): shows only when `detectProofEvent ≠ none` **and** no unexpired/suppressed prompt exists for that trigger. Leads with the earned result: *"You just PR'd your HYROX sim — 1:07:44, 4:12 under plan. Share it?"* Buttons: **Share my result** / **Not now** (snooze 30d) / **Don't ask again** (suppress this trigger type).
- **Submission sheet** (single screen):
  1. Star rating (1–5, optional but encouraged).
  2. Headline + body; AI-suggested headline pre-filled, clearly editable/removable.
  3. Verified-stat chips (toggle each) — shows exactly what data would publish.
  4. Attribution: name-style radio (Full / First + Last initial / Initials / Anonymous) with a **live preview** of the exact rendered card; optional city.
  5. Consent block: explicit checkbox, plain-language current `consent_versions` copy ("Duravel may display this publicly; withdraw anytime"), records `consent_version_id`. If an incentive applies, a **mandatory incentive-disclosure** line.
  6. Submit → "Thanks — pending review."
- **Manage my testimonials** (account settings → `app/(app)/settings/testimonials`): own submissions with status; **withdraw** button; editing re-queues for review.

### Admin moderation (one screen, founder-only, `app/(admin)/proof-queue`)
- Queue table, **pending first**: body (+ `body_original` if edited), stats with provenance, `is_insider`/`incentivized` badges, AI-triage flags. Row actions: **Approve / Reject(+note) / Edit-copy / Feature / Assign surfaces**. Bulk-approve for trusted sources. **Keyboard-fast** — solo-founder throughput matters.

### Display
- **Wall of Proof (`/proof`)**: card grid; verified-stat cards visually distinct ("Verified result" badge). Sport filter tabs (HYROX now). Footer disclaimer: *"Individual results. Outcomes depend on training history, consistency, and other factors and are not typical."*
- **Pricing**: 2–3 highest-trust cards (prefer verified-stat + full name) adjacent to the trial CTA; aggregate badge only above min-N.
- **Landing**: hero-adjacent aggregate badge + 3–6 card strip → "See all" → `/proof`.
- **Every quantified claim renders the "not typical" disclaimer proximate** (same visual block), not buried, per FTC.

---

## 7. Third-Party Services + Rough Costs

**Recommendation: build first-party for MVP.** Duravel's proof is data-verified and native; a generic testimonial SaaS can't consume `workout_logs`/engine stats, and piping PII to a third party adds a data-processor/GDPR surface for zero MVP benefit. Reassess a paid tool only when *manual* collection (video, external reviews) exceeds one-screen throughput.

| Option | Role | Cost | Verdict |
|---|---|---|---|
| **First-party (Supabase + this schema)** | Collection, storage, moderation, display | $0 incremental (existing Postgres) | **MVP choice** |
| **Supabase Storage** | Later: video/photo hosting | ~$0.021/GB + egress; negligible at low volume | Phase C |
| **Anthropic Haiku** | Moderation triage + headline suggestion | Current Haiku ≈ **$0.80/$4.00 per M in/out tokens**; each submission is a few hundred tokens → **sub-cent/submission → < $1/mo** at this scale | MVP (optional) |
| **Senja** | If outsourcing collection | Free ~15 testimonials; **~$29/mo** Starter; ~$59/mo Pro | Skip for MVP; possible fallback |
| **Testimonial.to** | Alt collection/video | Free tier limited; paid ~$20–$60/mo | Skip |
| **Trustpilot** | Third-party credibility + Google stars | Free basic; paid plans ~$250+/mo | **Defer** post-traction; overkill for a solo product |
| **Resend** (drafted in `_phase3_draft`) | Email review requests | Free ~3k emails/mo; ~$20/mo for 50k | Phase C (resolve `resend` imports first) |
| **schema.org Review/AggregateRating** | SEO rich snippets | $0 (markup) | Phase C; Google requires first-party genuine reviews and limits self-serving snippets |

**Net MVP incremental cost: effectively $0–$1/mo.** (Pricing figures approximate; verify current vendor pages at build time.)

---

## 8. Domain / Training-Science & Compliance Basis

### Why verified endurance stats are strong proof
- Endurance outcomes are **objective and continuous**: finish times, threshold pace, HR zones, ACWR/monotony, adherence. A −4:12 HYROX-sim delta is checkable in a way "I feel great" is not. Grounding testimonials in the engine's own reconciled numbers turns copy into **evidence** — more persuasive *and* more FTC-defensible.
- **Time the ask to the result.** Willingness to advocate peaks right after a salient achievement (PR, race finish) — the same window athletes post to social. The post-log prompt captures proof at max authenticity and volume.
- **Adherence + progression = the honest story.** Because the deterministic engine reconciles planned vs. actual and periodizes Base/Build/Peak/Taper, the app attributes results to **consistency over a mesocycle**, not a magic-bullet claim — aligning marketing with training science and avoiding "transformation in X days" territory the FTC scrutinizes.

### FTC 2024 Reviews & Testimonials Rule — binding design constraints
The final rule (effective Oct 2024; civil penalties adjusted annually into the ~$50k/violation range) shapes this schema and flow:
1. **No fake/AI-authored testimonials.** → Haiku never authors published copy (only advisory, user-endorsed language); `source` and `is_insider` tracked; `body_original` preserved.
2. **Insider reviews must disclose the relationship.** → `is_insider` flag → render a "Duravel team/friend" disclosure. Critical during cold-start (§9), when early proof comes from your network.
3. **No incentivizing *positive* sentiment; incentives must be disclosed.** → `incentivized` + `incentive_note`; you may offer (e.g.) a free month for *an honest review of any sentiment*, never "for 5 stars." UI renders an incentive disclosure when set.
4. **No review gating / suppression of negatives.** → The prompt fires on proof *events* (PRs/races), not a "was your experience good?" pre-filter; the moderation queue may reject spam/PII/off-topic but **must not** reject truthful negative feedback to game the aggregate. `moderation_note` logged on every rejection (audit).
5. **"Results not typical" proximate disclosure** on any quantified outcome (endurance-specific: depends on training age, consistency, injury history). A design requirement, not an optional footer.

### Attribution/privacy
Graduated identity (full → initials → anonymous) raises submission rate while respecting that some athletes won't attach a real name to fitness data — and keeps PII out of the public read path via **pre-rendered `display_name`** + the whitelisted definer view.

---

## 9. Cold-Start Plan: Bootstrapping the FIRST Proof

The hardest part for a new solo product. Concrete, compliant sequence:

1. **Founder-run beta cohort (weeks 0–6).** Recruit 10–20 endurance/HYROX athletes (local gym, HYROX community, r/hyrox, Strava clubs) into a free extended trial *in exchange for honest feedback* (not positive reviews — FTC). Log their programs/results. `source='beta_interview'`.
2. **Harvest verified early wins.** As the engine records first PRs/races/adherence, the post-result prompt captures testimonials **with verified stats** — the strongest first proof and self-differentiating. 5–8 verified-stat cards beat 50 generic ones.
3. **Founder & network testimonials — labeled.** Your own Duravel training and early supporters' quotes are legitimate **if disclosed** (`is_insider=true` → "Duravel team" tag). Use sparingly and honestly to seed the wall.
4. **Manual imports with consent.** DM/interview quotes and screenshots → `importManualTestimonial` with a stored `consent_artifact`. Convert enthusiastic beta Slack/Discord messages (with permission) into cards.
5. **Proof-of-mechanism, not proof-of-crowd.** Until N is high, lead marketing with **the verified-result mechanic** ("Duravel tracks plan vs. reality — here's a real athlete's −4:12") and concrete engine capabilities, not a thin "4.9 from 3 reviews." Keep the aggregate badge hidden until `min_n` (default 8).
6. **Race-day capture loop.** HYROX events cluster results in time. Pre-arm users before known race dates so the post-race prompt fires while adrenaline is high; a finish-line result is the most shareable proof and doubles as adaptation data.
7. **Incentivize honestly.** Offer beta users a free month for *a review of any sentiment*, disclosed as incentivized — rule-compliant and volume-starting.
8. **Sequence to conversion.** Route the first ~10 approved, highest-trust items to the **pricing page** (nearest revenue) before decorating the landing page.

**Exit criteria for cold-start:** ≥8 approved testimonials (≥3 with verified stats, ≥1 race result), aggregate badge live, ≥2 on pricing — target within **6–8 weeks** of the beta cohort.

---

## 10. Effort Estimate & Phased Build Plan

Sizing (solo): **S** ≤2 days · **M** 3–5 days · **L** 1–2+ weeks. Gate = `next build` green; `lib/proof/*` vitest-covered.

> **Realism note.** RLS + `SECURITY DEFINER` views against an **untyped** Supabase client (hand-written row types, `as` casts, easy to get grants/`security_invoker` subtly wrong) is the highest-friction part. Budget debugging time there, not in the UI.

### Phase A — Schema + capture core (**M–L**)
- Migrations **0019–0024** (race_results, testimonials, stats, prompts, consent_versions, views+RLS+grants+indexes). (**M** — the RLS/definer-view wiring is the cost)
- `lib/proof/detectProofEvent` + `deriveStats` + `types.ts`, with vitest incl. the ACWR double-count guard. (**M**)
- `submitTestimonial`, `attachVerifiedStats`, `withdrawTestimonial`, `dismissPrompt`, `recordRaceResult` + Zod schemas + rate limit. (**M**)
- In-app trigger card + submission sheet (live preview, stat chips, consent). (**M**)
**Exit:** an authed user submits a verified-stat testimonial; it lands `pending`.

### Phase B — Moderation + display (**M**)
- Founder admin queue (service-role, env-allowlist gate) — approve/reject(+note)/feature/surfaces/edit-copy(+`body_original` snapshot). (**M**)
- Public `/proof` page, landing strip, pricing cards, aggregate badge with min-N gate. (**M**)
- FTC disclosure rendering (insider / incentive / "not typical" proximate); ISR + on-demand `revalidatePath` on approve/withdraw; founder new-submission ping. (**S–M**)
- Optional Haiku moderation-triage + headline suggestion (Zod-validated, advisory). (**S–M**)
**Exit:** approved proof renders on marketing surfaces; MVP shippable. **A+B ≈ 10–15 working days** (up from the draft's 8–12, reflecting RLS/definer-view + disclosure + re-moderation reality).

### Phase C — Reach & richness (**L**, later)
- Email review requests via `resend` (fix `_phase3_draft` imports first). (**M**)
- Video/photo testimonials + Supabase Storage + image moderation. (**L**)
- schema.org rich snippets; evaluate Trustpilot/Senja if manual volume grows. (**M**)
- Referral link on shared verified results. (**M**)

### Phase D — Multi-sport & B2B (**L**, aligned to triathlon/Ironman + licensing bets)
- Sport-tagged walls (reuse `event_type`). (**S**)
- App-store rating deep-links post native-mobile/LLC unblock. (**S**)
- B2B case-study proof objects for engine-licensing / white-label decks. (**M**)

---

## 11. Risks & Open Questions

**Risks**
- **Thin early volume looks worse than none.** → min-N aggregate gate; lead with verified-result mechanic; honest insider labeling.
- **FTC exposure from insider/incentivized proof during cold-start.** → `is_insider`/`incentivized` enforced in render; incentives never conditioned on sentiment; rejection audit trail (`moderation_note`).
- **Stat mis-derivation publishes a wrong number.** → `deriveStats` pure + heavily unit-tested; stats re-derived at submit with provenance pointers and a frozen `verified_at`; founder sees exact values in moderation; un-derivable stats are omitted, never guessed.
- **PII leakage via public read path.** → definer view whitelists columns; `display_name` pre-rendered; anon key never touches `user_id`; base-table anon `SELECT` never granted.
- **RLS/definer-view misconfiguration** (untyped client, easy to over-expose). → policies + grants consolidated in one migration (0024) for a single review; test the anon read path explicitly (approved row visible, pending/rejected invisible, no PII columns).
- **Account deletion vs. published testimonial.** `user_id` nullable + `on delete set null` keeps anonymized proof — but confirm this matches the erasure stance (Q1).
- **Untyped Supabase `as` casts** hiding shape drift on new tables. → centralize row types in `lib/proof/types.ts`; consider generated types later.

**Open questions (owner decisions)**
1. On account deletion: keep anonymized testimonial (current default) or hard-delete? Must align consent copy + GDPR erasure stance.
2. Admin gate: env allowlist (chosen for Phase A) is fine solo; add `profiles.is_admin` only if a second moderator appears — confirm.
3. Free-forever (non-generating) users: allow **text-only** testimonials, or restrict proof to trial/paid athletes who've run the engine? (Volume vs. relevance.)
4. `consent_versions` table (chosen) vs. bare version string — confirm the table is acceptable overhead. (Recommended: yes, for defensibility.)
5. Confirm the ACWR **double-count guard** matches how the engine currently treats a linked race in `workout_logs` (one load-bearing log per race).
6. Final **min-N** (default 8) and per-surface display counts (landing 3–6, pricing 2–3, `/proof` all).

---

## Appendix: File / Module Map (for build)
- `supabase/migrations/0019_race_results.sql`, `0020_testimonials.sql`, `0021_testimonial_stats.sql`, `0022_testimonial_prompts.sql`, `0023_consent_versions.sql`, `0024_public_views_and_rls.sql`
- `lib/proof/detectProofEvent.ts`, `lib/proof/deriveStats.ts`, `lib/proof/types.ts`, `lib/proof/moderation.ts` (Haiku triage)
- `lib/testimonials/actions.ts` (server actions), `lib/testimonials/admin.actions.ts` (service-role)
- `app/proof/page.tsx` (ISR, reads `public_testimonials` + stats + aggregate), pricing/landing components read the same views
- `app/(app)/settings/testimonials/*` (manage/withdraw), `app/(admin)/proof-queue/*` (moderation)
- vitest: `lib/proof/__tests__/detectProofEvent.test.ts`, `deriveStats.test.ts`, `acwr-race-nodup.test.ts`

---

**Sources:**
- [FTC — Final Rule Banning Fake Reviews and Testimonials (Aug 2024)](https://www.ftc.gov/news-events/news/press-releases/2024/08/federal-trade-commission-announces-final-rule-banning-fake-reviews-testimonials)
- [FTC — Consumer Reviews and Testimonials Rule: Q&A](https://www.ftc.gov/business-guidance/resources/consumer-reviews-testimonials-rule-questions-answers)
- [FTC — Endorsement Guides: What People Are Asking](https://www.ftc.gov/business-guidance/resources/ftcs-endorsement-guides-what-people-are-asking)
- [FTC — "Average Results" disclosure requirements (analysis)](https://www.internetlegalattorney.com/average-results-ftc-disclosure/)
- [Supabase — Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [Postgres — CREATE VIEW (`security_invoker`, `security_definer` semantics)](https://www.postgresql.org/docs/current/sql-createview.html)
- [Anthropic — Model pricing](https://www.anthropic.com/pricing)
- [Senja — Pricing](https://senja.io/pricing)
- [Shoutjar — Social Proof Before Launch](https://shoutjar.com/guides/social-proof-before-launch)
- [Product Marketing Alliance — Generating social proof in four steps](https://www.productmarketingalliance.com/start-generating-powerful-social-proof-in-four-steps/)
- [Testimonial.to — Social proof examples](https://testimonial.to/resources/social-proof-examples)
- [HYROX — Runna training partner](https://hyrox.com/training-partner/runna/)
