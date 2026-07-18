# Duravel — Session Handoff

_Last updated: 2026-07-18 (Sat). Session type: **strategy + planning** (competitive analysis, pricing, marketing, integration/app roadmaps, shareable assets). No repo code shipped — deliverables are docs/tools delivered in-session; apply to the repo natively (see §7)._

---

## 1. TL;DR — what this session produced

1. **Pricing decision executed on Stripe, copy fix still pending.** Annual is now **$119.99/yr** in Stripe + env; the website/email copy still says $159.99 → **live mismatch**, runbook written.
2. **Competitive analysis vs Runna** (interactive dashboard) + **3-scenario Year 1–5 projection**.
3. **Marketing strategy** mirroring Runna's playbook, sequenced for bootstrapped/part-time year 1.
4. **Two build plans** (Garmin import, iOS Capacitor app) merged into **one sequenced roadmap**.
5. **Shareable result-card generator** built (4 card types, exports 1080px PNG).

---

## 2. Pricing — annual → $119.99 (ACTION PENDING)

**Verified live 2026-07-17/18:**
- Stripe product `prod_Ut3BnXkptmdRK0`. Annual price `price_1TuBKrEnQhxb3rRAMKVzVpE3` = **$119.99/yr** (active, live). Monthly `price_1TtH5CEnQhxb3rRAKnX1JqWf` = $19.99/mo.
- `STRIPE_PRICE_ANNUAL` env already points to the $119.99 price. Old $149 price archived; **no $159.99 price ever existed** in Stripe.

**⚠️ Live mismatch — the remaining work is copy only:** the app still *displays* $159.99, so the site advertises $159.99 but Stripe charges $119.99. Fix (see `Duravel_Annual_Price_119_Runbook.md`):
- `app/pricing/pricing-plans.tsx` → `$159.99`→`$119.99`; `about $13.33/mo`→`about $10/mo`; badge `Save 38%`→`Save 50%`.
- `lib/email/templates/TrialEnding.tsx` (6 strings) → `$159.99`→`$119.99`; `$13.33`→`$10`; "four months"→"six months".
- Cosmetic: comments in `lib/email/templates/types.ts` and `.env.example`.
- Then commit + push (Vercel auto-deploys). No Stripe or env change needed. Existing subs unaffected.

---

## 3. Competitive analysis vs Runna (reference)

Dashboard artifact: **`duravel-vs-runna`** (also `duravel_vs_runna.html`).

Key public facts on Runna: subscription app launched Mar 2022; ~30% MoM growth; subscriptions ~30× in 2023; ~$40M ARR run-rate and **~300k paying subscribers** at the **April 2025 Strava acquisition** (est. $80–120M); ~$10M total VC raised; pricing $19.99/mo · $119.99/yr. **~40–60% of active users pay** (trial-gated model, not freemium). Milestone dates are modeled reconstructions, not disclosed.

**Duravel Year 1–5 (3 scenarios, ~$145 blended ARPU):** Bear 25k subs / $3.6M ARR · **Base 90k / $13.1M** · Bull 280k / $40.6M (Bull ≈ Runna's actual curve). Plan around Base; Bull needs paid fuel + full-time.

---

## 4. Deliverables index (this session)

| Deliverable | File | Artifact | Where it lives |
|---|---|---|---|
| Runna comparison dashboard | `duravel_vs_runna.html` | `duravel-vs-runna` | chat + gallery |
| Annual $119.99 runbook | `Duravel_Annual_Price_119_Runbook.md` | — | chat |
| Marketing strategy | `Duravel_Marketing_Strategy.md` | — | chat |
| Garmin integration plan | `Duravel_Garmin_Integration_Build_Plan.md` | — | chat |
| iOS Capacitor app plan | `Duravel_iOS_App_Build_Plan.md` | — | chat |
| Merged build roadmap | `Duravel_Build_Roadmap.html` | `duravel-build-roadmap` | chat + gallery |
| Shareable result cards | `duravel_result_cards.html` | `duravel-result-cards` | chat + gallery |

_All delivered in-session. None are in the repo yet — save/commit natively where you want them (the dated handoffs + `HANDOFF.md` live in the repo root; the business-plan handoff lives in the Business plan folder)._

---

## 5. Key decisions locked this session

- **iOS build = Capacitor** wrapper around the Next.js app (loads hosted `app.duravel.app`; not static export). Add HealthKit + push + share-sheet + Sign-in-with-Apple to justify native (dodges Guideline 4.2).
- **iOS payments = external purchase link to existing Stripe** (US). Per the **Dec 2025 appeals ruling**, Apple may eventually charge a "reasonable" fee on external links but the district court hasn't set one → **effectively 0% now**. Add IAP (Small Business Program, 15%) for international later. US-first.
- **Shared ingestion pipeline built ONCE:** Strava + Garmin + iOS HealthKit all normalize into canonical `sessions` + new `wellness_daily`; model feed = adherence (planned vs actual) + training load + readiness. Each provider is then a thin adapter.
- **Marketing = Runna's free viral loop, bootstrapped.** Retention engine + Strava-write branding + result cards + `/deka` wedge + SEO + community + gifted ambassadors. Defer paid ads/localization to funded phase.

---

## 6. Immediate next actions (highest leverage first)

1. **Apply to the Garmin Connect Developer Program TODAY** (Activity + Health API) — approval-gated, long lead, zero code. Gates the entire Garmin lane.
2. **Confirm D-U-N-S + start Apple Developer org enrollment** — gates the entire iOS lane (see [Mercury/Apple chain] memory).
3. **Apply the $119.99 copy fix + push** — resolves the live price mismatch (§2).
4. **Ship the growth loop early:** Strava activity-write with Duravel branding + wire the built result cards into the completed-session/race flows. No approvals needed; pure upside.
5. **Turn on lifecycle emails** (`EMAIL_ENABLED`) when ready — system is built and gated off.
6. Then: build the **shared ingestion pipeline** (foundation for Garmin + HealthKit), per the roadmap (`Duravel_Build_Roadmap.html`, M1 ~W5).

---

## 7. Constraints & gotchas (don't relearn these)

- **Device bridge does NOT write through to `C:\dev\duravel`** in cloud sessions — edit the repo on-computer or via native Git Bash. Bridge writes don't reach Windows git.
- **Cloud session can `git push` but cannot open PRs** (hits an `add_repo` access gate). Open PRs manually via `https://github.com/leviloveless/Duravel/compare/main...<branch>?expand=1`.
- **Founder context:** part-time for ~the next year, and **restricted from taking outside money in year 1** → year 1 is bootstrapped proof-of-loop, then raise/partnership from strength. (Also worth an employment-agreement / IP check before pushing hard on side work — legal question, not covered here.)
- **Cross-provider dedup is mandatory** once Garmin lands — the same run syncs to both Strava and Garmin.
- **Engine safety rule (from `HANDOFF.md`):** HYROX program output must stay byte-identical; enforced by tests. Don't regress it.

---

## 8. Where to pick up

New session: read this file, then the roadmap artifact (`duravel-build-roadmap`) for sequencing and the marketing strategy for growth. The two approval applications in §6 (Garmin, Apple/D-U-N-S) are the gating long-lead items — everything else waits on them, so fire both first. Memory index (`MEMORY.md`) has been updated with all of the above.
