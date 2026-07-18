# Duravel — Engine-as-API Licensing: Build Plan

_Status: **PLAN ONLY — not implemented.** Drafted July 14, 2026. Re-validate against the current codebase before starting; module boundaries and function signatures cited here may have moved._

Companion to `Duravel_WhiteLabel_Coaching_Platform_Build_Plan.md`. Where that plan builds a full multi-tenant coaching product, **this plan does the opposite: it exposes the Duravel engine as a versioned, authenticated, metered API (and optional SDK) so _other_ apps and coaches build their own front end on top of it.** It's the smaller, faster-to-revenue path, because the hard part — the deterministic training-science engine — is already the right shape.

---

## 1. What we're selling

Programmatic access to Duravel's training intelligence, without the consumer app:

- **Program generation** — given an athlete profile + goal, return a fully periodized, individualized program (phases, microcycles, zone distribution, volume, session-by-session content).
- **Periodization skeleton only** — the deterministic structure without the AI-authored session prose, for licensees who want to render/fill content themselves.
- **Adaptation** — given a week's logs/readiness, return the recommended revision (hold, deload, protect long run, earned bump, re-anchor).
- **Supporting math** — HR zones, VDOT paces, HYROX station loads by division/sex, race pacing plans.

Buyers: other training/fitness apps, coaching-software vendors, wearable companies, and technical coaches who want the engine behind their own tools. The moat — the periodization and load-management logic — stays server-side and is never shipped to the client.

---

## 2. Why this is the smaller lift

The engine is already a **pure, deterministic library with no auth/DB/user coupling**:

- `lib/engine/*` — `buildSkeleton(toEngineInput(input))` takes an `EngineInput` and returns a `ProgramSkeleton`. Zero I/O. Already unit-tested in isolation (vitest, reconstructable in a sandbox).
- `lib/engine/index.ts` already defines a clean **public surface**: `buildSkeleton`, `toEngineInput`, `allocateMesocycles`, `sequenceMicrocycles`, `applyTapers`, `planWeek`, `analyzeNeeds`, the adaptation exports (`computeWeekSignals`, `decideAdaptation`, `applyDecisionToWeek`, `clampToBounds`), and the volume/zone constants.
- `lib/schemas.ts` — the Zod schemas that validate every input/output are already the contract; engine union types are `z.infer`'d from them, so schema and engine can't drift.
- Individualization (VDOT paces, working weights, division/sex station loads) is centralized in `assembleArgsFromInput` (`lib/generation/assemble.ts`), so one call produces all the personalized args.

The only genuine coupling to remove is in the **orchestrator**: `generateProgram(supabase, programId)` reads the input from a `programs` row and writes `program_data` back (`lib/generation/generate-program.ts`). The API needs a **stateless variant** that takes an input object and returns program content without any database (§4). Everything below it is already pure.

---

## 3. Surface to expose (v1 API)

Version everything under `/api/v1/` (or a separate service — see §8). Request/response bodies reuse the existing Zod schemas verbatim.

| Endpoint | Maps to | Notes |
|---|---|---|
| `POST /v1/skeletons` | `buildSkeleton(toEngineInput(input))` | Deterministic, **no AI**, cheap/instant. Returns `ProgramSkeleton`. |
| `POST /v1/programs` | stateless `generateProgramContent(input)` (§4) | Full program incl. AI-authored sessions. Metered on tokens. Async or streamed (multiple model calls). |
| `POST /v1/adaptations` | `computeWeekSignals` → `decideAdaptation` → `applyDecisionToWeek` | Given week targets + logs + readiness, return the revision decision + revised week. Deterministic, cheap. |
| `POST /v1/zones` | `lib/zones.ts` | HR zones from max/resting/threshold HR or custom bands. |
| `POST /v1/paces` | `lib/engine/paces.ts` | VDOT paces from benchmarks. |
| `POST /v1/pacing` | `lib/engine/pacing.ts` | HYROX race pacing plan by division/goal time. |

