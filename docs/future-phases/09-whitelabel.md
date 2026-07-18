# Duravel White-Label Coaching Platform (B2B) — Design & Build Spec

**Status:** Preparatory design (not yet scheduled for build)
**Author:** Product + Eng (prep work for Levi)
**Date:** 2026-07-15
**Scope area:** Multi-tenant white-label coaching platform — let coaches/gyms run Duravel under their own brand for their athletes.
**Stack of record:** Next.js 16 (App Router — server components, server actions, route handlers), React 19, TypeScript strict (`noUnusedLocals`, `noUncheckedIndexedAccess`), Supabase (Postgres + Auth + RLS + Storage, service-role admin client, **untyped client — queries cast with `as`**), Anthropic Haiku + Zod, deterministic engine (`lib/engine/*`), generation (`lib/generation/*`), Stripe live billing (webhook = sole entitlement writer; `BILLING_ENABLED` gate). Repo `C:\dev\duravel`, migrations continue from `0019`.

---

## 0. What changed from the prep draft (fixes folded in)

This spec supersedes the prep draft. The material corrections, each explained where it lands:

1. **`profiles.org_id` removed.** A single-valued `org_id` column on `profiles` silently forbids a user from belonging to two orgs, and collides with the stated "D2C user coexists with org membership" goal (a `profiles` row is 1:1 with a user). **Membership is the sole athlete↔org binding via `org_members`.** Per-artifact `org_id` (on `programs`, `workout_logs`, etc.) records *which org context produced the row*. See §3.
2. **Trial vs. seat-cap entitlement bug fixed.** `seats_used <= seats_purchased` fails during a no-card trial (`seats_purchased = 0`, `seats_used > 0`). Entitlement now treats `status IN ('trialing','active')` as entitled and only enforces the seat cap for `active`. See §4/§7.
3. **RLS write policies now validate `org_id` integrity in `WITH CHECK`,** not just the actor's right to touch the athlete — otherwise a coach could stamp a *foreign* `org_id` on a legitimately-writable row. New `can_write_for_org(athlete, org_id)` helper. See §3.
4. **`org_id` write-path derivation made explicit.** Athlete-authored rows (logs, check-ins) inherit `org_id` from the linked program/session, not from ambient state. See §3/§4.
5. **Durable background jobs called out as a real dependency.** Vercel serverless/fluid functions have wall-clock ceilings; a single Haiku generation can already flirt with them, and "regenerate a cohort" fans out to hundreds of long calls. This needs a durable queue (QStash or Inngest), not in-request fan-out. New cost line + risk. See §5/§7/§9.
6. **Invite flow hardened:** email-bound, single-use via atomic `accepted_at` guard, partial-unique on pending `(org_id, lower(email))`, existing-user vs new-signup branches. See §3/§4.
7. **Attribution promoted from audit-only to first-class:** `adaptations` and coach edits carry `actor_user_id` so the athlete UI can show "Adjusted by Coach Levi" without joining the audit log. See §3/§6.
8. **Storage bucket + policy for org logos** specified (was hand-waved). See §3.
9. **Owner-as-athlete and dual-role** resolved (allow a second membership row; `unique(org_id,user_id)` relaxed to `unique(org_id,user_id,role)` with a guard). See §3/§9.
10. **Realistic total effort** added (not just per-workstream S/M/L): MVP Phases 0–3 ≈ **8–12 focused solo weeks**, isolation + billing being the long poles. See §10.
11. **Legal/GDPR made a Phase-3 blocker:** Duravel becomes a **data processor** for each org → DPA + updated ToS before the first paying org. See §9/§10.

---

## 1. Goal & Why Now

### Goal
Turn Duravel from a single-brand D2C app into a **multi-tenant platform** where an external coach or gym (an "org") operates their own branded instance: they invite athletes, assign and monitor Duravel-generated periodized programs, review adherence and adaptation signals, and make coach-in-the-loop adjustments — all under their own logo, name, and (later) domain. Duravel bills the org on a **seat-based subscription**; the org owns its athlete relationship and sets its own athlete-facing pricing.

### Why now
- **The engine is the moat, and it already exists.** The deterministic periodization engine (Base/Build/Peak/Taper, meso/microcycle structure, exact volume reconciliation, formula-based paces, personalized HR zones, HYROX station pacing, ACWR/monotony/readiness adaptation) is precisely what coaching platforms *lack*. Competitors (TrainingPeaks, TrueCoach, TrainHeroic, Everfit, FITR, Superset) are largely **delivery + logging shells** — the coach still authors every session by hand. Duravel's program *writes and adapts itself* to engine rules. Selling that is higher-margin than selling calendars.
- **B2B routes around solo-founder constraints.** Native mobile is blocked on LLC formation; triathlon/Ironman is the big product bet and months out. White-label is **pure web** (already the deployed surface), reuses the entire engine and data model with near-zero engine change, and monetizes the existing asset while those bets mature.
- **Seat billing improves unit economics.** D2C is $19.99/mo per athlete with retail CAC and churn. A gym with 30 athletes at $9–12/seat is one sale, one support relationship, and far stickier (switching cost = re-onboarding a roster).
- **Market signal.** HYROX coaching is a live, fast-growing niche. None of the incumbents pair a science-grade auto-periodization engine with white-label delivery. There's a defensible wedge *now* while HYROX still scales.
- **Billing plumbing is already tenant-ready-ish.** Migration `0018` repointed the subscription FK to `auth.users`, and the Stripe webhook is already the **sole writer of entitlement** — a second (org) product extends that plumbing rather than fighting it.

