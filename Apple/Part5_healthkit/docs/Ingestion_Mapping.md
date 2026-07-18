# Duravel iOS — Part 5: HealthKit → Shared Ingestion Mapping & Dedupe

**Scope:** how a HealthKit `HKWorkout` becomes a Duravel workout via the
**existing shared ingestion pipeline**, and the dedupe rules that stop the same
session being counted twice across HealthKit, Strava, and (planned) Garmin.

> This doc is the contract. It assumes the existing shared ingestion schema
> already stores workouts with a `source` + `external_id` and normalized
> metrics (that's what the Strava importer uses). Field names below are the
> **intended** shape — Levi/whoever owns the backend should reconcile against
> the actual column names in Supabase (see **Needs Levi**).

---

## 1. Where HealthKit enters the pipeline

HealthKit is just **another source** feeding the same ingestion endpoint the
Strava sync uses. Nothing about the pipeline's downstream (normalization,
storage, feed, analytics) changes — we add one source adapter.

```
 Apple Watch / iPhone
        │  (HealthKit)
        ▼
 Native plugin (Swift)  ── serialized DuravelHKWorkout ──►  healthkit.service.ts
        │                                                        │ toIngestionWorkout()
        │                                                        ▼
        │                                        POST /api/ingest/healthkit  { workouts: IngestionWorkout[] }
        │                                                        │
        ▼                                                        ▼
   background wake                                     SHARED INGESTION PIPELINE
   → observer → anchored pull                          (same code path Strava uses)
                                                          │  1. source-idempotency (external_id)
                                                          │  2. normalize
                                                          │  3. CROSS-SOURCE DEDUPE  ◄── the new rule
                                                          ▼
                                                        workouts table (+ feed / analytics)
```

Recommendation: keep a **thin `/api/ingest/healthkit` route** that adapts the
posted `IngestionWorkout[]` into the internal call the Strava importer already
makes (e.g. `ingestWorkout(source, payload)`), so both sources converge on one
dedupe implementation. Do **not** re-implement dedupe in the iOS layer — the
client pre-filter (skipping Strava-origin HK samples) is only an optimization;
the backend is authoritative.

---

## 2. Field mapping

`IngestionWorkout` (posted by the client) → internal workout record:

| Ingestion DTO field | Source (HealthKit) | Internal workout field (reconcile names) | Notes |
| --- | --- | --- | --- |
| `source` = `'healthkit'` | constant | `source` | source discriminator |
| `externalId` | `HKWorkout.uuid` | `external_id` | idempotency key **within** the healthkit source |
| `activityType` | `HKWorkoutActivityType` → slug (§3) | `activity_type` | normalized slug shared across sources |
| `startTime` | `HKWorkout.startDate` (ISO, UTC) | `start_time` | **primary dedupe key** |
| `endTime` | `HKWorkout.endDate` | `end_time` | |
| `durationSeconds` | `HKWorkout.duration` | `duration_seconds` | **dedupe key** |
| `distanceMeters` | `HKWorkout.totalDistance` | `distance_meters` | may be null (e.g. strength) — **dedupe key when present** |
| `activeEnergyKcal` | `HKWorkout.totalEnergyBurned` | `active_energy_kcal` | may be null |
| `avgHeartRate` | HKStatistics over window (avg) | `avg_heart_rate` | computed natively |
| `maxHeartRate` | HKStatistics over window (max) | `max_heart_rate` | computed natively |
| `originAppName` | `sourceRevision.source.name` | `origin_app_name` | provenance |
| `originBundleId` | `sourceRevision.source.bundleIdentifier` | `origin_bundle_id` | provenance — drives source-skip (§4) |
| `deviceName` | `HKWorkout.device?.name` | `device_name` | e.g. "Apple Watch" |
| `wasManualEntry` | `HKMetadataKeyWasUserEntered` | `was_manual_entry` | lower-trust for metrics |

Timezone: all timestamps posted as **ISO8601 UTC**. Store UTC; render in the
user's tz at display time (same as Strava).

Daily-context quantities (resting HR, HRV SDNN, VO2max) are **not** workouts —
they go to a separate recovery/metrics store (or the dashboard read model),
fetched via `getRecoveryContext()`. They are not part of workout dedupe.

---

## 3. Activity type normalization

The Swift layer already emits a normalized slug (`activityTypeName()` in
`HealthKitPlugin.swift`). Keep this table the single source of truth and mirror
it in the backend's canonical activity enum so Strava/Garmin/HealthKit all map
into the same set.

| HKWorkoutActivityType | Duravel slug |
| --- | --- |
| running | `run` |
| walking | `walk` |
| cycling | `ride` |
| swimming | `swim` |
| traditionalStrengthTraining / functionalStrengthTraining | `strength` |
| highIntensityIntervalTraining | `hiit` |
| rowing | `row` |
| elliptical | `elliptical` |
| stairClimbing / stairs | `stairs` |
| coreTraining | `core` |
| crossTraining | `cross_training` |
| mixedCardio | `cardio` |
| hiking | `hike` |
| yoga | `yoga` |
| flexibility | `mobility` |
| (anything else) | `other` |

> HYROX-style sessions usually surface from the watch as `functionalStrengthTraining`,
> `highIntensityIntervalTraining`, or `mixedCardio`. There is no native HYROX
> type. If Duravel needs a distinct HYROX classification, infer it downstream
> from the user's assigned plan/session rather than from the HK type.

