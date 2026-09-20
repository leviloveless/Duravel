/**
 * What a brick's legs actually ask of the athlete (Levi, 2026-09-20).
 *
 * *"The brick workouts need to indicate the time spent running, time spent
 * cycling, speed for running and wattage for cycling."*
 *
 * ## What was actually on screen
 *
 * Two things, and only one of them was the thing asked about.
 *
 *   - On the WORKOUT page a brick read `Bike — 90 min — Zone 2`. Durations and
 *     zones, no target: a zone is a band on a heart-rate chart, not a number you
 *     can ride to.
 *   - On the WEEK page it read nothing at all. `SessionDetail` in
 *     `week-card.tsx` had branches for run, lift, hybrid and cardio, and
 *     returned `null` for everything else — so the main view of the program
 *     showed a brick's title and no content whatsoever. Not even the durations.
 *     A brick is the most race-specific session a triathlete does and it was the
 *     one session you had to click into to see at all.
 *
 * ## One formatter, three surfaces
 *
 * `week-card`, `workout-view` and `session-card` all render a brick's segments,
 * and before this they did it with three separate template literals that had
 * already drifted. They now delegate here. When two surfaces show the same
 * number, one of them has to own it.
 *
 * ## Where the numbers come from
 *
 * WATTS from the athlete's FTP, in the same Coggan bands `bikeContent` already
 * prescribes rides in — so a brick's ride and a standalone ride at the same zone
 * read the same, which they did not before.
 *
 * ⚠️ FTP IS ONLY ASKED OF TRIATHLETES (`onboarding-form.tsx` gates the field on
 * `isTriathlon`), and Levi's call on 2026-09-20 was to leave it that way: a
 * station athlete who authors a brick in the custom builder gets the effort
 * description instead. That is why `bikeSegmentTarget` returns `undefined`
 * rather than a `% FTP` band when no FTP is known — a percentage of a number
 * nobody supplied reads like a prescription and is not one.
 *
 * PACE from the athlete's own training paces, which every sport has, because
 * they derive from the 5K time HYROX already requires. So the run leg carries a
 * pace even where the bike leg cannot carry watts.
 *
 * PURE — no I/O, no framework. Used at RENDER from the athlete's live
 * benchmarks, which means a program generated before this shipped gains its
 * targets with no regeneration, and correcting an FTP corrects every brick ever
 * built. Same bargain the HR lines struck (`hr-targets.ts`).
 */

import { formatPace, type RunPaces } from "./paces";

/** The athlete's anchors, as much of them as is known. */
export interface BrickTargets {
  /** Functional threshold power, watts. Triathletes only — see the note above. */
  ftpWatts?: number;
  /** The athlete's training paces, from their run benchmarks. */
  paces?: RunPaces | null;
}

/**
 * Coggan power bands by training zone, as fractions of FTP.
 *
 * Lifted to match `bikeContent`'s existing prescriptions exactly rather than
 * chosen afresh: endurance 56-75%, sweet spot 88-94%, threshold 95-105%, VO₂max
 * 110-120%, recovery below 55%. A brick's ride is an ordinary ride that happens
 * to be followed by a run, and it should read like one.
 */
const WATT_BAND: Record<number, [number, number]> = {
  1: [0, 0.55],
  2: [0.56, 0.75],
  3: [0.88, 0.94],
  4: [0.95, 1.05],
  5: [1.1, 1.2],
};

/**
 * The run pace a brick leg at this zone is asking for.
 *
 * A brick's run leg is prescribed by ZONE, while paces are keyed by run TYPE, so
 * the two have to be bridged. Zone 2 off the bike is the athlete's easy pace —
 * NOT their long-run pace, even though both are Zone 2: a brick run is short and
 * already fatigued, and long-run pace is the slower of the two.
 */
const ZONE_PACE: Record<number, keyof RunPaces> = {
  1: "easy",
  2: "easy",
  3: "tempo",
  4: "threshold",
  5: "interval",
};

/** Watt target for a bike leg, or undefined when no FTP is known. */
export function bikeSegmentTarget(goalZone: number, t?: BrickTargets): string | undefined {
  const ftp = t?.ftpWatts;
  if (!ftp || ftp <= 0) return undefined;
  const band = WATT_BAND[goalZone] ?? WATT_BAND[2]!;
  return `${Math.round(ftp * band[0])}–${Math.round(ftp * band[1])}W`;
}

/** Pace target for a run leg, or undefined when no benchmarks are known. */
export function runSegmentTarget(goalZone: number, t?: BrickTargets): string | undefined {
  const p = t?.paces;
  if (!p) return undefined;
  const key = ZONE_PACE[goalZone] ?? "easy";
  const sec = p[key];
  if (typeof sec !== "number" || !Number.isFinite(sec) || sec <= 0) return undefined;
  return `${formatPace(sec)}/mi`;
}

/** The target for whichever discipline this segment is, if one can be given. */
export function brickSegmentTarget(
  segment: { discipline: string; goalZone: number },
  t?: BrickTargets,
): string | undefined {
  if (segment.discipline === "bike") return bikeSegmentTarget(segment.goalZone, t);
  if (segment.discipline === "run") return runSegmentTarget(segment.goalZone, t);
  return undefined;
}

/**
 * One brick segment as the athlete reads it.
 *
 * `Bike — 90 min — Zone 2 — 134–180W`
 * `Run — 20 min — Zone 2 — 9:45/mi`
 *
 * The target is appended rather than replacing the zone, because the zone is
 * what the session is FOR and the target is how to hit it — and because an
 * athlete without an FTP still needs the line to make sense.
 */
export function brickSegmentLine(
  segment: { discipline: string; durationMin: number; goalZone: number },
  t?: BrickTargets,
): string {
  const name = segment.discipline.charAt(0).toUpperCase() + segment.discipline.slice(1);
  const target = brickSegmentTarget(segment, t);
  return (
    `${name} — ${Math.round(segment.durationMin)} min — Zone ${segment.goalZone}` +
    (target ? ` — ${target}` : "")
  );
}
