# Duravel — Master Roadmap

**Author:** Chief of Staff (for Levi, solo founder) · **Date:** 2026-07-15
**Context:** Stripe web billing went LIVE 2026-07-14 ($19.99/mo · $149/yr · 14-day no-card trial). Product is HYROX-only. This roadmap sequences the 13 preparatory specs (`01`–`13`) into one decisive plan.

> **The one-line thesis:** You just turned on the money faucet on a single-sport product with almost no users. For the next quarter, **everything that isn't "get more trials to convert and stay" is a distraction** — with exactly two exceptions you must start *now* because they have long lead times and unblock everything else: **form the LLC** and **begin the engine-boundary extraction**.

---

## 1. How to read this roadmap

The 11 specs fall into four strategic buckets. The single biggest mistake would be to chase the exciting long-horizon bets (triathlon `01`, B2B `08`/`09`, mobile `06`) before the just-launched billing is actually converting and retaining. The second biggest mistake would be to *not* start the slow-calendar unblockers (LLC, engine extraction) early, because they gate the exciting stuff and you can't buy back the lead time later.

| Bucket | Specs | Role |
|---|---|---|
| **Revenue/retention NOW** | `07` emails, `04` proof, `10` typed-supabase, `05` community | Directly move trial→paid and churn on the *existing* product. Ship first. |
| **Retention depth** | `02` nutrition, `03` video | Increase WTP and stickiness once the conversion loop works. |
| **The brand bet** | `01` triathlon (+ `11` Garmin as its data layer) | The reason "Duravel" is sport-agnostic. Biggest TAM, biggest effort, needs the engine boundary. |
| **B2B / platform** | `08` API licensing, `09` white-label, `06` native mobile | High-ceiling, long builds, mostly gated on LLC and/or the engine boundary. |
| **Acquisition (top-of-funnel)** | `12` free tool + capture, `13` field marketing | Generate the trials that `07`/`04` convert. Externally paced by the race calendar. |

Two cross-cutting **unblockers** sit under everything and must be kicked off Day 1 in parallel with revenue work:
- **LLC formation** (paperwork, ~S effort, weeks of calendar) — gates `06` (Apple), `11` (Garmin production), `07`'s legal postal footer, and `09`'s B2B DPA/enterprise contracts.
- **Engine sport-abstraction / pure DB-free core** — the *same* refactor is the P0 of `01` (triathlon `ProgramType`), the pivotal extraction in `08` (§5.1), and the reuse-verbatim assumption in `09`. Doing it once, cleanly, de-risks the three highest-ceiling bets.

---

## 2. Recommended sequencing (with rationale)

### Wave 0 — Kick off Day 1, in parallel, zero-to-low eng cost
1. **Form the LLC.** It is on the critical path of four separate specs (`06` §1 hard blocker, `11` §0.1/§9 "highest risk", `07` §2.4 CAN-SPAM postal address, `09` §9 data-processor DPA). Every one of them calls it out. It's slow-calendar and cheap-effort — the definition of "start immediately." Per `06` §10 Phase 0: LLC → D-U-N-S → org verification is 1–2+ weeks of *waiting*. Buy that time now.
2. **Open the Garmin developer application** (`11` Phase 0). Approval is a 1–4 week handshake and may itself require the LLC. Paperwork only; no code.

### Wave 1 — Protect and convert the live product (weeks 0–6)
3. **Typed Supabase migration (`10`).** *Do this first of all the code work.* Rationale straight from `10` §1: "Billing is live and money is on the line. The Stripe webhook is the sole writer of entitlement… an untyped write here that targets a renamed/misspelled column… can wrongly grant or revoke paid access." It's **M** effort (~5–8 days), **zero runtime change**, and it de-risks every subsequent spec's schema work (`01` alone adds 7 migrations; `08`/`09` add 6–7 each of tenant-isolation SQL). Doing it *before* the triathlon/B2B table explosion is, in the spec's words, "strictly cheaper." This is the cheapest high-leverage move on the board.
4. **Lifecycle emails MVP (`07`, Phases A+B).** The highest-ROI email in any subscription business — **trial-ending** — does not yet exist (`07` §1). The trial expiry is already deterministic from `profiles.trial_started_at + 14d`, so T-3/T-1/T-0 conversion mail needs *zero new billing infrastructure*. It also finally kills the build-breaking `resend` import in `_phase3_draft`, unblocking the email tie-ins that `04`, `05`, and `09` all depend on. Effort is honestly the low end of **L** (~1.5–2 weeks). *Caveat:* the lifecycle (non-transactional) sends need the legal postal footer → they wait on the LLC address, but the transactional trial-ending/receipt path can ship first.
5. **Traction / social proof (`04`, Phases A+B).** Billing is live, so "the trial→paid moment is exactly where proof moves revenue" (`04` §1). This is now revenue-linked, not vanity. Duravel's structural advantage — engine-*verified* stats ("−4:12 vs. plan") — is hard to fake and impossible for competitors bolting on Senja to copy. **M** effort. Run the cold-start beta-cohort plan (`04` §9) concurrently to manufacture the first proof.

