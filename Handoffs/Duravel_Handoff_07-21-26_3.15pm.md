# Duravel Handoff — 07-21-26 3.15pm

## Session focus
Surfaced the weekly-time-budget **tradeoff in-app** on the program page (closes the volume-vs-intensity loop). Prior commits today: `268ff97` (Phase 0), `fd00563` (Phase 1 + PDF email gate). This work is UNCOMMITTED in the working tree.

## What changed (3 files)
- **NEW `lib/time-budget-copy.ts`** — shared UI copy + planned-load summary:
  - `BUDGET_LABEL`, `BAND_EMPHASIS` (Threshold-leaning → Strongly polarized), `getBudgetCopy(sport, band)` (per-sport level + tradeoff; generic fallback for DEKA ATLAS/ULTRA).
  - `summarizeBudget(program_data)` → peak volume (h + mi), peak session-RPE load estimate (5-zone RPE anchors 2.5/4/6/7.5/9 × minutes), and program-average easy/threshold/hard mix.
  - NOTE: onboarding-form + /science explorer still carry their own copies — could be migrated to this module later (dedupe).
- **NEW `components/program/time-budget-card.tsx`** — server component. Shows budget label, athlete level, 3 stats (peak volume / peak load / intensity emphasis), a stacked easy/threshold/hard intensity bar, and the tradeoff sentence. Only renders when the program has a weeklyHours band (legacy programs omit it). Degrades gracefully (level+tradeoff only) if program_data is null (still generating).
- **`app/program/[id]/page.tsx`** — reads `weeklyHours` from input_snapshot.profile; renders `<TimeBudgetCard sport band data={program_data} />` alongside the other cards (after TriZonesCard). Added `WeeklyHoursBand` to the schemas import + the component import. No new DB fields (uses existing `program_data` + `input_snapshot`).

## Verify locally before committing
```
npm run build      # confirms the new server component + page edit compile
npm run typecheck  # optional
```
No tests needed (pure display + a small pure summarizer). `npm test` unaffected.

## Commit (from Windows CMD)
```
cd C:\dev\duravel
git add "app/program/[id]/page.tsx" components/program/time-budget-card.tsx lib/time-budget-copy.ts ^
        Handoffs/Duravel_Handoff_07-21-26_3.15pm.md
git commit -m "feat: surface the time-budget tradeoff on the program page"
```
(Push needs Levi. Lock error → `del C:\dev\duravel\.git\index.lock`.)

## Backlog / next options (volume-intensity track)
- Safety guardrails (workplan §5): single-session jump cap, concurrent strength/power interference scaling with endurance hours, impact-routing >20h.
- Phase 1 loose ends: prefill weeklyHours in edit mode; DEKA ATLAS/ULTRA bands; tri_olympic test; optional low-band z5 nudge.
- Gate polish: Resend delivery of the PDF; /admin science_leads view; dedupe/rate-limit the leads route.
- Dedupe the 3 copies of the per-sport budget copy into lib/time-budget-copy.ts.
