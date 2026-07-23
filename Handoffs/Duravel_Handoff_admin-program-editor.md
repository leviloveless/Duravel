# Admin — Structured (no-code) program editor

Replaces the raw-JSON box on `/admin/program/[id]` with a **form** over
`programs.program_data`, so you edit programs by filling fields — never JSON or
code. The raw-JSON editor is kept as an "Advanced" fallback under a collapsible.

## What you can do (no code)
- Pick any week (dropdown shows Week N — phase/microweek + its mileage/cardio).
- For each day, see its sessions and:
  - **Lift:** edit lift type; per-movement swap **exercise**, change **sets**,
    **reps**, **weight**, intensity %, RIR, emphasis; add / remove movements.
  - **Run:** run type, duration, pace, distance, goal zone, description,
    compromised-long-run toggle.
  - **Hybrid:** goal zone, station elements (exercise + prescription), race-sim toggle.
  - **Cardio / Swim / Bike / Brick / Race:** their fields (durations, zones, types,
    segments, priority).
  - **Add / remove sessions** per day (empty day = rest); add/remove list items.
- **Save** runs through the existing `updateProgramData` action, which
  re-validates the whole program against `ProgramDataSchema` — a bad edit is
  rejected with a precise error, never written. Each session editor spreads the
  original session, so any field not shown is preserved (no data loss).

## Files
- `components/admin/program-form-editor.tsx` — NEW client component (the form).
- `app/admin/program/[id]/page.tsx` — renders `ProgramFormEditor` as the primary
  editor; the old `ProgramEditor` (raw JSON) moved under an "Advanced" `<details>`.
- No engine, schema, or DB changes. No new server code — reuses `updateProgramData`.

## Verify (comment-free — Windows CMD safe)
    npm run build
    git add -A
    git commit -m "admin: structured no-code program editor over program_data"

(Frontend-only; `npm run build` type-checks + lints it. No new unit tests — it's
a form over the already-schema-validated save path. `lib/admin.test.ts` still
fails on missing env — pre-existing.)

## Using it for Levi (ties requests together)
1. **Create the program in-app** for `levi.loveless@duravel.app` via your normal
   build/onboarding flow. Thanks to Batch 7, his profile (HYROX, 15 h, beginner
   runner, 250 lb) now auto-produces the conservative ~18 mi start + low-impact
   buffer — the v2 reference curve — with full AI-filled content and pacing cards.
2. Open **/admin/program/[his-program-id]** and hand-tune with the form: swap in
   your preferred exercises for the weak-station work (farmers carry, sled pull,
   burpee broad jump), set weights off his benchmarks, adjust the compromised-run
   stations, etc.
3. **Save** — it validates and updates both the admin and athlete views.

## Possible next step (not built — you chose admin-only)
Add an "Edit this session" link on each card in the athlete "View as athlete →"
page that deep-links into this editor at that week/day, for a see→edit→see loop.
Say the word and I'll wire it.