*Why 3–5 in this order:* `10` is insurance on the thing that just went live; `07` and `04` are the two most direct levers on trial→paid for a product that just started charging. All three touch the existing HYROX product only — no engine risk.

### Acquisition workstream (`12` free tool + capture, `13` field marketing) — parallel, paced by the race calendar

Everything above is about *converting and keeping* the users you already have. `12` and `13` are about *getting more trials into the top of that funnel* — the input side of the same machine. They run on a **separate, externally-fixed clock**: Levi races DekaFit (Jul 25), SLC (Sep 19), Boston (Oct 10), and Dallas (Nov 21), and each is a fixed-date chance to capture the exact ICP at a start line. You cannot defer a race.

- **`13` field marketing is operational and largely already prepped** — QR cards, the HYROX pacing-guide lead magnet, the stopgap capture page, and the go-live/deliverability runbooks all exist. The near-term action is simply to host the stopgap capture page before DekaFit and print the cards.
- **`12` free tool + lead capture is a modest M build** that can slot into **Wave 1–2** beside `07`/`04`: it reuses `07`'s email transport and the sandbox-verified `computeSends` scheduler, so it's mostly wiring. Ship Phase A (capture + welcome) first; it replaces the stopgap.

**Guardrail:** keep this lightweight until conversion is proven. Do **not** build paid acquisition, a referral program, or elaborate funnel tooling before `07`/`04` show trial→paid working — the races justify only a *minimal* capture-and-nurture surface, not a full growth stack. The goal is to not waste fixed-date race traffic, not to turn the quarter into an acquisition project.

### Wave 2 — Retention loop (weeks 6–14)
6. **Community (`05`).** "Billing went live… retention is the biggest LTV lever" (`05` §1). Cheapest retention surface available *before* native mobile. Runs on Skool (external, ~$100/mo) with a thin claim-code bridge — a solid **M**, no engine/AI change. Ships its in-app CTA independently, then picks up the email tie-in now that `07` unblocked Resend.
7. **Nutrition guidance-first MVP (`02`, Phases 0–D).** Turns Duravel from "train" into "train + fuel," raising WTP and retention with **zero incremental third-party cost** and **no training-engine changes** (`02` §10). The deterministic nutrition engine is the one **L** chunk. Crucially it's built *sport-agnostic* from day one, which "de-risks the triathlon bet" (`02` §1.4). Gate on validated retention before the L-sized food-logging v2.
8. **Video technique library (`03`).** Plugs the mid-workout retention leak (users leaving for YouTube at peak intent) and doubles as an SEO/top-of-funnel surface. Eng is **M**; the honest total is **M–L** because content production (filming ~30 clips) is the long pole. Can run its content shoots in parallel with other work.

*Why 6–8 after Wave 1:* these deepen retention but only matter once you're actually acquiring and converting trials. They're also all "read the engine's outputs, change nothing" — low risk, parallelizable.

### Wave 3 — The brand bet + its data moat (starts in parallel ~week 8, lands over months)
9. **Engine boundary extraction / `ProgramType` abstraction.** *Begin the P0 refactor early and in isolation.* This is `01` P0 ("land P0 completely before writing any triathlon code… highest-leverage and highest-regression-risk step") and simultaneously `08` §5.1 ("the single highest-value and highest-risk piece") and the enabling assumption of `09`. Do the `08` Phase-0 import audit (grep `lib/engine/*` for `supabase`/`createClient`/`process.env`) first to size it honestly. Prove HYROX output is **byte-identical** (`01` §5.6) as the exit gate.
10. **Triathlon MVP (`01`, P0→P2, sprint/olympic/70.3).** The flagship diversification the brand name exists for; longer, more expensive goals (a $500–900 Ironman entry, 6–9-month arcs) mean far better trial-to-paid and retention economics than HYROX's short cycles (`01` §1.2). Overall **L**. Sequence strictly after the P0 engine abstraction.
11. **Garmin completion (`11`).** Triathletes skew Garmin, and Garmin is the only source of the daily HRV/sleep/RHR signals the adaptation engine wants (`11` §1). It's the natural data layer for the triathlon push. **L**, gated on LLC + production approval — which is why Wave 0 opened the paperwork.

