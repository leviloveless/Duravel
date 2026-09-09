/**
 * THE TEMPO RUN'S HEART-RATE BAND.
 *
 * Interval and threshold have carried per-rep HR targets since the rep lines
 * shipped. Tempo — the third quality run, and the one an athlete is most likely
 * to drift on, because there are no reps to break the effort up and nothing to
 * reset against — carried none. One of six lines in the quality-run prescription
 * was quietly less useful than its neighbours.
 *
 * What is guarded here is not the wording. It is:
 *
 *  1. that the band is derived from the athlete's OWN model — Zone 3's span under
 *     whatever anchoring they have — rather than a generic percentage bolted on;
 *  2. that it finishes BELOW threshold HR, because sub-threshold is the definition
 *     of a tempo run and a band that crossed it would be prescribing the threshold
 *     session under another name;
 *  3. that it costs the prescription NO EXTRA LINE — the six-line shape was
 *     arrived at through three rounds of simplification and is not up for
 *     renegotiation; and
 *  4. that it comes out of the SAME function on the generation path and the render
 *     path, which is the property that let existing programs gain HR lines with no
 *     regeneration. A tempo band added only at generation would be baked and then
 *     stripped, because the program view drops every baked HR line and rebuilds it
 *     from the live model on each render.
 */
import { describe, it, expect } from "vitest";
import { resolveHrModel, zoneBpmRange } from "@/lib/zones";
import {
  hrTargetLines,
  stripHrLines,
  tempoBandBpm,
  withHrLines,
  HR_LINE_PREFIX,
} from "./hr-targets";
import { runDescription } from "./run-descriptions";

/** The engine's own goal zone for a tempo run (`slots.ts` `GOAL_ZONE.tempo`). */
const TEMPO_ZONE = 3;

/** Three athletes, one per anchoring method in the cascade. */
const LTHR = resolveHrModel({ age: 27, sex: "male", maxHr: 205, thresholdHr: 175 });
const HRR = resolveHrModel({ age: 35, sex: "male", restingHr: 50 });
const HRMAX = resolveHrModel({ age: 35, sex: "male" });
const ALL = [LTHR, HRR, HRMAX];

const tempoLines = (model = LTHR, goalZone = TEMPO_ZONE) =>
  hrTargetLines({ runType: "tempo", goalZone, model, reps: 0 });

describe("the tempo band exists at all", () => {
  it("gives a tempo run one HR line where it used to give none", () => {
    const ls = tempoLines();
    expect(ls).toHaveLength(1);
    expect(ls[0]).toMatch(/^HR /);
    expect(ls[0]).toMatch(/^HR tempo: \d+ by \d+ min in - \d+ by the end$/);
  });

  it("does not need a rep count — a tempo run has none", () => {
    // The program view derives reps from work distance, and `repsForWorkMiles`
    // returns null for tempo, so the view passes 0. That must not silence the line.
    expect(tempoLines()).toEqual(
      hrTargetLines({ runType: "tempo", goalZone: 3, model: LTHR, reps: 0 }),
    );
    for (const reps of [0, 1, 5]) {
      expect(hrTargetLines({ runType: "tempo", goalZone: 3, model: LTHR, reps })).toHaveLength(1);
    }
  });

  it("says nothing when there is no model to read", () => {
    expect(hrTargetLines({ runType: "tempo", goalZone: 3, model: null, reps: 0 })).toEqual([]);
    expect(hrTargetLines({ runType: "tempo", goalZone: 9, model: LTHR, reps: 0 })).toEqual([]);
  });
});

describe("the band is the athlete's own physiology", () => {
  it("sits inside the session zone the ENGINE assigned", () => {
    for (const model of ALL) {
      const band = tempoBandBpm(model, TEMPO_ZONE);
      const z3 = zoneBpmRange(model, TEMPO_ZONE);
      expect(band.settled).toBeGreaterThanOrEqual(z3.min);
      expect(band.end).toBeLessThanOrEqual(z3.max);
      // Not pinned to the floor: an effort held at the boundary with Zone 2 is an
      // easy run the athlete has been told to call a tempo.
      expect(band.settled).toBeGreaterThan(z3.min);
      // And it climbs — a single flat number would read as a failed first mile.
      expect(band.end).toBeGreaterThan(band.settled);
    }
  });

  it("finishes BELOW threshold HR under every anchoring method", () => {
    // Zone 4's ceiling is where this project puts threshold HR under all three
    // anchors (under LTHR it is 1.00 x threshold HR by construction). Tempo sits
    // below threshold; a band that touched it would be the threshold session.
    for (const model of ALL) {
      expect(tempoBandBpm(model, TEMPO_ZONE).end).toBeLessThan(zoneBpmRange(model, 4).max);
    }
  });

  it("stays under threshold even for a goal zone that would push it over", () => {
    // Custom hand-entered bands can order themselves however they like. The
    // sub-threshold ceiling is what stops an impossible combination printing a
    // tempo target above the athlete's threshold HR.
    const band = tempoBandBpm(LTHR, 5);
    expect(band.end).toBeLessThan(zoneBpmRange(LTHR, 4).max);
    expect(band.settled).toBeLessThanOrEqual(band.end);
  });

  it("gives two athletes with the SAME max HR different numbers", () => {
    // The point of routing through `zoneBpmRange` rather than a %-of-max constant:
    // the band has to move with whatever data the athlete actually supplied.
    expect(HRR.maxHR).toBe(HRMAX.maxHR);
    expect(tempoLines(HRR)).not.toEqual(tempoLines(HRMAX));
  });

  it("moves when the athlete's threshold HR moves", () => {
    const fitter = resolveHrModel({ age: 27, sex: "male", maxHr: 205, thresholdHr: 185 });
    expect(tempoBandBpm(fitter, TEMPO_ZONE).end).toBeGreaterThan(
      tempoBandBpm(LTHR, TEMPO_ZONE).end,
    );
  });
});

