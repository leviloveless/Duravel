# Duravel — Future Phases Prep Pack

_Prepared overnight, 2026-07-15. Planning & research only — no code, git, database, Stripe, or deployment was touched. Everything here is for you to review and decide on._

**Start with [`00-ROADMAP.md`](00-ROADMAP.md)** — it sequences all 13 specs into one plan (waves, dependency graph, effort×impact, 30/60/90-day plan, and explicit "don't do yet" calls).

Then dive into whichever spec you want. Each is a self-contained, implementation-ready design doc (goal, scope, schema/migrations, API changes, engine/AI implications, UX, costs, risks, effort + phased build plan), grounded in the real stack.

| # | Spec | What it covers |
|---|------|----------------|
| 00 | Master Roadmap | How to sequence everything below |
| 01 | Triathlon / Ironman module | The flagship: extend the engine beyond HYROX to swim/bike/run |
| 02 | Nutrition module | Fueling guidance periodized to training load |
| 03 | Video / technique library | HYROX-station + lift demos linked to sessions |
| 04 | Traction & social proof | Verified-result testimonials → pricing-page conversion |
| 05 | Brand & community | Low-maintenance community + retention loop |
| 06 | Native mobile (Capacitor) | App Store path + push notifications (LLC-gated) |
| 07 | Lifecycle & transactional email | Trial-ending conversion; finishes the `_phase3_draft` |
| 08 | Engine API licensing (B2B) | License the periodization engine as an API |
| 09 | White-label coaching platform (B2B) | Coaches/gyms run Duravel under their brand |
| 10 | Typed Supabase client (tech debt) | Remove `as` casts; protect the live billing writer |
| 11 | Garmin integration completion | Finish the scaffold; HRV/sleep → readiness |
| 12 | Acquisition funnel | Free HYROX pacing tool + anonymous lead capture + nurture; feeds `07`/`04` |
| 13 | Field marketing & race activation | QR cards + race-day capture playbook (DekaFit/SLC/Boston/Dallas) |

**The roadmap's headline:** you just turned on billing for a single-sport product with few users, so this quarter is about protecting and converting that — front-load `10` (typed Supabase, protects the entitlement writer), `07` (trial-ending emails), and `04` (social proof) — while starting the two slow-calendar unblockers on Day 1: **form the LLC** and **begin the engine sport-abstraction refactor**. Hold the exciting big bets (triathlon, B2B, mobile) until those are in place. Running in parallel on a separate, **calendar-driven** clock: the **acquisition funnel** (`12` free tool + lead capture, `13` race field-marketing) — it feeds trials into that conversion machine and is paced by fixed race dates (DekaFit Jul 25 → Dallas Nov 21), so a minimal capture surface must exist now even while the big product bets wait.
