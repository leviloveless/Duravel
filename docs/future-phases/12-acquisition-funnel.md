# Duravel — Acquisition Funnel: Free Tool, Lead Capture & Nurture

### Implementation-Ready Design & Build Spec

**Author:** Growth + Engineering (prep phase) · **Date:** 2026-07-15 · **Status:** Final — ready for phased build · **Owner:** Levi (solo founder) · **Provider:** Resend (shared with `07`) · **Migrations continue from:** whatever is free after `07` (see §3.0) · **Repo:** `C:\dev\duravel`

> **Scope note.** This is the *pre-account* half of Duravel's email story. Spec `07` is the **in-app lifecycle** system — it emails people who already have an `auth.users` account (welcome, trial-ending, receipts, weekly summary). This spec is the **acquisition funnel** — it captures and nurtures **anonymous leads** who do *not* yet have an account, and converts them into trial signups. The two share Resend, domain auth, the suppression list, and the `sendEmail()` choke-point; they do **not** share a data model (leads live in `email_subscribers`, keyed by email, not `auth.users`). Grounded in the current stack (Next.js 16 App Router, React 19, TS strict, Supabase + RLS with an untyped service-role admin client, Vercel, Stripe billing live 2026-07-14). Nothing here touches the engine or generation pipeline.

---

## 0. Relationship to existing specs and the `_phase3_draft`

This spec **re-homes** the acquisition portion of the earlier prep work so it stops colliding with what shipped:

- **`_phase3_draft/` is superseded.** Spec `07` absorbs its *transactional/user-lifecycle* pieces and removes the build-breaking `resend` import. This spec absorbs its *acquisition* pieces (`email_subscribers`, `email_sends`, `computeSends`, the 7 nurture templates, the `/pace` capture action). When `07` deletes the draft, lift the still-valuable, sandbox-verified `lib/email/schedule.ts` (`computeSends`, 4/4 vitest) and `lib/email/races.ts` into this build.
- **Migration number collision — fixed here.** The draft's `0018_email_subscribers.sql` **must be renumbered**: `0018` is now the live `subscriptions.user_id → auth.users` migration. See §3.0.
- **Depends on `07` for transport, but can ship a thin version without it.** The DekaFit stopgap (spec `13`) already sends via Resend directly. The *clean* build reuses `07`'s `sendEmail()` + suppression; if `07` hasn't shipped yet, this spec can call Resend directly behind the same `EMAIL_ENABLED` flag and back-fill the choke-point later.
- **Feeds `04` and `07`.** Captured leads that convert become `auth.users`, at which point `07`'s lifecycle and `04`'s proof-capture take over. The `email_subscribers.user_id` back-link (§3.1) is the seam.

Prep artifacts already in the repo that this spec formalizes: `Duravel_Phase3_Lifecycle_Email_Build_Plan.md`, `Duravel_Pace_Page_Copy.md`, `Duravel_Email_Templates.html`, and `marketing/*` (see spec `13`).

---

## 1. Goal & Why-Now

### Goal
Widen the **top of the funnel** the conversion work (`07`, `04`) then converts: give non-users a genuinely useful **free tool** (a HYROX pacing calculator), capture opted-in emails from it, and **automatically nurture** those leads toward a 14-day trial — with zero manual sending.

### Why now
- **Billing is live but the funnel is empty at the top.** `07`/`04` optimize trial→paid; they do nothing to *create* trials. A free tool + capture is the cheapest first-party acquisition surface and a compounding SEO asset ("hyrox pacing calculator").
- **Races are a fixed-date forcing function.** Spec `13` (field marketing) points QR codes at this funnel. DekaFit (Jul 25), SLC (Sep 19), Boston (Oct 10), Dallas (Nov 21) are immovable dates — the capture surface must exist to catch that traffic. (Until the full tool ships, the spec-`13` stopgap page catches it.)
- **The nurture sequence is already written and the scheduler is verified.** The 7 emails exist (`Duravel_Email_Templates.html`); `computeSends()` is unit-tested. This is mostly *wiring*, not net-new design.
- **Cost floor ~$0.** Shares Resend's free tier with `07`.

### Non-goals (this phase)
- Paid acquisition / ads (defer until LTV/CAC from organic + field is known).
- The in-app lifecycle emails — those are `07`.
- A/B testing platform, referral program (referral is a later growth phase; the `email_subscribers` model leaves room for it).

---

## 2. User-facing scope

### 2.1 The free tool — `/pace` (public, no account)
A HYROX **goal-time pacing calculator**. Inputs: division, sex, goal finish time, a recent run benchmark, experience. Output: per-run target splits + station pacing, framed around the "compromised runs" (see the算法 in §5). Value-for-email exchange: the result is shown after an email-gated step ("where should we send your splits?"). Copy is fully drafted in `Duravel_Pace_Page_Copy.md`.