Design rules:
- **Deterministic endpoints (`/skeletons`, `/adaptations`, `/zones`, `/paces`, `/pacing`) are the easy, high-margin win** — no AI cost, instant, trivially cacheable. Consider shipping these first as a "periodization API" MVP before the AI-backed `/programs`.
- **`/programs` is the expensive one** — it fans out one Haiku call per mesocycle batch (`planChunks`, `MAX_WEEKS_PER_CALL = 3`). Make it async (job + webhook/poll) or streamed; don't hold a 60s request open per the current `maxDuration = 60` constraint.
- **The schema _is_ the API contract.** Publish the Zod schemas (or generated JSON Schema / OpenAPI) as the docs. Version the contract; never break `v1` request shapes.

---

## 4. The one real refactor: make generation stateless

Today's orchestrator is DB-coupled:

```ts
// current — reads a programs row, writes program_data back
generateProgram(supabase: SupabaseClient, programId: string): Promise<GenerateResult>
```

Extract a **pure content generator** with no Supabase dependency:

```ts
// target — pure: input in, program out, no persistence
generateProgramContent(input: GenerationInput): Promise<{
  program: ProgramData;
  skeleton: ProgramSkeleton;
  issues: string[];
  usage: GenerationUsage;
}>
```

Mechanics:
- Lift the body of the current `try` block in `generateProgram` (build skeleton → `planChunks` → `generateChunk` fan-out → `assembleProgram` → `verifyProgram`) into `generateProgramContent`.
- Keep the existing `generateProgram(supabase, programId)` as a thin wrapper that loads the row, calls `generateProgramContent`, and persists — so the consumer app is unchanged.
- The API route calls `generateProgramContent` directly and never touches the DB for program data.
- `generateChunk` needs the Anthropic key; keep that server-side (the licensee never sees it). Offer a **BYO-key** option later for licensees who want to pay Anthropic directly (§6).

This is a clean, low-risk extraction — the inner pipeline is already pure; only the read/write ends are being peeled off. Add a unit test that runs `generateProgramContent` against a fixed input and asserts a valid, verified program (extends existing engine tests).

---

## 5. Auth, keys, and metering

New, separate from the consumer app's Supabase Auth (licensees are machines, not end users):

- **`api_clients`** — `(id, name, org_name, api_key_hash, tier, status, created_at)`. Issue keys as `dvl_live_…`; store only a hash.
- **`api_usage`** — one row per call: `(client_id, endpoint, tokens_in, tokens_out, cost_usd, status, created_at)`. You already compute per-generation token/cost totals (`GenerationUsage`, priced in `generate-program.ts`) and log them to `generation_events` — reuse that accounting, just key it by API client instead of user.
- **Auth middleware** — bearer `Authorization: dvl_live_…`, look up the hash, attach the client + tier, reject if suspended. Independent of the Supabase user session.
- **Rate limiting per tier** — generalize the atomic `claim_generation_slot` pattern (`0012`) to key on `api_client_id`. Deterministic endpoints get a high limit; `/programs` gets a tier-based cap.

Metering is the business model, so build it in from the first endpoint, not later.

---

## 6. Pricing & AI cost pass-through

- **Deterministic endpoints:** flat per-call or per-seat/monthly tiers — near-zero marginal cost, high margin.
- **`/programs` (AI-backed):** cost is real and variable (Haiku tokens; the code already prices at $1/1M in, $5/1M out). Two models:
  - **Managed:** you use your Anthropic key, meter tokens via `api_usage`, and bill cost + markup. Simplest for the licensee.
  - **BYO-key:** the licensee supplies their own Anthropic key; you charge a platform fee only. Better margins for them, less cost risk for you. Add later.
- Publish tiers (e.g. Starter / Growth / Scale) with monthly call quotas + overage. The `api_usage` table is the source of truth for billing and quota enforcement.

---

## 7. Protecting the moat

