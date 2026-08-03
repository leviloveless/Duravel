# Duravel Handoff — 08-02-26 11.05pm

## Scope
Fixed a generation-blocking schema bug found while testing, then verified the post-B-race fix live.
**All work committed + pushed + deployed** (`75785a9`). Nothing outstanding in the working tree.

## The blocker: program generation failed
Creating a test program failed twice, identically:
```
Schema validation failed: weeks.0.days.2.sessions.1.movements.0.sets
— Invalid input: expected number, received undefined
```

**Root cause (pre-existing).** `AiDaySchema` reuses the full `SessionSchema`, so anything REQUIRED
there is required of the AI. `lib/ai/prompts.ts` line 35 tells the model:

> "the engine sets sets/reps/intensity/RIR and any plyometric element deterministically — just choose
> which patterns go in each session"

…but `LiftSessionSchema` **required** `sets` and `repRange`. `applyStrengthSchemes` overwrites both at
assembly, so the model's values are discarded anyway. A model that followed the prompt and omitted
`sets` therefore killed the entire generation.

**Fix:** `sets: z.number().int().default(3)`, `repRange: z.string().default("8-10")`. Assembled
ProgramData still always carries concrete numbers. New `lib/ai-lift-schema.test.ts` (5 tests) pins it,
including the exact reported failure shape.

**Why it surfaced now:** the post-B-race fix put lifts back into weeks 8 and 11, giving the model more
lift movements to emit. The old programs generated partly *because* week 8 had no lifts at all.

**General rule: any field the engine overwrites at assembly must NOT be required of the AI.** Worth
auditing the rest of `SessionSchema` if generation ever fails this way again.

## ⚠️ Process miss (mine) — prompt oracle was red on `main`
I had been running only `vitest run lib/engine lib/generation`. Running the full `lib` suite surfaced
that **`lib/ai/prompts.test.ts` had been failing since commit `7717e5f`** (the weekend-load change) —
`main` was red for two commits. Engine day-placement feeds the AI PROMPT, so `lib/ai` must be run too.
Verified the snapshot change was placement-only (session mix byte-identical: an interval and an easy
run swapping days) and regenerated it. **Always run `vitest run lib`.**

## Live verification — program `f643abef-1c27-4c00-86e3-50a5e143fb1c` ("Post-B fix test")
Same inputs as the previously-verified program (long-run Sat+Sun, rest Mon, lift Tue–Fri,
hybrid Tue–Fri+Sun, 10–20 h/wk, B races wk 7 + wk 10, A race wk 16, 12.5 mi / 300 min start).

| | before | now |
|---|---|---|
| Week 8 strength | **0 min** | **180 min** |
| Week 11 strength | **0 min** | **180 min** |

Week 8 detail: Mon rest · Tue Z1–2 cardio 61m · Wed Z1–2 cardio 61m · Thu interval 45m + full-body
lift 60m · Fri hybrid 55m + threshold 45m · **Sat long run 77m + power lift 60m (137m)** ·
Sun hybrid 55m + lower-body lift 60m (115m).

All four original requirements still hold: long run on Saturday, Sunday is the hybrid (no hard run
after the long run), Monday rest stays light, Sat/Sun are the two biggest days. Week 7/10 (B race)
keep their single reduced lift; week 16 (A race) has none — both correct per spec.

## Verification
- `vitest run lib` → **731 tests pass** across 75 files (`lib/admin.test.ts` fails to LOAD in the cloud
  harness — missing `@supabase/ssr` — identical on a pristine base, environment artifact only).
- Cloud `tsc` with `strict` + `noUncheckedIndexedAccess` → clean.
- Device files md5-identical to the tested tree.
- Vercel production confirmed on the right SHA before testing.

## Open / notes
- Deload-week Sundays sit ~5 min behind the 60m lift days (cosmetic; Saturday still far ahead).
- `_to_delete\` has accumulated scratch (f2/f3/fresh/lib-src tgz, tsconfig.*.json, stale lock copies)
  — safe to empty.
- Test programs on the dashboard: "Post-B fix test" (`f643abef`) is the verified one; earlier
  "Fall Hyrox" / "16-week goal event program" can be deleted.
