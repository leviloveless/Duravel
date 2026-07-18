# Duravel — Multi-Sport Live QA Plan

_Written 2026-07-17. Purpose: verify every sport generates a correct program against **live** Supabase + Anthropic keys (the DEKA/Atlas AI-fill path has never been exercised live), and verify the eleven Tasks additions from the 2026-07-17 batch before/after they merge. Deterministic paths are unit-tested (446 passing); this plan covers what tests can't: the live AI fill, real rendering, and end-to-end feel._

Work top to bottom. Each check is `[ ]` — tick it, and log anything that fails in the **Bug log** at the bottom.

---

## 0. Pre-flight (do these first)

- [ ] **Deploy the branch.** Merge `fix/build-env-nonfatal` first if not already (deterministic deploys), then push `feat/tasks-batch-2026-07-17` and open its Vercel **Preview** deploy. QA on the preview URL, not production.
- [ ] **Env vars on the preview** (all environments, Production included): `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `ANTHROPIC_API_KEY`. Without the Anthropic key the DEKA/HYROX AI-fill silently degrades.
- [ ] **Apply migration `0026_daily_metrics.sql`** in the Supabase SQL editor. Required for the HR/HRV checks (#7) — the page will error on the daily-metrics fetch without the table. Treat as irreversible; confirm the table + 4 RLS policies exist.
- [ ] **Test account** with an active 14-day trial (billing is live; a trial account can generate).
- [ ] Have a benchmarks set ready to type: a 5K time, and for triathlon a **swim CSS** (e.g. `1:40`) and **bike FTP** (e.g. `250`). You'll run triathlon twice — once WITH these, once WITHOUT — so keep them handy.

**How to generate a program:** onboarding → pick the sport → fill benchmarks/experience → generate → open the program page. Note generation latency for the AI-fill sports (should be seconds, not a timeout).

---

## 1. Per-sport generation matrix

Nine sports across three engine paths. Station-hybrid (HYROX + all DEKA) uses the deterministic skeleton **+ AI session fill (Haiku)** — this is the untested-live path, give it the most scrutiny. Triathlon and general fitness are fully deterministic.

### 1a. HYROX (baseline / regression anchor)
- [ ] Generates with no error; program page renders.
- [ ] Looks like a normal HYROX program (8 stations, run intervals, race-format pacing). The **Pacing card** appears (HYROX-only).
- [ ] Weekly summary header totals (cardio time, miles) match the sum of the sessions shown — the reconciler must keep them exact.
- [ ] Golden regression: nothing about HYROX output should have changed this batch (the golden-oracle test enforces this; just eyeball that a fresh HYROX program looks unchanged).

### 1b. DEKA Fit  ·  1c. DEKA Mile  ·  1d. DEKA Strong  ·  1e. DEKA Atlas  ·  1f. DEKA Ultra
For **each** DEKA format:
- [ ] Generates against the live key with **no AI/reconcile error**; program validates (no blank/`undefined` sessions, no schema error).
- [ ] AI-filled session content is coherent and matches the prescribed skeleton (station lists, rep targets read sensibly — not gibberish or empty).
- [ ] Weekly summary totals match the sessions.
- [ ] **DEKA Fit specifically:** the 5K benchmark is required (round-2 rule: 5K required only for HYROX + DEKA Fit); the DEKA **pacing plan** card renders for running + station splits.
- [ ] **DEKA Mile / Ultra:** the pacing plan renders (Ultra should cover its 5 laps).
- [ ] **DEKA Atlas:** the needs analysis reflects the Atlas-specific scorers — absolute strength, overhead-pressing endurance, glycolytic capacity — and the program emphasis matches (not the generic run/station profile).

### 1g. Ironman 70.3  ·  1h. Ironman 140.6 (run each twice — with and without anchors)
- [ ] Generates (fully deterministic — should be instant, no AI).
- [ ] The **Experience** page asked for **swim + bike** experience (not hybrid).
- [ ] **Training zones by discipline** shows **all three** — swim, bike, run (this was the #8 bug).
  - [ ] WITHOUT CSS/FTP entered: swim shows effort ranges, bike shows **% of FTP**, each with a "add your … " nudge.
  - [ ] WITH CSS/FTP entered: swim shows exact **/100m** pace, bike shows exact **watts**.
- [ ] Bike zone rows carry a **secondary HR (% LTHR)** line under the power/% target.
- [ ] Bike **workouts** show watts (or %FTP) **and** a secondary HR cue; swim workouts show CSS-paced sets; runs are effort/Zone-based.
- [ ] **Long ride cap (#11):** 70.3 long ride tops out ~2.5–2.6h; 140.6 long ride is ≤3.5h in base/build and reaches ~5h only in the peak phase. The long-ride description tells the athlete to finish with a **15–25 min easy brick run**.
- [ ] **140.6 duty-of-care** copy present where expected ("never run the full marathon in training," fuel on 5h+ rides).
- [ ] Regenerate any Ironman program you created **before this batch** — old ones predate the rebound + long-ride fixes.

### 1i. General Fitness
- [ ] Generates (deterministic rotating-emphasis skeleton); optional sub-goal respected.
- [ ] Sessions render; weekly summary totals match.

---

## 2. Cross-cutting checks — the eleven Tasks additions

Verify these on the sports noted. Most are visible in the **weekly summary table** and on session cards.

- [ ] **#4 Strength = 60 min.** Open any program with lifts (HYROX / DEKA / General). Every strength session's estimated time reads **60 min**. The summary's Strength-time column counts 60 per lift.
- [ ] **#5 Long-run progression.** On a run-based program (HYROX / DEKA Fit / General): the week's **long run is clearly longer than the easy runs**, it **increases across weeks**, and **never exceeds 90 min**. Early weeks shouldn't have a long run barely bigger than an easy run.
- [ ] **#3 Time tracker.** Summary table shows **Metcon / Strength / Total** training-time columns; Total = strength + metcon + running + non-running cardio; values look right for the week's sessions.
- [ ] **#6 Planned vs. Actual.** Before logging: Actual columns show "—". **Log a session** with actual miles + duration → that week's **Actual Miles / Actual Cardio Time** populate; Planned columns unchanged.
- [ ] **#7 Daily HR/HRV.** (needs migration 0026) Use the **"Daily resting HR & HRV"** form to enter 2–3 days of RHR/HRV within one program week → that week's **Recovery avg (RHR / HRV)** cells show the correct **average** (not the last value). A week with no entries shows "—". Entering HR-only or HRV-only still averages the one present.
- [ ] **#8 Swim/bike zones** — covered in 1g/1h above.
- [ ] **#9 Bike FTP + HR** — covered in 1g/1h above (spot-check the Coggan bands: Z2 56–75% FTP, Z4 91–105% FTP; HR shown as % LTHR).
- [ ] **#10 Table width.** At a normal desktop width the **whole summary table is visible with no horizontal scroll**. Narrow the window / open on mobile → it degrades gracefully (scrolls only when genuinely too narrow).
- [ ] **#11 Long ride** — covered in 1g/1h above.

---

## 3. Regression / don't-break checks

- [ ] **HYROX unchanged** (see 1a) — the frozen output must look identical to a pre-batch HYROX program.
- [ ] **Billing / auth / email untouched** — pricing, login, forgot-password pages load; don't test-charge. `EMAIL_ENABLED` stays unset.
- [ ] **Adaptation / weekly review** still works on a run-based sport (log a full week → review banner offers to recalculate the next week).
- [ ] No console errors on the program page for any sport (open dev tools once per family).

---

## 4. Bug log

| # | Sport / feature | What you saw | Expected | Severity |
|---|---|---|---|---|
|   |   |   |   |   |

Severity: **blocker** (wrong/broken output, generation fails) · **major** (renders but incorrect) · **minor** (cosmetic).

---

## 5. Sign-off

- [ ] All 9 sports generate live with no error.
- [ ] DEKA/Atlas AI-fill content is coherent and schema-valid.
- [ ] All eleven Tasks additions verified.
- [ ] No regressions in HYROX / billing / auth.
- [ ] Bug log triaged; blockers fixed before merge to `main`.

**When done:** send me the bug log (or the filled-in table) and I'll turn each item into a fix. If it's all clean, this branch is safe to merge and deploy.