### 2.2 Lead capture
Email + optional first name + **required consent checkbox**, tagged with `source`/`race_tag` from the `?src=` URL param (set by the QR codes in spec `13`). Writes an `email_subscribers` row via the service-role client.

### 2.3 Acquisition nurture sequence (7 emails, pre-account)
Distinct from `07`'s post-account lifecycle. Fully drafted in `Duravel_Email_Templates.html`.

| # | template | Trigger | Timing | Purpose |
|---|----------|---------|--------|---------|
| 1 | `welcome` | capture | instant | Deliver splits + the pacing-guide PDF; soft trial CTA |
| 2 | `nurture_1` | capture | +2 days | Education (Zone-2 / easy pace) — authority |
| 3 | `nurture_2` | capture | +5 days | Social proof / ambassador result |
| 4 | `nurture_3` | capture | +8 days | The ask — free-trial CTA |
| 5 | `nurture_4` | capture | +14 days | Last touch / gentle urgency |
| 6 | `race_week` | capture w/ `race_tag`, race future | race − 3 days | Race-week tips + in-person hook |
| 7 | `post_race` | capture w/ `race_tag`, race future | race + 1 day | "How'd it go?" → convert into next block |

### 2.4 Conversion + attribution
On trial signup, link the lead: set `email_subscribers.user_id` when the signup email matches an existing subscriber. This makes **lead → trial → paid** a single join and lets you measure per-`source` (per-race) CAC.

---

## 3. Data model / schema

### 3.0 Migration numbering (read first)
`07` consumes `0019` (`email_preferences`) and its subsequent ledger/suppression tables (≈`0020`–`0021`). **Assign this spec's numbers at build time from the next free slot** (≈`0022`+). Do **not** reuse `0018` (now the `subscriptions` FK migration). The `_phase3_draft/0018_email_subscribers.sql` file is a design reference only — renumber on the way in.

### 3.1 `email_subscribers` (anonymous leads)
```sql
create extension if not exists citext;

create table public.email_subscribers (
  id             uuid primary key default gen_random_uuid(),
  email          citext not null unique,
  first_name     text,
  source         text not null default 'free_tool',   -- free_tool | dekafit | slc | bos | dal | web
  race_tag       text,                                 -- null | dekafit | slc | bos | dal
  goal_time      text,                                 -- welcome merge
  result_payload jsonb,                                -- calculator inputs/outputs → splits_summary
  status         text not null default 'active'
                   check (status in ('active','unsubscribed','bounced','complained')),
  unsub_token    uuid not null default gen_random_uuid() unique,
  user_id        uuid references auth.users(id) on delete set null,  -- set at signup (attribution)
  consented_at   timestamptz not null default now(),
  created_at     timestamptz not null default now()
);
create index email_subscribers_user_idx on public.email_subscribers (user_id);

alter table public.email_subscribers enable row level security;
-- No anon/authenticated policies: all access via the service-role client (bypasses RLS),
-- matching the project convention. Capture is a public endpoint but runs server-side.
```

### 3.2 `lead_sends` (queue + ledger + idempotency, for anonymous leads)
Kept **separate from `07`'s user-keyed ledger** so `07` stays untouched and there's no nullable-`user_id` gymnastics. Same idempotency discipline.
```sql
create table public.lead_sends (
  id                  uuid primary key default gen_random_uuid(),
  subscriber_id       uuid not null references public.email_subscribers(id) on delete cascade,
  template            text not null,   -- welcome | nurture_1..4 | race_week | post_race
  status              text not null default 'queued'
                        check (status in ('queued','sent','failed','skipped','canceled')),
  scheduled_for       timestamptz not null,
  sent_at             timestamptz,
  provider_message_id text,
  attempts            int not null default 0,
  last_error          text,
  created_at          timestamptz not null default now()
);
-- Idempotency: partial unique so dry-run 'skipped' / 'failed' rows never occupy the slot
-- (adopt the exact fix from 07 §0.1 — a plain UNIQUE would block real/retry sends).
create unique index lead_sends_dedup
  on public.lead_sends (subscriber_id, template)
  where status in ('queued','sent');
create index lead_sends_due_idx on public.lead_sends (status, scheduled_for);
```
> **Reuse `07`'s hard suppression.** Before any lead send, check `07`'s `email_suppressions` (bounced/complained). A single suppression list must cover *both* systems or a complained address keeps getting lead mail.

---

## 4. Implementation

### 4.1 Transport — reuse `07`'s choke-point
All sends go through `07`'s `sendEmail()` (feature-flagged by `EMAIL_ENABLED`, batch-aware, suppression-checked, RFC-8058 one-click unsubscribe). This spec adds the *lead* templates + a *lead* scheduler; it does not re-implement transport. If built before `07`, call Resend directly behind `EMAIL_ENABLED` and refactor to the choke-point when `07` lands.

