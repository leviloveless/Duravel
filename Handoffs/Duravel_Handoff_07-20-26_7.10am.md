# Duravel — Session Handoff

**Saved:** 2026-07-20 (Mon) 7:10am ET · **Session type:** Tasks.md batch — audit + standalone Ironman engine
**Continues:** `Duravel_Handoff_07-19-26_8.25pm.md` (Oura shipped). This handoff covers the `Tasks.md` feature batch worked after it.

---

## 1. Headline

Worked the `Tasks.md` list (`Training Program App/Tasks/`). **Most of the 14 additions were already implemented in a prior session** (verified in code). This session: shipped the two genuine UI gaps, then — per Levi's decision — built a **standalone Ironman/triathlon engine** separate from HYROX/DEKA. **Full engine suite is green (322 tests) and the golden-HYROX snapshot is byte-identical (unchanged md5).** Tasks.md marked (#1–#15) + renamed `Tasks_07.20.2026_07.10AM.md`.

---

## 2. Audit result (Tasks.md #1–#14)

Already done before this session (verified): #1 fartlek descriptions, #4 strength=60min, #5 long-run 90-min ramp (HYROX/run), #6 planned-vs-actual miles/cardio, #7 daily RHR/HRV + weekly averages, #8 tri swim+bike+run zone tables, #9 swim CSS + bike FTP/HR session paces, #10 wide `max-w-6xl` container, #11 long-ride 5–6h/75%-cap/brick. The repo carries `// Tasks addition #N` comments matching this exact list — it was largely built earlier and never marked/renamed.

Genuine gaps this session filled: **#2** (summary-table Dates column), **#12** (sticky nav header), and the triathlon-side of **#3/#5/#13/#14** via the new engine.

---

## 3. What shipped (commits on `main`, pushed status = LOCAL — Levi must `git push`)

- **`8aa5232`** — #12 sticky header (`components/nav-bar.tsx`) + #2 week Dates column in the summary table.
- **`53bdc71`** — **standalone Ironman engine.**

### The Ironman engine (`53bdc71`)
Decision (Levi): keep triathlon and HYROX/DEKA as **separate engines** sharing only data types + UI. HYROX/DEKA untouched → golden-HYROX byte-identical, no snapshot regen.
- **New `lib/engine/ironman/index.ts`** — the deterministic tri engine, moved out of `sports/triathlon.ts` and expanded. Receives `SportConfig` as a param (no config import → no cycle).
- **`lib/engine/sports/triathlon.ts`** — now ONLY the `tri_70_3`/`tri_140_6` configs + tables + `swimLevelFromCss`/`bikeLevelFromFtp`, and **re-exports** the engine from ironman so every existing import site (`skeleton.ts`, `generate-program.ts`, `adapt-week.ts`, tests) keeps working unchanged.
- **Strength (#3):** periodized full-body lifts — base 2/wk → build/peak 1/wk, 60 min, engine-placed on the lowest-minute day that isn't the long-run/long-ride day; base hypertrophy (3×8–12), build/peak strength (4×4–6).
- **Time trackers (#3):** `weekIronmanTime()` (additive in `lib/session-volume.ts`) → swim/bike/run/lift/total; the summary table shows these columns for triathlon (HYROX keeps metcon/strength/total). Wired via `sport` on `ProgramMeta` → `isTriathlon` in `program-view.tsx` (+ one-line `sport` add in `app/program/[id]/page.tsx`).
- **Long-run caps (#5, Levi's numbers):** 140.6 ≤150 min (~18 mi), 70.3 ≤120 min (~10 mi), ramped, always > that week's easy runs.
- **Discrete brick:** the weekly long ride is now a discrete bike→run `brick` with a 15–30 min easy run tail (was an inline note); dedicated mid-week race bricks kept.
- **A/B/C periodization (#13/#14) — triathlon only:** race week A ×0.50 / B ×0.60 / C ×0.70 (keep frequency, cut duration, `raceDay` + `race` session set); week-after A ×0.25 / B ×0.50 / C ×0.75, active-recovery (caps swim≤45/bike≤90/run≤30, no vo2/threshold/brick, after-A first day rest). Rebound-Increase-Deload preserved.

**Deferred by decision:** applying #13/#14 A/B/C periodization to **HYROX/DEKA** (would change the golden snapshot). HYROX keeps its existing simpler race model. Do it as its own deliberate pass if wanted.

---

## 4. Verification

- Ran the **full `lib/engine` suite in the cloud** (win32 node_modules can't run tooling in the Linux bridge, so a copied harness was used): **22 files / 322 tests pass**, incl. golden-hyrox (6) byte-identical (snapshot md5 unchanged, no `-u`), triathlon (18, updated), new ironman (17), deka, general-fitness. `tsc --noEmit` clean.
- Existing `triathlon.test.ts` assertions that legitimately changed (long-ride-is-brick, bike-heavy-by-time, deload-vs-held) were updated to the new intended behavior; a new assertion covers lift presence + long-run caps.
- **Not run:** the full Next app build (routes/TSX) — run `npm run build` on-computer / let Vercel build to confirm the app compile. Engine logic is fully cloud-verified.

---

## 5. Next actions
1. **`git push origin main`** — commits `8aa5232` + `53bdc71` (and any earlier unpushed) are local only.
2. Confirm the **Vercel build** is green (engine verified; app build not run here).
3. Regenerate a **triathlon program** (recalculate) to see strength + swim/bike/run/lift time columns + capped long runs live.
4. Optional future: apply A/B/C periodization to HYROX/DEKA (deliberate golden-snapshot regen); formalize the tri long-ride 2.5h lower-bound floor.
5. Still open from earlier: Apple Dev/D-U-N-S enrollment (top long-lead gate); Oura privacy-policy line + webhooks; WHOOP (needs a device).

---

## 6. Where things live
- **Ironman engine:** `lib/engine/ironman/index.ts` (+ `index.test.ts`); `sports/triathlon.ts` = configs + re-export shim. Memory: `duravel-ironman-engine`.
- **Tasks list (completed):** `Training Program App/Tasks/Tasks_07.20.2026_07.10AM.md` (renamed from Tasks.md, items #1–#15 marked).
- **Roadmap:** `Duravel_Roadmap_Planned_vs_Actuals.html` (updated).
- **Git-bridge gotcha (unchanged):** the mount allows rename but not unlink, so git leaves stale `.git/*.lock` + `tmp_obj_*` files; `mv` them aside before git ops (done). Commits authored as Levi, no AI-vendor references.
