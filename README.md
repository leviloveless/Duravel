# Duravel

An AI-assisted HYROX training-program generator. A deterministic periodization
**engine** designs the program structure and volume; **Claude Haiku** fills in
the concrete session content; the app then re-asserts every numeric invariant
so what's displayed always matches the plan.

Stack: **Next.js 16** (App Router, RSC) · **React 19** · **TypeScript** ·
**Supabase** (Postgres + Auth + RLS) · **Anthropic SDK** · **Vitest** ·
deployed on **Vercel**.

## Getting started

```bash
nvm use            # Node 20 (see .nvmrc)
npm install
cp .env.example .env.local   # then fill in the values
npm run dev
```

### Environment

All env vars are validated at boot by `lib/env.ts` (a missing/malformed value
fails fast with a clear message). See `.env.example`:

- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` — Supabase project (public).
- `ANTHROPIC_API_KEY` — server-only; never prefix with `NEXT_PUBLIC_`.
- `NEXT_PUBLIC_SITE_URL` (optional) — absolute URL for signup confirmation links.
- `ANTHROPIC_MODEL` (optional) — model override (defaults to `claude-haiku-4-5`).
- `GENERATION_UNLIMITED_EMAILS` (optional) — comma-separated emails exempt from the daily cap.

## Scripts

| Script | What it does |
|---|---|
| `npm run dev` / `build` / `start` | Next dev / production build / serve |
| `npm run test` | Vitest unit suite (engine + generation) |
| `npm run test:coverage` | Vitest with coverage + thresholds |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint (`next/core-web-vitals` + `next/typescript`) |
| `npm run format` / `format:check` | Prettier write / check |

## Database & migrations

SQL migrations live in `supabase/migrations/` (numbered). Apply new ones in the
Supabase SQL editor (or via the Supabase CLI) **before** deploying code that
depends on them. Every user-owned table has Row Level Security enabled with
`auth.uid()`-scoped policies; the app only ever uses the anon key + user JWT
(no service-role key), so Postgres RLS is the single tenancy boundary.

## Architecture

- `lib/engine/` — pure, deterministic periodization (skeleton → slots → sequencing → volume/taper). Extensively unit-tested.
- `lib/generation/` — merges the engine skeleton with AI session content (`assemble.ts` enforces the engine's planned session kinds), reconciles volume, and persists.
- `lib/ai/` — prompt construction + the single Haiku call per mesocycle (Zod-validated, one retry, timeout-bounded).
- `lib/schemas.ts` — Zod schemas doing triple duty: form validation, AI-response validation, DB-read validation.
- `app/` — App Router pages, server actions, and API routes; `components/` — the UI (server components fetch, client leaves interact).

## Quality gates

CI (`.github/workflows/ci.yml`) runs tests, build, typecheck, and lint on every
PR. Pre-commit formatting/linting is wired via Husky + lint-staged (run
`npx husky init` once after cloning, then set `.husky/pre-commit` to
`npx lint-staged`).
