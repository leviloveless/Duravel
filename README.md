# Duravel

An AI-assisted training-program generator for hybrid athletes. A deterministic
periodization **engine** designs the program structure and volume; a language
model fills in the concrete session content; the app then re-asserts every
numeric invariant so what's displayed always matches the plan. Triathlon
programs are built entirely by the engine, with no model call at all.

Ten sports: HYROX, five DEKA formats (fit / mile / strong / atlas / ultra),
three triathlon distances (olympic / 70.3 / 140.6), and general fitness.

Stack: **Next.js 16** (App Router, RSC) · **React 19** · **TypeScript** ·
**Supabase** (Postgres + Auth + RLS) · **Vitest** · deployed on **Vercel**.

The app lives at the **repo root** — `app/`, `lib/`, `components/`,
`supabase/`. There is no project subdirectory.

## Getting started

```bash
nvm use            # Node 20 (see .nvmrc)
npm install
cp .env.example .env.local   # then fill in the values
npm run dev
```

### Environment

All env vars are validated at import time by `lib/env.ts` (a missing or
malformed value fails fast with a clear message; during `next build` the same
check downgrades to a warning, because static page-data collection runs in
workers that don't always have the runtime env). See `.env.example` for the
full annotated list.

Required to boot:

- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` — Supabase project (public).
- `ANTHROPIC_API_KEY` — server-only; never prefix with `NEXT_PUBLIC_`.

Everything else is optional, so the app runs before any of it is configured:
site URL and generation-model overrides, Stripe billing (`BILLING_ENABLED`
gates enforcement), Resend lifecycle email, web push (VAPID), the wearable
integrations (Strava, Oura, Garmin, Apple Health), admin allowlist, and
`APPLE_TEAM_ID` for Universal Links.

## Scripts

| Script                            | What it does                                                          |
| --------------------------------- | --------------------------------------------------------------------- |
| `npm run dev` / `build` / `start` | Next dev / production build / serve                                   |
| `npm run test`                    | Vitest unit suite — `lib/**/*.test.ts`, ~1480 tests across ~141 files |
| `npm run test:coverage`           | Coverage over `lib/engine/**` + `lib/generation/**`, with thresholds  |
| `npm run typecheck`               | `tsc --noEmit`                                                        |
| `npm run lint`                    | ESLint (`next/core-web-vitals` + `next/typescript`)                   |
| `npm run format` / `format:check` | Prettier write / check                                                |
| `npx tsx scripts/preview.ts`      | Print a deterministic program skeleton to stdout                      |

Tests run in the node environment with placeholder env supplied by
`vitest.config.ts`; nothing makes a network call.

## Database & migrations

SQL migrations live in `supabase/migrations/` (numbered, plus `APPLY_NOTES.md`).
Apply new ones in the Supabase SQL editor (or via the Supabase CLI) **before**
deploying code that depends on them. Every user-owned table has Row Level
Security enabled with `auth.uid()`-scoped policies, and the app uses the anon
key + user JWT, so Postgres RLS is the single tenancy boundary. The one
exception is the Stripe webhook, which needs `SUPABASE_SERVICE_ROLE_KEY` to
write subscription state outside a user session.

## Architecture

- `lib/engine/` — pure, deterministic periodization (skeleton → slots → sequencing → volume/taper). Extensively unit-tested; `golden-hyrox.test.ts` freezes HYROX output.
- `lib/engine/sports/` — the per-sport config registry (`hyrox`, `deka`, `triathlon`, `general-fitness`), resolved by `getSport(id)`.
- `lib/generation/` — merges the engine skeleton with generated session content (`assemble.ts` enforces the engine's planned session kinds), reconciles volume to exact targets (`reconcile.ts`), verifies, and persists.
- `lib/ai/` — prompt construction plus one model call per mesocycle chunk (Zod-validated, one retry, timeout-bounded).
- `lib/schemas.ts` — Zod schemas doing triple duty: form validation, model-response validation, DB-read validation.
- `lib/wearables/` — one shared ingestion/dedupe pipeline behind every provider adapter (Strava, Oura, Apple Health, Garmin).
- `lib/email/` — Resend lifecycle email: templates, categories, dedupe, unsubscribe, webhook status.
- `app/` — App Router pages, server actions, and API routes; `components/` — the UI (server components fetch, client leaves interact).

## Quality gates

CI (`.github/workflows/ci.yml`) runs tests, build and typecheck on every PR.
Lint and `npm audit` also run but are **non-blocking** — the tree is not lint
clean yet. Pre-commit formatting/linting is available via Husky + lint-staged
but is not checked in: run `npx husky init` once after cloning, then set
`.husky/pre-commit` to `npx lint-staged`.