### Wave 4 — B2B / platform (demand-driven, after the engine boundary exists)
12. **White-label coaching platform (`09`)** and/or **Engine API licensing (`08`).** Both monetize the engine to a segment the $19.99 consumer app can't reach, with near-zero marginal cost, and both *reuse the engine boundary built in Wave 3*. Each is **8–12 weeks** solo. Pick based on inbound demand; do **not** run both at once (solo-founder support ceiling). `09`'s crown jewel is tenant isolation; `08`'s is billing/metering correctness.
13. **Native mobile (`06`).** Notifications are "the single highest-leverage retention lever for a training app" (`06` §1), but the shell is gated on the LLC→Apple path. Engineering (Phases 1–2) is buildable now (~3–5 weeks); if the LLC clears during Wave 1–2, this can slot earlier as a retention play. Ship **US-first** to exploit the friendlier anti-steering rules.

---

## 3. Dependency graph

```
                        ┌─────────────────────────────────────────────┐
        (Wave 0)        │  LLC FORMATION  (slow calendar, S effort)    │
                        └───┬──────────┬───────────┬──────────┬────────┘
                            │          │           │          │
                    Apple Dev      Garmin       CAN-SPAM    B2B DPA /
                    account        prod approval postal addr enterprise
                            │          │           │          contracts
                            ▼          ▼           ▼          ▼
                     06 native     11 Garmin    07 lifecycle 09 white-
                     mobile        (prod)       emails       label
                     (submission)               (lifecycle   (paid orgs)
                                                 sends)

  (Wave 1, foundational)
   ┌──────────────────────────┐
   │ 10 TYPED SUPABASE (M)    │  ── de-risks EVERY later migration
   │  protects live billing   │      (01, 08, 09 each add 6–7 migrations)
   └──────────────────────────┘

   ┌──────────────────────────┐
   │ 07 lifecycle emails      │  ── resolves _phase3_draft / `resend`
   │  (kills the build break) │      import, which UNBLOCKS:
   └───────────┬──────────────┘        • 05 community email tie-in
               │                        • 04 proof email review-requests
               │                        • 09 branded org emails

  (Wave 3 keystone)
   ┌──────────────────────────────────────────┐
   │ ENGINE SPORT-ABSTRACTION / DB-FREE CORE   │
   │  = 01 P0  =  08 §5.1 extraction  ≈ 09 reuse│
   └───────┬───────────────┬──────────────┬─────┘
           ▼               ▼              ▼
     01 triathlon    08 API license   09 white-label
     (P1→P2)         (endpoints)      (assign program)
           │
           ▼
     11 Garmin (richest data for triathlon multisport)

  (Smaller shared prerequisites)
   • Stable engine SESSION ID  →  02 session_fueling (§0.2 blocker),
                                  03 movement_slug linking
   • Durable background queue  →  01 generation_jobs, 09 cohort gen,
     (QStash/Inngest)             06 v2 offline-log sync
```

**Three load-bearing edges to internalize:**
- **`10` typed-supabase de-risks everything else.** It's compile-time-only and cheap, and every spec that adds tables (`01`, `04`, `08`, `09`) is safer written against a typed client. Front-load it.
- **LLC → {Apple, Garmin, email postal, B2B contracts}.** One slow paperwork item unblocks four specs. Its cost is calendar, not effort — so it must start Day 1 regardless of code priorities.
- **Engine abstraction → {triathlon, API licensing, white-label}.** The most valuable refactor in the codebase. Build it once, in isolation, byte-identical-verified, before any of the three bets that stack on it.

---

## 4. Effort × Impact table (all 11 areas + 2 unblockers)

Effort: **S** ≤2 days · **M** ~1 week · **L** ~2+ weeks · **XL** 6+ weeks. Impact = leverage on revenue/retention/strategic optionality *given a just-launched HYROX billing product*.