### Non-goals (this phase)
- Native mobile coach app (blocked on LLC; web-responsive only).
- Marketplace / coach discovery directory.
- Coach-authored *custom* engine rules (coaches **consume** the engine; they don't reprogram it).
- Engine API licensing / headless SDK — that's a **separate** untracked planning doc; keep it distinct to avoid scope merge.
- Coach overriding athlete **physiology** inputs (HR/threshold) — MVP blocks it (§5, §9).

---

## 2. User-Facing Scope

### Personas
- **Org Owner** — the coach/gym owner who signs up, brands the org, holds the Stripe subscription, manages seats and billing.
- **Coach** — a staff member managing a subset of athletes (may equal the owner in a solo-coach org).
- **Athlete** — an end user training under the org's brand. Org-managed (coach controls program) with self-serve logging/check-ins; coach oversees.

### MVP (first shippable slice)
1. **Org creation & membership.** Create an org, become owner; invite coaches and athletes by email; roles owner/coach/athlete; assign athletes to a coach.
2. **Athlete onboarding into an org.** Coach invites athlete → athlete accepts (existing Duravel user or fresh signup) → an `org_members` row binds them to the org. Existing D2C users keep their personal (`org_id NULL`) data and gain an org context.
3. **Coach dashboard — roster view.** One row per athlete: current phase/week, next session, adherence % (planned vs logged, trailing 2 wk), last check-in + readiness, ACWR/monotony load flag, last-activity age, profile-completeness state, quick actions.
4. **Assign a program.** Coach triggers generation for an athlete via the *existing* pipeline (engine skeleton → Haiku fill → Zod validate → reconcile). Coach supplies program inputs (race date, experience, availability, equipment) — not physiology.
5. **Monitor an athlete.** Drilldown: program calendar, planned-vs-actual per session, adaptation history, readiness check-ins, linked Strava activities.
6. **Coach-in-the-loop adjustment.** Coach can trigger the weekly-review **"Apply"** adaptation on an athlete's behalf, and make **bounded** manual edits (swap a session, shift a rest day, nudge volume within engine guardrails). Every change is attributed to the coach.
7. **Per-org branding.** Org name, logo, primary/accent color, support email. Athletes/coaches see the org brand in the app chrome instead of "Duravel."
8. **Seat-based billing.** Owner subscribes; seats = active athlete memberships. Stripe licensed-quantity subscription with proration. Entitlement (org-aware) + `BILLING_ENABLED` gate program generation and Apply.

### Later (post-MVP, prioritized)
- **Custom domain / full white-label** (`train.gymname.com`) via Vercel wildcard domains + host-based tenant resolution.
- **Coach templates** — save a generation-input preset ("HYROX Open, 12-week, 4 days/wk") and apply across athletes.
- **Bulk actions** — generate/regenerate a cohort (queued, rate-limited), group message.
- **Athlete-facing branded emails** (ride the Phase-3 lifecycle-email work once the `resend` import in `_phase3_draft` is resolved).
- **Coach analytics** — cohort trends, adherence, at-risk surfacing.
- **Sub-coach hierarchy / athlete reassignment** in large orgs.
- **Org-level integrations** — single Garmin/Strava app registration per org (pending Garmin Health approval).
- **In-app coach↔athlete messaging / session comments.**
- **Triathlon/Ironman cohorts** once the engine supports the sport (rides the same tenancy model unchanged).

---

## 3. Data Model / Schema Changes

**Design principle:** additive, RLS-first, backward-compatible. Existing D2C rows are "org-less" (`org_id IS NULL`). Every tenant-scoped table carries `org_id`; isolation is enforced by policies backed by a single membership table and `SECURITY DEFINER` helper functions (Supabase multi-tenant best practice — avoids recursive RLS, keeps policies flat and index-friendly).

**Athlete↔org binding lives ONLY in `org_members`.** We deliberately do **not** add `org_id` to `profiles` (a profile is 1:1 with a user; a single column can't express membership in two orgs, and would break D2C coexistence). Per-row `org_id` on artifacts records *which context produced the row*.

### New migrations (0019 →)

**`0019_orgs.sql` — orgs and membership**
```sql
create table public.orgs (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  slug          text not null unique,           -- reserved for later subdomain routing; app-generated, collision-retried
  owner_user_id uuid not null references auth.users(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create type public.org_role as enum ('owner','coach','athlete');

create table public.org_members (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.orgs(id) on delete cascade,
  user_id       uuid not null references auth.users(id) on delete cascade,
  role          public.org_role not null default 'athlete',
  status        text not null default 'active',   -- active | removed  (invites live in org_invites, not here)
  coach_user_id uuid references auth.users(id),    -- for athletes: their assigned coach
  created_at    timestamptz not null default now(),
  -- A user may hold at most one row per (org, role): lets an owner also be an athlete in their own org
  -- without a second staff row, while still preventing duplicate memberships.
  unique (org_id, user_id, role)
);

create index on public.org_members (user_id);
create index on public.org_members (org_id, role);
create index on public.org_members (org_id, coach_user_id);
```
> **Dual-role note:** `unique(org_id,user_id,role)` (rather than `(org_id,user_id)`) intentionally allows a solo coach who also trains to hold both an `owner`/`coach` row and an `athlete` row. App logic resolves "current context" (staff vs athlete) explicitly; it never infers role from a single lookup.

**`0020_org_helpers.sql` — SECURITY DEFINER membership helpers** (the isolation backbone)
```sql
-- Member of this org in any active role?
create or replace function public.is_org_member(p_org uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.org_members m
    where m.org_id = p_org and m.user_id = (select auth.uid()) and m.status = 'active'
  );
$$;

-- Owner/coach on this org?
create or replace function public.is_org_staff(p_org uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.org_members m
    where m.org_id = p_org and m.user_id = (select auth.uid())
      and m.role in ('owner','coach') and m.status = 'active'
  );
$$;

-- Can current user READ/act on this athlete? (self, or staff of an org the athlete is in)
create or replace function public.can_manage_athlete(p_athlete uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select (select auth.uid()) = p_athlete
      or exists (
        select 1
        from public.org_members staff
        join public.org_members ath on ath.org_id = staff.org_id
        where staff.user_id = (select auth.uid())
          and staff.role in ('owner','coach') and staff.status = 'active'
          and ath.user_id = p_athlete
          and ath.role = 'athlete' and ath.status = 'active'
      );
$$;

-- Can current user WRITE a row FOR this athlete stamped with this specific org_id?
-- Closes the "coach stamps a foreign org_id" hole: the org_id must be one where BOTH
-- the actor is staff AND the athlete is an active athlete, OR it's a personal (NULL) row the athlete owns.
create or replace function public.can_write_for_org(p_athlete uuid, p_org uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select
    case
      when p_org is null then (select auth.uid()) = p_athlete         -- personal/D2C row: only the athlete
      else exists (
        select 1
        from public.org_members staff
        join public.org_members ath on ath.org_id = staff.org_id
        where staff.org_id = p_org
          and staff.user_id = (select auth.uid())
          and staff.role in ('owner','coach') and staff.status = 'active'
          and ath.user_id = p_athlete
          and ath.role = 'athlete' and ath.status = 'active'
      )
      or (
        -- athlete writing their own org-context row (e.g., logging against an org program)
        (select auth.uid()) = p_athlete
        and exists (select 1 from public.org_members m
                    where m.org_id = p_org and m.user_id = p_athlete
                      and m.role = 'athlete' and m.status = 'active')
      )
    end;
$$;
```
> **Why `(select auth.uid())`:** wrapping in a scalar subselect lets Postgres evaluate it once per query (init-plan caching) instead of per row. **Why `security definer set search_path = ''`:** prevents search-path injection and lets the helper read `org_members` without the *caller* needing a direct grant that would recurse through RLS.

**`0021_branding.sql` — per-org branding + logo storage**
```sql
create table public.org_branding (
  org_id        uuid primary key references public.orgs(id) on delete cascade,
  display_name  text,
  logo_path     text,          -- Supabase Storage object path in the 'org-logos' bucket
  primary_color text,          -- hex, validated app-side (^#[0-9a-fA-F]{6}$)
  accent_color  text,
  support_email text,
  custom_domain text unique,   -- null until later phase
  show_powered_by boolean not null default true,  -- upsell lever (remove on higher tier)
  updated_at    timestamptz not null default now()
);
```
Storage: create a **public-read** bucket `org-logos` (logos are shown pre-auth on invite/branded pages). Write is restricted — logo uploads go through an **owner-only server action using the service-role client** (with an explicit `is_org_staff` re-check), never a client-side upload, since the untyped client + client-side Storage policy is an easy leak surface. Public URL is derived from `logo_path` at render.

**`0022_add_org_id.sql` — tenant-scope existing tables**
Add nullable `org_id uuid references public.orgs(id)` to `programs`, `workout_logs`, `adaptations`, `readiness_checkins`, `wearable_activities`. (Deliberately **not** `profiles` — see above.) Nullable ⇒ existing D2C rows valid (`NULL` = personal). Backfill is a no-op. Index each: `create index on public.programs (org_id);`, etc.

Also add attribution to `adaptations` (promote from audit-only so the athlete UI can render it directly):
```sql
alter table public.adaptations add column if not exists actor_user_id uuid references auth.users(id);
-- NULL actor = athlete/self or system; non-null = coach who triggered the Apply.
```

> **Write-path rule (load-bearing):** `org_id` on athlete-authored rows is **derived, never ambient.** When an athlete logs a workout or checks in against a session, the row inherits `org_id` from the linked program/session. When a coach assigns a program, the server action stamps `org_id` from the *membership under which the coach is acting*. There is no "current org" cookie that silently stamps rows — context is resolved per action from `org_members`.

**`0023_org_subscriptions.sql` — seat billing** (separate table from D2C `subscriptions` so entitlement stays clean)
```sql
create table public.org_subscriptions (
  org_id                 uuid primary key references public.orgs(id) on delete cascade,
  stripe_customer_id     text,
  stripe_subscription_id text,
  status                 text,            -- trialing | active | past_due | canceled | incomplete
  plan                   text,            -- 'seat_monthly' | 'seat_yearly'
  seats_purchased        integer not null default 0,   -- Stripe quantity (source: webhook)
  seats_used             integer not null default 0,   -- maintained by trigger below
  current_period_end     timestamptz,
  trial_started_at       timestamptz,
  updated_at             timestamptz not null default now()
);
create index on public.org_subscriptions (status);
```

**`0024_invites.sql` — invite tokens**
```sql
create table public.org_invites (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.orgs(id) on delete cascade,
  email       text not null,               -- stored lower-cased by the app
  role        public.org_role not null default 'athlete',
  token       text not null unique,        -- crypto-random (>=32 bytes, base64url), single-use
  invited_by  uuid not null references auth.users(id),
  accepted_at timestamptz,                  -- atomic single-use guard (see acceptInvite)
  expires_at  timestamptz not null default (now() + interval '14 days'),
  created_at  timestamptz not null default now()
);
create index on public.org_invites (email);
-- At most one *pending* invite per (org, email):
create unique index org_invites_pending_uq
  on public.org_invites (org_id, lower(email))
  where accepted_at is null;
```

**`0025_org_audit.sql` — coach action attribution**
```sql
create table public.org_audit_log (
  id              bigint generated always as identity primary key,
  org_id          uuid not null references public.orgs(id) on delete cascade,
  actor_user_id   uuid not null references auth.users(id),
  athlete_user_id uuid references auth.users(id),
  action          text not null,   -- 'assign_program' | 'apply_adaptation' | 'edit_session' | 'invite' | 'accept_invite' | 'update_branding' | ...
  meta            jsonb,
  created_at      timestamptz not null default now()
);
create index on public.org_audit_log (org_id, created_at desc);
```

### RLS policy pattern (every tenant table)
Enable RLS on all new tables and add policies to the `org_id`-bearing existing tables. Representative set on `programs`:
```sql
alter table public.programs enable row level security;

-- READ: athlete sees own; org staff see all programs in their org.
create policy programs_select on public.programs for select using (
  (select auth.uid()) = user_id
  or (org_id is not null and public.is_org_staff(org_id))
);

-- INSERT: actor must be allowed to write FOR this athlete under THIS org_id (validates org_id integrity).
create policy programs_insert on public.programs for insert with check (
  public.can_write_for_org(user_id, org_id)
);

-- UPDATE: same on both sides so a row can't be re-homed to another org.
create policy programs_update on public.programs for update
  using (public.can_write_for_org(user_id, org_id))
  with check (public.can_write_for_org(user_id, org_id));

-- DELETE: staff or self.
create policy programs_delete on public.programs for delete using (
  public.can_manage_athlete(user_id)
);
```
The same four-policy shape (select / insert-with-check / update-both-sides / delete) applies to `workout_logs`, `adaptations`, `readiness_checkins`, `wearable_activities`, keyed on their `user_id` + `org_id`. Splitting `FOR ALL` into explicit `insert`/`update` is what lets `WITH CHECK` reject a foreign `org_id` — a `FOR ALL ... USING` policy alone does not gate INSERT correctly.

`org_members`, `org_invites`, `org_subscriptions`, `org_branding`, `org_audit_log` get **read** policies via the helpers, but their **mutations run through the service-role admin client** in server actions (invite accept, role changes, seat accounting, webhook writes) to avoid the classic recursive-RLS trap where a policy on `org_members` must read `org_members`.

**Seat-count trigger** (keeps `seats_used` truthful without app bookkeeping; no-ops safely if the subscription row doesn't exist yet):
```sql
create or replace function public.sync_org_seats() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_org uuid := coalesce(new.org_id, old.org_id);
begin
  update public.org_subscriptions s
  set seats_used = (
        select count(*) from public.org_members m
        where m.org_id = v_org and m.role = 'athlete' and m.status = 'active'
      ),
      updated_at = now()
  where s.org_id = v_org;   -- if no subscription row yet, simply updates nothing
  return null;
end $$;

create trigger trg_sync_org_seats
after insert or update or delete on public.org_members
for each row execute function public.sync_org_seats();
```

### Isolation guarantees (the part to get exactly right)
- **Every tenant table has `org_id` + RLS keyed to it** through `is_org_staff` / `can_write_for_org` / `can_manage_athlete`. No policy reads `org_members` in a recursing way (helpers are `security definer`).
- **`WITH CHECK` validates `org_id` integrity**, so a coach can't stamp another org's id onto a writable row, and rows can't be re-homed on UPDATE.
- **The service-role admin client bypasses RLS.** The *few* actions that use it (invite accept, seat sync, branding/logo write, webhook writes) must **manually re-check membership** before every write. Treat those paths as "RLS is OFF; you are the RLS." A shared `assertOrgStaff(orgId, userId)` / `assertCanManage(athleteId, orgId, userId)` guard is called first thing in each.
- **Untyped Supabase client (`as` casts) means the type system is NOT a safety net.** TS will not catch a missing `.eq('org_id', …)`. Isolation is 100% Postgres RLS + explicit server-side checks.
- **Cross-tenant leakage vitest suite (hard CI gate).** Against a seeded local Postgres: for every tenant table assert coach A of org 1 cannot select/insert/update/delete org 2 rows; an athlete cannot read sibling athletes; a coach cannot stamp a foreign `org_id`; a removed member loses access. Nothing behind this gate ships until it's green.

---

## 4. API / Route + Server-Action Changes

All new surfaces are App Router server components + server actions, mirroring existing D2C structure. **Tenant context is resolved server-side per request** from the authenticated user's `org_members` row (later, from request host) — never trusted from the client.

### New route groups
```
app/(coach)/
  layout.tsx                 -- resolves org context, applies branding, guards role in ('owner','coach')
  dashboard/page.tsx         -- roster overview (server component)
  athletes/[id]/page.tsx     -- single-athlete drilldown
  athletes/[id]/program/     -- program calendar + planned-vs-actual
  settings/branding/page.tsx
  settings/billing/page.tsx  -- seat count, plan, Stripe portal link
  settings/team/page.tsx     -- invite coaches, manage members, reassign athletes
app/(org)/join/[token]/page.tsx   -- branded invite acceptance
```

### Server actions (`app/(coach)/actions.ts`, etc.)
- `createOrg(name)` → admin client: create org (slug generated + collision-retried), owner `org_members` row, empty `org_branding`, `org_subscription` in `trialing` with `trial_started_at = now()`. Audit `create`.
- `inviteMember(orgId, email, role)` → gated by `is_org_staff`; lower-case email; upsert into `org_invites` respecting the pending-unique index; email the link via Resend (later) or return the link now (alpha). Audit `invite`.
- `acceptInvite(token)` → admin client. **Atomic single-use:** `UPDATE org_invites SET accepted_at = now() WHERE token = $1 AND accepted_at IS NULL AND expires_at > now() RETURNING *` — if zero rows, the invite is spent/expired. On success: if the signed-in user's verified email matches the invite email, create the `org_members` row (fires the seat trigger); else send them through sign-in/sign-up first, then resume. Audit `accept_invite`. Handles both existing-Duravel-user and fresh-signup branches; **email match is enforced** so a leaked token can't be redeemed by a stranger.
- `assignProgram(athleteUserId, orgId, generationInputs)` → **wraps the existing `lib/generation` entry point**, then stamps `org_id` on the created `program` (and child sessions) from `orgId`; writes `org_audit_log`; gated by `can_manage_athlete` **and** `requireOrgEntitlement(orgId)` + `BILLING_ENABLED`. **Enqueues** the Haiku generation as a durable job (see §5) and returns a pending state; the roster reflects "generating…".
- `applyWeeklyReview(athleteUserId, orgId)` → wraps the existing weekly-review "Apply"; same gate; writes `adaptations.actor_user_id = coach`; audit `apply_adaptation`.
- `editSession(sessionId, patch)` → bounded manual edit validated against engine guardrails (§5); records `actor_user_id`; audit `edit_session`.
- `updateBranding(orgId, patch)` → owner-only; validate hex colors + support email; logo upload via admin client to `org-logos`; audit `update_branding`.
- `reassignAthlete(orgId, athleteUserId, newCoachUserId)` → staff-only; updates `org_members.coach_user_id`; audit.
- **No `setSeatCount` action.** Seats derive from active athlete memberships; the trigger maintains `seats_used`; a debounced job pushes `quantity` to Stripe (§7).

### Route handlers
- `app/api/webhooks/stripe/route.ts` — **extend the existing sole-writer webhook.** On `customer.subscription.created/updated/deleted` and `invoice.paid`, branch on Stripe `metadata.kind`: `'org'` → write `org_subscriptions` (status, plan, `seats_purchased` from `quantity`, `current_period_end`); else the existing D2C path. Set `metadata = { kind:'org', org_id }` at checkout. **Webhook stays the single entitlement writer** — no coach action or client writes entitlement.
- `app/api/orgs/[id]/seats/route.ts` (internal, service-role) — invoked by a **debounced** job after membership churn to push new `quantity` to Stripe; idempotent (no-op if quantity unchanged). Debounce avoids a flurry of Stripe writes (and proration line items) when a coach bulk-invites 30 athletes.

### Guarding + entitlement (org-aware, trial-correct)
`lib/auth/org.ts`:
- `requireOrgStaff(orgId)` — 403 unless `is_org_staff`.
- `requireOrgEntitlement(orgId)` — reads `org_subscriptions`:
  - `status = 'trialing'` and `trial_started_at` within 14 days → **entitled**, seat cap **not** enforced (fixes the `seats_purchased = 0` trial bug).
  - `status = 'active'` → entitled **iff `seats_used <= seats_purchased`** (soft-block or auto-increment per §7).
  - `past_due`/`canceled`/expired trial → not entitled.
- Generation and Apply gate on **org** entitlement when `org_id` is set, **personal** entitlement otherwise — one branch, two sources. The null-`org_id` path must still require personal entitlement so a coach can't get free generation by omitting `org_id`.

---

## 5. Engine / AI Implications

**Core thesis: the engine does not change.** Linking, generating, and adapting for an org-athlete is *identical* to D2C because a synced/assigned artifact is still a `program` + `workout_logs` + `readiness_checkins` keyed to a `user_id`. The tenancy layer sits *above* the engine.

- **Generation reuse (verbatim).** `assignProgram` calls the same `lib/generation` pipeline: deterministic engine builds the skeleton (phases, meso/microcycles, zone distribution, volume targets, formula paces, personalized HR zones from the athlete's `profiles`), Haiku fills sessions, Zod validates, reconciliation snaps mileage/cardio to targets. The **only** delta is post-generation: stamp `org_id`. The **athlete's own profile** drives personalization; the coach supplies *program inputs* (race date, days/week, equipment), not physiology (MVP).
- **Adaptation reuse (verbatim).** ACWR, monotony, readiness, session-RPE already flow from `workout_logs`. A coach-triggered Apply runs the same weekly-revision logic — the engine can't tell coach-initiated from athlete-initiated. Strava-linked activities feed the same signals with **zero engine change**, as the existing wearable design intends. Only new bit: record `adaptations.actor_user_id`.
- **Durable background execution (new, load-bearing).** A Haiku generation pass is a multi-second-to-minute LLM+reconcile operation. Vercel functions have wall-clock ceilings; running generation *inline* in a server action risks timeouts, and "regenerate cohort" would fan out to hundreds of long calls that a single request cannot host. **Route generation/regeneration through a durable queue** (QStash or Inngest) with a **per-org concurrency cap** and global Anthropic rate-limit guard to avoid 429s and cost spikes. The server action enqueues + returns pending; a worker route runs the existing pipeline and writes the program. This also cleanly supports retries and bulk cohort jobs. (If D2C generation is currently inline and near the limit, this hardening benefits both surfaces.)
- **Coach manual edits must respect engine invariants.** The one place engine authority meets coach discretion. `editSession` is **bounded**: swap session type, move a rest day, nudge volume within a tolerance band — but not silently break the microcycle's zone distribution or total-volume reconciliation. Implementation: route edits through a validation layer that **re-runs the engine's reconciliation check** and either accepts, or flags "this breaks Peak-week taper volume by X% — confirm override." The deterministic engine stays the source of truth for structure/volume/zones; the coach gets a *guarded, logged* override.
- **AI cost is per-generation, unchanged per athlete.** Each assigned program is one Haiku pass, same token profile as D2C. Org AI spend = (# athletes × generations/regenerations). Bulk regen is the only new multiplier — queued and capped as above.
- **Branding never touches the engine or the prompt.** Branding is presentation-only; Haiku prompt and Zod schemas are brand-agnostic. No risk of brand text leaking into program logic.
- **Profile-completeness gate.** Because personalization reads `profiles`, the invite/roster flow must ensure each org-athlete has a **complete profile** (benchmarks, HR inputs) before generation — otherwise the engine falls back to formula defaults and the coach gets a generic plan. Surface incomplete athletes on the roster and **block Assign** until minimal inputs exist.

---

## 6. UX Outline

**Design stance:** the coach surface is a **dense operations dashboard**; the athlete surface is the *existing* Duravel app, re-skinned per org. Reuse existing athlete components wholesale — only the chrome (logo, colors, name) changes. Theme via CSS custom properties injected in the `(coach)`/branded athlete layout from `org_branding`, resolved server-side to avoid FOUC.

### Coach dashboard (roster) — `/(coach)/dashboard`
- Header: org logo + name (branded).
- Roster table, one row per athlete: name, phase/week badge, next session, **adherence %** (logged vs planned, trailing 2 wk), **readiness** (last check-in color), **load flag** (ACWR/monotony out-of-band → amber/red chip), last-activity age, profile-completeness chip, quick actions (Assign / Review / Open).
- Top "needs attention" band: red load flags, missed check-ins > N days, incomplete profiles, generation failures.
- Filters: by coach (multi-coach org), by phase, by attention state.

### Athlete drilldown — `/(coach)/athletes/[id]`
- Program calendar (reuse athlete calendar) with planned-vs-actual overlay per session.
- Adaptation timeline: readiness check-ins, applied revisions (with coach attribution), ACWR/monotony sparkline.
- Linked Strava activities with link-to-planned-session state.
- Action rail: **Assign/Regenerate** (queued), **Run weekly review (Apply)**, **Edit session** (guarded), **Message** (later).
- Every mutating action shows attribution ("Adjusted by Coach Levi, 2026-07-14"), sourced from `adaptations.actor_user_id` / edit records.

### Branding settings — `/(coach)/settings/branding`
- Live preview pane: athlete chrome updates as owner edits name/logo/colors.
- Fields: display name, logo upload (Storage), primary + accent color (hex-validated), support email, "show Powered by Duravel" toggle (disabled below the tier that unlocks it). Custom-domain field present but disabled/"coming soon."

### Billing settings — `/(coach)/settings/billing`
- Current plan, `seats_used / seats_purchased`, monthly cost estimate, next invoice date, trial countdown when trialing.
- "Manage in Stripe" → Billing Portal (reuse existing integration).
- Warning state as `seats_used` approaches/exceeds purchased. **Recommended behavior: auto-increment quantity with proration**, surfaced clearly ("adding this athlete adds a seat, prorated $X"), for lowest friction. (Hard-block is the alternative; pick one — see §9.)

### Team settings — `/(coach)/settings/team`
- Invite coaches/athletes by email; pending-invites list (with resend/revoke); role management; reassign athlete to a different coach.

### Athlete experience
- Unchanged Duravel app, re-skinned. Athlete sees their coach's brand, logs workouts, checks in, connects Strava, views program. Configurable "powered by Duravel" footnote (an upsell lever).

### Invite acceptance — `/(org)/join/[token]`
- Branded landing → sign in or sign up (email must match invite) → membership created → redirect into branded athlete app. Clear expired/spent-token state.

---

## 7. Third-Party Services + Rough Costs

| Service | Role in this feature | Rough cost |
|---|---|---|
| **Supabase** | Postgres + Auth + RLS + Storage (org logos). Existing project extends; no new project. | Pro ~$25/mo covers early orgs; logo storage negligible. Watch connection pool/compute as row counts and coach dashboards (heavier reads) grow. |
| **Stripe** | Seat-based org subscriptions (licensed `quantity` price), proration on seat changes, Billing Portal, webhooks. Reuse existing account. | 2.9% + $0.30 per transaction; no new fixed cost. Optional volume tiers via `tiers`/`transform_quantity`. |
| **Anthropic Haiku** | Session generation per assigned/regenerated program (unchanged per-program profile). | ~pennies per generation; scales with athletes × regenerations. Bulk regen queued + capped. |
| **Vercel** | Hosting (existing). Later: custom-domain white-label via Vercel wildcard Domains + host routing. | Existing plan. Custom domains add per-domain cost + wildcard SSL automation when that phase lands. |
| **Durable queue (QStash or Inngest)** | **New dependency.** Runs generation/regeneration off the request path; retries; per-org concurrency; bulk cohort fan-out. | QStash free tier ~500 msg/day, then usage-based (~$1/100k). Inngest free tier ~50k steps/mo. Either is cheap at MVP scale; pick one and standardize (also benefits D2C generation reliability). |
| **Resend** | Branded invite + lifecycle emails (later; ride the Phase-3 `_phase3_draft` — resolve the `resend` import first). | Free ~3k emails/mo; ~$20/mo at 50k. |
| **Strava** | Existing per-athlete OAuth sync. Works unchanged for org athletes. | Free (rate-limited). |
| **Garmin Health** | Later, org-level app registration. Pending approval (scaffold only today). | Free once approved. |

### Seat-billing model (recommendation)
- **Licensed quantity price** (`recurring.usage_type = licensed`), `quantity` = active athletes; monthly + yearly variants. Suggested org wholesale **$9–12/seat/mo**, undercutting TrainingPeaks' ~$9/athlete-plus-base while offering the auto-programming they lack. Stripe **minimum quantity is 1**; an org with a subscription but zero athletes still bills 1 seat (or keep such orgs on trial/inactive until their first athlete).
- **Seats = active athlete memberships.** DB trigger maintains `seats_used`; the debounced seats job pushes `quantity`; Stripe **prorates** automatically.
- **Trial is seat-agnostic.** During `trialing`, entitlement ignores the seat cap (§4) — the org can load a roster before converting.
- **Volume discounts** later via Stripe `tiers`.
- **14-day no-card trial** at org level via `org_subscriptions.trial_started_at`, reusing the exact D2C pattern.
- **Webhook stays sole entitlement writer.** Org checkout sets `metadata.kind='org'` + `org_id`; the existing webhook routes org events to `org_subscriptions`.

---

## 8. Domain / Training-Science Basis

The B2B value proposition *is* the science; the platform distributes it.

- **Periodization is the product.** Base/Build/Peak/Taper with meso/microcycle structure and progressive overload is standard endurance doctrine — but most coaching *software* leaves the coach to hand-build it. Duravel encodes it deterministically, so every athlete in an org gets individually periodized programming without per-athlete coach hours. **That labor arbitrage is the sale.**
- **Load monitoring is coach-grade.** ACWR and training monotony are established injury/overtraining signals coaches actively watch. Surfacing them per-athlete on the roster ("needs attention" band) turns Duravel into a **risk dashboard**, not just a plan generator — a concrete reason a gym pays per seat.
- **Individualized physiology.** Formula paces + personalized HR zones (custom bands → threshold HR → resting HR → sex-specific %HRmax) give each athlete their own zones. Getting per-athlete zones right across a roster is exactly the tedious, error-prone work worth automating.
- **HYROX specificity.** Station pacing + hybrid strength/endurance is a genuine niche competence generic tools don't model (run-station alternation). Being the *HYROX-native* white-label engine is the beachhead before triathlon.
- **Coach-in-the-loop, not coach-replaced.** The defensible stance: the engine owns structure/volume/zones (where math and consistency matter); the coach supplies context, judgment, and **bounded** overrides (where human read of the athlete matters). The guarded-edit design (§5) encodes this — the platform never lets a well-meaning manual edit quietly violate a taper or blow up ACWR.

---

## 9. Risks & Open Questions

**Risks**
- **Tenant isolation is existential.** Untyped client + service-role paths mean one missing check leaks another gym's athletes. Mitigation: RLS on every tenant table via `security definer` helpers, `WITH CHECK` org-id integrity, mandatory membership re-checks in all admin-client writes, cross-tenant leakage vitest suite as a **hard CI gate**.
- **Recursive-RLS / dashboard performance.** Naive per-row `org_members` subqueries recurse or slow down; coach dashboards are read-heavy. Mitigation: `security definer` helpers + `(select auth.uid())` init-plan caching + denormalized indexed `org_id`; paginate/aggregate roster queries.
- **Long-running generation on serverless.** Inline Haiku generation risks Vercel timeouts; bulk regen fans out beyond a request's budget. Mitigation: durable queue (QStash/Inngest), per-org concurrency cap, Anthropic rate-limit guard, pending-state UX.
- **Billing/seat drift.** Membership churn vs Stripe quantity can desync. Mitigation: DB trigger = source of `seats_used`; debounced idempotent Stripe push; nightly reconcile job; webhook = sole entitlement writer.
- **Trial/seat entitlement edge cases.** `seats_purchased = 0` during trial; Stripe min-quantity 1; downgrade proration credits. Mitigation: trial is seat-cap-exempt; explicit status branches in `requireOrgEntitlement`.
- **Coach edits breaking engine invariants.** Mitigation: guarded edits validated against reconciliation with explicit override confirmation + attribution.
- **Solo-founder support load.** Each org is a B2B relationship with higher support expectations than a D2C user. Mitigation: keep MVP tight, lean on self-serve settings, strong empty/attention states, dogfood with one friendly gym before charging.
- **Legal exposure.** Duravel becomes a **data processor** for each org's athlete data, and hosts training advice delivered under someone else's brand. Mitigation: DPA + updated ToS clarifying the coach (not Duravel) owns the athlete relationship and training advice; **legal review before the first paying org** (Phase-3 blocker). GDPR: data export/erasure on org churn.

**Open questions**
- **Who pays?** MVP assumes the org pays for all seats. Confirm no athlete self-pay hybrid for v1.
- **Existing D2C user invited to an org:** their personal (`org_id NULL`) programs **coexist** with org-stamped ones (recommended). Confirm the context-switch UX (personal vs org view) for such dual users.
- **Seat-cap behavior:** **auto-increment quantity with proration** (recommended, lowest friction) vs hard-block past purchased seats. Confirm founder risk appetite.
- **"Powered by Duravel" removal** — at which plan tier? (`org_branding.show_powered_by` is wired; policy TBD.)
- **Owner-as-athlete:** allowed via a second `org_members` row (schema supports it). Confirm this is desired vs. forcing a separate personal account.
- **Data ownership / export on org churn:** contractual + technical offboarding policy (also GDPR). Define before first paying org.
- **Physiology overrides:** MVP blocks coaches editing athlete HR/threshold. When (and how guarded) do coaches get physiology override?
- **Queue vendor:** QStash vs Inngest — pick one and standardize across D2C + org generation.

---

## 10. Effort Estimate + Phased Build Plan

Sizing: **S** ≈ ≤2 days, **M** ≈ 3–6 days, **L** ≈ 1–2+ weeks (solo). **MVP total (Phases 0–3) ≈ 8–12 focused solo weeks**, with isolation and billing the long poles.

| Workstream | Size |
|---|---|
| Migrations 0019–0025 (orgs, members, helpers, branding + bucket, org_id + attribution, org_subscriptions, invites, audit) | **M** |
| RLS policies (4-policy shape) + `security definer` helpers + cross-tenant leakage test suite | **L** (isolation is the crown jewel) |
| Org creation + invite/accept flow (admin-client actions, atomic single-use, email-match) | **M** |
| Coach dashboard roster + athlete drilldown (reuse athlete components) | **L** |
| Durable-queue generation harness (QStash/Inngest) + wire `assignProgram`/regenerate through it | **M** (also hardens D2C) |
| `assignProgram` / `applyWeeklyReview` wrappers + attribution + audit | **M** |
| Guarded `editSession` w/ reconciliation validation | **M** |
| Per-org branding (settings + Storage + themed chrome, no-FOUC) | **M** |
| Seat billing (Stripe quantity price, webhook extension, seat trigger + debounced sync, portal, trial-aware entitlement) | **M** |
| Legal/DPA + ToS review (external) | **S** (Levi's time) + external counsel |
| Custom domain white-label | **M** (later) |
| Coach templates + queued bulk actions | **M** (later) |
| Cohort analytics | **M** (later) |
| Branded lifecycle emails (Resend; resolve Phase-3 imports) | **S–M** (later) |

### Phased plan

**Phase 0 — Isolation foundation (gate before any UI).**
Migrations 0019–0022 (+ helpers), RLS on every tenant table with the 4-policy shape, cross-tenant leakage vitest suite green in CI, `next build` clean. **Nothing ships until leakage tests pass.**

**Phase 1 — Org + roster (internal alpha).**
Org creation, invite/accept (email-match, atomic), `org_members`, coach dashboard roster (read-only monitoring), athlete drilldown reusing existing components. No billing yet (behind `BILLING_ENABLED`/flag). Dogfood with one friendly gym.

**Phase 2 — Assign + adapt (queue-backed).**
Durable-queue generation harness; `assignProgram` + `applyWeeklyReview` wrappers with attribution; profile-completeness gate; guarded `editSession`; audit + attribution surfaced. A coach can now actually run and adapt programs. Still flag-gated.

**Phase 3 — Branding + seat billing + legal (first paid orgs).**
Per-org branding + themed athlete chrome; Stripe seat subscription + webhook extension + seat trigger/debounced sync; org trial via `trial_started_at`; trial-aware, seat-aware entitlement; billing settings + portal. **DPA + ToS in place.** Flip entitlement gating on; onboard first paying org.

**Phase 4 — Scale & polish (later).**
Custom-domain white-label, coach templates + queued bulk regen, cohort analytics, branded Resend emails, sub-coach hierarchy, org-level Garmin (post-approval), triathlon cohorts once the engine supports the sport.

---

### Guiding constraints honored
- Reuses the deterministic engine + Haiku + Zod pipeline **verbatim**; tenancy is a layer above, not an engine change.
- Additive migrations from **0019**; existing D2C rows valid as `org_id NULL`; **no `org_id` on `profiles`** (membership is the binding).
- Stripe **webhook remains sole entitlement writer**; `BILLING_ENABLED` continues to gate generation + Apply, now org- and trial-aware.
- Isolation enforced entirely in **Postgres RLS + explicit service-role checks** (with `WITH CHECK` org-id integrity) because the Supabase client is untyped and `as`-cast — the type system cannot be the safety net.
- Long-running generation moved to a **durable queue** so serverless limits and bulk fan-out don't break it.
- `next build` + vitest (especially the leakage suite) are the real gates.

**Sources:** Supabase RLS best practices (SECURITY DEFINER helpers, `(select auth.uid())` init-plan caching, avoiding recursive policies) · Stripe — subscription quantities & proration · Stripe — recurring/tiered pricing models · TrainingPeaks / TrainHeroic coach pricing (2026 comparisons) · FITR HYROX white-label coaching · Superset HYROX coaching software · QStash / Inngest durable background jobs on Vercel · Vercel function duration limits & wildcard custom domains.
