# Duravel Handoff — 07-21-26 4.12pm

## Session focus
Safety guardrails — a pure, tested analysis layer + a "Safety" tab. Written to the working tree (UNCOMMITTED). No engine generation logic changed → golden-HYROX unaffected.

## What changed (4 files)
- **NEW `lib/engine/guardrails.ts`** — pure `analyzeGuardrails(programData)` → `{ flags, clear }`. Read-only; never mutates the program. Four checks (all research-grounded, thresholds are named consts):
  - `run_jump` — a week's longest single run vs. the recent longest (trailing 4wk max); info >30%, warn >50% (Nielsen 2024).
  - `volume_spike` — weekly cardio-minutes vs. trailing mean; warn >50% (acute:chronic spike).
  - `concurrent` — ≥2 heavy lifts + ≥3 hard-endurance/hybrid sessions in a week (interference).
  - `impact` — weekly running mileage; info ≥55mi, warn ≥70mi (route to low-impact).
  - Also exports `worstSeverity(report)`.
- **NEW `lib/engine/guardrails.test.ts`** — 6 unit tests (clear program, each flag fires, null/empty safe).
- **NEW `components/program/guardrail-card.tsx`** — server component; all-clear state or a list of flags (warn=red/Watch, info=amber/Heads-up) with the detail + week.
- **`app/program/[id]/page.tsx`** — added a **Safety** tab (`<GuardrailCard report={analyzeGuardrails(data)} />`) right after Tracker.

## Design note
This is deliberately an **advisory analysis layer**, not an auto-rewrite of generation. That keeps it golden-safe and unit-testable (I can't run the engine in the cloud sandbox). A natural follow-up is to feed these flags back into generation as soft caps (e.g., cap the long-run step, cap strength volume at high endurance hours) — gated by weeklyHours so the golden path stays byte-identical.

## Verify + commit (from Windows CMD)
```
cd C:\dev\duravel
npm test        # runs the new guardrails.test.ts (6 tests); golden-hyrox unaffected
npm run build

git add lib/engine/guardrails.ts lib/engine/guardrails.test.ts ^
        components/program/guardrail-card.tsx "app/program/[id]/page.tsx" ^
        Handoffs/Duravel_Handoff_07-21-26_4.12pm.md
git commit -m "feat: safety guardrails analysis + Safety tab"
```
Note: `app/program/[id]/page.tsx` also carries the tabbed-view + Safety changes together if you hadn't committed the earlier program-features batch yet — the git add stages whatever's uncommitted in it.

## Still open (optional)
- Feed guardrails into generation as soft caps (gated by weeklyHours).
- Phase-1 loose ends (edit-mode weekly-hours prefill, DEKA ATLAS/ULTRA bands, tri_olympic test).
- Marketing polish (Resend PDF delivery, /admin science_leads, dedupe budget-copy).
- Push everything (nothing pushed yet — cloud egress blocked).
