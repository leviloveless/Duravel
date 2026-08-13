# Duravel Handoff — 2026-08-04 10:11am ET

## STATUS: committed on `main` as `5681bf3`, **PUSH PENDING** (Levi pushes).

`git push origin main` sends one commit: **`5681bf3` engine: 45-min floor on Zone 1-2
cardio blocks**, on top of `32f1d99`. Roadmap note updated in the same working tree
(uncommitted unless you want it — see §5).

---

## 1. The rule (Levi, this session)

A **Zone 1–2 cardio session has a 45-minute minimum**. Below 45 it isn't worth the trip —
and utility flattens fast after 45, so **frequency beats duration**: 90 surplus minutes are
**two 45s**, not one 90 and not three 30s.

**The one exception:** a block sharing a day with **another CARDIO session** — a run or a
hybrid — is a brick / second aerobic piece, not a session of its own, and may be shorter
(floor 30, Levi's choice this session). **A lift is NOT cardio**, so a lift day gets the full
45-minute floor. That is exactly the reported bug: Tue + Wed lift days each carrying a
30-minute spin. Saturday's 53-minute block next to the long run was always fine — brick, and
over 45 anyway.

## 2. What changed — `lib/generation/reconcile.ts`

Only the Zone 1–2 filler planner. Run sizing, mileage, paces, lift spacing: untouched.

- `MIN_PAIRED_CARDIO = 30` (applied to ANY day, including empty ones) is gone. Now
  **`MIN_CARDIO_BLOCK = 45`** + **`MIN_BRICK_CARDIO = 30`**, chosen per day by
  **`cardioFloor(day)`** = `dayHasCardio(day) ? 30 : 45`. `dayHasCardio` already meant
  run/hybrid/cardio/bike/swim/brick — a lift day returns false, which is the whole point.
- **`spread()` rewritten.** It used to hand the first host day `min(sessionCap, room, left)` —
  a session-cap-sized chunk — and move on, which is how a single 90-minute block happened.
  It now cuts the minutes into **as many legal blocks as they can pay for**
  (`floor(left / 45)`, bounded by available days) and splits them **evenly**, then mops up
  anything a too-small day couldn't seat.
- **`absorb()` (new).** A remainder too small to stand alone tops up a block already planned
  (still under session + day caps) instead of shipping as a short standalone session. If it's
  still stranded it parks **beside a run** as a brick tail rather than on an empty weekday.
- The `k` back-off loop (spread days ↔ "weekend stays biggest") is unchanged in shape; it just
  spends 45 per spread day instead of 30.

`lib/generation/reconcile.test.ts`: new `describe("Zone 1–2 blocks respect the 45-minute floor")`
— a 50-case sweep (5 week shapes × 10 cardio targets) asserting no short standalone block and an
exact cardio total, plus a "90 → 45 + 45" case and a brick case.

## 3. Before / after on a real generated week

Deterministic 16-week program, 6 training days, beginner/highly-trained, week 15
(303 cardio min, 15.8 mi) — the exact shape Levi reported:

| day | BEFORE (`main`) | AFTER (`5681bf3`) |
|-----|-----------------|-------------------|
| mon | cardio **30** | cardio **45** |
| tue | lift:full 60 + cardio **30** | lift:full 60 + cardio **53** |
| wed | progression 72 + cardio 53 | progression 72 |
| thu | lift:upper 60 | lift:upper 60 |
| fri | cardio **30** | cardio **45** |
| sat | long 73 + easy 15 | long 73 + easy 15 |

Same 143 filler minutes, same weekly total — three legal sessions instead of four, three of
which were illegal 30s.

## 4. Audit (480 deterministic weeks: 5 day-sets × 3 experience × 2 training classes × 16 wks)

| metric | before | after |
|---|---|---|
| sub-45 **standalone** blocks | **162** | **0** |
| short blocks that are brick tails | 29 | 48 (same blocks, now beside a run instead of standalone) |
| aerobic days / week | 4.76 | 4.69 |
| weeks with a 3-day dry stretch | 18 / 480 | 21 / 480 |
| lift days paired with cardio | 91% | 89% |

The spread cost is ~2% — a 45 pushes a 60-min lift day over the weekend's peak more easily
than a 30 did, so the "weekend stays biggest" rule occasionally drops a pairing. Cheap for
killing 162 junk sessions.

**838/838 vitest pass** (3 new), `tsc --noEmit` clean, prettier clean. Golden-HYROX
byte-identical gate still green. Verified in cloud clone `/tmp/duravel-ci` @ `32f1d99`;
patch md5 `b659c191b2a8f1f954f4c832e64bb4d4` matched on both sides; applied file md5s match.

## 5. TO DO (Levi)

1. **`git push origin main`** — sends `5681bf3`.
2. After deploy, **Recalculate the Test program**. This is generation-time: existing programs
   keep their old 30-min blocks until recalculated.
3. `Duravel_Roadmap_Planned_vs_Actuals.html` — the "HYROX credible full" row note now lists the
   session-quality rules (day placement 08-02, lift separation + mileage + manual paces 08-03/04,
   this 45-min floor). Written to the repo file; **not committed and the desktop artifact
   `duravel-roadmap-planned-vs-actuals` was not re-pushed** — say the word and I'll do both.

## 6. Known / not addressed

- **Tiny unavoidable remainders.** When the week's runs already cover almost all the prescribed
  cardio, a leftover of e.g. 9 minutes still has to land somewhere for the total to stay exact.
  It now parks beside the long run (a 9-min brick tail) instead of appearing as a standalone
  9-minute "session" on an empty Monday — better, but still odd. The clean fix is to let the
  weekly cardio total run a few minutes under instead of emitting a sub-15 block; that means
  relaxing the exact-total invariant, so I did not do it unilaterally. **Open question for Levi.**
- **Very large blocks in cramped weeks.** Where the caps make an exact total impossible (few
  eligible days, big cardio target) the planner still falls back to "pile the overflow onto the
  last block", which can exceed the session cap. Pre-existing; slightly *less* frequent after
  this change (38 vs 42 blocks over 150 min in the audit). Not touched.
- `applyPostBRaceRecovery` bluntness and the tracked junk in `_to_delete/` — unchanged from the
  08-04 12:54pm handoff. (This session dropped `cardio45.patch` into `_to_delete/`.)
