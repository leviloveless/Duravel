# Duravel — Typed Supabase Client Migration: Design & Build Spec

**Owner:** Levi (solo founder) · **Area:** Platform / Tech Debt · **Status:** Preparatory design (not scheduled) · **Date:** 2026-07-15
**Repo:** `C:\dev\duravel` · **Migrations:** comments migration lands as `0019`, optional enum migration as `0020` (see §3)

---

## 0. TL;DR

Duravel's Supabase client is **untyped**: every query casts results with `as`, so the compiler cannot see the database schema. This defeats the entire point of a `strict` TypeScript setup (`noUncheckedIndexedAccess`, `noUnusedLocals`) and lets a whole class of bug — schema drift, wrong column names, nullable columns treated as non-null, enum typos, missing NOT-NULL insert columns — reach production silently. The Stripe webhook (sole writer of entitlement) and the deterministic engine's persistence boundary are exactly the code paths where a silent cast bug is most expensive.

This spec adopts a **generated `Database` type** from the schema, wires it into the SSR/server client and the service-role admin client, and removes casts **module-by-module** behind a mechanical, low-risk rollout. `next build` remains the gate; a new CI job regenerates types from `supabase/migrations/*` and fails the build on drift. **Net-new runtime behavior: zero.** This is a compile-time-only change — no schema change is required to *do* the migration (two optional convenience migrations are proposed and gated), no user-facing feature change, no engine logic change.

**Effort: M** (~5–8 focused days spread over 2–3 weeks to de-risk), dominated by the incremental cast-removal sweep and the *new, legitimate* null-guards that real row types surface — **not** the wiring. Can escalate to **L** only if Phase 0 discovers the live DB has drifted from `migrations/*` (§9.4) or if JSONB insert-site friction (§5.4) proves widespread.

---

## 1. Goal & Why Now

### Goal
Make the Supabase schema visible to the TypeScript compiler so that:
1. Column/table/enum names, nullability, and result shapes are checked at compile time.
2. Schema drift (a migration renaming/dropping a column the code still reads) breaks `next build` instead of production.
3. `as`-casts stop laundering `unknown`/`any` into confidently-wrong typed values.
4. Autocomplete and cross-data-layer refactors work, which materially speeds up a solo founder.

### Why now
- **Billing is live and money is on the line.** The Stripe webhook is the *sole writer* of entitlement (`subscriptions`, plus whatever `profiles` fields gate `BILLING_ENABLED`, and `trial_started_at`). An untyped write here that targets a renamed/misspelled column, or a gate-read of a column that no longer exists, can wrongly grant or revoke paid access. This is the single highest-value place to have the compiler watching.
- **The schema is young but accelerating.** 18 migrations exist; `0018` already *repointed a foreign key* (`subscriptions` → `auth.users`) — exactly the kind of structural change casts hide. The triathlon/Ironman diversification bet will add tables and columns fast; every one is a new drift surface. Adopting types *before* that expansion is strictly cheaper.
- **The cost compounds.** Every new module written against the untyped client adds more `as` casts to later remove. Cheaper today than in three months.
- **Low-risk and reversible.** Types are erased at build time; they change *what compiles*, never *what runs*. The rollout pauses or reverts cleanly at any module boundary.

### Explicitly *not* a goal
- Not an ORM adoption (no Drizzle/Prisma/Kysely). Supabase stays the client; we only add its own generated types.
- Not a query-behavior change, RLS change, or data migration (except the guarded, optional enum promotion in §3.1, which is the only data-touching step in the whole plan).
- Not a runtime-validation replacement. Zod still guards the untrusted boundary (Haiku output, webhook payloads, external API responses). Generated types describe *the DB's declared shape*, not *runtime truth*, and say **nothing about RLS access** — see §5 and §9.7.

---

## 2. Scope — MVP First, Then Later

