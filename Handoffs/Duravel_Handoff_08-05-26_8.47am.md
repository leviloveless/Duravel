# Duravel Handoff — 2026-08-05 8:47am CT

## STATUS: patch 17 APPLIED to the worktree, md5-verified, **NOT committed**. Base `03f2597`.

**939/939 vitest · `tsc` clean · `next build` clean.**
`.git/index.lock` absent.

```
_to_delete/session17-0805.patch   lift-day priority · Strava title/description format · readiness clarity
```

```
cd C:\dev\duravel
git add lib components app
git commit -m "lift-day priority (strength/power/light); Strava title + workout description; weekly check-in clarity"
git push
```

⚠️ **Engine changes are generation-time. Existing programs need a RECALCULATE.**

---

## 1. 🔴 Lift-day priority — patch 16's structure is REVERTED

Levi, 2026-08-05: *"(1) if 1 weightlifting day, then strength workout, (2) if 2 weightlifting days,
then strength and power, (3) if 3 weightlifting days, then strength and power and light."*

**A live read of his own program settled this.** Week 1 of "Fall prep" showed Tue full / Wed power /
Fri light — the pre-patch-16 shape, and exactly the rule he just stated. Patch 16 (power as a block
on the heavy day) had changed 3 lift days to *strength + light + light*, dropping the power day. So
patch 16's structure is reverted; **patch 15's power CONTENT is kept**, which is the part that
mattered — the power day is a real power day now, not a max-strength duplicate.

`researchLiftSplit` is now explicit rather than emergent:

```
1 -> ["full"]                              strength
2 -> ["full", "power"]                     strength, power
3 -> ["full", "power", "full"]             strength, power, light
4+ -> ["full", "power", "full", "full"]    ...further days add LIGHT volume
```

Exactly ONE heavy day and exactly ONE power day, however many lift days the week has.
`applyStrengthSchemes` now lights up **every full-body day after the first** (it keyed off "the LAST
full session", which was equivalent at two lift days but would have shipped two maximal days at
four). The alternating `full`/`power` slot shape is load-bearing: `separateLiftDays` uses precisely
that distinction to keep heavy days off consecutive dates.

Snapshot churn: `time-budget-skeleton` h20_30 (HYROX + DEKA) regenerated — the second power day
becomes a light day. Reviewed and intended.

## 2. 🔴 Strava format — Levi's spec, byte-for-byte

```
Week 1 - Monday - Interval Run
Warm up: 15 min easy (~1.1 mi) @ 13:20/mi with 3-4 short strides
Work: 4 x 1km at 7:40/mi (4:46/km), with 4:45 of easy JOGGING between reps at 13:20/mi (jog, not walk — keep moving so your heart rate stays up)
Cooldown: 10 min easy (~0.8 mi) @ 13:20/mi
Work:rest 1:1 - your rest equals your work time.
```

Verified against the real week-1 interval run rendered on the live site — identical.

- **`stravaTitle`** is new on `SessionSummary` and is written as the Strava activity **name**.
  `updateActivityDescription` now takes an optional `name`; plumbed through `brandStravaActivity`,
  the `/api/wearables/strava/brand` route, and `SessionShare`. `week-card.tsx` passes `dayKey`.
- **The description is the workout and nothing else.** The `Planned:` / `Actual:` block and the
  `— Duravel · … · duravel.app` footer are gone from Strava. (Actuals still drive the result CARD —
  only the Strava text changed.)
- ⚠️ **Idempotency moved.** The block used to open with `BRAND_MARKER`, which is how `stripBrandTag`
  found and replaced it. With the branding gone, the **title line is the anchor**:
  `stripWorkoutBlock` (branding.ts) cuts from `/^Week \d+ - .+$/m` to the end. `buildBrandedDescription`
  strips BOTH shapes, so an activity branded before today gets its legacy tag replaced rather than
  stranded above the new text. Tested both ways.
- Title degrades gracefully: no day → `Week 3 - Threshold Run`; no week → `Threshold Run`.

## 3. 🟡 Weekly readiness — clarity, no behaviour change

Levi: *"I am not sure when I am supposed to be filling it out, and it seems duplicative with the
daily hr/hrv."* Both were fair. The heading named a week but never a day, and the form asked for
resting HR + HRV — the same two numbers the Daily tab collects — with no explanation.

- Tab renamed **"Readiness" → "Weekly check-in"**; the other stays "Daily HR/HRV". The labels now
  carry the cadence, which is what made them feel redundant.
- Weekly form states when and why: *fill in once at the start of week N; it is the only place your
  subjective state is captured, and a low score softens the week BEFORE you train it.*
- The HR/HRV fields now say: only fill these in if you are **not** logging daily and have no wearable.
- Daily form gained the reciprocal line: it builds the baseline, it does **not** replace the weekly
  check-in.

Copy only — `computeReadiness`, the Hooper math and the wearable prefill are untouched.

## 4. ✅ Live verification — DONE (browser reached this time)

`switch_browser` connected on the second attempt ("Duravel.app browser"). Read Levi's real program
(`Fall prep`, 16 weeks, week 1 of 16) end to end.

Confirmed live:
- Week-1 interval run description matches the Strava spec exactly.
- The **old broken power day is still live** — Wed Aug 5 shows `Barbell Bench Press — 4 sets × 5–6
  reps — ~78% 1RM · 3 RIR · Max strength`. That is the pre-patch-15 bug. **The program predates every
  patch from 13 on; it needs a RECALCULATE** to pick up the real power day, equipment awareness and
  the new starting volume.
- 3 lift days a week (Tue/Wed/Fri) — the structure §1 now pins.

⚠️ Notes for next time: `app.duravel.app` returns a Vercel **404 DEPLOYMENT_NOT_FOUND** — the live
host is `duravel.app`. `/program` 404s; program pages are `/program/<uuid>`. `list_projects` for team
`team_N4cfcDYaIJuPYg36yIredN33` returns **empty**, so the Vercel MCP cannot see this project.

## ▶️ NEXT
1. **Recalculate `Fall prep`** and re-read week 1 — the only way to see patches 13–17 on real data.
2. Then test "To Strava" on a linked activity and confirm the title lands.
3. `assignDays` caps upstream (open since Aug 4).

## 🟡 STILL OPEN
- `assignDays` places sessions without consulting the caps.
- `applyPostBRaceRecovery` bluntly rearranges the front of the week.
- Triathlon h30_40 delivery audit.
- iOS parked (no Xcode project; needs a Mac + Apple enrollment; MANIFESTs point at a dead `hyroxai/`).
- Lifecycle email: code ready, needs `EMAIL_ENABLED` + `RESEND_API_KEY` + DNS.
- hyresult: consider licensing hyroxresultapi.com or the Apify scraper rather than building one.

## Process notes
- ⚠️ **Never run `prettier --write lib/ components/`** — it reflowed 130+ untouched files last
  session. Format edited files BY NAME.
- **Incremental patches need a real base.** `/tmp/base14` = HEAD + p13…p16 committed; patch 17 is a
  diff against that. Copying only the intended files into the base also filters out formatter noise.
- md5-compare both sides after every apply.
- **Read the live app before assuming a spec.** Patch 16 was built and shipped on a structure Levi
  did not want; one look at his real program showed the old shape was already correct.
- `_to_delete/` now also holds `session17-0805.patch`.
