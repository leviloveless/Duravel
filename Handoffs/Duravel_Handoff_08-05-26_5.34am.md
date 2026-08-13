# Duravel Handoff — 2026-08-05 5:34am CT

## STATUS: patches 13, 14, 15 APPLIED to the worktree, md5-verified, **NOT committed**. Base `2da2e7f`.

**934/934 vitest · `tsc` clean · `next build` clean · golden-HYROX skeleton byte-identical.**
`.git/index.lock` absent.

```
_to_delete/session13-0805.patch   equipment-aware exercises + currentDaysPerWeek → starting volume
_to_delete/session14-0805.patch   legacy band back-fill (CAPS ONLY)
_to_delete/session15-0805.patch   the power / explosive lift day
```

They are INCREMENTAL — 13, then 14, then 15.

```
cd C:\dev\duravel
git add lib app
git commit -m "engine: real power day; equipment-aware lifts; starting volume follows training frequency; legacy programs inherit sane caps"
git push
```

⚠️ **All generation-time. Existing programs need a RECALCULATE.**

---

## 1. 🔴 The power / explosive day was a lie (FIXED, patch 15)

Levi: *"It should not just be a copy of the regular full body workout."* It was worse than a copy.

**What a real advanced week-8 power session shipped:**

```
Front Squat      6 x 4-5  @85% 1RM, 2 RIR
Reverse Lunge    6 x 18
Push Press       6 x 4-5  @85% 1RM, 2 RIR
Lat Pulldown     6 x 4-5  @85% 1RM, 2 RIR
plyo: broad jumps 5 x 3
```

24 working sets of grinding, near-failure work — **the hardest session of the week**, and the exact
opposite of power training, which is defined by BAR SPEED, not load. It contained an 18-rep lunge.
The only explosive thing on it (the plyo block) also appeared on both non-power days, so the "power"
day was *less* differentiated than the bolt-on.

**Two root causes, both one-liners:**
- `patternEmphasis` returned `max_strength` for `power` — the same branch as `full`.
- `acceptsPattern("power", …)` returned `true` for everything, so `spreadPatternSessions` used the
  power day as a **dumping ground** for overflow sets. That is where 6-sets-of-everything came from.

**What it produces now** (same athlete, same week):

```
Jump Squat               3 x 3  ~57% 1RM · move fast — end the set the moment bar speed drops  rest 165s
Sandbag Over-Shoulder    3 x 3  ~57% 1RM · (same cue)                                          rest 165s
Wall Ball                3 x 3  ~57% 1RM · (same cue)                                          rest 165s
Explosive Lat Pulldown   3 x 3  ~57% 1RM · (same cue)                                          rest 165s
plyo: broad jumps 5 x 3
```

**12 working sets, not 24.** Levi chose **ballistic + sport transfer**, so the B slot of each pattern
leans HYROX/DEKA-specific where a station analogue exists — sled push, wall ball, sandbag
over-shoulder, burpee broad jump.

Pieces:
- **`POWER` scheme** (`strength.ts`): base 4x3 @45%, build 4x3 @55%, peak 5x2 @62%, taper 3x2 @55%.
  RIR ≥ 4 always. `PCT_CAP.power = 67` — above ~2/3 1RM a "ballistic" lift stops being ballistic.
- **`power` added to the `StrengthEmphasis` Zod enum** — APPENDED, and `emphasis` is optional on
  every movement, so stored programs still parse.
