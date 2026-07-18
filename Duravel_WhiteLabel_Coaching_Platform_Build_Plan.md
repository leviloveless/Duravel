# Duravel — White-Label Coaching Platform: Build Plan

_Status: **PLAN ONLY — not implemented.** Drafted July 14, 2026. Do not begin work from this without re-reading against the current codebase (schema/migrations/RLS may have moved on)._

This is one of two companion plans for turning Duravel's engine into a product other people can build on:

- **This document** — a multi-tenant **coaching platform**: coaches sign up, manage athletes, build/assign periodized plans using the Duravel engine, and monitor logging + adaptation across their roster, optionally under their own brand.
- **`Duravel_Engine_API_Licensing_Build_Plan.md`** — the smaller alternative: license the engine itself as an authenticated, metered API/SDK to other builders.

The two are not mutually exclusive. The coaching platform can be built directly on the current app; the API plan is the faster path to revenue if the goal is to let _other_ apps embed the engine. Read both before committing.

---

## 1. What we're building

A B2B2C product with three actors:

- **Coach** (paying customer) — creates and owns training programs, invites athletes, assigns programs to them, reviews each athlete's logs/readiness/adaptations, and can override the engine's output.
- **Athlete** (the coach's client) — logs workouts, does readiness check-ins, connects wearables — the existing consumer experience, but their program is authored/assigned by a coach instead of self-generated.
- **Org / brand owner** (optional, for true white-label) — a coaching business whose coaches and athletes see _their_ logo, colors, and domain instead of Duravel's.

The engine, periodization, fatigue/stress/load management, and workout logging already exist and are reused wholesale. The build is almost entirely the **tenancy, roles, authoring, and branding** layer around them.

---

## 2. Why this is a real build (the current constraints)

The engine is portable, but the app around it is **single-tenant and athlete-owned by design**. Concretely, from the current code:

- **One auth user = one athlete.** `profiles.id` is a FK to `auth.users` (`0001_init.sql`). There is no notion of a person who owns _other people's_ data.
- **Every program belongs to exactly one user.** `programs.user_id → profiles(id)`; RLS policy `programs: own rows` is `auth.uid() = user_id`.
- **All user-data RLS is strict per-user equality.** `profiles`, `programs`, `races`, `workout_logs` (`0005`), `adaptations` (`0006`), `readiness_checkins` (`0010`), `wearable_activities`/`wearable_daily` (`0016`) all gate on `auth.uid() = <owner>`. A coach literally cannot `SELECT` an athlete's row today — that isolation _is_ the security model, and the engineering review specifically praised the "no service-role key for user data, RLS-only" posture.
- **Billing is per-athlete.** `subscriptions` (`0014`) is keyed `user_id PRIMARY KEY`; `lib/subscription.ts` gates features on the signed-in user's own subscription or their 14-day trial. There's no per-seat or org billing.
- **Single brand.** Brand name, colors, domain are hard-coded (post-rebrand to "Duravel"). No theming layer.
- **Program creation is self-service + AI.** Onboarding wizard → `GenerationInput` → engine skeleton → AI fill. There is no surface for one person to author/override a plan _for_ someone else.

None of this is a flaw — it's the right shape for a solo-athlete B2C app. It just means white-label = adding a tenancy/roles/authoring/branding layer on top, and (critically) **rewriting every RLS policy** so coach access is possible without breaking athlete isolation.

---

## 3. Target architecture

### 3.1 Tenancy model

Introduce an **organization** as the top-level tenant, with memberships that carry roles.

```
organizations
  └── memberships (user ↔ org, role: owner | coach | athlete)
        ├── coach  → authors programs, manages a roster
        └── athlete → owns their own logs, is coached by ≥1 coach

coach_athletes (explicit coach ↔ athlete link within an org)
```

Design decisions to lock before building:

- **Solo athletes still work.** The existing B2C product must keep functioning. Model a solo athlete as an org-of-one where they are both owner and athlete, OR keep `organization_id` nullable and treat null-org rows as "personal." Recommended: **backfill every existing user into a personal org** so all code paths go through one model (fewer branches, fewer RLS special-cases). This is the single most important compatibility decision.
- **Can an athlete have multiple coaches / belong to multiple orgs?** Start with **one active coaching relationship per athlete per org**; allow multiple orgs later. Keep `coach_athletes` a real table (not a single FK on profiles) so the M:N door stays open.
- **Who owns a program — coach or athlete?** Recommended: the **program is owned by the org and assigned to an athlete**, authored by a coach. Add `programs.organization_id`, `programs.coach_id` (author), keep `programs.user_id` as the **assigned athlete**. This keeps the athlete-facing queries (which key on `user_id`) mostly intact while adding the coach dimension.

### 3.2 Roles & permissions matrix (target)

| Action | Athlete (self) | Coach (own athletes) | Org owner |
|---|---|---|---|
| Read own profile/program/logs | ✅ | ✅ (their athletes) | ✅ (org) |
| Create/assign program | ❌ (or self, personal org) | ✅ | ✅ |
| Override engine output | ❌ | ✅ | ✅ |
| Log workouts / readiness | ✅ | ❌ (read only) | ❌ |
| Manage roster / invites | ❌ | ✅ (own athletes) | ✅ (all) |
| Billing | n/a | n/a | ✅ |

---

## 4. Data model changes (new migrations, from `0018`)

All new tables get RLS from day one. New numbered migrations continue the existing sequence (current head is `0017`).

- **`0018_organizations.sql`**
  - `organizations (id, name, slug unique, owner_user_id → profiles, brand jsonb, created_at)`.
  - `brand jsonb` holds `{ logoUrl, primaryColor, accentColor, productName, supportEmail, customDomain }` for §8.
- **`0019_memberships.sql`**
  - `memberships (id, organization_id → organizations, user_id → profiles, role check in ('owner','coach','athlete'), status check in ('invited','active','removed'), created_at, unique(organization_id, user_id))`.
  - This table is the backbone of every rewritten RLS policy — index `(user_id)` and `(organization_id, role)`.
- **`0020_coach_athletes.sql`**
  - `coach_athletes (id, organization_id, coach_user_id → profiles, athlete_user_id → profiles, status, created_at, unique(organization_id, coach_user_id, athlete_user_id))`.
- **`0021_programs_tenancy.sql`**
  - `alter table programs add column organization_id uuid references organizations`, `add column coach_id uuid references profiles` (author; nullable for self-authored).
  - Backfill: create a personal org per existing user, set `organization_id`, leave `coach_id` null.
- **`0022_rls_coach_access.sql`** — the RLS rewrite (see §5). Ship as its own migration so it can be reviewed and rolled back independently.
- **`0023_org_billing.sql`** — per-seat billing tables (see §7); may land later.
- **`0024_program_overrides.sql`** — coach authoring/override storage (see §6).
- **`0025_invitations.sql`** — `invitations (id, organization_id, email, role, token, invited_by, expires_at, accepted_at)`.

Keep the existing untyped-Supabase convention (`as` casts on reads) noted in the handoff; if a typed client is adopted, do it as a separate, prior refactor.

---

## 5. The RLS rewrite (security-critical — the core of this project)

Today every user-data policy is `auth.uid() = <owner>`. Coach access means each of those tables needs an **additional** path: "the caller is a coach of the row's athlete, in the same org." This must be added **without** widening athlete access to anyone else's data.

Recommended approach — **`SECURITY DEFINER` helper functions**, mirroring the existing `has_active_subscription()` pattern in `0014`:

```sql
-- True when p_coach coaches p_athlete in some org (active link).
create or replace function coaches_athlete(p_coach uuid, p_athlete uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from coach_athletes ca
    where ca.coach_user_id = p_coach
      and ca.athlete_user_id = p_athlete
      and ca.status = 'active'
  );
$$;

-- True when p_user is owner/coach in the org that owns p_program.
create or replace function can_manage_program(p_user uuid, p_program uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from programs pr
    join memberships m on m.organization_id = pr.organization_id
    where pr.id = p_program and m.user_id = p_user
      and m.role in ('owner','coach') and m.status = 'active'
  );
$$;
```

Then extend policies **table by table**, keeping the athlete's own-row path intact and adding a coach path. Example for `programs`:

```sql
-- Athlete still sees their own; coach/owner sees org programs they manage.
create policy "programs: athlete own" on programs
  for select using (auth.uid() = user_id);
create policy "programs: coach read" on programs
  for select using (can_manage_program(auth.uid(), id));
create policy "programs: coach write" on programs
  for update using (can_manage_program(auth.uid(), id))
             with check (can_manage_program(auth.uid(), id));
```

Apply the same pattern to `workout_logs`, `adaptations`, `readiness_checkins`, `wearable_activities`, `wearable_daily`, and `races` (via program), granting coaches **read** on logs/readiness/activities and **read/write** on programs. Deliberately keep **writes to logs athlete-only** — coaches plan, athletes execute.

Hard rules for this migration:

- **Never use a broad service-role bypass for coach reads.** The current design's strength is that user data never touches the service-role key; preserve that. Coach access goes through RLS + helper functions, not `admin.ts`.
- **Watch for recursive RLS.** Helper functions are `security definer` precisely so a policy on `programs` can query `memberships`/`coach_athletes` without triggering _their_ RLS and recursing. Verify no policy references a table whose own policy references back.
- **Test the negative cases first.** Before shipping, prove: coach A cannot read coach B's athletes; a removed athlete's coach loses access; an athlete cannot read another athlete in the same org. Write these as SQL-level tests (seed rows, `set role`, assert visibility) — this is the highest-risk surface in the entire plan.

**Effort/risk:** this is the single largest and riskiest work item. Budget real time for an adversarial review of the policies (ideally a second set of eyes or a dedicated verification pass), not just the happy path.

---

## 6. Coach authoring & override surface

"A coach builds their own training programs using my engine" is subtly different from the current auto-generate flow. The engine should **propose**, and the coach should be able to **override**. The existing pipeline already supports this shape — reuse it rather than building a parallel one.

Current pipeline (keep):
`GenerationInput → toEngineInput → buildSkeleton → planChunks → generateChunk (AI) → assembleProgram → verifyProgram → persist` (`lib/generation/generate-program.ts`), plus the adaptation path `computeWeekSignals → decideAdaptation → applyDecisionToWeek` and `lib/generation/adapt-week.ts`.

Add a coach override layer **between assembly and persistence**:

- **Store overrides, not just final output.** `0024_program_overrides.sql`: `program_overrides (id, program_id, week_number, day, session_index, patch jsonb, coach_id, created_at)`. A patch mutates one session (swap a run for a hybrid, change target volume/zone, replace station work, edit notes).
- **Re-apply overrides after any regenerate/adapt.** When the engine recomputes a week, re-apply the coach's stored patches on top so a recalculate doesn't silently wipe the coach's edits. This mirrors the existing "frozen week" and upsert-preserve semantics already in the logging layer.
- **Respect the verifier.** Run `verifyProgram` after overrides; surface violations to the coach (e.g. "this week now has 0 rest days") rather than blocking silently. Reuse the existing `issues[]` channel.
- **Template programs.** Let a coach save a program as a reusable template (`is_template` on programs, no assigned athlete) and clone-assign it to athletes, re-running individualization (VDOT paces, working weights, division/sex station loads via `assembleArgsFromInput`) against each athlete's benchmarks. This is a major coach value-prop and reuses existing per-athlete individualization for free.

UI surfaces to add:
- Coach program editor (week grid with per-session override controls) — extends the existing `app/program/[id]/edit` surface.
- "Assign to athlete(s)" flow with per-athlete individualization preview.
- Template library.

---

## 7. Billing model change

Replace per-athlete subscriptions with **per-seat / per-coach** org billing.

- New `org_subscriptions` (or generalize `subscriptions` to key on `organization_id`): plan tiers by number of active athlete seats, billed to the org owner.
- Options: (a) simple per-seat Stripe subscription billed to the coach; (b) **Stripe Connect** if coaches resell to their own athletes and you take a platform fee. (a) is far simpler — start there.
- Entitlement check moves from "does this user have a sub?" to "is this athlete's seat covered by their org's plan?" Refactor `lib/subscription.ts` `getEntitlement()` accordingly; keep the `BILLING_ENABLED` flag and trial concept (now an org trial).
- The generation rate limit (`claim_generation_slot`, `0012`; 3/day per user) should become **per-org** or **per-seat** — a coach generating for 30 athletes will blow the per-user cap instantly. Re-scope the limiter.

---

## 8. White-label branding layer

Only needed if coaches want **their** brand, not Duravel's. If the near-term goal is just "coaches use Duravel-branded software," defer this whole section.

- `organizations.brand jsonb` (from `0018`) drives a theming context: product name, logo, primary/accent colors, support email.
- Load brand server-side by org (or by custom domain host) and inject via CSS variables + a `BrandProvider`. The app already ships light-only with a small palette, so theming is tractable.
- **Custom domains:** map `org.brand.customDomain` → org at the edge (Vercel domains + a middleware host lookup). This is the most operationally involved part (TLS, domain verification); treat as a later phase.
- Transactional email (invites, receipts) also needs per-brand from/reply-to.

---

## 9. Auth, invites, and "act as"

- **Invitations** (`0025`): coach invites athlete by email → token link → athlete signs up/accepts → `memberships` + `coach_athletes` rows created active.
- **Role resolution on login:** after auth, resolve the user's memberships and route to the coach dashboard vs. athlete experience. Add a role/org switcher for multi-role users.
- **Coach "view as athlete":** coaches need to see an athlete's program/logs read-only. This is just a coach-scoped read (via §5 policies) rendering the existing athlete views — not true impersonation. Avoid actual session impersonation (audit/security headache).

---

## 10. Rollout path (do not big-bang this)

1. **Compatibility backfill first.** Ship `organizations` + `memberships` + personal-org backfill with **no behavior change** — every existing user becomes owner+athlete of a personal org. Verify the B2C product is byte-for-byte unaffected. This de-risks everything downstream.
2. **RLS rewrite behind the backfill** (`0022`), still with no coach UI — prove isolation holds with the new policies before any coach can exist.
3. **Coach role + roster + read-only monitoring** — coaches can be invited, see their athletes' programs/logs. No authoring yet.
4. **Coach authoring/override + templates** (§6).
5. **Org billing** (§7).
6. **White-label branding + custom domains** (§8) — last, and optional.

Each phase is independently shippable and testable. Phases 1–2 are pure infrastructure with no user-visible change if done right.

---

## 11. Effort estimate (solo founder, rough order-of-magnitude)

| Phase | Scope | Rough effort |
|---|---|---|
| 1 | Org/membership tables + personal-org backfill, no behavior change | 1–1.5 wks |
| 2 | RLS rewrite + adversarial isolation testing | 1.5–2.5 wks (highest risk) |
| 3 | Coach role, invites, roster, read-only athlete monitoring | 2–3 wks |
| 4 | Coach authoring/override layer + templates | 3–4 wks |
| 5 | Per-seat org billing (Stripe, re-scope rate limits) | 1.5–2 wks |
| 6 | White-label theming + custom domains (optional) | 2–3 wks |

Total to a sellable coaching platform **without** custom-domain white-labeling: ~9–13 weeks of focused solo work. The engine/training-science work is $0 of that — it's all reuse.

---

## 12. Key risks & decisions to make before starting

- **RLS correctness is existential.** A single over-broad policy leaks one client's data to another coach. This is the thing to get a second reviewer / dedicated verification workflow on.
- **Program ownership model** (§3.1) is a one-way door — decide "org-owns, athlete-assigned, coach-authored" up front; retrofitting it later is painful.
- **Keep solo B2C alive.** The personal-org backfill is what protects the existing product and revenue; don't skip it to save time.
- **Scope white-label honestly.** "Coaches use my software" (no branding) is ~half the work of "coaches ship their own brand" (custom domains, theming, per-brand email). Confirm which one the market actually wants before building §8.
- **Don't fork the engine.** All individualization must keep flowing through `assembleArgsFromInput` / the shared engine surface so B2C and coaching stay in sync — resist any coach-specific engine branch.

---

_Companion: `Duravel_Engine_API_Licensing_Build_Plan.md`. Source-of-truth for current state: `Duravel_Handoff_2026-07-14.md` and `supabase/migrations/`._
