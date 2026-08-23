# Duravel Handoff — 2026-08-13, 10:29am CT

## Status: all three commits pushed and VERIFIED LIVE

`origin/main` = `fd916a8`.

| commit | contents |
|---|---|
| `321810c` | program: one button syncs every connected source |
| `90ef53d` | engine: the plan owns liftType, and a hybrid trains every race event |
| `fd916a8` | handoffs: 08-03 through 08-12 |

Migrations 0041 and 0042 confirmed already applied by Levi. **This session needed no migration.**

## Live verification (duravel.app, 2026-08-13)

### 1. Sync from all connected sources — WORKS

On `Fall prep`, the header now shows **Sync workouts** with `Last sync: …` under it. Clicking it returned:

> **Imported 9 workouts (Strava 9, Oura 0).**

- **Both providers were pulled.** Oura appearing in the line at all means it is connected and was invoked — that leg had never had a caller outside the Settings panel before today.
- The link-suggestions banner went **(2) → (7)** without a manual reload, so `router.refresh()` is firing and newly imported activities become link candidates immediately.
- **Console clean** on a fresh load — no React #418, no errors. The 7 survived a full reload, so this is not a hydration artifact (the trap from 2026-08-06).

### 2. The liftType bug — CONFIRMED IN PRODUCTION DATA, THEN FIXED

Before regenerating, `Fall prep` showed the bug and its correct counterpart side by side:

| week | Tue | Wed | Fri |
|---|---|---|---|
| 1 | Full body | Power | **Lower body** ← bug |
| 2 | Full body | Power | **Lower body** ← bug (the one Levi asked about) |
| 3 | Full body | Power | *(deload, 2 lifts)* ✓ |
| 4 | Full body | Power | **Full body @ 12–15 reps ~58% 1RM** ✓ |
| 5 | Full body | Power | **Full body @ 12–15 reps ~60% 1RM** ✓ |

Weeks 4–5 are what weeks 1–2 should have looked like — and note their Friday session is the **LIGHT day** (muscular endurance, 12–15 reps). That is precisely what weeks 1 and 2 lost: the AI happened to return `"full"` in weeks 4–5 and `"lower"` in weeks 1–2, and nothing corrected it. Exactly the diagnosis.

**After regenerating (on the throwaway program): zero occurrences of "Lower body lift" anywhere in 16 weeks.** The whole program reads `Full / Power / Full`.

### 3. Race-structure hybrids — WORKS

A base-phase hybrid now reads:

```
Warm up: 10 min easy (~0.8 mi) @ 13:20/mi
run — 1000m @ race pace (threshold)
skierg — 300m skierg
run — 1000m @ race pace (threshold)
sled push — 15m sled push @ 202kg
run — 1000m @ race pace (threshold)
sled pull — 15m sled pull @ 153kg
run — 1000m @ race pace (threshold)
burpee broad jumps — 25m burpee broad jumps
run — 1000m @ race pace (threshold)
row — 300m row
run — 1000m @ race pace (threshold)
farmers carry — 60m farmers carry @ 2×32kg
run — 1000m @ race pace (threshold)
sandbag lunges — 30m sandbag lunges @ 30kg
run — 1000m @ race pace (threshold)
wall balls — 30 reps wall balls @ 9kg
Cooldown: 5 min easy (~0.4 mi) @ 13:20/mi
```

- All 8 stations, **in race order**, each behind a **full 1000 m** run. ✓
- **Pro division loads** resolved correctly (202/153 kg sleds, 2×32 kg carry, 30 kg bag, 9 kg ball). ✓
- **Phase ramp confirmed across the block** — base → build:
  - wall balls **30 → 45** reps (100 × 0.6 × 0.5 = 30; 100 × 0.85 × 0.5 = 42.5 → 45)
  - skierg **300 → 425** m
  So half-volume rides on top of the phase factor rather than replacing it, exactly as designed.
- **Timing is now pace-aware**: `10 / 53 / 5 = 68 min` in base, `10 / 56 / 5 = 71 min` in build. Every hybrid used to read a flat `10 / 40 / 5 = 55 min` regardless of athlete or content.

## ⚠️ THE INTENSITY FINDING IS WORSE ON LEVI'S OWN SETTINGS THAN IN THE SWEEP

The 192-week sweep said hard-running share moves 25.9% → 39.1%. On the regenerated program it is steeper, because the weekly mileage target is low:

**Week 1: 10 mi total. Long run 3.8 mi + hybrid 4.97 mi. Roughly HALF the week's running is inside the hybrid at race pace.**

Note what the reconciler did: week 1 has **no separate quality run at all** — Long run + Hybrid are the only running. So at low mileage the substitution I proposed is already happening by accident; what got squeezed instead is the **easy aerobic volume** (a 3.8-mile long run in a 10-mile week).

**Still Levi's call, now with a live number.** The lever remains: make the substitution deliberate — a week whose hybrid carries ~5 mi at race pace shouldn't also schedule a threshold run, and the mileage target should probably rise to protect the easy volume rather than letting the long run absorb the squeeze.

## Notes for next session

- **CRLF trap:** `lib/generation/stations-assemble.test.ts` is CRLF on disk while its siblings are LF; `git status` reports it clean because git normalizes on read, but its md5 will never match `git show HEAD:`. Ship that file whole rather than patching it. Check with `file <path>` whenever a base md5 mismatches but git says clean.
- **The prompt oracle snapshot moved deliberately** (3 lines) with the reason recorded in `lib/ai/prompts.test.ts`'s header. The golden-HYROX oracle freezes the skeleton only and did not move.
- **Vercel MCP returns 403** on this project (`list_projects` empty, `list_deployments` forbidden). Verify deploys through the live site instead.
- `Duravel_Roadmap_Planned_vs_Actuals.html` still has uncommitted edits from before 08-12 and was **not** updated this session.
- Levi's `ZZ DELETE ME - warmup test` program was regenerated as the test subject. **`Fall prep` was NOT regenerated** — it still carries the old full/power/lower weeks and the old 4-station hybrids until he recalculates it.

## Still open (unchanged)

- The intensity-distribution decision above.
- 3 duplicate Strava activities to delete by hand (no API can).
- The 17%-of-weeks-over-target finding — still unexamined.
- Triathlon `h30_40` audit.
- `CLAUDE.md` still says the app lives under `hyroxai/` — it does not.
- `app.duravel.app` returns Vercel `404: DEPLOYMENT_NOT_FOUND` (the iOS shell targets it).
