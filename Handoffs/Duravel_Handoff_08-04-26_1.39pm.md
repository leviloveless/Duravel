# Duravel Handoff — 2026-08-04 1:39pm ET (session wrap)

## STATUS: all three commits PUSHED. `main` == `origin/main` == `fed63db`. Nothing outstanding in the worktree.

```
fed63db  engine: weekly working-set volume per pattern + light second full-body day   ← deploy BUILDING
87fd7a3  engine: drop sub-15-min cardio remainders instead of shipping a token block   ← deployed READY
5681bf3  engine: 45-min floor on Zone 1-2 cardio blocks                                ← deployed READY
32f1d99  (previous session's base)
```

Vercel: `87fd7a3` is live (`dpl_FMbdo29u…` READY). `fed63db` was still BUILDING at wrap
(`dpl_6P3ik4PN…`) — **confirm it went READY before testing the strength changes.**

⚠️ **All three are GENERATION-TIME. Existing programs need a RECALCULATE to pick any of them up.**

---

## 1. Zone 1–2 cardio: 45-minute floor (`5681bf3`)

**Levi's rule.** A Zone 1–2 cardio session has a **45-minute minimum** — below that it isn't worth
the trip, and utility flattens past ~45, so **frequency beats duration**: 90 surplus minutes are
**two 45s**, never one 90 and never three 30s.

**The one exception:** a block sharing a day with **another CARDIO session — a run or a hybrid** —
is a brick tail and may be shorter (floor 30). **A lift is NOT cardio**, so a lift day gets the
full 45. That was the reported bug: Tue + Wed lift days each carrying a 30-minute spin. A 53-min
block next to Saturday's long run was always fine.

All Z1–2 filler is built in one place — `planFiller`/`spread` in `lib/generation/reconcile.ts`:
- `MIN_PAIRED_CARDIO` (30, any day) → `MIN_CARDIO_BLOCK` (45) + `MIN_BRICK_CARDIO` (30), chosen per
  day by `cardioFloor(day) = dayHasCardio(day) ? 30 : 45`.
- `spread()` now cuts its minutes into as many legal blocks as they can pay for and splits them
  **evenly**, instead of dumping a session-cap-sized chunk on the first host day.
- new `absorb()` tops a too-small remainder onto a block already planned (under the caps) rather
  than shipping it as a short standalone session.

Real generated week 15, before → after: `mon 30 / tue-lift 30 / wed 53 / fri 30` became
`mon 45 / tue-lift 53 / fri 45` — same 143 minutes, three legal sessions instead of four.

## 2. Sub-15-minute remainders are dropped (`87fd7a3`)

`MIN_MEANINGFUL_CARDIO = 15`. When the week's runs already cover nearly all the prescribed cardio,
the leftover used to be emitted as its own block — a 9-minute "session" — purely to keep the weekly
total exact. **A gap under 15 minutes is now not filled at all**; the total lands those few minutes
short. Every gap ≥ 15 is still hit exactly.

**Combined audit, 480 deterministic weeks** (5 day-sets × 3 experience × 2 classes × 16 wks):

| metric | before | after |
|---|---|---|
| sub-45 **standalone** Z1–2 blocks | **162** | **0** |
| token blocks (<15 min) | 16 | **0** |
| aerobic days / week | 4.76 | 4.69 |
| lift days paired with cardio | 91% | 89% |

## 3. Strength: weekly set volume + a light second full-body day (`fed63db`)

**Levi's rules.** Weekly WORKING SETS **per movement pattern** come from **lifting experience** —
**beginner 6 / intermediate 8 / advanced 10** — and when a week carries **more than one full-body
lift, the LATER one runs LIGHT (12–15 reps)**. Heavy first while fresh.

Answered this session: deload/taper **scale down** (×0.6 / ×0.5); the **later** full goes light; the
**lunge is included** in the weekly target (still at its high-rep endurance scheme).

- `lib/engine/strength.ts` — `WEEKLY_SETS_PER_PATTERN` (6/8/10), `WEEKLY_SET_FACTOR` (deload 0.6,
  taper/race 0.5), `weeklySetTarget()`, `splitWeeklySets()` (remainder to the EARLIER = heavier
  sessions; never returns a zero-set session), and `LIGHT_FULL` — a 12–15 rep / ~50–60% 1RM / 3 RIR
  scheme per phase. `movementScheme(...)` and `patternEmphasis(...)` take a new `light` flag.
- `lib/generation/assemble.ts` — `applyStrengthSchemes` now takes `liftingExp`, walks lift sessions
  in CALENDAR order, marks the last `full` as light when there are ≥2, and finishes with
  `applyWeeklySetVolume()`, which rewrites ONLY `sets` so each pattern's weekly total hits target.
- `liftingExp` threaded through `AssembleArgs` / `assembleArgsFromInput` → both call sites
  (`generate-program.ts`, `adapt-week.ts`). **It was never plumbed before — strength volume ignored
  lifting experience entirely.**
- **853/853 vitest** (15 new), `tsc` clean, prettier clean. **Golden-HYROX byte-identical snapshot
  untouched** — it freezes `buildSkeleton`, and all of this happens at assembly.
- Audit (16-wk program, 3 experience levels, patterns filled as the AI would): weekly sets per
  pattern **exactly on target in every week**, and **every week with two full-body lifts got exactly
  one light day**.

---

## 🔴 OPEN — needs Levi's call (raised, not answered)

