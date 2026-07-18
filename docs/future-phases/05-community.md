# Duravel — Brand & Community: Design & Build Spec

**Owner:** Levi (solo founder)
**Status:** Preparatory design — not scheduled, not built. Implementation-ready.
**Date:** 2026-07-15
**Area:** Brand & community (the connective tissue around the product)
**Related planning docs:** B2B engine-licensing / white-label drafts (untracked); `_phase3_draft` lifecycle-email work (unresolved `resend` import).

---

## 0. TL;DR / Recommendation

- **Platform:** Run community on **Skool** (external) for the MVP. Do **not** build in-app community first. Skool gives a single feed, built-in gamification (points/levels/leaderboards), fast setup, and one centralized moderation surface — the lowest-maintenance option for one person. Discord's per-channel moderation and Circle's multi-space config both cost more solo-founder time.
- **Hard realism caveat that reshapes the build:** Skool has **no first-class public webhook/API** for membership events. Do **not** design around a signed `skool-webhook` as the sole mirror path (that is the Stripe pattern and it does not transfer here). Instead, make **membership mirroring self-serve and degrade gracefully**: the authoritative in-app signal is a **user-entered claim code**, with an *optional* Zapier/automation bridge as a convenience layer if/when Skool exposes a "new member" trigger on the current plan. Membership state is **presentation-only** and gates nothing security-critical, so a weaker trust model is acceptable.
- **Integration seam:** Duravel is the **system of record for eligibility and identity**; Skool is the community *surface*. Build a thin, one-way bridge: Duravel decides who may join (active trial or paid), issues a **claim code**, and records membership + a small set of **milestone events** so training progress can *reference* community without the engine depending on it.
- **What Duravel actually builds in the MVP:** a `community_*` schema (invites/claim codes, membership mirror, milestone events, a webhook-dedup table); a server action to issue a claim code; a claim-verification action; deterministic streak/milestone computation from existing `workout_logs`; one `/community` surface that deep-links out; and minimal **funnel instrumentation** so the retention hypothesis is actually measurable. No engine changes. No AI changes.
- **Gamification dose:** deliberately **moderate**. Ship streaks + a small fixed milestone set + one *adherence-based* leaderboard, not an XP economy. Reward **consistency/adherence, never raw volume** (volume rewards fight the engine's deliberately-easy weeks).
- **Effort (corrected):** MVP is a solid **M** (not S–M). It is dominated by config plus one bridge plus one surface, but the correct RLS/column-grant work, timezone-aware streak logic, claim-code flow, dedup, and instrumentation push it firmly into M. "Later" phases are **M–L each** and explicitly gated on the MVP demonstrating a retention lift.

---

## 1. Goal & Why-Now

### Goal
Give Duravel a durable retention and brand layer that (a) reduces churn on the $19.99/mo · $149/yr plans via social accountability, (b) gives the sport-agnostic "Duravel" brand a home beyond HYROX, and (c) sustains at a solo-founder effort ceiling of **≤ 2–3 hrs/week** steady-state.

### Why now
1. **Billing went live 2026-07-14.** Real paying users + a 14-day no-card trial now exist. Retention is the biggest LTV lever for a subscription training app, and social accountability is among the best-evidenced retention mechanisms in fitness. Community is the cheapest retention surface available **before native mobile** (blocked on the LLC / Apple Developer registration).
2. **The trial is app-side and card-free.** Trial users are the cohort most likely to lapse silently. Inviting them into a community on day 1 is a low-cost re-engagement channel that needs no push/native.
3. **Brand expansion is the core product bet.** "Duravel" is deliberately sport-agnostic; triathlon/Ironman is the diversification thesis. A community seeded now on **training identity** (not "HYROX tips") is the asset that carries the brand across sports later. Seeding it while the audience is small and HYROX-only is far cheaper than retrofitting post-diversification.
4. **It composes with work already in flight.** `_phase3_draft` lifecycle email is the natural onboarding-into-community channel; Strava sync + `workout_logs` already emit the milestone/streak signals a community thrives on. This is connective tissue over things that mostly already exist.

### Explicit non-goals for now
Not a social network. No in-app real-time chat. No large public forum to moderate. No gating community behind engine complexity. **No new engine or AI surface area.**

---

## 2. User-Facing Scope

### MVP (external platform + thin bridge)
1. **Community exists on Skool** — one group ("Duravel Athletes"), single feed, a small Classroom section for evergreen guides (pacing, HYROX station technique, "how to read your Duravel plan").
2. **Invite on entry.** When a user starts a trial or subscribes, Duravel surfaces a "Join the community" CTA that issues a personal **claim code** and deep-links to Skool. Same CTA appears in the trial-start and subscription-confirmation emails (email path is P3, gated on `resend`).
3. **In-app Community surface (`/community`)** — a single page that shows: membership state (invited / joined), a deep link to Skool, the user's current **training streak** and **next milestone** computed from their own logs, and a **claim-code panel** ("Already joined on Skool? Confirm here").
4. **Milestone/streak awareness.** Duravel computes a small fixed milestone set from existing `workout_logs` (e.g., first logged session, 4-week consistency streak, first plan completed, first sub-target station split) and surfaces them with a one-tap "post to community" prompt (copy pre-filled; posting itself happens on Skool).
5. **Membership mirror.** Duravel records, per user, whether they've joined and their community handle — via **claim code (authoritative)** and, optionally, a Zapier/automation bridge (convenience). Membership state gates nothing; it is presentation only.

### Later (only if MVP shows retention lift)
- **L1 — Automated milestone posting / bot.** Duravel posts milestone cards to the feed on the user's behalf (opt-in), via Skool automation or a scheduled poster. Removes the manual copy/paste step. **Feasibility depends on Skool automation surface — verify before committing.**
- **L2 — Cohort challenges.** Time-boxed challenges tied to engine phases (e.g., "8-week Base block consistency"); leaderboard keyed to **adherence %**, not raw volume.
- **L3 — In-app community feed (build-vs-buy re-eval).** Only if (a) Skool's lack of deep training-data integration becomes the ceiling **and** (b) native mobile has shipped (post-LLC). Supabase Realtime would justify it. Separate future spec.
- **L4 — Sport-expansion spaces.** At triathlon/Ironman launch: sub-topics/tags on Skool single-feed, or spaces if migrated to Circle. Designed for now only at the identity layer.

---

## 3. Data Model / Schema Changes

**Principle:** The engine and generation pipeline remain unaware of community. Community tables may reference `auth.users` / `profiles`, but nothing in `lib/engine/*` or `lib/generation/*` reads them. New migrations continue from **0019**. All tables get RLS. Privileged writes use the **service-role admin client** (bypasses RLS), consistent with the existing "webhook is the sole writer of entitlement" pattern. All service-role writes go through `lib/community/*`, never client code.

### Migration `0019_community_membership.sql`
```sql
create table public.community_memberships (
  user_id            uuid primary key references auth.users(id) on delete cascade,
  status             text not null default 'invited'
                       check (status in ('invited','joined','left','banned')),
  platform           text not null default 'skool',
  external_member_id text,                 -- Skool member id, once known (may stay null)
  external_handle    text,                 -- display handle in the community
  invited_at         timestamptz not null default now(),
  joined_at          timestamptz,
  left_at            timestamptz,
  updated_at         timestamptz not null default now()
);

alter table public.community_memberships enable row level security;

-- Read-only for the owner; ALL writes are service-role only.
create policy "read own membership"
  on public.community_memberships for select
  using (auth.uid() = user_id);

create index community_memberships_status_idx
  on public.community_memberships (status);
```

### Migration `0020_community_invites.sql` — corrected idempotency model
The draft claimed `issueCommunityInvite()` is "idempotent — reuse unexpired token." **That is impossible if only the hash is stored:** you cannot reconstruct the join URL from a hash. Corrected design: store the hash for verification, and treat re-issue as **"supersede prior unconsumed invites and mint a fresh one."** The client always receives a freshly generated code; older unconsumed codes for the same user are marked `superseded_at` so at most one is live. (A raw code is never persisted; it is returned once, at issue time, and shown to the user.)

```sql
create table public.community_invites (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  code_hash     text not null,            -- sha256 of the raw claim code; raw never stored
  eligibility   text not null             -- snapshot of why they qualified at issue time
                  check (eligibility in ('trial','paid')),
  expires_at    timestamptz not null,
  consumed_at   timestamptz,              -- set when the user confirms membership
  superseded_at timestamptz,              -- set when a newer invite replaces this one
  created_at    timestamptz not null default now()
);

alter table public.community_invites enable row level security;
-- No client access whatsoever; issued and validated server-side via service role.
revoke all on public.community_invites from anon, authenticated;

create index community_invites_user_idx on public.community_invites (user_id);
create unique index community_invites_code_hash_idx on public.community_invites (code_hash);
-- Enforce "at most one live invite per user" at the DB layer.
create unique index community_invites_one_live_idx
  on public.community_invites (user_id)
  where consumed_at is null and superseded_at is null;
```

### Migration `0021_community_milestones.sql` — corrected column-level write control
The draft's `for update ... with check (auth.uid() = user_id)` policy is a **privilege bug**: Postgres RLS cannot restrict *which columns* change, so that policy lets a user rewrite `kind`, `payload`, `achieved_at`, and forge milestone history. Fix: **remove the client UPDATE policy entirely and route "mark shared" through a service-role server action** (simplest, matches the "service role is the privileged writer" convention). A column-level `GRANT UPDATE (shared_at)` is offered as an alternative but is deliberately not the default — a single owned column-grant path plus RLS is easy to get subtly wrong, and the service-role action is the established pattern.

```sql
create table public.community_milestones (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  kind         text not null,            -- e.g. 'first_log','streak_4w','plan_complete'
  achieved_at  timestamptz not null default now(),
  payload      jsonb not null default '{}'::jsonb,  -- denormalized, engine-agnostic, NO PII
  shared_at    timestamptz,              -- set only via service-role action
  created_at   timestamptz not null default now(),
  unique (user_id, kind)                 -- each kind fires once per user (dedupe)
);

alter table public.community_milestones enable row level security;

-- Read own milestones. NO client update/insert/delete policy: writes are service-role only.
create policy "read own milestones"
  on public.community_milestones for select
  using (auth.uid() = user_id);

create index community_milestones_user_idx
  on public.community_milestones (user_id, achieved_at desc);
```

### Migration `0022_community_events.sql` — dedup + funnel instrumentation (NEW; the draft was missing both)
Two gaps the draft left open: (1) any inbound automation/webhook needs **replay/dedup** (Stripe has this; the draft's Skool path did not), and (2) the MVP's Definition of Done requires comparing joiner vs non-joiner retention, but nothing recorded the **funnel**. One small append-only table covers both.

```sql
create table public.community_events (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid references auth.users(id) on delete set null, -- null for unmatched inbound
  event_type    text not null,           -- 'invite_issued','join_confirmed','milestone_shared',
                                          -- 'cta_viewed','cta_clicked','inbound_member_joined', ...
  source        text not null default 'app'
                  check (source in ('app','skool','automation')),
  dedup_key     text,                    -- e.g. automation delivery id; null for app-origin events
  payload       jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now()
);

alter table public.community_events enable row level security;
revoke all on public.community_events from anon, authenticated; -- analytics read via service role
-- Idempotency for any inbound automation delivery.
create unique index community_events_dedup_idx
  on public.community_events (source, dedup_key)
  where dedup_key is not null;
create index community_events_type_idx on public.community_events (event_type, created_at desc);
```

### `updated_at` maintenance
Add a shared trigger (or set `updated_at = now()` explicitly in every service-role write) for `community_memberships`. Keep it a plain `before update` trigger to avoid drift; do not rely on the app layer alone.

### Notes on the model
- **Streaks are computed, not stored** — derived from `workout_logs` at read time, optionally snapshotted into a milestone's `payload` when one fires. No write path on every log; `workout_logs` stays the single source of truth for training behavior.
- **Untyped Supabase client / TS strict:** all reads cast with `as CommunityMembership`, `as CommunityMilestone[]`, etc., per existing convention. Define row types in `lib/community/types.ts`. Under `noUncheckedIndexedAccess`, milestone/streak logic must treat every array index and `.at()` result as possibly `undefined` (relevant when scanning `workout_logs` windows — see §6 streak semantics).
- **No FK from engine tables to community tables** and no community read inside generation/adaptation. Preserves "synced data feeds the engine with zero engine changes."
- **No PII in `payload` or `community_events.payload`.** Store metric snapshots and milestone kinds, never emails/names. On account delete, `on delete cascade` clears Duravel-side rows; Skool-side data is controlled separately (see §9 privacy).

---

## 4. API / Route + Server-Action Changes

All new code lives under `lib/community/*` plus a few App Router entries. Nothing in `lib/engine/*` or `lib/generation/*` changes.

### Eligibility helper (`lib/community/eligibility.ts`)
Single source of truth for "may this user access community." Pure-ish, unit-tested.
```
eligibility(user): 'paid' | 'trial' | 'none'
  - 'paid'  if an active row exists in subscriptions (status active/trialing per Stripe mirror)
  - 'trial' if now() < profiles.trial_started_at + interval '14 days' AND not 'paid'
  - 'none'  otherwise
```
Community access = `paid` OR `trial`. **Deliberately NOT gated by `BILLING_ENABLED`.** `BILLING_ENABLED` gates *paid features* (program generation, weekly-review Apply); community is a **conversion + retention** surface that must include trial users. Gate on eligibility, not on the paid-feature flag.

### Server actions (`lib/community/actions.ts`)
- **`issueCommunityInvite()`** — authenticated. Computes eligibility; if `none`, returns a soft "start your trial first" state (no code). Otherwise: supersede any live invite for the user, generate a random claim code, store its hash + eligibility snapshot in `community_invites`, upsert `community_memberships` to `status='invited'`, log `invite_issued` to `community_events`, and return `{ claimCode, skoolJoinUrl }`. **Not gated by `BILLING_ENABLED`** (see above). Correctly idempotent per the "one live invite" DB constraint — repeated calls supersede-and-reissue, and the freshly returned code is always the live one.
- **`confirmCommunityMembership(rawCode, handle?)`** — authenticated; the **authoritative** join path. Hashes `rawCode`, looks up an unconsumed, unexpired, non-superseded invite **for the calling user**, sets `consumed_at`, flips `community_memberships` to `status='joined'`, `joined_at=now()`, stores `external_handle` if provided, and logs `join_confirmed`. This works with **zero dependency on any Skool API** — it is the fallback that is actually the default.
- **`markMilestoneShared(milestoneId)`** — service-role write (client update policy was removed). Verifies caller owns the milestone (`user_id = auth.uid()` checked in the action), sets `shared_at`, logs `milestone_shared`. Backs the optimistic "I posted this" UI.
- **`recomputeMilestones()`** — reads the caller's `workout_logs`, evaluates the fixed milestone ruleset (`lib/community/milestones.ts`), inserts newly-achieved rows, relying on `unique(user_id, kind)` to dedupe. Pure ruleset is unit-tested; the action is a thin DB wrapper. **Trigger points (concrete):** (a) invoked at the end of the existing workout-log write path (best-effort, non-blocking — a failure here must never fail a log write), and (b) on `/community` load as a safety net. A Vercel Cron nightly sweep is **optional/L1**, not MVP.
- **`logCommunityCtaEvent(type)`** — lightweight `cta_viewed` / `cta_clicked` writer for funnel measurement.

### Route handlers (App Router)
- **`app/api/community/membership-bridge/route.ts`** *(optional convenience, not required for MVP correctness)* — accepts an inbound "new member" / "member left" payload from a **Zapier (or equivalent) automation** wired to Skool, authenticated by a shared secret in the path/header (Skool has no HMAC — accepted because membership is presentation-only, gates nothing). Dedupes on `(source='automation', dedup_key)`; matches the member to a user by `external_handle`/email **only as a hint**, never as an eligibility grant; writes via service role; logs `inbound_member_joined`. If Skool exposes no usable automation trigger on the active plan, **this route is simply not deployed** and the claim-code flow stands alone. There is intentionally **no** `skool-webhook`/`invite-callback` pair as in the draft — those assumed capabilities Skool does not reliably provide.

### UI surface (server components + one client island)
- **`app/(app)/community/page.tsx`** — server component. Reads membership + latest milestones + computed streak; renders the join CTA + claim-code panel, or the "you're in" state; shows the milestone list with share prompts. One small **client island** handles optimistic "mark shared", copy-to-clipboard of pre-filled post text, and the claim-code input.
- **CTA placements:** trial start, first program generated, subscription confirmation. Each fires `logCommunityCtaEvent('cta_viewed')` on render and `'cta_clicked'` on click.
- **Email tie-in (P3):** trial-start + subscription-confirmation templates in `_phase3_draft` carry the invite CTA. The in-app CTA ships **independently** of the email path; email follows once the `resend` import is resolved.

### What does NOT change
Stripe webhook, entitlement logic, `BILLING_ENABLED` gating of generation/Apply. Community sits **outside** the paid-feature gate and only **reads** eligibility signals.

---

## 5. Engine / AI Implications

**Net engine impact: none.** Hard design constraint, and a feature, not a limitation.

- The deterministic engine (periodization, zones, volume reconciliation, ACWR/monotony/readiness) is untouched. Community reads its **outputs** (logs, completed plans) but never feeds structure/volume/zones.
- **Haiku is not involved in the MVP.** Milestone detection is deterministic rules over `workout_logs` — it must be, for the same reason the engine owns structure: reproducibility and cost control. Never let the LLM "decide" a milestone.
- **Optional, bounded AI use (Later, opt-in):** Haiku could draft the *prose* of a share card from a structured milestone payload, validated with Zod exactly like session generation — cheap, short-prompt, strictly cosmetic, never touches training. Kept out of MVP to avoid new cost/latency surface until community is proven.
- **Adaptation engine interaction: none.** A streak is a *presentation* of adherence; the engine already consumes session RPE / readiness / ACWR directly. **A streak must never become an engine input** — that would corrupt training logic with a motivational metric and pressure athletes through deloads/tapers.

---

## 6. UX Outline

### Entry / onboarding into community
1. **Triggers:** (a) trial start, (b) first program generated, (c) subscription confirmation. Each shows: "Join Duravel Athletes — training's easier with people."
2. **Join flow:** CTA → `issueCommunityInvite()` → open Skool join URL in a new tab; show the **claim code** and a "come back and confirm" hint. External-platform signup friction is unavoidable and acknowledged.
3. **Confirm / return state:** the user pastes the claim code into `/community` (or, if the optional automation bridge is live, membership flips automatically). `/community` then shows "you're in" + the deep link.

### In-app Community surface (`/community`)
- **Header:** current training streak ("3-week streak") + next-milestone progress ("2 sessions from your first Base block complete").
- **Milestone feed:** achieved milestones as cards, each with "Share to community" (copies pre-filled, **PII-free** text + opens Skool). Shared cards show a subtle "shared" state.
- **Community link + claim block:** persistent deep link; claim-code input for users who joined on Skool first.

### Streak semantics (the draft left these undefined — specifying now)
- **Unit = weekly consistency, not daily.** A "streak" = consecutive **calendar weeks** each containing ≥1 `workout_logs` row (planned-linked or synced). Weekly (not daily) avoids all-or-nothing quitting and matches how a periodized plan actually schedules rest.
- **Week boundary:** ISO week (Mon–Sun) in the **user's timezone**. `profiles` may not currently store a timezone; if absent, default to the account's inferred locale or UTC and **flag this as the one small profile addition** the feature may need (a nullable `profiles.timezone`). Do not block MVP on it — UTC is an acceptable v1.
- **Forgiveness:** one "grace week" allowed per rolling 8 weeks without breaking the streak (deload/taper/illness weeks are legitimate). Never surface a broken streak punitively; show "restart your streak," not "you lost it."
- **Performance:** computing from all of a user's `workout_logs` at read time is fine at current scale; cap the scan window (e.g., last 26 weeks). Under `noUncheckedIndexedAccess`, treat every windowed index as possibly `undefined`.

### Content cadence (realistic for one person — target ≤ 2–3 hrs/week)
| Cadence | Ritual | Effort |
|---|---|---|
| Weekly (fixed day) | One "Weekly check-in" thread ("What's your key session this week?") — reusable template | ~15 min |
| Weekly | Repost / react to 2–3 member milestone posts | ~15 min |
| Bi-weekly | One short evergreen Classroom addition or a coaching note tied to the current periodization phase (Base/Build/Peak/Taper) | ~30–45 min |
| Monthly | "Race/event recap" or a HYROX-technique deep-dive | ~45 min |
| Ad hoc | Answer questions; nudge members to answer each other (the retention flywheel — aim to *reduce* founder reply share over time) | variable |

Template-driven so it can be batched and, later, partially automated (L1).

### Gamification (dose = moderate, per the science)
- **Ship:** streaks; a **small fixed milestone set (~6–8 kinds)**; **one leaderboard** — Skool's built-in points, or an **adherence-%** leaderboard when a challenge runs.
- **Do NOT ship:** a full XP economy, many badge tiers, or per-action points that reward volume over consistency. The S-shaped adherence evidence (moderate feature richness maximizes intention; excess reduces it) plus the concrete risk of **gamifying volume** (which conflicts with the engine's deliberately-easy weeks) both argue for restraint. Provide a **leaderboard opt-out** (adaptive control for low-self-efficacy athletes).

### Brand presence
Consistent "Duravel Athletes" naming, logo, and one voice: sport-agnostic, endurance-identity, coach-not-hype. Seeds triathlon/Ironman at the identity layer without committing UI to it now.

---

## 7. Third-Party Services + Rough Costs

| Option | Base cost (2026) | Fees | Gamification | Paywall | Solo-founder fit |
|---|---|---|---|---|---|
| **Skool (recommended)** | ~$99/mo flat, single plan | Processing % on native payments — **moot** for Duravel (billing via Stripe, not through Skool) | Built-in points/levels/leaderboards | Native | **Best.** Fast setup, one feed, one moderation surface. **API/webhook support is weak — plan around it (§0, §4).** |
| **Circle** | $89 Basic → $199 Professional → $399 Business | varies by tier | Add-on/limited | Native | Multi-space power but more setup + ongoing config; better API/webhooks than Skool |
| **Discord** | Free | needs Whop/Patreon/Launchpass (~4–8%) for paywall | None native (bots only) | None native | Great real-time + bots, but per-channel moderation scales badly solo; content buries |
| **In-app (Supabase)** | infra only (~$0–25/mo) | none | build it yourself | native (Stripe) | Highest control, **highest build + maintenance** — deferred to L3 |

**Recommendation: Skool for MVP.** Since Duravel bills through Stripe, community access is **free to eligible members** — Skool's payment rails (and their fee) are not used; you pay the flat platform fee for the lowest-maintenance engagement surface. **The trade-off you are buying is weak programmatic integration**, which the claim-code architecture (§4) absorbs.

**Rough monthly run cost (MVP):** ~$99 Skool + negligible Supabase delta + $0 incremental Vercel ≈ **~$100/mo.** Optional later: `resend` for lifecycle emails (free tier ~3k emails/mo, then ~$20/mo); an automation bridge (Zapier ~$20–30/mo *only if* used for the optional membership route); Haiku share-copy (pennies at this scale).

**Domain/brand:** Skool custom domains are not supported on its plan — use a redirect from your own domain (`community.duravel.app` → Skool) via a Vercel rewrite/redirect. Circle supports custom domains on Professional+ if that ever matters.

---

## 8. Domain / Training-Science Basis

- **Social accountability drives adherence.** Group accountability and shared commitment are among the best-evidenced levers for physical-activity adherence and program retention; gamified-activity RCTs consistently show engagement lift. This is the core retention thesis.
- **Gamification has an S-shaped optimum.** The 2025 *Frontiers in Psychology* study on feature richness found intention rises low→moderate but **weakens** in the "overload zone," and that low-self-efficacy users hit cognitive strain earlier. Implication (reflected in §6): moderate dose, adaptive opt-outs, no feature bloat.
- **Reward consistency, not volume.** Duravel's engine deliberately periodizes — some weeks are lighter by design (taper, deloads). A volume leaderboard would push athletes to violate their plan and undermine ACWR/monotony safety. So milestones and any leaderboard key to **adherence-to-plan** and **consistency streaks**, aligning with rather than fighting periodization.
- **Streaks as identity, not pressure.** Streaks reinforce identity but backfire as all-or-nothing quitting after a break. Define them forgivingly (weekly consistency + grace week, per §6) and never surface a broken streak punitively.

*(Sources at the end.)*

---

## 9. Risks & Open Questions

**Risks**
1. **Skool has no reliable webhook/API (primary architectural risk).** The mirror cannot depend on Skool pushing membership events. **Mitigation (already in the design):** claim code is the authoritative, Skool-independent join signal; the automation bridge is optional and best-effort; membership state gates nothing security-critical. **Must-verify before build:** exactly what "new member" automation trigger, if any, Skool exposes on the active plan — this decides only whether the *optional* bridge ships, not whether the MVP works.
2. **Identity split across two accounts.** A user has a Duravel account and a Skool account with possibly different emails. **Mitigation:** claim code binds the two explicitly and reliably; never infer eligibility from a Skool-side email match — the claim code, issued only to eligible users, is the trust anchor.
3. **Community cold-start.** A near-empty community *hurts* retention. **Mitigation:** don't invite everyone on day 1; seed a founding cohort, establish the weekly ritual, widen invites only once baseline activity exists.
4. **Founder time creep.** The ≤2–3 hr/week can balloon. **Mitigation:** template-driven cadence; push member-to-member answering; do not build L1 automation until the manual ritual proves it sticks.
5. **Gamifying the wrong metric.** Covered in §8 — rewards key to adherence/consistency, never volume.
6. **Dependency on `_phase3_draft` / `resend`.** Email onboarding depends on unresolved lifecycle-email work. **Mitigation:** ship the **in-app** CTA first; email tie-in (P3) follows once `resend` imports are fixed. Community MVP does not block on it.
7. **Milestone recompute failure coupling.** `recomputeMilestones()` runs off the workout-log write path. **Mitigation:** it must be best-effort and fully isolated — a milestone-computation error can never fail or slow a log write (which feeds the engine). Fire-and-forget with its own error handling; the `/community` safety-net recompute covers any miss.
8. **Deprovisioning on churn (the draft omitted this).** What happens to community access when a trial lapses or a subscription cancels? **Decision:** do **not** auto-remove lapsed users from Skool — community is a re-conversion channel and removal is brand-damaging and manual. Duravel simply stops *issuing new* invites to `eligibility='none'` users; existing members stay. Optionally set `community_memberships.status` transitions for analytics, but take no punitive action. Revisit only if abuse appears.

**Open questions**
- Trial users: full community access, or read-only preview until paid? **Recommendation: full access** — community is a conversion lever, not a paid perk.
- At triathlon/Ironman launch: stay single-feed (tags) on Skool, or migrate to Circle spaces? Decide at expansion time.
- Ever want community *inside* the app (L3)? Only justified post-native-mobile and if Skool's data-integration ceiling actually bites.
- **Privacy/PII:** milestone share cards expose training data **by design and opt-in**; confirm no PII in pre-filled post text or stored payloads. Skool is a separate data processor for member data — note it in the privacy policy; Duravel-side cascade-delete covers Duravel rows only.
- Small profile addition: is `profiles.timezone` worth adding now for accurate streak week boundaries, or is UTC acceptable for v1? (Recommendation: UTC for v1; add timezone opportunistically.)

---

## 10. Effort Estimate + Phased Build Plan

**Sizing:** S = ≤1 day · M = 2–4 days · L = 1–2+ weeks (solo).

| Phase | Scope | Size |
|---|---|---|
| **P0 — Config & seed** | Create Skool group, branding, Classroom starter guides, weekly-ritual template, founding-cohort invite list. **Verify Skool's automation/trigger surface.** No code. | **S** |
| **P1 — Bridge (MVP core)** | Migrations 0019–0022 (membership, invites w/ corrected idempotency, milestones w/ corrected write control, events/dedup+instrumentation); `lib/community/*` (types, eligibility, milestone ruleset + vitest, streak logic + vitest, actions); `issueCommunityInvite` / `confirmCommunityMembership` / `markMilestoneShared` (service-role) / `recomputeMilestones`; optional automation-bridge route. | **M** |
| **P2 — In-app surface** | `/community` page (server component), streak + milestone rendering from `workout_logs`, share-prompt + claim-code client island, CTA placements at trial/generate/subscribe with funnel events. `next build` under TS strict is the gate. | **M** |
| **P3 — Email tie-in** | Wire invite CTA into trial-start + subscription emails once `_phase3_draft` / `resend` is resolved. | **S** |
| **P4 — Later (deferred, gate on retention data)** | L1 auto-posting bot (verify Skool automation first); L2 cohort/adherence challenges; L3 in-app feed re-eval; L4 sport-expansion spaces; optional Haiku share-copy. | **M–L each** |

**MVP = P0–P2 (P3 when unblocked): overall a solid M** — corrected up from the draft's S–M. It is dominated by config + one bridge + one surface, but the correct RLS/column-write handling, timezone-aware forgiving streak logic, claim-code + supersede idempotency, dedup, and funnel instrumentation are real, and each is a place to get subtly wrong under TS strict. Everything past P3 is explicitly gated on the MVP demonstrating a retention lift.

**Definition of done (MVP):**
- An eligible (trial-or-paid) user can join from an in-app CTA and confirm membership via claim code with **no dependency on any Skool API**.
- `/community` shows a correct forgiving weekly streak + at least one milestone computed from **real** `workout_logs`.
- Milestone ruleset **and** streak logic are covered by vitest; `unique(user_id, kind)` dedupe verified.
- Funnel events (`invite_issued`, `join_confirmed`, `cta_viewed/clicked`, `milestone_shared`) are recorded so **30/60-day retention of community-joiners vs non-joiners is measurable** before any L-sized investment.
- `next build` passes under TS strict (`noUnusedLocals`, `noUncheckedIndexedAccess`).
- **`lib/engine/*` and `lib/generation/*` are unchanged; no new AI surface.**

---

## Sources
- [Skool vs Circle 2026 (SkoolPrep)](https://skoolprep.com/skool-vs-circle) · [Skool vs Discord 2026 (SkoolPrep)](https://skoolprep.com/skool-vs-discord)
- [Best community platforms compared 2026 (Circle)](https://circle.so/blog/best-community-platforms) · [Skool alternatives for fitness coaches 2026 (Communipass)](https://communipass.com/blog/skool-alternatives-for-fitness-coaches-2026/)
- [S-shaped impact of gamification feature richness on exercise adherence intention (Frontiers in Psychology, 2025)](https://www.frontiersin.org/journals/psychology/articles/10.3389/fpsyg.2025.1671543/full)
- [Gamification & behavioral nudges in health apps (Sahha)](https://sahha.ai/blog/gamification-behavioral-nudges-health-apps/) · [Columbia Moves gamified activity RCT (IJBNPA)](https://link.springer.com/article/10.1186/s12966-023-01530-1) · [Workout accountability ideas (Trainerize)](https://www.trainerize.com/blog/workout-accountability/)