### MVP (this project)
1. **Generate `Database` types** from the schema into `types/database.types.ts` (single source, committed, `--schema public`).
2. **Wire the `Database` generic** into the client entry points:
   - `createServerClient<Database>` (SSR / server components / route handlers / server actions),
   - the browser client **iff one exists** (`createBrowserClient<Database>`) — confirm in P0 (§9.6),
   - the **service-role admin client** (`createClient<Database>`), the privileged writer and the most important one to type.
3. **Introduce typed helpers** (`Tables<'programs'>`, `TablesInsert<'workout_logs'>`, `TablesUpdate<...>`, `Enums<...>`) plus a thin re-export module (`types/db.ts`) so app code imports domain row types from one place.
4. **Incrementally remove `as` casts, module-by-module**, highest-risk first: **billing → engine/generation persistence → adaptation-signal reads → wearables → everything else.** Each module compiles clean before moving on.
5. **CI type-drift gate:** a GitHub Action that spins the schema up from `supabase/migrations/*`, regenerates types, and fails if the committed `database.types.ts` differs — so a migration that lands without a type regen cannot merge to `main` (which auto-deploys to Vercel).
6. **Document the workflow** (a `gen:types` script + a short `CONTRIBUTING`/README note) so future migrations regenerate types as a reflex.

### Later (explicitly deferred)
- **Typed RPC / Postgres functions** (`Functions` is covered by the generator) — promote to MVP *only if* P0 finds RPCs in use (§9.6).
- **Engine domain ↔ DB row mapping layer** — a deliberate mapper at the persistence seam rather than leaking DB shapes into `lib/engine/*`. Designed in §5.1; the mappers themselves ship in P3.
- **`text` → Postgres `enum` promotion** for closed, engine-owned value sets (phase, statuses). Optional, guarded, and moved to its own migration `0020` in P4 — see §3.1.
- **Per-column JSONB type overrides** (`MergeDeep`) so `programs.plan` etc. type as the Zod-inferred domain type instead of opaque `Json` — see §5.4.
- **Zod-from-types codegen** (`supabase-to-zod`) to derive runtime validators from DB types. Nice-to-have.

---

## 3. Data Model / Schema Changes

**The migration itself requires no schema change.** Generated types read the existing schema (migrations `0001`–`0018`). The following are *optional* and clearly gated; only the comments slice (§3.1a) is recommended as part of this work.

> **Migration-numbering discipline (correction to keep the plan honest):** a migration is immutable once applied. You cannot "reopen" `0019` in a later phase. Therefore the **comments** change is `0019` (P2) and the **enum promotion**, if done, is a *separate later migration* `0020` (P4). Do not fold both into one number applied at two different times.

### 3.1a (Recommended, zero-DB-risk) `0019_type_comments.sql` — column comments only
Supabase surfaces `COMMENT ON COLUMN` as JSDoc in the generated types, so this documents the model at every call site with zero behavioral or data risk:
- `profiles.trial_started_at` — how the 14-day app-side trial is computed.
- The `profiles`/`subscriptions` columns that gate `BILLING_ENABLED` and entitlement.
- Any column whose meaning is non-obvious (adaptation signal fields, status columns).

Ship this unconditionally.

### 3.1b (Optional, guarded) `0020_enum_promotion.sql` — `text` → Postgres `enum`
Promote de-facto enums stored as `text` to real Postgres enums where the value set is closed and engine-owned. Highest value:
- periodization phase: `base | build | peak | taper`
- program/session status fields
- readiness scales *iff* stored as free `text`

Each becomes `CREATE TYPE duravel_phase AS ENUM (...)` + `ALTER TABLE ... ALTER COLUMN phase TYPE duravel_phase USING phase::duravel_phase`. This turns `string` in the generated types into a **narrow union**, so `"Build "` (trailing space) or `"builds"` fails to compile.