- **`POWER_EXERCISE`** — a ballistic library per pattern, ordered most-equipment-first and ending in
  something a bodyweight-only athlete can do (composes with patch 13's equipment work).
- **`POWER_PATTERNS`** — `chest_fly` is excluded outright; a single-joint isolation movement has no
  explosive expression. `acceptsPattern("power", …)` now enforces it, which is what stopped the
  dumping-ground behaviour.
- **`MAX_POWER_SESSION_SETS = 12`** vs the general 24. `capSessionWorkingSets` takes a per-session
  ceiling now instead of one global constant.
- **`POWER_REST_SECONDS = 165`** written onto each movement, and **`POWER_CUE` replaces the RIR
  figure** in `suggestedWeight`. "4 RIR" next to a jump squat invites the exact grinding the whole
  emphasis exists to prevent.
- New schema fields `restSeconds` + `note` (both optional).

Guarded by `lib/engine/power-session.test.ts` (14 tests). `strength-power.test.ts` had an assertion
that *pinned the bug* (`expect(patternEmphasis("squat","power")).toBe("max_strength")`) — rewritten.

### 🟡 Still open on the power day
`researchLiftSplit` produces `[full, power, full, power]` and the placement puts the power day
**directly after the heavy full-body day** (Mon full → Tue power). Power work wants a fresh CNS;
this is the one remaining structural problem with the session and it lives in sequencing, not in
`strength.ts`.

## 2. Legacy band back-fill — shipped NARROW, deliberately (patch 14)

Levi said "yes back fill". I shipped the caps half only, because the measurement changed the picture
twice and the wide version is a bigger product decision than it looks.

**Shipped:** a bandless program infers a band from its own stored start cardio
(`inferBandFromStartCardio`, 10% tolerance) and uses it **for `trainingCaps` only** — it is
deliberately NOT written to `weeklyHours`. Bounded by `maxBandForTrainingDays` so a 3-day athlete
can't inherit 10-20 hour caps. This kills the case where an advanced 7-day triathlete had a
**90-minute session ceiling on a 70.3 build**.

**Not shipped — needs Levi.** Treating a legacy program as a full band program halves the average
shortfall:

| sport | avg gap before → after | worst before → after |
|---|---|---|
| hyrox | 183 → 127 min | 633 → 521 |
| deka_fit | 71 → 71 min | 369 → 262 |
| tri_70_3 | 476 → 189 min | 900 → 846 |

…but on a real 5-day legacy HYROX week it also moved **Z5 from 3% → 11%**, dropped a training day to
the band session budget, and turned easy/fartlek runs into interval and threshold runs. Same volume,
different sport. Nobody signs up for that by clicking "recalculate". **Levi chose caps-only for now.**

⚠️ **Two measurement traps recorded so the next session doesn't fall in them:**
1. The "% of weeks ≥15 min short" metric is misleading. Back-fill makes that number go UP (74% → 85%)
   while average and worst-case gaps go DOWN. It trades a few catastrophic misses for many small
   ones. **Judge by gap size, not threshold count.**
2. I could not confirm the tri improvement is a genuine delivery gain rather than the band table
   simply lowering the target. Unresolved.

## 3. `BILLING_ENABLED` — ALREADY DONE, the backlog item was stale
Both `BILLING_ENABLED` and `EMAIL_ENABLED` already route through `envFlag()`; they were fixed in the
same patch as `STRAVA_WRITE_ENABLED`. Re-swept for strict `=== "true"` comparisons — none left.

## 4. 🔴 iOS — the blocker is not code
`Apple\` contains **no Xcode project**. It is 35 markdown docs, ~25 TypeScript files that belong in
the Next app, 5 SQL migrations, and **2 Swift files** (one plugin, one reference). The Capacitor
shell is *generated* by `npx cap add ios`, which requires macOS.

- Cannot be built from the cloud sandbox, and cannot be built on Levi's Windows machine either.
- Gated on: Apple Developer enrollment (D-U-N-S in flight), a Mac with Xcode, signing certs.
- **Every MANIFEST maps files to `hyroxai/…` and that directory no longer exists** — the repo root
  IS the app now. Destinations need remapping before anything is copied.
- Product fork still undecided: **IAP vs external billing**. Duravel has LIVE Stripe at $19.99/mo;
  Apple requires IAP for digital subscriptions and takes 15–30%.

Recommendation: park until the Mac and the Apple account are real.

## 5. Lifecycle email — code ready, rest is Levi's
`emailEnabled()` requires BOTH `EMAIL_ENABLED` and `RESEND_API_KEY`. All flows built and tested.
`Duravel_Resend_Deliverability_Runbook.md` has the DNS steps (SPF/DKIM/DMARC). Nothing to code.

## 6. hyresult — the question may be moot
Could not read their terms: `/terms` 404s, the homepage links a `/legal` route that returned nothing.
**But third-party HYROX results APIs already exist** — hyroxresultapi.com sells a JSON API, and
there's a scraper on Apify. Licensing one is cleaner than scraping: no ToS exposure, no brittle HTML
parsing, no IP-block risk, someone else maintains it. Price that before building a scraper at all.

## 🟡 STILL OPEN (not started this session)
- **`assignDays` places sessions without consulting the caps.** Correct today by downstream cleanup,
  not by construction. Moving the cap upstream into assignment is the durable version.
- **Power day lands after the heavy day** — see §1.
- `applyPostBRaceRecovery` still bluntly rearranges the front of the week.
- Triathlon h30_40 delivery audit (station-hybrid no longer offers it, so this is tri-only now).
- Push notifications — gated behind the iOS decision.

## Process notes
- **NEVER run `git add`/`commit`/`status` on the device from a cloud session.** `git apply` is the
  exception; its `unable to unlink … Operation not permitted` warnings are harmless. No lock was
  created this session.
- **Incremental patches need a real base.** `/tmp/base14` = HEAD + patch 13, committed, then patch 14
  committed on top. Diffing the working tree against `HEAD` would have folded patch 13 into patch 14
  and conflicted on the device. Keep that clone alive across a session with uncommitted patches.
- md5-compare both sides after every apply. 11/11, 3/3, 5/5 this session.
- Deterministic audits (`buildSkeleton` / `assembleProgram(sk, [], …)` with empty chunks) produced
  every number here. **Sanity-check the metric before trusting it** — my first legacy audit reported
  "100% of weeks short" on BOTH baseline and change because it summed `durationMin` (unset on
  placeholder sessions) instead of `sessionTiming(s).total`.
- `_to_delete/` now also holds `session13/14/15-0805.patch`.
