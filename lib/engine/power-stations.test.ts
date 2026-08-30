/**
 * THE POWER DAY IS THE RACE'S FOUR LOADED STATIONS (Levi, 2026-08-25).
 *
 * "The power workout should include the following exercises: (1) Sled push,
 * (2) sled pull, (3) wall balls, (4) walking lunges. The number of reps and
 * weight should be scaled to the experience of the user" — and on loading:
 * "Absolute weights based on the type of race the user is preparing for; the
 * weights should be 150% of the competition weight."
 *
 * The load rule is the one worth guarding hardest. It is a FACT about the
 * athlete's division and sex, read from the sport's own catalog, and it must not
 * quietly drift when the volume tables change.
 */
import { describe, it, expect } from "vitest";
import {
  applyPowerStations,
  powerStationLoad,
  powerStationMovements,
  POWER_STATIONS,
  POWER_STATION_LOAD_FACTOR,
  POWER_STATION_CUE,
} from "./power-stations";
import { HYROX_CATALOG } from "./stations";
import { POWER_REST_SECONDS } from "./strength";
import type { Session } from "@/lib/schemas";

const base = {
  division: "open",
  sex: "male",
  hybridExp: "intermediate",
  weightUnit: "kg",
} as const;
const move = (opts = {}) => powerStationMovements({ ...base, ...opts });
const named = (opts = {}) => move(opts).map((m) => m.exercise);

describe("the four stations", () => {
  it("is exactly Levi's four, in the order they are performed", () => {
    expect(named()).toEqual(["Sled Push", "Sled Pull", "Wall Balls", "Walking Lunges"]);
  });

  it("leads with the sleds — the most demanding work wants the freshest athlete", () => {
    expect(named().slice(0, 2)).toEqual(["Sled Push", "Sled Pull"]);
  });

  it("tags each with the movement pattern it trains, so the week still counts them", () => {
    expect(move().map((m) => m.pattern)).toEqual([
      "horizontal_press",
      "horizontal_pull",
      "vertical_press",
      "lunge",
    ]);
  });

  it("marks every movement as power work, with the long rest and a station cue", () => {
    for (const m of move()) {
      expect(m.emphasis).toBe("power");
      expect(m.restSeconds).toBe(POWER_REST_SECONDS);
      // "bar speed" is meaningless on a sled.
      expect(m.note).toBe(POWER_STATION_CUE);
      expect(m.note).not.toMatch(/bar/i);
    }
  });
});

describe("the load is 150% of the competition weight", () => {
  for (const division of ["open", "pro"] as const) {
    for (const sex of ["male", "female"] as const) {
      it(`holds for ${division}/${sex}`, () => {
        for (const { station } of POWER_STATIONS) {
          const raceKg = HYROX_CATALOG.stations[station]!.loadKg![division]![sex]!;
          const text = powerStationLoad(station, division, sex, "kg")!;
          const shown = Number(/^([\d.]+) kg/.exec(text)![1]);
          const exact = raceKg * POWER_STATION_LOAD_FACTOR;
          // Within the granularity a gym can actually load: 0.5 kg on a light
          // implement, 2.5 kg once there are plates on a sled.
          const grain = exact < 20 ? 0.25 : 1.25;
          expect(
            Math.abs(shown - exact),
            `${station} ${division}/${sex} → ${text}`,
          ).toBeLessThanOrEqual(grain);
          // …and the race figure is quoted exactly, not re-rounded.
          expect(text).toContain(`150% of race ${raceKg}`);
        }
      });
    }
  }

  it("gives a female athlete different weights from a male one", () => {
    const m = powerStationLoad("sled_push", "open", "male", "kg");
    const f = powerStationLoad("sled_push", "open", "female", "kg");
    expect(m).not.toBe(f);
  });

  it("converts to pounds without losing the 150%", () => {
    const text = powerStationLoad("wall_balls", "open", "male", "lbs")!;
    // 6 kg race → 9 kg → ~20 lb.
    expect(text).toMatch(/^20 lb /);
  });

  it("keeps light implements to a sensible granularity", () => {
    // Rounding everything to 2.5 kg turned a 9 kg wall ball into 10.
    expect(powerStationLoad("wall_balls", "open", "male", "kg")).toBe("9 kg (150% of race 6)");
  });

  it("falls back to HYROX for a sport whose catalog has no such station", () => {
    const empty = { ...HYROX_CATALOG, stations: {} } as typeof HYROX_CATALOG;
    expect(powerStationLoad("sled_push", "open", "male", "kg", empty)).toBe(
      powerStationLoad("sled_push", "open", "male", "kg"),
    );
  });
});

describe("experience scales the VOLUME, never the weight", () => {
  const levels = ["beginner", "intermediate", "advanced"] as const;

  it("gives a more experienced athlete more work", () => {
    const volume = levels.map((hybridExp) =>
      move({ hybridExp }).reduce((n, m) => n + m.sets * parseFloat(m.repRange), 0),
    );
    expect(volume[0]!).toBeLessThan(volume[1]!);
    expect(volume[1]!).toBeLessThan(volume[2]!);
  });

  it("hands all three levels the SAME load", () => {
    const loads = levels.map((hybridExp) => move({ hybridExp }).map((m) => m.suggestedWeight));
    expect(loads[0]).toEqual(loads[1]);
    expect(loads[1]).toEqual(loads[2]);
  });

  it("keeps the sled well short of the race's 50 m — a power set ends while it is fast", () => {
    for (const hybridExp of levels) {
      const sled = move({ hybridExp })[0]!;
      expect(parseFloat(sled.repRange), hybridExp).toBeLessThan(50);
    }
  });
});

describe("applyPowerStations", () => {
  const lift = (liftType: string): Session =>
    ({
      kind: "lift",
      liftType,
      movements: [{ pattern: "squat", sets: 6, repRange: "3", exercise: "Trap-Bar Jump" }],
      power: { exercise: "box jumps", sets: 4, reps: "3" },
    }) as unknown as Session;

  it("replaces a power day's movements wholesale", () => {
    const week = { days: [{ sessions: [lift("power")] }] };
    applyPowerStations(week, base);
    const s = week.days[0]!.sessions[0]!;
    if (s.kind !== "lift") throw new Error("expected a lift");
    expect(s.movements.map((m) => m.exercise)).toEqual([
      "Sled Push",
      "Sled Pull",
      "Wall Balls",
      "Walking Lunges",
    ]);
  });

  it("drops the plyometric add-on — four race stations are concrete enough", () => {
    const week = { days: [{ sessions: [lift("power")] }] };
    applyPowerStations(week, base);
    const s = week.days[0]!.sessions[0]!;
    if (s.kind !== "lift") throw new Error("expected a lift");
    expect(s.power).toBeUndefined();
  });

  it("leaves every other lift day alone", () => {
    for (const liftType of ["full", "upper", "lower"]) {
      const week = { days: [{ sessions: [lift(liftType)] }] };
      applyPowerStations(week, base);
      const s = week.days[0]!.sessions[0]!;
      if (s.kind !== "lift") throw new Error("expected a lift");
      expect(
        s.movements.map((m) => m.exercise),
        liftType,
      ).toEqual(["Trap-Bar Jump"]);
    }
  });
});