**This is the only data-touching step in the entire plan. Guards, in order:**
1. **Value-set audit first.** `SELECT DISTINCT phase FROM programs;` (and equivalents) against the live DB. If any value is out of the intended set, **defer that column** — do not force it.
2. **Locking cost.** `ALTER COLUMN ... TYPE` takes an `ACCESS EXCLUSIVE` lock and rewrites the table. Tables are small (solo-founder scale) so this is a sub-second blip, but run it in a low-traffic window and be aware it is not online-safe on large tables.
3. **Irreversibility of the type.** Postgres lets you `ALTER TYPE ... ADD VALUE` later, but **reordering or removing enum values is painful** (requires a new type + swap). If the value set is not yet stable (likely, given the triathlon expansion may add phases/session kinds), **prefer type-only narrowing (§3.2) over a real enum** — you get the same compile-time union with zero DB commitment and trivial reversibility.

**Decision:** Ship `0019` comments unconditionally. Only ship `0020` enum promotion for columns with a verified-clean, *stable* value set; otherwise use §3.2.

### 3.2 (Zero-DB-risk alternative to enum promotion) Type-only narrowing
Keep the column as `text` in the DB and narrow it in one place in application code:

```ts
// types/db-overrides.ts
import type { Database } from './database.types'

// Semantic unions the DB stores as text. Narrowing lives here, not scattered as casts.
export type Phase = 'base' | 'build' | 'peak' | 'taper'
export type ProgramStatus = 'draft' | 'active' | 'archived' // confirm against live values
```

This does not make the *generated* type narrower, but it centralizes the union so a read site becomes **one checked assertion** (`row.phase as Phase`) instead of scattered `as any`. Zero DB risk, instantly reversible, and the natural home if/when you later promote to a real enum.

### 3.3 Tables in scope for typing (all existing, none need changing to be typed)
`profiles`, `programs`, `workout_logs` (0005), `adaptations` (0006), `readiness_checkins` (0010), `subscriptions` (0014/0018), `wearable_activities` + workout-log links (0016/0017). All are covered automatically by `gen types`.

### 3.4 Where the schema-in-code lives
- `types/database.types.ts` — **generated, committed, never hand-edited** (enforced by a header banner + the CI drift gate).
- `types/db.ts` — hand-written re-exports/helpers (`export type Program = Tables<'programs'>`), the import surface for app code. If a JSONB override file exists (§5.4), `db.ts` re-exports the merged `Database` from there so nothing else imports `database.types.ts` directly.
- `types/db-overrides.ts` — semantic unions (§3.2) and, if used, the `MergeDeep` JSONB overrides (§5.4).

---

## 4. API / Route + Server-Action Changes

No route contract, request/response shape, or URL changes. All changes are internal type wiring; runtime is byte-for-byte identical.

### 4.1 Client factories (the wiring)
Add the generic wherever the clients are constructed:

```ts
// lib/supabase/server.ts
import { createServerClient } from '@supabase/ssr'
import type { Database } from '@/types/db' // re-exports the (possibly override-merged) Database

export function getServerClient(/* cookies... */) {
  return createServerClient<Database>(url, anonKey, { cookies: /* ... */ })
}

// lib/supabase/admin.ts  (service-role; privileged server-only writer)
import { createClient } from '@supabase/supabase-js'
import type { Database } from '@/types/db'

export const admin = createClient<Database>(url, serviceRoleKey, {
  auth: { persistSession: false },
})
```

After this single change, **every existing `as` cast becomes redundant but still compiles** (a cast on top of a typed result is legal). That is what makes the rollout incremental: wiring the generic is safe and global; removing casts is per-module and gradual.

### 4.2 Server actions & route handlers
- Program-generation action(s), the weekly-review **Apply** action, Strava sync/link handlers, readiness check-in writes, and the **Stripe webhook route handler** each get their casts removed when their module's turn comes.
- For inserts/updates, replace the `as` on the *input object* with `TablesInsert<'x'>` / `TablesUpdate<'x'>` so missing required (NOT-NULL) columns or unknown keys are caught **before** the write (§4.4).
- **Adopt `{ data, error }` discipline as casts come off.** Untyped code often reads `data` directly. With real types, `data` is `T | null` and you must handle `error` (or at minimum narrow `data`). `.single()` throws-to-`error` on 0/2+ rows; `.maybeSingle()` returns `T | null`. Picking the right one per call is part of the sweep, not an afterthought.