| # | Area | Effort | Impact | Note (per spec) |
|---|------|:---:|:---:|---|
| — | **LLC formation** | S | **High** | Unblocks `06`,`11`,`07`,`09`. Slow calendar → start now. |
| `10` | **Typed Supabase** | M | **High** | Protects the live entitlement writer; de-risks all future migrations. Zero runtime change. |
| `07` | **Lifecycle emails** | L (low) | **High** | Trial-ending = highest-ROI email; unblocks `_phase3_draft`/`resend`. |
| `04` | **Traction / social proof** | M | **High** | Directly moves trial→paid; engine-verified stats are uncopyable. |
| `01` | **Triathlon engine** | L | **High** | The brand thesis; better retention/WTP economics than HYROX. Needs engine P0. |
| `06` | **Native mobile** | L (+LLC) | **High** | Notifications = top retention lever; blocked on LLC→Apple. |
| `05` | **Community** | M | **Med** | Cheapest pre-mobile retention surface; ~$100/mo Skool. |
| `02` | **Nutrition** | L | **Med–High** | Raises WTP; sport-agnostic build de-risks triathlon. |
| `03` | **Video library** | M–L | **Med** | Retention leak + SEO funnel; content is the long pole. |
| `11` | **Garmin** | L (+LLC/approval) | **Med** | Data moat for triathlon; unique HRV/sleep signals. |
| `09` | **White-label B2B** | XL (8–12 wk) | **Med–High** | Seat revenue, stickier than D2C; needs engine boundary + LLC/DPA. |
| `08` | **API licensing B2B** | XL (8–11 wk) | **Med** | New revenue, no cannibalization; near-zero marginal cost. |
| `12` | **Acquisition funnel** | M | **Med–High** | Free tool + lead capture feeds trials into the `07`/`04` conversion machine; reuses `07` transport. |
| `13` | **Field marketing / race activation** | S (ops) | **Med** | Fixed-date race capture; assets already built. Calendar-driven, not deferrable. |

---

## 5. Concrete 30 / 60 / 90-day plan

### Days 0–30 — "Protect the money, start the slow clocks"
- **Day 1 paperwork (parallel, non-eng):** file the LLC (`06`/`11`/`07`/`09`); submit the Garmin developer application (`11` Phase 0); recruit the 10–20 athlete beta cohort for proof cold-start (`04` §9).
- **`10` Typed Supabase, P0→P2:** pin the supabase-js/ssr/CLI trio and prove one query infers (the `never`-bug gate, `10` §9.1); wire the generic; remove casts in the **billing path first** (Stripe webhook + `BILLING_ENABLED` reads). Ship `0019_type_comments.sql`.
- **`07` emails, Phase A:** resolve `_phase3_draft`, pin `react-email` against React 19, prove `next build` green with `EMAIL_ENABLED=false`; stand up domain auth (DKIM/SPF/DMARC on `send.duravel.com` — start DNS propagation early).
- **Exit:** billing code is type-checked; email system deploys dark; LLC + Garmin clocks are ticking.

### Days 30–60 — "Turn on conversion"
- **`07` emails, Phase B:** ship Welcome, Trial-ending T-3/T-1/T-0 (with late-entitlement re-check), Receipt, Weekly summary; flip `EMAIL_ENABLED=true`. (Lifecycle sends go live once the LLC postal address exists.)
- **`04` proof, Phases A+B:** schema + `detectProofEvent`/`deriveStats` (with the ACWR double-count guard), in-app capture, founder moderation queue, pricing-page + `/proof` display with FTC disclosures. Route first approved verified-stat cards to the **pricing page** (nearest revenue).
- **`10` finish:** engine/generation persistence + wearables casts removed; CI drift gate live.
- **Begin `08` Phase-0 engine import audit** (½–1 week) to size the abstraction refactor honestly.
- **Exit:** the two most direct trial→paid levers (conversion emails + pricing proof) are live on the HYROX product; the engine-extraction scope is known.

### Days 60–90 — "Retention loop + open the brand-bet runway"
- **`05` Community MVP (P0–P2):** Skool group, claim-code bridge, `/community` streak/milestone surface, funnel instrumentation so joiner-vs-non-joiner retention is *measurable* before any deeper investment.
- **Engine `ProgramType` abstraction (P0):** execute the refactor in isolation; **byte-identical HYROX snapshot** is the exit gate. This is the keystone for `01`, `08`, `09`.
- **Kick off `02` nutrition Phase 0/A** (session-id prerequisite + foundations) and/or **`03` video content shoots** in parallel (content is schedule-independent).
- **If LLC cleared:** start `06` native Phase 1 (Capacitor shell + OAuth round-trip prototype — the highest-uncertainty piece) and advance `11` Garmin Phase 0 to eval credentials.
- **Exit:** retention loop instrumented; engine boundary proven; triathlon/B2B/mobile all have a clean runway.

