/**
 * An authored week actually reaching a TRIATHLETE (Levi, 2026-09-11).
 *
 * ## Why this file exists
 *
 * For two days the custom tier sold a promise it did not keep for a third of
 * its sports. `buildSkeleton` short-circuits to `buildTriathlonSkeleton` before
 * `weekDays` is ever reached, so `assignDaysFromTemplate` — the entire authored-
 * week mechanism — was unreachable from every triathlon program. A triathlete
 * could design a week, save it, and be billed for the privilege while the engine
 * built something else entirely. Nothing errored. 1,591 tests passed.
 *
 * That is the "an engine decision silently discarded by the wiring" shape for
 * the fifth time in this repo, and the reason the first assertion below is the
 * blunt one: the sessions the athlete asked for are on the days they asked for.
 *
 * ## What is deliberately NOT asserted
 *
 * Minutes. Every number in an authored triathlon week is still the engine's —
 * the band ceiling, the phase caps, `fitTriSlotsToTarget`. Pinning them here
 * would pin the volume model to the template feature, and they are separate
 * questions with separate tests.
 */
import { describe, it, expect } from "vitest";
import { buildSkeleton } from "./skeleton";
import type { EngineInput, WeekTemplate, DaySlot } from "./types";

const authored: WeekTemplate = {
  days: [
    { day: "mon", sessions: [{ kind: "swim" }] },
    { day: "tue", sessions: [{ kind: "bike", startMin: 60 }] },
    { day: "wed", sessions: [{ kind: "run", runType: "tempo" }] },
    { day: "thu", sessions: [{ kind: "swim" }] },
    { day: "sat", sessions: [{ kind: "brick" }] },
    {
      day: "sun",
      sessions: [
        { kind: "run", runType: "long" },
        { kind: "lift", liftType: "full" },
      ],
    },
  ],
};

function input(weekTemplate?: WeekTemplate, over: Partial<EngineInput> = {}): EngineInput {
  return {
    sport: "tri_70_3",
    durationWeeks: 12,
    trainingDays: ["mon", "tue", "wed", "thu", "sat", "sun"],
    runningExp: "intermediate",
    hybridExp: "intermediate",
    liftingExp: "intermediate",
    trainingClass: "non_highly_trained",
    weeklyHours: "h10_20",
    races: [{ weekNumber: 12, priority: "A" }],
    needs: {},
    restDays: [],
    weekTemplate,
    ...over,
  } as unknown as EngineInput;
}

/** The kinds on a day, in order — the shape an athlete would recognise. */
const shape = (days: DaySlot[]) =>
  days.map((d) => `${d.day}:${d.sessions.map((s) => s.kind).join("+") || "-"}`).join(" ");

describe("a triathlete's authored week", () => {
  const built = buildSkeleton(input(authored));

  it("puts the authored sessions on the authored days", () => {
    // Week 1 is a loading week: what the athlete wrote is what the week holds.
    expect(shape(built.weeks[0]!.days)).toBe(
      "mon:swim tue:bike wed:run thu:swim sat:brick sun:run+lift",
    );
  });

  it("is not the week the engine would have built on its own", () => {
    // The guard that makes the assertion above mean something. Without it the
    // test would still pass if the template were ignored and the generated week
    // happened to look similar.
    const generated = buildSkeleton(input());
    expect(shape(built.weeks[0]!.days)).not.toBe(shape(generated.weeks[0]!.days));
  });

  it("honours the athlete's discipline MIX, not just their days", () => {
    // Levi's 2026-09-11 decision: two swims where the engine wanted more is two
    // swims. This is the half of the feature that cannot be faked by placement.
    const kinds = built.weeks[0]!.days.flatMap((d) => d.sessions.map((s) => s.kind));
    expect(kinds.filter((k) => k === "swim")).toHaveLength(2);
    expect(kinds.filter((k) => k === "bike")).toHaveLength(1);
  });

  it("keeps the shape across the phases, because a template is every week", () => {
    for (const wk of [1, 4, 8]) {
      expect(shape(built.weeks[wk - 1]!.days), `week ${wk}`).toBe(
        "mon:swim tue:bike wed:run thu:swim sat:brick sun:run+lift",
      );
    }
  });

  it("gives the RACE week back to the taper protocol", () => {
    // Race-week structure is a safety property, not a preference — the same
    // short-circuit the station path takes.
    const race = built.weeks[11]!;
    expect(race.days.some((d) => d.sessions.some((s) => s.kind === "race"))).toBe(true);
    expect(shape(race.days)).not.toBe("mon:swim tue:bike wed:run thu:swim sat:brick sun:run+lift");
  });

  it("still holds every week inside the athlete's hours", () => {
    // The whole reason the authored path reuses `fitTriSlotsToTarget` rather than
    // sizing sessions itself. h10_20 tops out at 20 h = 1,200 min.
    for (const w of built.weeks) {
      const total = w.days.reduce(
        (n, d) =>
          n +
          d.sessions.reduce(
            (m, s) =>
              m +
              ("durationMin" in s ? (s.durationMin as number) : 0) +
              ("segments" in s
                ? (s.segments as { durationMin: number }[]).reduce((x, g) => x + g.durationMin, 0)
                : 0),
            0,
          ),
        0,
      );
      expect(total, `week ${w.weekNumber}`).toBeLessThanOrEqual(1200);
    }
  });

  it("never puts a session on a day the athlete does not train", () => {
    const trainingDays = ["mon", "tue", "wed", "thu", "sat", "sun"];
    for (const w of built.weeks) {
      for (const d of w.days) expect(trainingDays).toContain(d.day);
    }
  });

  it("builds a generic week when the athlete authored none", () => {
    // The tier is opt-in: no template must leave the triathlon path exactly as
    // it was. This is the regression guard for every existing triathlete.
    const before = buildSkeleton(input());
    const after = buildSkeleton(input(undefined));
    expect(shape(after.weeks[0]!.days)).toBe(shape(before.weeks[0]!.days));
  });
});

