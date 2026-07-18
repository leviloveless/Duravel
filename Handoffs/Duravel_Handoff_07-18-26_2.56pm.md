# Duravel — Session Handoff

**Saved:** 2026-07-18 (Sat) 2:56pm ET · **Session type:** reconciliation + roadmap
**Naming standard (NEW, mandatory):** `Duravel_Handoff_MM-DD-YY_H.MMam/pm` in `C:\dev\duravel\Handoffs` (fallback: OneDrive `Training Program App\Handoffs` + notify). This file is the first to follow it.

---

## 1. What this session did

1. **Reconciled all prior handoffs + artifacts against the actual repo** (`C:\dev\duravel`) — see the status table in §3.
2. **Codified the mandatory handoff naming/location rule** (above) into project memory (`duravel-handoff-rule.md`) and the memory index.
3. **Rebuilt the roadmap as a single living "Planned vs Actuals" doc** — `Duravel_Roadmap_Planned_vs_Actuals.html` (repo root) + persisted as the desktop artifact `duravel-roadmap-planned-vs-actuals`.
4. **Filed the loose artifacts into the repo:** the 7 uploaded artifact PDFs → `docs\artifacts\`; the missing `Duravel_Handoff_20260718.md` → `Handoffs\`; `Duravel_iOS_HANDOFF.md` → `Apple\`.

---

## 2. Key reconciliation corrections (handoffs were stale)

- **Triathlon is BUILT and live on `main`** (Ironman 70.3 + 140.6, deterministic end-to-end: per-discipline zones, volume tiering, weekly adaptation). The old build-timeline had triathlon *starting* mid-Sep — it's months ahead.
- **The full engine is 9 sports on `main`** (HYROX, 5×DEKA, 2×triathlon, General Fitness) behind the byte-identical golden-HYROX gate (PR #13/#14 merged).
- **The $119.99 copy fix is already applied in the working tree** — `app/pricing/pricing-plans.tsx` shows `$119.99` / "about $10/mo" / "Save 50%". Memory/handoffs still called it "pending." It just needs **commit + push** (and verify `lib/email/templates/TrialEnding.tsx`).
- **iOS Parts 1–7 are generated but NOT integrated** into `hyroxai/ios` (confirmed by Levi). The `Apple\` folder is messy — it has a nested `Apple\Apple\` and reorganized Part folders.
- **Handoffs were scattered** across the repo and OneDrive with three naming styles; 07-17/07-18 handoffs were missing from the repo entirely (now filed).

---

## 3. Reconciled status — done vs not

**DONE / LIVE:** Stripe billing ($19.99/mo · $119.99/yr); Resend email infra; auth confirm + forgot-password; HYROX engine (byte-identical gate); all 5 DEKA formats; **triathlon 70.3 + 140.6**; General Fitness; DekaFit `/deka` estimator; wearables Strava import; `daily_metrics` layer (mig 0026); lifecycle email system **built + committed (gated off)**; strategy deliverables (Runna analysis, marketing strategy, result-card generator, both roadmaps).

**IN PROGRESS / PARTIAL:** $119.99 copy fix (applied, not pushed ≈90%); shared ingestion foundation (wearables + daily_metrics, not the full canonical unify ≈40%); Strava→pipeline refactor + cross-provider dedup (≈25%); result-card *wiring* into app flows (generator exists, ≈30%); triathlon full-MVP polish + live QA (≈70%); multi-sport strength/cardio specs (drafted, not in repo ≈20%).

**NOT STARTED:** Garmin Dev Program application; Apple Developer enrollment / D-U-N-S; lifecycle-email go-live wiring (webhook / unsub route / pref-center / welcome+receipt) + `EMAIL_ENABLED`; iOS integration (all Parts) + build/TestFlight/submit; Strava branded activity-write; cards→iOS share sheet; self-validation race season.

**BLOCKED (external, start now):** Garmin approval (gates all Garmin code); D-U-N-S → Apple enrollment (gates all iOS).

---

## 4. Do-now, highest leverage

1. Submit the **Garmin Connect Developer Program** application (Activity + Health API) — zero code, long lead.
2. Confirm **D-U-N-S** + start **Apple Developer** org enrollment.
3. **Commit + push the $119.99 copy fix**; verify `TrialEnding.tsx`.
4. Ship the **growth loop**: Strava branded activity-write + wire the result-card generator into completed-session / race flows.
5. Build the **shared ingestion pipeline** (canonical `sessions` + `wellness_daily`) — foundation for Garmin + iOS HealthKit.
6. Finish lifecycle-email wiring, then flip `EMAIL_ENABLED`.

---

## 5. Constraints / gotchas (don't relearn)

- **Cloud device-bridge writes to `C:\dev\duravel`:** files written this session were confirmed present via the bridge, but the documented history is that bridge writes may not reach the native Windows git index. **Verify these files appear in Windows Explorer / `git status`**; if any are missing, they can be re-dropped into the OneDrive `Handoffs` folder.
- Cloud session can `git push` but **cannot open PRs** (add_repo gate) — open manually at `github.com/leviloveless/Duravel/compare/main...<branch>?expand=1`.
- **Never break the golden-HYROX byte-identical test** — HYROX output must stay frozen.
- iOS archive/sign/upload is **macOS/Xcode or Codemagic only** — never from Windows.
- Billing model for iOS (Apple IAP vs external Stripe link) is an **open decision** — confirm before wiring the paywall.

---

## 6. Where things live

- **Living roadmap:** `C:\dev\duravel\Duravel_Roadmap_Planned_vs_Actuals.html` (artifact `duravel-roadmap-planned-vs-actuals`). Update the `ROWS`/`MILESTONES` arrays each session.
- **Artifact PDFs:** `C:\dev\duravel\docs\artifacts\`.
- **iOS build artifacts:** `C:\dev\duravel\Apple\` (Parts 1–7 + `Duravel_iOS_HANDOFF.md`, `Duravel_iOS_Morning_ToDo.md`).
- **Handoffs:** `C:\dev\duravel\Handoffs\` (this file + prior).
- **Project memory:** desktop persistent memory (`MEMORY.md` index + topic files; new `duravel-handoff-rule.md`).