### 4.3 The `BILLING_ENABLED`-gated paths
The Stripe webhook writes entitlement; program generation and weekly-review **Apply** read it. These three are typed **first** (§10). Removing casts here means the webhook's `subscriptions`/`profiles` write is checked against actual columns, and each gate-read is checked to reference a column that exists.

### 4.4 Where untyped casts currently hide bugs (the crux of "why")
Concrete failure modes the migration eliminates:

1. **Entitlement write to a wrong/renamed column (webhook).** `admin.from('subscriptions').update({ status, current_period_end } as any)` — if a column was renamed (cf. `0018`) or misspelled, the cast swallows it, the field silently no-ops, and a paying user's entitlement is wrong. **Typed:** `TablesUpdate<'subscriptions'>` rejects unknown keys → compile error.
2. **Nullable columns treated as non-null.** With the *row* untyped, `program.phase.toUpperCase()` on a nullable `phase` compiles today because `program` is effectively `any`. **Typed:** `phase: string | null` forces a null check — precisely the `Cannot read properties of null` class.
3. **Enum/status typos.** `.eq('status', 'active')` against a DB storing `'trialing' | 'active' | 'canceled'` — a typo returns zero rows silently. **Typed (with §3.1b enum or §3.2 union):** the literal is checked.
4. **Insert missing a NOT-NULL column.** Linking a wearable activity writes a `workout_log`; if a required column (e.g. the NOT-NULL FK to the planned session) is omitted, the untyped insert compiles and fails only at runtime. **Typed:** `TablesInsert<'workout_logs'>` flags the missing field. Because "linking a synced workout = writing a `workout_log`" is the seam that feeds the adaptation engine, a malformed insert here corrupts adaptation inputs.
5. **`select('a, b, c')` shape drift.** Casting a partial select to a hand-written interface that has since diverged → fields silently `undefined`. **Typed:** the select's *inferred* row is checked against usage.
6. **Join / embedded-relationship cardinality.** postgrest returns embedded relations as an object or an array depending on cardinality; hand-cast code routinely gets this wrong (a documented postgrest-js footgun). Generated types infer the correct shape from the query string.

---

## 5. Engine / AI Implications

The deterministic engine and the Haiku generation layer are affected only at their **persistence boundary**, with one deliberate design choice.

### 5.1 Keep engine domain types decoupled from DB row types
`lib/engine/*` continues to own its rich domain types (phases, mesocycles, microcycles, zone distributions, HR bands, station pacing). **Do not** replace those with `Tables<'programs'>` — DB rows are a *storage projection* (flattened, often JSONB-blobbed), and coupling engine math to storage shape would be a regression. Instead:
- Add explicit **mapper functions** at the `lib/generation/*` persistence seam: `toProgramRow(domain): TablesInsert<'programs'>` and `fromProgramRow(row): DomainProgram`. These are the *only* place engine types meet DB types and the natural home for a vitest unit test.
- Drift becomes visible in one place: a migration that changes a persisted column breaks the mapper's compile, not some random read deep in the engine.

### 5.2 Haiku output stays Zod-validated — types don't replace validation
Generated `Database` types describe the DB's *declared* shape; they are **not runtime guarantees** and say nothing about Haiku's output. The flow is unchanged: Haiku generates session content → **Zod validates** → the deterministic engine reconciles mileage/cardio to targets → persist. The typed client only strengthens the **persist** step (the reconciled result is written via `TablesInsert<...>`). Zod at the untrusted boundary and types at the DB boundary are **complementary, not redundant.**

### 5.3 Adaptation-signal reads
ACWR, monotony, readiness, and session-RPE computations read `workout_logs`, `readiness_checkins`, `adaptations`. Typing these reads forces nullable-metric handling (e.g. a `workout_log` with null HR/pace feeding an average). Because synced wearable data lands as `workout_logs` with potentially sparse fields, the null-awareness the types force is directly protective of adaptation-signal correctness.