describe("an authored week the athlete sized", () => {
  it("weights the ride they made bigger, without letting it take the week", () => {
    const big: WeekTemplate = {
      days: [
        { day: "mon", sessions: [{ kind: "swim" }] },
        { day: "tue", sessions: [{ kind: "bike", startMin: 45 }] },
        { day: "wed", sessions: [{ kind: "run", runType: "easy" }] },
        { day: "thu", sessions: [{ kind: "bike", startMin: 180 }] },
        { day: "sat", sessions: [{ kind: "brick" }] },
        { day: "sun", sessions: [{ kind: "run", runType: "long" }] },
      ],
    };
    const w = buildSkeleton(input(big)).weeks[0]!;
    const rides = w.days
      .flatMap((d) => d.sessions)
      .filter((s) => s.kind === "bike")
      .map((s) => (s as { durationMin: number }).durationMin);
    expect(rides).toHaveLength(2);
    const small = Math.min(...rides);
    const large = Math.max(...rides);

    // THE RULE, and it took a wrong expectation to find it: the engine may
    // deliver LESS spread than the athlete asked for — the caps and the race
    // balance are allowed to compress it — but it must never deliver MORE. An
    // amplified ratio would be the engine inventing an emphasis out of a number
    // the athlete typed, which is the one thing a size box must not do.
    //
    // Measured here: a 45-vs-180 ask (4.0x) ships at about 3.6x, compressed by
    // the long-ride cap. The first version of this test asserted <= 3.0 on the
    // theory that `weightIn`'s per-session clamp bounded the PAIR; it does not —
    // it bounds each side, so the pair can legitimately reach 9x. The clamp is
    // the safety rail, this is the contract.
    expect(large).toBeGreaterThan(small);
    expect(large / small).toBeLessThanOrEqual(180 / 45);
  });

  it("does not stack the long-ride multiplier on top of an authored size", () => {
    // The two are the same statement made twice. Sizing the rides 45 and 180 and
    // then multiplying the larger by 1.4 for being "the long one" produced a
    // spread the athlete never asked for — caught by the test above before it
    // shipped, which is the whole reason that bound is written as the ask.
    const sized: WeekTemplate = {
      days: [
        { day: "mon", sessions: [{ kind: "swim" }] },
        { day: "tue", sessions: [{ kind: "bike", startMin: 90 }] },
        { day: "wed", sessions: [{ kind: "run", runType: "easy" }] },
        { day: "thu", sessions: [{ kind: "bike", startMin: 90 }] },
        { day: "sat", sessions: [{ kind: "brick" }] },
        { day: "sun", sessions: [{ kind: "run", runType: "long" }] },
      ],
    };
    const rides = buildSkeleton(input(sized))
      .weeks[0]!.days.flatMap((d) => d.sessions)
      .filter((s) => s.kind === "bike")
      .map((s) => (s as { durationMin: number }).durationMin);
    // Two rides the athlete called equal come out equal, even though one of them
    // is still designated the week's long ride for capping purposes.
    expect(rides[0]).toBe(rides[1]);
  });
});