### 4.2 Scheduler — lift the verified pure logic
- `lib/email/schedule.ts` → `computeSends(capturedAt, raceTag)` — **sandbox-verified (vitest 4/4)**. Welcome immediate; nurtures +2/+5/+8/+14d; `race_week`/`post_race` race-relative and only if still future. Move it out of `_phase3_draft` verbatim.
- `lib/email/races.ts` → race-date config (DekaFit 2026-07-25, SLC 2026-09-19, BOS 2026-10-10, DAL 2026-11-21). One line per new race.
- Drain: fold lead sends into `07`'s existing cron (`/api/cron/email`) — query due `lead_sends` alongside due user sends in the same batch pass — rather than standing up a second cron.

### 4.3 Capture action
`app/(marketing)/pace/actions.ts` → `captureLead(input)`: Zod-validate (email + `consent === true`), rate-limit by IP (public endpoint), upsert `email_subscribers`, `computeSends()` → bulk-insert `lead_sends` (welcome inserted as `sent` after an inline send for instant delivery). Skeletons exist in `_phase3_draft/app/pace/actions.ts`.

### 4.4 Attribution hook
In the signup path, after account creation, `update email_subscribers set user_id = <new user> where email = <signup email> and user_id is null`. One statement; enables per-source CAC.

---

## 5. The calculator logic (the actual free tool)

This is the "roadmap #6 free tool" made concrete. Pure, testable, no I/O — keep it in `lib/pace/` and vitest it.

**Model:** `finish ≈ Σ run_time + Σ (station + roxzone) time`. Given a goal finish and an estimated station/roxzone budget (scaled by experience + division), the remaining time / 8 = average run pace; the plan then front-loads margin (runs 1–2 ~10–15s/km under average) and expects a 20–40s/km fade on the compromised runs (5–8). The full pacing rationale, the goal-time→splits table, and per-station strategy are already written in `Duravel_HYROX_Pacing_Guide.pdf` (accurate to official 25/26 loads) — the calculator is the interactive version of that guide, and the guide is the lead magnet delivered in `welcome`.

**v1 scope:** deterministic table lookup + interpolation is enough; do **not** over-engineer. Store the inputs/outputs in `result_payload` so `welcome` can render `splits_summary`.

---

## 6. UX
- `/pace` is mobile-first (people scan at races on phones). Copy: `Duravel_Pace_Page_Copy.md`.
- Result gate: show a teaser, capture email, then reveal + email the full splits.
- `?src=` → `source`/`race_tag` (default `free_tool`). SEO metadata targets HYROX pacing terms.
- Preference/unsubscribe: reuse `07`'s tokenized routes; lead unsubscribe flips `email_subscribers.status` and cancels queued `lead_sends`.

## 7. Cost
Shares Resend with `07` (free ≤3k/mo, 100/day; $20/mo Pro at scale). The free-tier 100/day cap is a design constraint if a race dumps a big batch at once — the cron's batching (`07` §4.1) handles it; a race spike may just trickle over a day.

## 8. Risks & guardrails
- **Public-endpoint abuse** → IP rate-limit + honeypot (the stopgap page already models the honeypot); `citext` unique email + idempotent enqueue absorb duplicates.
- **Deliverability on a new domain** → shared warm-up with `07` on `send.duravel.app` (see `Duravel_Resend_Deliverability_Runbook.md`).
- **Two email systems, one reputation** → single shared suppression list is mandatory (§3.2).
- **Promising splits before the calculator exists** → the spec-`13` stopgap promises a *guide* (the PDF), not live splits; keep that honest until `/pace` ships.
- **CAN-SPAM footer** → lifecycle lead mail needs the LLC postal address, same gate as `07` §2.4.

## 9. Effort & phased build plan
Overall **M** (the transport is `07`'s; this is capture + calculator + wiring).

- **Phase A — Capture MVP (S–M):** migration (`email_subscribers` + `lead_sends`), `captureLead`, a minimal `/pace` with the email gate, inline `welcome` send. Ships value immediately (replaces the stopgap).
- **Phase B — Nurture (S):** lift `schedule.ts`/`races.ts`; fold lead sends into `07`'s cron; nurture_1–4 live.
- **Phase C — Race triggers + tagging (S):** `race_week`/`post_race`; `?src=` source/race attribution.
- **Phase D — Calculator v1 + SEO + attribution (M):** the real pacing math in `lib/pace/`, `result_payload` → `splits_summary`, SEO page, and the signup `user_id` back-link.

**Gate:** `next build` green (flag off *and* on); `schedule.ts` + `lib/pace/*` vitest green; a real capture delivers `welcome` within seconds and queues correct `scheduled_for` rows.

## 10. Sequencing note (see `00-ROADMAP.md`)
Phase A/B can slot into **Wave 1–2** alongside `07`/`04` — it's the input side of the same conversion machine and is a modest **M**. Its *urgency* is set externally by the race calendar (spec `13`): the capture surface (full tool, or the stopgap) must exist before the next race. It does **not** displace `10`/`07`/`04`, which protect and convert the billing that's already live.