---

## 4. Dedupe — the core rules

A single real-world workout can arrive through **multiple sources**:
- Apple Watch records it → in HealthKit (source: Apple Watch).
- Strava **also** writes that same workout into HealthKit (source: Strava iOS),
  AND we ingest it directly via Strava OAuth.
- Garmin (planned) may write to HealthKit too, and/or be imported directly.

Without dedupe the user sees the same session 2–3×. Two layers:

### Layer A — same-source idempotency (exact)
Within `source = 'healthkit'`, `external_id = HKWorkout.uuid` is stable. Upsert
on `(source, external_id)`. Re-delivering the same workout (anchor overlap,
background + foreground both firing) is a no-op update, never a duplicate.
Implement as a unique constraint `(source, external_id)`.

### Layer B — cross-source fuzzy dedupe (the important one)
When a candidate workout is being ingested, check for an **already-stored
workout from a different source** that is "the same session" by fuzzy match:

Match if **ALL** of:
1. **Start time within ± 90 seconds.** Different devices stamp start slightly
   differently (watch tap vs GPS lock vs Strava rounding).
2. **Duration within ± 3% (min ± 20s).** Trims/auto-pause cause small drift.
3. **Distance within ± 2% (min ± 50 m)** — **only applied when both workouts
   have a distance**. If either side has null distance (e.g. strength), skip
   this check and rely on 1 + 2 (+ activity family, below).
4. **Activity family compatible.** Map slugs to families
   (`run/walk/hike` = footpod-cardio, `ride` = cycling, `swim` = swim,
   `strength/core/mobility` = strength, else exact-slug). A `run` and a `ride`
   at the same time are NOT the same session even if duration matches.

If a match is found → treat as the **same session**, do **not** create a new
workout. Instead **merge/enrich** by source priority (§5) and record the extra
source id in a `workout_sources` link (so we know it was also seen via HK).

Tolerances live in one config block so they're tunable:

```ts
// backend dedupe config (reference)
export const DEDUPE = {
  startTimeToleranceSec: 90,
  durationTolerancePct: 0.03,
  durationToleranceMinSec: 20,
  distanceTolerancePct: 0.02,
  distanceToleranceMinMeters: 50,
};
```

Query strategy (cheap + index-friendly): to find candidate matches, filter the
workouts table to the same user and `start_time BETWEEN candidate.start - 90s
AND candidate.start + 90s`, then apply rules 2–4 in code. Index on
`(user_id, start_time)`.

### The Strava-writes-to-HealthKit case (most common duplicate)
If Strava is installed, Strava mirrors activities into HealthKit. Those HK
samples carry `sourceBundleId = com.strava.stravaride`. Two defenses:
- **Client pre-filter** (`SKIP_SOURCE_BUNDLE_IDS` in `healthkit.service.ts`)
  drops HK workouts whose origin is Strava/our own app before posting — cheap
  win, avoids the round-trip.
- **Backend Layer B** still catches it if the pre-filter misses (e.g. bundle id
  changes), because the Strava-origin HK workout fuzzy-matches the directly
  ingested Strava workout.

Belt and suspenders: never rely on the client filter alone.

---

## 5. Source priority (which record "wins" on merge)

When the same session exists from multiple sources, pick a **canonical** record
and enrich missing fields from the others. Recommended priority for metric
trust:

```
Garmin (direct)  >  Strava (direct)  >  HealthKit (Apple Watch origin)  >  HealthKit (other origin)  >  manual entry
```

Rationale: direct integrations carry richer streams (laps, GPS, power) than the
HK summary; a native Apple Watch HK workout is high quality for HR but a summary
for structure; manual entries are least trusted. On merge:
- Keep the canonical source's structural data (distance, duration, GPS if any).
- **Backfill nulls** from lower-priority sources (e.g. HK `avgHeartRate` if the
  canonical lacks HR).
- Keep all contributing source ids in `workout_sources` for traceability + so a
  later delete/unlink from one source doesn't orphan the workout.

> If the canonical is later deleted at its source, promote the next-highest
> remaining source rather than dropping the workout.

---

## 6. Ordering / race considerations

- **HealthKit can arrive first OR second** relative to Strava. Dedupe must be
  symmetric — it runs on every ingest and matches against whatever is already
  stored, regardless of which source landed first.
- **Background + foreground double fire:** the anchored query + `syncNow()` can
  both return the same workout close together. Layer A idempotency handles this;
  make the upsert transactional so two concurrent ingests of the same
  `(source, external_id)` don't both insert (unique constraint + ON CONFLICT).
- **Late edits:** if a user edits a workout on the watch/Strava after ingest,
  the HK `uuid` stays the same → Layer A upserts the new values. Good.

---

## 7. Test checklist (real device)
1. Record an Apple Watch run with no other integration → appears once.
2. Connect Strava + Apple Watch, record one run → appears **once** (dedup),
   canonical = Strava, HR backfilled from HK if Strava lacks it.
3. Strength workout (null distance) recorded twice via watch → one record
   (Layer A), not blocked by distance rule.
4. A run and a ride started within 90s (edge) → **two** records (activity
   family differs).
5. Reinstall app / reset anchor → re-sync does not create duplicates (Layer A).

---

## 8. Backend reconciliation needed → see **Needs Levi**
The exact Supabase column names, the existing dedupe function (if Strava already
has one we should extend, not duplicate), and whether a `workout_sources` link
table exists or needs creating.