### 5.4 JSONB columns — the one place types add friction, not just safety
Any `jsonb` column (likely session content, zone distributions, the persisted `plan`) generates as `Json` — a recursive `string | number | boolean | null | {...} | [...]` type. Two consequences:

1. **Reads:** `Json` won't validate JSONB internals — that stays Zod's job.
2. **Writes (the friction):** `TablesInsert<'programs'>` will require the JSONB field be assignable to `Json`. A **Zod-inferred nested domain type is frequently *not* directly assignable to `Json`** (optional properties, branded types, tuples), so a naive cast-removal at a JSONB *insert* site can produce a new compile error that a `as unknown as Json` "fixes" — re-introducing exactly the cast we're trying to delete.

**Resolution:** for the handful of JSONB columns that carry structured domain data, register a **per-column type override** so the column types as the domain type in both directions. Supabase supports this via `MergeDeep` (`type-fest`):

```ts
// types/db-overrides.ts (the merged Database that lib/supabase/* imports via types/db.ts)
import type { MergeDeep } from 'type-fest'
import type { Database as Generated } from './database.types'
import type { Plan } from '@/lib/engine/types' // Zod-inferred domain type

export type Database = MergeDeep<Generated, {
  public: { Tables: { programs: {
    Row:    { plan: Plan }
    Insert: { plan: Plan }
    Update: { plan: Plan }
  } } }
}>
```

Do this **lazily** — only for columns that actually hurt during the P3 sweep — not preemptively. This keeps the "delete a cast, don't move it" invariant true at JSONB seams.

---

## 6. UX Outline

No end-user UX. The "users" are Levi and CI.

1. **Autocomplete & inline docs** on every `.from('...')`, column, filter literal, and insert object; column `COMMENT`s (§3.1a) render as hover docs — the entitlement/trial model becomes self-documenting at the call site.
2. **One command:** `gen:types` regenerates `types/database.types.ts` after a migration. A README/CONTRIBUTING note codifies "new migration → run `gen:types` → commit both files together."
3. **CI feedback:** forget, and the PR gate fails with "types out of date — run `gen:types`," including the diff. No silent drift, and — critically — it fails **before merge to `main`**, which auto-deploys to Vercel.
4. **Failure ergonomics:** the incremental rollout keeps every red compile scoped to the module you're on; a single module's cast-removal commit reverts without touching the global wiring.

---

## 7. Third-Party Services + Rough Costs

| Item | Service | Cost |
|---|---|---|
| Type generation | **Supabase CLI** (`supabase gen types typescript`), via `npx`/`pnpm dlx`/`bunx` | **$0** |
| Local schema spin-up for CI drift check | Supabase CLI + Docker in GitHub Actions (`supabase db start` applying `migrations/*`) | **$0** (CLI); Actions minutes only |
| CI runner | **GitHub Actions** (already the path to Vercel-from-`main`) | Private-repo free tier is ample for one lightweight job per PR; overage ~US$0.008/min. `supabase db start` pulls container images (~1–2 min) — cache them (§10) to keep the job snappy. |
| Optional: Zod-from-types | `supabase-to-zod` / `zod-to-ts` (dev dep) | **$0** |
| Optional: `type-fest` (for `MergeDeep`) | dev dep | **$0** |
| Hosting / DB | **No change** (Supabase + Vercel as-is) | $0 delta |

**Net new recurring cost: effectively $0.** The only consumption is a few GitHub Actions minutes per PR.

**One dependency caution (not a cost):** version compatibility between `@supabase/supabase-js`, `@supabase/ssr`, and the CLI — see §9.1.

---

## 8. Domain / Training-Science Basis