- **The engine never ships to the client.** Only inputs/outputs cross the wire; the periodization/load logic stays server-side. This is inherently better IP protection than an SDK that runs the logic on the licensee's machine.
- **If an on-prem/SDK option is ever demanded**, ship a compiled/obfuscated build and a license key check — but default to hosted API. Note it as a future option, not v1.
- **Version + deprecation policy** — licensees build businesses on this; commit to a stable `v1` and a deprecation window. Breaking changes go to `v2`.

---

## 8. Deployment shape

Two options:

- **Same Next.js app, new `/api/v1/*` route handlers** — fastest; reuses the existing deploy (Vercel), engine imports, and schemas directly. Namespaced auth middleware keeps it isolated from the consumer routes. **Recommended for MVP.**
- **Separate service** (extract `lib/engine` + `lib/generation` + `lib/ai` + `lib/schemas` into a shared package, deploy a dedicated API app) — cleaner blast-radius and independent scaling, but more setup. Do this only if/when API traffic or reliability isolation demands it.

Either way, factor the engine + generation + schemas into a clearly importable boundary now (they nearly are) so the "extract to a package" move is cheap later.

---

## 9. Docs & SDK

- **OpenAPI spec generated from the Zod schemas** (e.g. `zod-to-openapi`) — single source of truth, always in sync with the contract.
- **Interactive docs** (Scalar / Redoc) + copy-paste cURL examples per endpoint.
- **Thin TypeScript SDK** (optional, later) — a typed client that wraps the REST calls and re-exports the request/response types. Low effort since the types already exist; high perceived value.

---

## 10. Phased plan

1. **Stateless refactor** — extract `generateProgramContent` (§4); add a unit test. No API yet. Consumer app unchanged.
2. **Deterministic API MVP** — `/v1/skeletons`, `/v1/adaptations`, `/v1/zones`, `/v1/paces`, `/v1/pacing` + API-key auth + `api_usage` metering. This alone is a sellable "periodization API" with no AI cost.
3. **AI generation endpoint** — `/v1/programs` async/streamed, token metering, managed billing.
4. **Docs + OpenAPI + pricing tiers + quota enforcement.**
5. **(Later)** BYO-key option, TypeScript SDK, extract-to-package / separate service if scale demands.

---

## 11. Effort estimate (solo founder, rough)

| Phase | Scope | Rough effort |
|---|---|---|
| 1 | Stateless `generateProgramContent` extraction + test | 2–4 days |
| 2 | Deterministic API + key auth + metering | 1–1.5 wks |
| 3 | AI `/programs` endpoint (async, metered) | 1–1.5 wks |
| 4 | OpenAPI docs + pricing/quota | 1 wk |
| 5 | BYO-key / SDK / service extraction (optional) | 1–2 wks |

Total to a sellable engine API: **~3–5 weeks**, with a **sellable deterministic-only MVP in ~2 weeks** (phases 1–2). Materially smaller than the coaching platform because there's no tenancy rewrite, no coach UI, and no RLS surgery — the engine is already decoupled.

---

## 12. Key risks & decisions

- **AI cost exposure on `/programs`.** Meter from day one and consider BYO-key early, or a naive flat price on a variable-cost endpoint erodes margin. The deterministic endpoints carry no such risk — lead with them.
- **Contract stability.** Once licensees ship on `v1`, the Zod schemas are a public commitment. Freeze them deliberately.
- **Statelessness must be truly stateless.** Any hidden read from `programs`/`profiles` in the generation path will break the API. The §4 extraction has to be verified to touch no DB (grep the call graph for `supabase` usage after extraction).
- **Support burden.** An API product means developer support, status page, uptime expectations — lighter than a full SaaS, but non-zero. Price for it.
- **Cannibalization vs. leverage.** Decide whether the API competes with the consumer app or complements it (e.g. only license to non-competing verticals). A positioning decision, not a technical one.

---

_Companion: `Duravel_WhiteLabel_Coaching_Platform_Build_Plan.md`. Source-of-truth for current state: `Duravel_Handoff_2026-07-14.md`, `lib/engine/index.ts`, `lib/generation/generate-program.ts`, and `lib/schemas.ts`._