---

## 6. Quick-wins vs. deep-bets

**Quick wins (weeks, high certainty, ship on the existing HYROX product):**
- `10` Typed Supabase (**M**, zero runtime risk, protects billing) — the highest ROI-per-day item on the board.
- `07` Lifecycle emails (**L-low**) — deterministic trial-ending conversion, no new billing infra.
- `04` Social proof (**M**) — verified-stat cards, direct pricing-page lift.
- `05` Community (**M**) — config + one bridge + one surface, external platform does the heavy lifting.
- **LLC filing** (**S** effort) — the cheapest unblock of the most downstream work.

**Deep bets (months, higher uncertainty, strategic ceiling):**
- `01` Triathlon (**L**) — the brand's reason to exist; gated on the engine abstraction.
- `09` White-label (**XL**, 8–12 wk) — tenant-isolation-heavy; new B2B revenue class.
- `08` API licensing (**XL**, 8–11 wk) — engine-extraction- and billing-correctness-heavy.
- `06` Native mobile (**L** + LLC) — notification retention, but store-review and entity gated.
- `11` Garmin (**L** + approval) — data moat, but externally gated on Garmin + LLC.
- `02` Nutrition (**L**) — sits between: guidance-first MVP is bounded, but the food-logging v2 is a genuine deep bet (defer until retention proven).

---

## 7. Explicit "do NOT do yet" — with reasons

1. **Do NOT build native mobile before the LLC is filed and the engine/conversion basics are in (`06`).** The whole thing is hard-blocked on LLC→Apple (`06` §1). Filing the LLC is Day-1 paperwork; *engineering* the shell before conversion emails/proof exist would be optimizing a distribution channel for a funnel that isn't converting yet. Start the LLC clock; hold the code until Wave 2–3.

2. **Do NOT start triathlon program code before the `ProgramType` P0 refactor is complete and HYROX is proven byte-identical (`01` §5.1, §10).** The spec calls this "non-negotiable." It's the highest-regression-risk step and everything stacks on it; writing sport code first guarantees a messy fork and risks silently regressing the paying HYROX product.

3. **Do NOT launch either B2B line (`08`, `09`) this quarter.** Both are XL (8–12 weeks each), both depend on the engine boundary that doesn't exist yet, and both add a *support relationship* burden a solo founder shouldn't take on while the D2C conversion loop is still being tuned. `09` §9 and `08` §9 both flag solo-founder support load as a top risk. Let inbound demand + the engine boundary (Wave 3) decide which one, and never run both concurrently.

4. **Do NOT build nutrition food-logging (`02` v2, Phase E) or the adaptive-energy layer yet.** `02` §10 is explicit: ship guidance-first (zero food-DB cost, no engine change) and "validate retention/willingness-to-pay before committing to the L-sized food-logging build." Food diaries are "a deep, thankless build."

5. **Do NOT count on Garmin as a near-term deliverable (`11`).** It's gated on Garmin production approval *and* possibly the same LLC. Open the paperwork now, build against eval behind `GARMIN_ENABLED`, but do not put it on the critical path for anything until approval + entity land (`11` §0.1, §9).

6. **Do NOT ship the enum-promotion migration in `10` (§3.1b) preemptively.** The triathlon expansion will add phases/session kinds, so the value sets aren't stable. Use type-only narrowing (`10` §3.2) — zero DB risk, reversible — until the schema settles. (Ship only the `0019` comments migration unconditionally.)

7. **Do NOT turn on lifecycle (non-transactional) email sends before the LLC postal address exists (`07` §2.4).** CAN-SPAM / Gmail bulk-sender rules require a valid physical address in the footer. Ship the *transactional* trial-ending/receipt path first; hold weekly-summary/win-back bulk until the address is real. This is another reason the LLC is Day-1.

8. **Do NOT build in-app community, video captions/search, or coach's-note AI personalization in the first pass (`05` L3, `03` later, `03`/`04` Haiku extras).** Each is explicitly deferred in its spec until the cheaper MVP proves the retention hypothesis. Instrument first (`05`'s funnel events), invest second.

---

## 8. The single most important sentence

If you do only three things this quarter: **file the LLC on Day 1, ship `10`+`07`+`04` to protect and convert the billing you just launched, and start the engine-abstraction P0 in isolation** — because those three moves respectively unblock the future, defend the present, and open the door to the brand bet, at the lowest effort-to-leverage ratio available.
