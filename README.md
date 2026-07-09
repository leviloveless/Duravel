# HyroxAI

AI-powered HYROX training program generator. See `product-spec.md` and
`architecture-plan.md` in the project root for the full spec and system
design; `requirements-questionnaire.md` (copied here as
`content/philosophy.md`) is the coaching philosophy source of truth.

## Stack

Next.js 14+ (App Router, TypeScript) · Supabase (auth + Postgres) ·
Claude Haiku (session generation) · Tailwind CSS · Zod · Vercel.

## Getting started

```bash
npm install
cp .env.local.example .env.local   # fill in Supabase + Anthropic keys
npm run dev
```

## Repo structure

```
app/                  Pages + API routes (App Router)
lib/engine/           Periodization Engine — deterministic, no AI (Milestone 3)
lib/ai/               Session Generator — Claude Haiku prompt + call layer (Milestone 5)
lib/supabase/         Browser + server Supabase clients
lib/schemas.ts         Zod schemas: profile, program, week, session
content/philosophy.md  Coaching philosophy, deployed copy of requirements-questionnaire.md
supabase/migrations/   SQL schema (profiles, programs, races)
```

## Build plan

See `architecture-plan.md` §9 for the 7-milestone build order. Currently
at **Milestone 1: Scaffold** — this commit.