1. **A pattern trained ONCE a week gets the whole weekly target in ONE session.** Real example
   (advanced, h20_30 band): a Monday full-body day came out `Reverse Lunge 10×15`,
   `Push Press 10×5-6`, `Chest-Supported Row 10×5-6` — because those patterns appear only on that
   day. That session totals ~46 working sets, and strength sessions are billed at a **fixed 60
   minutes** (`STRENGTH_SESSION_MIN` in `session-volume.ts`), so the time budget doesn't even see it.
   Options: cap per-session sets (~5–6) and accept the week landing short when a pattern is trained
   once; or push the pattern DISTRIBUTION so each pattern lands ≥2×/week; or leave as-is.
2. **Triathlon / Ironman lifts are NOT covered.** `buildTriProgramData` builds its own lift sessions
   (`liftSession()` in `lib/engine/ironman/index.ts`, fixed 3–4 sets, 5 patterns) and never goes
   through `applyStrengthSchemes`, so 6/8/10 does not apply there. Deliberate scope call — say if you
   want it extended.

## 🟡 LATENT — pre-existing, not touched

- **~40% of generated weeks land UNDER their prescribed `targetCardioMinutes`** — 193 of 480 in the
  audit, the worst by **626 minutes** — on `main` BEFORE any of this session's work. `reconcile.ts`
  claims the cardio total is exact; in cramped weeks (few training days, 2-sessions/day cap, session
  caps) the minutes simply can't be placed. Same shapes emit a few over-cap blocks (150–490 min) via
  the "pile the overflow onto the last block" fallback. Worth deciding whether the engine should size
  `targetCardioMinutes` to what the athlete's chosen days can actually hold.
- `applyPostBRaceRecovery` still bluntly rearranges the front of the week after a B race.

---

## ▶️ NEXT UP — Strava card + description per workout (NOT STARTED)

Levi's ask: **every workout, in the app and on the website, should produce (1) a card photo and
(2) a workout description he can upload to Strava.**

**Most of the plumbing already exists** — this is extension, not new construction:
- `components/program/result-card.tsx` — 1080px branded card renderer (story/square), `CardData`
  union already has a **`session`** type (athlete / sessType / sessMain / sessVol / sessTime /
  sessHr / coachNote).
- `components/program/result-card-studio.tsx` — modal studio; rasterizes to a 1080px PNG via
  html2canvas, native share sheet with download fallback.
- `components/program/result-card-launcher.tsx` — the button, takes `initial: Partial<CardData>`.
- `lib/wearables/branding.ts` — `buildBrandedDescription()` / `brandTagLine()`, idempotent, plus
  `brandStravaActivity()` in `strava-brand.ts` (PUTs a description; needs `activity:write` +
  `STRAVA_WRITE_ENABLED`).

**The two gaps:**
1. The "Share" launcher only renders where `log?.status === "completed"` (week-card.tsx ~236 and
   ~544), prefilled by `sessionCardFromLog(...)` — so there's nothing on a workout you haven't
   logged.
2. **No per-workout description exists at all** — `branding.ts` only appends a one-line tag
   ("— Duravel · Threshold run · Week 6 · … · duravel.app"), not a summary of the workout.

**Suggested shape:** a pure `lib/program/session-summary.ts` deriving BOTH artifacts from a
`Session` (+ optional log/actuals + week/program context) — `cardData` for the existing renderer and
a multi-line `stravaDescription` (title, the prescription — intervals / stations / lift sets+reps —
paces and zones, then the existing `brandTagLine()` footer so branding stays idempotent). Then render
the launcher + a copy button on EVERY session row. The iOS app wraps the same Next UI, so one
implementation covers "app and website".

**Three questions were queued for Levi and not yet answered:**
1. **Content** — plan, swapping to actuals once logged/linked (suggested) / plan only / completed only?
2. **Delivery** — copy-to-clipboard (suggested; no new OAuth scope) or also auto-write onto the
   linked Strava activity via the existing write path?
3. **Text source** — engine-generated deterministic summary (suggested; free, instant, testable) or
   AI-written per workout (nicer prose, token cost, storage, regenerates on recalculate)?

---

## Process notes for the next session

- **NEVER run `git add`/`git commit` from the cloud.** It leaves a `.git/index.lock` that the bridge
  cannot delete (`mv` copies but can't unlink; `rm` is refused), which blocks Levi's own git. It
  happened again this session and stranded a verified change. Write the files, verify md5s, and hand
  Levi the commit + push commands.
- **The repo is PUBLIC** — `git clone https://github.com/leviloveless/Duravel.git` + `npm install` in
  the cloud container needs no auth (~2 min; 853 tests in ~31s; real tsconfig). Far better than
  tarball-shuttling. Patch → `_to_delete/` → `git apply` on device → md5-compare both sides.
- **End-to-end engine audits without the AI:** `assembleProgram(buildSkeleton(input), [], …)` with
  empty chunks runs the whole deterministic pipeline. Feed it a fabricated `AiChunk` to simulate the
  AI's pattern choices. Sweeping day-sets × experience × class × weeks gives real before/after
  numbers in seconds — that's where every finding in this handoff came from.
- Vercel MCP: `list_projects` returns EMPTY for this team; go straight to
  `list_deployments {projectId:"duravel", teamId:"team_N4cfcDYaIJuPYg36yIredN33"}` and match
  `meta.githubCommitSha`.
- `_to_delete/` now also holds `cardio45.patch`, `cardio-drop.patch`, `strength-volume.patch`,
  `index.lock.bak`, `next-index-9.lock.bak` — all junk, delete with the folder.
- `Duravel_Roadmap_Planned_vs_Actuals.html` — the "HYROX credible full" row note lists the
  session-quality rules through 08-04. Written to the repo file; **uncommitted**, and the desktop
  artifact was not re-pushed.
