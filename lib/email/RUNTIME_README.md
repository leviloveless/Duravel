# Duravel email runtime (`lib/email/*`)

The send layer for the 07 lifecycle emails. Everything routes through **`sendEmail()`** (`send.ts`), the single choke point. The ordered decision logic is factored into pure, unit-tested modules; `send.ts` is the thin I/O layer on top.

## Module map
| File | Role | Server-only? | Tested |
|---|---|---|---|
| `types.ts` | shared types (EmailTemplate, Tier, GateDecision…) | no | — |
| `categories.ts` | template → category / tier / pref-column registry | no | ✅ `categories.test.ts` |
| `dedup.ts` | dedup-key builders + trial-cycle discriminator | no | ✅ `dedup.test.ts` |
| `gate.ts` | ordered pre-claim + post-claim gates (pure) | no | ✅ `gate.test.ts` |
| `unsubscribe.ts` | stateless HMAC token mint/verify | no | ✅ `unsubscribe.test.ts` |
| `resend.ts` | singleton Resend client + `emailEnabled()` | **yes** | build |
| `recipient.ts` | resolve auth.users email via admin client (Zod) | **yes** | build |
| `render.tsx` | render job → `{ subject, html, text }` | **yes** | build |
| `send.ts` | `sendEmail()` orchestrator | **yes** | build |

The four `*.test.ts` suites (42 tests) are pure and run under your existing `npm test` (vitest). They import only the no-side-effect modules, so vitest never loads `server-only`. **All 42 pass and the whole set typechecks clean under your strict tsconfig** (verified against real `@supabase/supabase-js@2.110.2`, `resend@6.17.2`, `@react-email/*`).

## The gate order (enforced in `send.ts`, decided in `gate.ts`)
1. `EMAIL_ENABLED` flag → 2. recipient resolvable → 3. hard suppression → 4. (lifecycle) global unsubscribe → 5. (lifecycle) category flag → 6. (lifecycle) ≤1/day frequency cap → **claim** → 7. late entitlement re-check (trial-ending only) → render → send → advance ledger.

Service-tier templates (welcome, trial-ending, receipt) skip gates 4–6 but still honor the flag, a resolvable recipient, and hard suppression. The **idempotency claim** is a plain `insert … select` — a duplicate *live* key raises Postgres `23505` on the partial index (migration 0022), which `send.ts` catches and treats as "already claimed." No RPC needed.

## Env vars to add to `lib/env.ts`
Add these to `EnvSchema` (all `.optional()` so the app still boots with email off) **and** the matching `process.env.*` lines in the `safeParse({...})` call:

```ts
// --- Lifecycle email (Resend). Optional so the app boots before email is set up. ---
RESEND_API_KEY: z.string().optional(),
RESEND_WEBHOOK_SECRET: z.string().optional(),   // Svix signing (webhook — next layer)
EMAIL_FROM: z.string().optional(),              // e.g. "Duravel <coach@send.duravel.app>"
EMAIL_REPLY_TO: z.string().optional(),          // e.g. "levi.loveless@duravel.app"
EMAIL_ENABLED: z.string().optional(),           // "true" to actually send
EMAIL_UNSUB_SECRET: z.string().optional(),      // HMAC key for unsubscribe tokens
CRON_SECRET: z.string().optional(),             // Vercel cron bearer (cron — next layer)
```
`NEXT_PUBLIC_SITE_URL` already exists and is reused for absolute links.

Keep `EMAIL_ENABLED` **unset/false** for now — `sendEmail()` short-circuits to a `skipped` ledger row and sends nothing, so this whole layer can merge and deploy safely.

## Using it
```ts
import { sendEmail } from "@/lib/email/send";

await sendEmail({
  userId,
  template: "trial_ending",
  dedup: { template: "trial_ending", userId, stage: "T-3", trialStartedAt },
  render: { template: "trial_ending", props: { stage: "T-3", firstName, sessionsLogged, weeksCompleted, programName, subscribeUrl, annualUrl, manageUrl } },
});
```
Returns `{ status: "sent" | "skipped" | "failed", reason? }`. It's safe to call more than once for the same logical send — the dedup key + partial index guarantee at most one real send.

## Still to build (next layer — not in this drop)
The flows/scheduler (`flows/*`, `scheduler.ts`), the cron route (`app/api/cron/lifecycle`), the Svix webhook (`app/api/webhooks/resend`), the unsubscribe route (`app/api/email/unsubscribe`, GET+POST — it will call `verifyUnsubToken`), and the preference center (`/settings/email`). Then wire `welcome` into the first-session action and `receipt` into the Stripe webhook (downstream of the entitlement write). This drop is the choke point + its pure dependencies, which everything else builds on.
