# Duravel — Phase 3: Lifecycle Email & Lead-Capture Engine (Build Plan)

_Created: July 14, 2026_
_Status: **Planned** — new major development phase. Not yet built._
_Owner: Levi (solo)_
_Companion assets: `Duravel_Race_QR_Card.html`, `Duravel_Email_Templates.html`, `Duravel_Launch_Calendar_and_Revenue_Model.xlsx` (Race Activation Schedule tab)._

---

## 0. Where this sits in the roadmap

The product (M1–M11), the hardening tiers (Tier 0–3), billing (`0014`/`0015`), and wearables/sync-linking (`0016`/`0017`) are all built. What the launch plan needs next is **growth infrastructure** — the machinery that turns a QR scan at a race into a captured, nurtured, converting lead without any manual work.

This is that phase. It is additive: no changes to the engine, generation, or adaptation code. It introduces one new subsystem (`lib/email/*`), one new public capture surface (the free pacing tool), one migration (`0018`), and one scheduled job.

> **Proposed milestone label: M13 — Lifecycle Email & Lead Capture.**
> **Hard deadline: fully live before HYROX Salt Lake City, Sep 19, 2026** (the primary in-person activation). Deliverability warm-up means the *domain setup* sub-step must happen ~4–6 weeks earlier, in the Foundation phase.

---

## 1. Goal & scope

**Goal:** every email captured via the QR / free tool is automatically welcomed, nurtured toward a free trial, and — for race leads — re-engaged the week of their race and the day after, with zero manual sending.

**In scope**
- Public free-tool page with email capture (consent + source/race tagging).
- Store leads in Supabase; link a lead to a `user` when they later sign up (for conversion attribution).
- Seven templated emails (drafted in `Duravel_Email_Templates.html`).
- Immediate (transactional) sends + delayed/scheduled sends.
- Race-relative triggers driven by a race-date config.
- Unsubscribe, consent, and deliverability handled correctly from day one.