Infrastructure work, so training science enters indirectly — but the link is real: **the value of the adaptation engine depends on the integrity of its inputs.** ACWR (acute:chronic workload ratio), training monotony, readiness, and session-RPE are only as trustworthy as the `workout_logs` and `readiness_checkins` rows they aggregate. The failure modes types prevent (§4.4: missing required fields on a linked wearable log, nulls silently coerced, wrong-column writes) are exactly the ones that **silently corrupt the training-load math** and yield a subtly wrong periodized revision — an error invisible in a demo that erodes trust in the coach over weeks. Typing the persistence boundary is a guardrail on the *scientific correctness* of the plan, not just code hygiene.

---

## 9. Risks & Open Questions

### 9.1 (Real, must-handle) supabase-js / ssr / CLI compatibility — the `never` bug
There is a **known type-inference breakage**: certain `@supabase/supabase-js` versions (reported around **2.74.0**) expect an internal `__InternalSupabase` marker in the `Database` type that older CLI-generated types didn't include, causing **all queries to type as `never`** — the typed client becomes unusable. `@supabase/ssr` versions in that window (e.g. 0.5.2 / 0.7.0) were entangled. **Mitigation:**
- Before the sweep, **pin a known-good `supabase-js` + `ssr` + CLI trio**, and generate types with the **matching CLI version** so the marker (if required) is present.
- **Prove it end-to-end:** type *one real query* and confirm it infers a concrete row type (not `never`, not `any`). This is the P0 gate.
- Treat the CLI version as coupled to the client version; record both, exactly pinned, in the README note **and** in the CI workflow (`supabase/setup-cli` with a fixed `version:`, never `latest`).
- If inference is broken on current pins, upgrade to the fixed release or hold the client version until a compatible CLI ships. **This is the one gate that can stall the project — resolve it in P0 before committing to the sweep.**

### 9.2 `noUncheckedIndexedAccess` interaction — expect *new, legitimate* errors
Real row types surface null/undefined handling the untyped code ignored: nullable columns, `.single()` vs `.maybeSingle()` returning `T | null`, array-index access, and `data` being `null` on error. These are *correct* new errors, but they mean cast removal is **not purely mechanical** — each module needs a few real null-guards and `{ data, error }` handling. This is where the **M (not S)** comes from; budget for it.

### 9.3 JSONB / relationship-shape edges
`Json` columns aren't meaningfully typed without overrides, and a naive JSONB *insert* can spawn a cast you didn't want (§5.4). Mitigated by keeping Zod at those boundaries and adding `MergeDeep` overrides only where the sweep proves them necessary.

### 9.4 (Pre-work, can escalate effort to L) Live-schema vs migrations-schema divergence
If the **live DB has ever drifted from what `migrations/*` produces** (a hotfix run directly in the Supabase SQL editor, an unversioned change), then types generated from `--linked` (live) will differ from types generated from `--local` (migrations), and CI — which uses migrations — will fight the committed file forever. **P0 must confirm the live schema is fully reproducible from `0001–0018`** (diff live vs a fresh `supabase db start`). If it isn't, capture the drift as `0019` *first* and renumber the comments migration to `0020` (and enums to `0021`). Undiscovered drift here is the main path from M to L.

### 9.5 Regeneration discipline & CI source-of-truth
The scheme depends on regenerating types when migrations change. CI enforces it, but CI **must generate from the same source the drift gate trusts** — `migrations/*` via `supabase db start`, deterministic and secret-free — not a nightly pull from live, or you get a "green locally, red in CI" loop. **Decision:** CI generates `--local`. Neutralize cosmetic diff noise (trailing whitespace, line endings) in the gate (§10) so drift means *real* drift.

### 9.6 Open questions to resolve in P0 (before the sweep)
- **Browser client?** Is there a `createBrowserClient` usage, or is data access server-only? Determines whether 2 or 3 factories need the generic.
- **Exact `BILLING_ENABLED` gating columns** on `profiles`/`subscriptions` (to prioritize P2 and to write §3.1a comments).
- **Any Postgres functions / RPC in use today?** If yes, add `Functions` typing to the P2/P3 scope.
- **Current `supabase-js` / `ssr` / CLI versions** in `package.json` (drives §9.1).
- **Package manager** — the scripts below assume `pnpm`; if the repo uses npm/yarn/bun, translate `pnpm gen:types` accordingly. Confirm from the lockfile.
- **Is the repo a valid Supabase CLI project?** `supabase/config.toml` must exist and Docker must be available in CI for `supabase db start`. If only raw `.sql` migration files exist without CLI init, `supabase init` + config is P0 pre-work.
- **Confirmed closed, *stable* value-sets** for any column considered for enum promotion (§3.1b).