describe("it costs the prescription no extra line", () => {
  const hr = { model: LTHR, goalZone: TEMPO_ZONE };
  const hrLinesOf = (text: string) => text.split("\n").filter((l) => l.startsWith(HR_LINE_PREFIX));

  it("adds exactly one line to the tempo how-to and nothing else", () => {
    const without = runDescription("tempo", "intermediate");
    const with_ = runDescription("tempo", "intermediate", null, undefined, hr);
    expect(hrLinesOf(without)).toHaveLength(0);
    expect(hrLinesOf(with_)).toHaveLength(1);
    expect(with_.split("\n")).toHaveLength(without.split("\n").length + 1);
    expect(stripHrLines(with_)).toBe(without);
  });

  it("carries no recovery-jog line — a continuous run has no recovery jogs", () => {
    const ls = hrLinesOf(runDescription("tempo", "intermediate", null, undefined, hr));
    expect(ls.some((l) => l.includes("recovery jogs"))).toBe(false);
  });

  it("leaves the rep-based prescriptions at exactly six lines", () => {
    // Warm up / Work / Cooldown / Work:rest / HR reps / HR recovery jogs. Adding a
    // seventh here is the failure this whole design is arranged around.
    for (const runType of ["interval", "threshold"] as const) {
      const text = runDescription(runType, "intermediate", null, 4, {
        model: LTHR,
        goalZone: runType === "interval" ? 5 : 4,
      });
      expect(text.split("\n"), runType).toHaveLength(6);
    }
  });
});

describe("one function feeds both the generation path and the render path", () => {
  const hr = { model: LTHR, goalZone: TEMPO_ZONE };

  it("bakes the same line the view rebuilds", () => {
    const baked = runDescription("tempo", "intermediate", null, undefined, hr);
    // How the program view rebuilds it (`runHowTo` in `components/program/week-card`):
    // drop whatever was baked, re-render from the athlete's LIVE model.
    const rendered = withHrLines(
      baked,
      hrTargetLines({ runType: "tempo", goalZone: TEMPO_ZONE, model: LTHR, reps: 0 }),
    );
    expect(rendered).toBe(baked);
  });

  it("gives an ALREADY-GENERATED tempo run its band with no regeneration", () => {
    // A program generated before this shipped (or for an athlete with no HR data
    // at the time) has tempo text with no HR line at all. The view must produce
    // one from the model it has now.
    const stored = runDescription("tempo", "intermediate");
    expect(stored).not.toContain(HR_LINE_PREFIX);
    const rendered = withHrLines(
      stored,
      hrTargetLines({ runType: "tempo", goalZone: TEMPO_ZONE, model: HRR, reps: 0 }),
    );
    expect(rendered.split("\n").filter((l) => l.startsWith(HR_LINE_PREFIX))).toEqual(
      tempoLines(HRR),
    );
  });

  it("REPLACES a stale baked band rather than stacking a second one", () => {
    // An athlete who enters a resting HR after generation must see one band, the
    // new one — not last month's numbers with this month's underneath.
    const baked = runDescription("tempo", "intermediate", null, undefined, hr);
    const rerendered = withHrLines(
      baked,
      hrTargetLines({ runType: "tempo", goalZone: TEMPO_ZONE, model: HRR, reps: 0 }),
    );
    const ls = rerendered.split("\n").filter((l) => l.startsWith(HR_LINE_PREFIX));
    expect(ls).toHaveLength(1);
    expect(ls).toEqual(tempoLines(HRR));
    expect(rerendered).not.toContain(tempoLines(LTHR)[0]);
  });

  it("still strips cleanly for the places that have no model", () => {
    // Strava text and shared cards render without a model; they get the prose back.
    const baked = runDescription("tempo", "intermediate", null, undefined, hr);
    expect(stripHrLines(baked)).toBe(runDescription("tempo", "intermediate"));
  });
});