**Out of scope (for this phase)**
- The pacing-calculator math itself (that's launch-plan roadmap #6 — this phase assumes it exists or ships alongside; the capture layer is agnostic to it).
- In-app transactional email (trial-ending, payment receipts) — a natural *follow-on* that reuses this same `lib/email` sending layer.
- SMS / push.

---

## 2. Tooling decision

**Recommendation: Resend as the sending layer, with the schedule owned in-stack (Supabase + a Vercel Cron job).**

| | **Resend (recommended)** | **Loops.so (alternative)** |
|---|---|---|
| Model | Transactional/API-first email; you fire sends from code | Managed lifecycle/drip tool with a visual sequence editor |
| Fit with your stack | Excellent — you already fire server actions + Stripe webhooks; leads live in *your* Supabase | Good, but lead data + sequence logic live in Loops |
| Delayed nurture | You build a tiny queue + cron (~1 route, matches your `claim_generation_slot` pattern) | Built in — no code |
| Race-relative timing | Trivial — you compute `scheduled_for` from a race-date config | Awkward — needs date-property triggers in their UI |
| Trial-conversion attribution | Trivial — `email_subscribers.user_id` FK, one SQL join | Requires syncing events back out of Loops |
| Cost (launch scale) | Free ≤3k/mo (100/day); $20/mo for 50k | Free ≤1k contacts; paid tiers scale by contacts |
| Deliverability, unsub UI | You configure domain auth; Resend handles List-Unsubscribe | Handled for you |

**Why Resend wins for Duravel specifically:** you already have every primitive the "hard" path needs — server actions, a service-role admin client for privileged writes, numbered migrations, and a Vercel deploy that supports cron. Keeping leads in Supabase makes `lead → trial → paid` attribution a single join instead of a cross-tool sync. The only thing Loops saves you is the scheduler, and that's roughly one route handler and one pure function here.

**Pick Loops instead if** you'd rather not own *any* scheduling code and are happy to manage the sequence in a UI — a legitimate time-vs-control trade for a solo founder. The data model and the 7 templates in this plan port to Loops directly; you'd skip §6–§7's cron/queue and instead push subscribers to Loops via API on capture with `source`/`race_tag` properties.

_Verify current Resend pricing/limits and Vercel cron-frequency limits at build time — both change._

---

## 3. Architecture overview

```
                 ┌───────────────────────────── duravel.app ─────────────────────────────┐
   QR scan  ─▶   │  /pace  (free pacing tool)                                             │
   at race       │    ├─ calc splits (client)                                             │
                 │    └─ <EmailCaptureForm>  ──POST──▶  captureLead() [server action]     │
                 └───────────────────────────────────────┬────────────────────────────────┘
                                                          │ (service-role write)
                                        ┌─────────────────▼─────────────────┐
                                        │  email_subscribers  (Supabase)    │
                                        │  email_sends (queue + log)        │
                                        └───────┬───────────────────┬────────┘
                 send NOW (transactional)       │                   │  enqueue delayed rows
                 welcome+result  ───────────────┘                   │  nurture_1..4, race_week, post_race
                        │                                           │
                        ▼                                 ┌─────────▼──────────┐   every ~15 min
                 ┌────────────┐                           │  /api/cron/email   │◀── Vercel Cron
                 │  Resend    │◀──────────────────────────│  send due rows     │
                 │  (send.duravel.app)                    └────────────────────┘
                 └────────────┘
                        │  opens/clicks/bounces (webhook, optional)
                        ▼
                 signup ─▶ link email_subscribers.user_id  ⇒  lead→trial→paid attribution
```

Two send paths: **immediate** (fired inline from the capture action for instant gratification) and **scheduled** (rows in `email_sends` with a future `scheduled_for`, drained by the cron). Both go through one `sendTemplate()` function, both write an `email_sends` row, and both are idempotent.

---

## 4. Data model — migration `0018_email_subscribers.sql`

Next migration number is **`0018`** (current head is `0017`). Follows existing conventions: RLS **on**, no anon access, privileged writes via the server-side service-role client (same pattern as the wearable-secret and Stripe-webhook writes).

```sql
-- 0018_email_subscribers.sql
create extension if not exists citext;

-- Captured leads (pre-signup and post-signup).
create table public.email_subscribers (
  id             uuid primary key default gen_random_uuid(),
  email          citext not null unique,
  first_name     text,
  source         text not null default 'free_tool',      -- free_tool | dekafit | slc | bos | dal | web
  race_tag       text,                                    -- null | dekafit | slc | bos | dal
  goal_time      text,                                    -- e.g. '1:15:00', for the welcome merge
  result_payload jsonb,                                   -- raw calculator inputs/outputs for splits_summary
  status         text not null default 'active'
                   check (status in ('active','unsubscribed','bounced','complained')),
  unsub_token    uuid not null default gen_random_uuid() unique,
  user_id        uuid references auth.users(id) on delete set null,  -- set at signup
  consented_at   timestamptz not null default now(),
  created_at     timestamptz not null default now()
);

-- One row per (subscriber, template): queue + audit log + idempotency guard.
create table public.email_sends (
  id                  uuid primary key default gen_random_uuid(),
  subscriber_id       uuid not null references public.email_subscribers(id) on delete cascade,
  template            text not null,                       -- welcome | nurture_1..4 | race_week | post_race
  status              text not null default 'queued'
                        check (status in ('queued','sent','failed','skipped','canceled')),
  scheduled_for       timestamptz not null,
  sent_at             timestamptz,
  provider_message_id text,
  attempts            int not null default 0,
  last_error          text,
  created_at          timestamptz not null default now(),
  unique (subscriber_id, template)                         -- each template at most once per subscriber
);

create index email_sends_due_idx on public.email_sends (status, scheduled_for);
create index email_subscribers_user_idx on public.email_subscribers (user_id);

alter table public.email_subscribers enable row level security;
alter table public.email_sends       enable row level security;
-- No policies for anon/authenticated → all access is server-side via the service-role client,
-- which bypasses RLS. This matches the project's "RLS-only for user data, service-role for
-- privileged server ops" rule. (Optional later: a self-read policy once user_id is linked.)
```

**Idempotency is the whole safety story.** `unique (subscriber_id, template)` means a duplicate scan / double form submit / retry cannot double-send. The enqueue uses `insert ... on conflict (subscriber_id, template) do nothing`. The cron marks a row `sent` in the same transaction it dispatches, and only ever picks `status='queued'`.

---

## 5. The seven emails (drafted → see `Duravel_Email_Templates.html`)

| # | template key | Trigger | Timing | Purpose |
|---|---|---|---|---|
| 1 | `welcome` | Email capture | Instant (inline) | Deliver their splits, soft app intro, trial CTA |
| 2 | `nurture_1` | Capture | +2 days | Education: Zone-2 / easy-pace (authority) |
| 3 | `nurture_2` | Capture | +5 days | Social proof / ambassador result |
| 4 | `nurture_3` | Capture | +8 days | The ask — free-trial CTA |
| 5 | `nurture_4` | Capture | +14 days | Last touch / gentle urgency |
| 6 | `race_week` | Capture **with** `race_tag`, race in future | Race date − 3 days | Race-week tips + in-person hook |
| 7 | `post_race` | Capture **with** `race_tag`, race in future | Race date + 1 day | "How'd it go?" → convert into next block |

Merge fields used: `first_name`, `goal_time`, `splits_summary`, `race_name`, `ambassador_name`, `trial_url`, `tool_url`, `unsubscribe_url`. The template file shows each rendered, with its subject/preview/timing/merge header.

---

## 6. Sending & scheduling

**`lib/email/resend.ts`** — thin server-only Resend client (`import 'server-only'`). Never exposed to the browser bundle.

**`lib/email/templates.ts`** — one function per template returning `{ subject, html, text }`, taking a typed `props` object. (Option: `@react-email/components` + `@react-email/render` for nicer DX and previews; plain template literals also fine and add no deps. The drafted HTML in `Duravel_Email_Templates.html` drops in either way.)

**`lib/email/send.ts`** — `sendTemplate(subscriberId, template)`:
1. Load subscriber; if `status !== 'active'`, mark the `email_sends` row `skipped` and return.
2. Render template with the subscriber's merge props (+ `unsubscribe_url` from `unsub_token`).
3. Call Resend; on success set the row `sent` + `provider_message_id` + `sent_at`; on failure increment `attempts`, store `last_error`, leave `queued` (retried next cron tick, capped at e.g. 4 attempts → `failed`).

**`lib/email/schedule.ts`** — **pure, unit-tested** (matches the "pure logic in pure modules" convention). `computeSends(capturedAt, raceTag): { template, scheduledFor }[]` returns the welcome (now) + four nurtures (+2/+5/+8/+14d) + race_week/post_race (race-relative, only if the computed time is still in the future). No I/O — trivial to test.

**`captureLead()` server action** (`app/(marketing)/pace/actions.ts`):
1. Validate email + consent (Zod). Rate-limit by IP (reuse the existing limiter pattern) to stop abuse of a public endpoint.
2. `upsert` subscriber (service-role client) with `source`/`race_tag`/`goal_time`/`result_payload`.
3. `computeSends()` → bulk `insert ... on conflict do nothing` into `email_sends`.
4. **Send `welcome` inline immediately** (mark its row `sent`) for instant delivery.
5. Return success to the form.

**`app/api/cron/email/route.ts`** — the drain:
- Auth: require `Authorization: Bearer ${CRON_SECRET}` (Vercel Cron injects it). Reject otherwise.
- Select `status='queued' and scheduled_for <= now()` limit N (e.g. 100), oldest first.
- For each, `sendTemplate()`. Batch-friendly, idempotent, safe to run every 15 min.
- Register in `vercel.json`:
  ```json
  { "crons": [{ "path": "/api/cron/email", "schedule": "*/15 * * * *" }] }
  ```
  _Note: sub-daily cron frequency requires a Vercel paid plan. If staying on Hobby, either run the drain daily (fine for nurtures, too coarse for race-week timing) or point an external scheduler (e.g. cron-job.org) at the endpoint every 15 min using the same `CRON_SECRET`._

---

## 7. Race-relative triggers

**`lib/email/races.ts`** — the single source of truth for race dates:

```ts
export const RACES = {
  dekafit: { name: 'DekaFit',                 date: '2026-07-25' },
  slc:     { name: 'HYROX Salt Lake City',    date: '2026-09-19' },
  bos:     { name: 'HYROX Boston',            date: '2026-10-10' },
  dal:     { name: 'HYROX Dallas',            date: '2026-11-21' },
} as const;
```

When `captureLead` sees a `race_tag`, `computeSends` schedules `race_week` at `date − 3d` and `post_race` at `date + 1d`, **only if those instants are still in the future** at capture time (so a lead captured *at* the race still gets `post_race` but skips the already-passed `race_week`). Adding future races = one line here; no schema or code change.

---

## 8. Free-tool capture surface

- **Page:** `app/(marketing)/pace/page.tsx` — public, no auth. The pacing calculator + an `<EmailCaptureForm>` gated as "enter email to get your splits" (value-for-email exchange).
- **Source/race tagging:** read `?src=` from the URL (the QR encodes `duravel.app/pace?src=slc` etc.). Map `src` → `source` + `race_tag`. Default `free_tool` when absent.
- **Consent:** a checked-by-nothing (explicit) consent line — "Email me my splits + occasional training tips. Unsubscribe anytime." Store `consented_at`. This is single opt-in; it's compliant *because* the person is requesting the result. Do **not** pre-check.
- **SEO:** static metadata + HYROX pacing keywords (launch-plan Week 5 item).

---

## 9. Compliance & deliverability (do this first — it has lead time)

- **Send from a subdomain:** `send.duravel.app`, not the root. Protects the primary domain's reputation.
- **Domain auth in Resend:** add SPF, DKIM, and a DMARC record for `send.duravel.app`. **Set this up in the Foundation phase (launch-plan Week 2–3)** so the domain has sending history before the Sep 19 SLC surge. New domains that blast cold look like spam.
- **Warm-up:** the welcome email (highest engagement) naturally warms the domain as leads trickle in from build-in-public + the free tool through August. Don't import and blast an old list.
- **CAN-SPAM:** every email needs a real physical mailing address (registered agent or PO box is fine) and a working one-click unsubscribe. Both are in the drafted footer — fill the address before first send.
- **Unsubscribe:** `app/api/email/unsubscribe/route.ts?token=<unsub_token>` → set `status='unsubscribed'`, `update email_sends set status='canceled' where subscriber_id=... and status='queued'`. Also emit the RFC-8058 `List-Unsubscribe` / `List-Unsubscribe-Post` headers via Resend for one-click in Gmail/Apple.
- **Never** email purchased or scraped lists. The only entry point is the opt-in capture form.

---

## 10. Environment variables (add to `.env.example` + Vercel)

```
RESEND_API_KEY=            # SERVER ONLY
EMAIL_FROM="Levi at Duravel <levi@send.duravel.app>"
CRON_SECRET=               # random; guards /api/cron/email
# NEXT_PUBLIC_SITE_URL already exists — reused for absolute links in emails
# SUPABASE_SERVICE_ROLE_KEY already exists — reused for capture/cron writes
```

Wire them through `lib/env.ts` (the project validates env at boot). Email should be **feature-flaggable** like billing — e.g. treat unset `RESEND_API_KEY` as "email off" so the app still runs locally without it.

---

## 11. File-by-file build list

```
supabase/migrations/0018_email_subscribers.sql     # schema (§4)
lib/email/resend.ts                                 # server-only Resend client
lib/email/races.ts                                  # race-date config (§7)
lib/email/schedule.ts                               # PURE: computeSends() (§6) — unit tested
lib/email/templates.ts                              # 7 template fns → {subject,html,text}
lib/email/send.ts                                   # sendTemplate(), idempotent
app/(marketing)/pace/page.tsx                       # free tool + capture UI
app/(marketing)/pace/actions.ts                     # captureLead() server action
components/marketing/email-capture-form.tsx         # the form (consent, src)
app/api/cron/email/route.ts                         # scheduled drain (CRON_SECRET)
app/api/email/unsubscribe/route.ts                  # unsubscribe handler
vercel.json                                         # cron registration
lib/env.ts                                          # + RESEND_API_KEY, EMAIL_FROM, CRON_SECRET
.env.example                                        # documented (§10)
# tests
lib/email/schedule.test.ts                          # offsets + race-relative + past-race skip
lib/email/templates.test.ts                         # render snapshot + merge-field presence
```

Plus a one-line hook in the signup flow to backfill `email_subscribers.user_id` when a captured email later creates an account (the conversion join).

---

## 12. Testing

- **Pure logic (`schedule.ts`):** vitest — welcome is immediate; nurtures land at +2/+5/+8/+14d; with `race_tag` the race emails are race-relative; a race already within 3 days schedules only `post_race`; a fully past race schedules neither. No DB, no network.
- **Templates:** snapshot each rendered email; assert every `{{merge_field}}` is resolved (no stray braces) and the unsubscribe URL is present.
- **Idempotency:** integration-style test that a second `captureLead` for the same email inserts no duplicate `email_sends` rows.
- **Manual pre-flight before SLC:** capture a test lead with `src=slc`, confirm the welcome arrives, inspect the queued `race_week`/`post_race` rows' `scheduled_for`, send one through Resend's test mode, and run the inbox-placement / SPF-DKIM-DMARC check.
- **Gate:** `next build` (the real gate for anything touching Next/Supabase types) + `npm run test` green.

---

## 13. Build sequence & timeline (mapped to the launch calendar)

| Step | What ships | Launch-plan week | Why then |
|---|---|---|---|
| A | Resend account + **domain auth on `send.duravel.app`**; env wired | Foundation · **Wk 2–3** | Deliverability needs warm-up lead time before SLC |
| B | Migration `0018`; `captureLead`; capture form; **`welcome` inline send** | Prove the Engine · **Wk 4** | Rides with the free-tool build (Wk 4 calendar item) |
| C | `schedule.ts` + `email_sends` queue + Vercel Cron; nurture_1..4 | Prove the Engine · **Wk 5** | Turns capture into a real drip as the tool goes public |
| D | `races.ts` + race-relative `race_week`/`post_race`; source tagging | Build the Flywheel · **Wk 6–8** | Ready well ahead of the first big race |
| E | Pre-flight + deliverability check + metrics wired | Activate · **Wk 9–10** | **Bulletproof before SLC (Sep 19)** |

DekaFit (Jul 25, launch-plan Wk 2) lands **before** the full system — by design. For DekaFit, capture to a minimal version (Step B's form pointed at a simple landing page, welcome only) or even a plain form that just stores the email; treat it as the dress rehearsal. The full automated flow must be live for **SLC on Sep 19**.

---

## 14. Metrics

- **Funnel:** scans → captures (by `source`/`race_tag`) → welcome opens → trial starts → paid. The `email_subscribers.user_id` link makes `lead → trial → paid` a single join; tag event-sourced signups so per-race CAC is clean (launch-plan Wk 10–11).
- **Email health:** opens/clicks/bounces/complaints from Resend (optional webhook → could log to `email_sends` later). Watch bounce + complaint rates during the SLC surge.
- **Decision input:** per-race capture→trial rate feeds the launch plan's Week 12–13 "double down on the winning channel" call.

---

## 15. Risks & guardrails

- **Public endpoint abuse** → rate-limit `captureLead` by IP; validate + normalize email; the `unique` email constraint + idempotent enqueue absorb duplicates.
- **New-domain spam-foldering** → subdomain + full SPF/DKIM/DMARC + gradual warm-up; welcome-first.
- **Cron frequency on Vercel Hobby** → paid plan or external scheduler for sub-daily (race timing needs it).
- **Double-send** → `unique(subscriber_id, template)` + mark-sent-on-dispatch; the cron only picks `queued`.
- **Sending when email is unconfigured** → feature-flag on `RESEND_API_KEY`; app runs without it.
- **Scope creep** → this phase is capture + lifecycle only; in-app transactional email is a follow-on reusing `lib/email`.

---

## 16. Definition of done

- Migration `0018` applied to the live DB before the dependent code deploys.
- Scanning the QR → `/pace?src=slc` → entering an email delivers the **welcome within seconds** and queues the correct nurture + race rows with right `scheduled_for` values.
- Cron drains due rows idempotently; unsubscribe works and cancels queued sends.
- `send.duravel.app` passes SPF/DKIM/DMARC; a real address + one-click unsubscribe are in every footer.
- `schedule.ts`/`templates.ts` unit tests green; `next build` passes.
- **All of the above verified before HYROX Salt Lake City, Sep 19, 2026.**
```