### 9.7 Types are not access control (false-confidence guard)
Generated types describe *shape*, not *reachability*. A perfectly typed `admin.from('subscriptions').select()` still returns `[]` if RLS denies the row (or if you forgot the service-role client on a privileged path). Types remove shape bugs; they do **not** remove RLS/permission bugs. Keep treating "did I get rows?" and "am I on the right client?" as separate, explicit checks.

---

## 10. Effort Estimate & Phased Build Plan

**Overall size: M** — low conceptual risk, mechanical breadth, plus a real null-guard tax. ~5–8 focused days, deliberately spread across 2–3 weeks so each module's cast removal ships and bakes independently. Variance is dominated by §9.1 (version bug), §9.2 (new null-guards), and the §9.4 escalation risk.

| Phase | Scope | Size | Gate |
|---|---|---|---|
| **P0 — Spike & de-risk** | Confirm live schema == `migrations/*` (§9.4); confirm CLI project + Docker (§9.6); pin & validate the `supabase-js`/`ssr`/CLI trio so **one real query infers** (not `never`, §9.1); add `gen:types` script; generate `types/database.types.ts` and commit (no consumers yet). Answer all §9.6 questions. | **S** | `next build` green; one query proven typed; open questions closed. |
| **P1 — Wire the generic (no cast removal)** | Add `<Database>` to the server client, admin client, and browser client (if any). Add `types/db.ts` re-exports. Casts remain; nothing breaks. | **S** | `next build` green; byte-identical runtime. |
| **P2 — Billing first** | Remove casts in the Stripe webhook + `BILLING_ENABLED` gate-reads (generation, weekly-review Apply). Use `TablesInsert`/`TablesUpdate` on entitlement writes; adopt `{ data, error }` discipline. Land **`0019_type_comments.sql`** (comments only) and regen types. | **M** | `next build` green; manual smoke of a webhook event in **Stripe test mode** (no prod touch); regen committed. |
| **P3 — Engine / generation persistence** | Introduce `toProgramRow`/`fromProgramRow` mappers (§5.1); type generation persistence and adaptation-signal reads; add `MergeDeep` JSONB overrides only where the sweep forces them (§5.4). Unit-test mappers (vitest). | **M** | `next build` + vitest green. |
| **P4 — Wearables & the rest** | Strava sync/link (`workout_logs` inserts via `TablesInsert`), readiness check-ins, remaining modules. **Optional:** land **`0020_enum_promotion.sql`** *iff* value-sets are verified clean **and stable** (§3.1b); otherwise use type-only unions (§3.2). Regen types after any migration. | **M** | `next build` green; regen committed after any `0020` change. |
| **P5 — CI drift gate + docs** | GitHub Action: `supabase db start` → `supabase gen types typescript --local` → diff against the committed file, fail on drift. README/CONTRIBUTING note: "new migration → `gen:types` → commit both." | **S** | Action red on an intentionally-stale type file; green on clean; runs on PR **before** `main` merge. |

**Rollout safety properties:** P1 wiring is global and safe; every later phase is a self-contained, revertible module. `next build` is the gate at every step. No phase changes runtime behavior. The **only** data-touching action in the whole plan is the *optional* enum promotion in P4, guarded by a value-set audit and a lock-window (§3.1b).

### Reference commands (for the README note)
```bash
# Generate from local migrations (used by CI — deterministic, no secrets).
# Requires Docker + a valid supabase/config.toml (supabase init if absent).
supabase db start
supabase gen types typescript --local --schema public > types/database.types.ts

# Generate from the live project (ad-hoc; requires an access token + project ref).
supabase gen types typescript --project-id "$PROJECT_REF" --schema public > types/database.types.ts

# Convenience script (adjust "pnpm" to your package manager):
#   "gen:types": "supabase gen types typescript --local --schema public > types/database.types.ts"
pnpm gen:types
```

### CI drift-gate sketch (`.github/workflows/db-types.yml`)
```yaml
on:
  pull_request:      # gate BEFORE merge to main (main auto-deploys to Vercel)
  push:
    branches: [main]
jobs:
  verify-types:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: supabase/setup-cli@v1
        with:
          version: 2.x.y        # PIN EXACTLY to the trio validated in §9.1 — never "latest"
      - run: supabase db start   # applies migrations/* into a throwaway local stack
      - run: supabase gen types typescript --local --schema public > types/database.types.ts
      - name: Fail on drift
        run: |
          # --ignore-space-at-eol neutralizes cosmetic line-ending noise (§9.5)
          if ! git diff --ignore-space-at-eol --exit-code --quiet types/database.types.ts; then
            echo "::error::database.types.ts is stale — run 'pnpm gen:types' and commit."
            git --no-pager diff types/database.types.ts
            exit 1
          fi
```
> Note: `supabase db start` pulls Docker images each run (~1–2 min). Cache the CLI/image layers (e.g. `actions/cache` on the Supabase image, or the `supabase/setup-cli` cache options) to keep the job fast. If image pulls prove flaky, an alternative is applying `migrations/*` to a bare `postgres` service container and pointing `gen types` at its connection string — but `--local` is the documented, lowest-friction path.

---

## 11. Definition of Done
- `types/database.types.ts` is generated, committed, header-banner-marked as generated, and never hand-edited.
- All three (or two) client factories carry `<Database>`; no data-access module constructs an untyped client.
- Zero `as`/`as any` casts remain on Supabase query results, inserts, or updates across billing, engine/generation persistence, adaptation reads, and wearables. (A grep for `from(` + `as ` in `lib/**` and route handlers returns only intentional, documented narrowings from §3.2 / §5.4.)
- Entitlement writes use `TablesInsert`/`TablesUpdate`; gate-reads reference only existing columns.
- `toProgramRow`/`fromProgramRow` mappers exist and are vitest-covered.
- The CI drift gate is live and demonstrably fails on a stale type file, on PRs, before `main` merge.
- README/CONTRIBUTING documents the "migration → `gen:types` → commit both" reflex and the pinned CLI/client versions.
- `next build` and vitest are green; a Stripe **test-mode** webhook event was smoke-tested; no production data, Stripe live mode, or deployment was touched to complete the migration.

---

## Sources
- [Generating TypeScript Types — Supabase Docs](https://supabase.com/docs/guides/api/rest/generating-types)
- [Generate types using GitHub Actions — Supabase Docs](https://supabase.com/docs/guides/deployment/ci/generating-types)
- [Creating a Supabase client for SSR — Supabase Docs](https://supabase.com/docs/guides/auth/server-side/creating-a-client)
- [TypeScript support — Supabase JS API Reference](https://supabase.com/docs/reference/javascript/typescript-support)
- [supabase-js #1738 — type inference returns `never` (supabase-js 2.74 / ssr, `__InternalSupabase`)](https://github.com/supabase/supabase-js/issues/1738)
- [supabase-js #1288 — `never` overridden in union types](https://github.com/supabase/supabase-js/issues/1288)
- [postgrest-js #471 — wrong type for one-to-one relationship joins](https://github.com/supabase/postgrest-js/issues/471)
- [Supabase Discussion #30057 — @supabase/ssr client and Database types](https://github.com/orgs/supabase/discussions/30057)
- [Overriding generated types with `MergeDeep` — Supabase Docs](https://supabase.com/docs/reference/javascript/typescript-support#helper-types-for-tables-and-joins)
- [Using TypeScript with Supabase: A Practical Guide to Type Safety — supalaunch](https://supalaunch.com/blog/supabase-typescript-guide)
