import { describe, it, expect } from "vitest";
import {
  CLOSE_A_RACE_WEEKS,
  byDate,
  closeARaces,
  countdownTo,
  dateDrift,
  eventTitle,
  nextRace,
  upcoming,
  type EventRow,
} from "@/lib/events/derive";

const ev = (over: Partial<EventRow> & { race_date: string }): EventRow => ({
  id: over.race_date + (over.priority ?? "A"),
  user_id: "u1",
  program_id: null,
  priority: "A",
  name: null,
  sport: null,
  goal_time: null,
  notes: null,
  source: "athlete",
  ...over,
});

const TODAY = "2026-09-14";

describe("ordering", () => {
  it("sorts soonest first", () => {
    const out = byDate([ev({ race_date: "2026-11-28" }), ev({ race_date: "2026-10-17" })]);
    expect(out.map((e) => e.race_date)).toEqual(["2026-10-17", "2026-11-28"]);
  });

  it("puts an A race ahead of a B on the same day", () => {
    const out = byDate([
      ev({ race_date: "2026-10-17", priority: "B" }),
      ev({ race_date: "2026-10-17", priority: "A" }),
    ]);
    expect(out.map((e) => e.priority)).toEqual(["A", "B"]);
  });

  it("drops races that have already happened", () => {
    const out = upcoming([ev({ race_date: "2026-09-13" }), ev({ race_date: "2026-09-14" })], TODAY);
    expect(out.map((e) => e.race_date)).toEqual(["2026-09-14"]);
  });

  it("keeps a race happening today", () => {
    expect(upcoming([ev({ race_date: TODAY })], TODAY)).toHaveLength(1);
  });
});

describe("nextRace", () => {
  it("counts down to the NEXT A race, not the only one", () => {
    const next = nextRace(
      [ev({ race_date: "2026-11-28" }), ev({ race_date: "2027-03-06" })],
      TODAY,
    );
    expect(next!.race_date).toBe("2026-11-28");
  });

  it("prefers an A race over a sooner B", () => {
    const next = nextRace(
      [
        ev({ race_date: "2026-10-17", priority: "B" }),
        ev({ race_date: "2026-11-28", priority: "A" }),
      ],
      TODAY,
    );
    expect(next!.race_date).toBe("2026-11-28");
  });

  it("falls back to the next race of any priority when there is no A", () => {
    const next = nextRace([ev({ race_date: "2026-10-17", priority: "C" })], TODAY);
    expect(next!.priority).toBe("C");
  });

  it("ignores races in the past", () => {
    expect(nextRace([ev({ race_date: "2026-01-01" })], TODAY)).toBeNull();
  });

  it("returns null for an empty season", () => {
    expect(nextRace([], TODAY)).toBeNull();
  });
});

describe("countdownTo", () => {
  it("counts whole days", () => {
    const c = countdownTo(ev({ race_date: "2026-11-28" }), new Date(2026, 8, 14));
    expect(c).toEqual({ days: 75, weeks: 10, spareDays: 5 });
  });

  it("is null when there is no race", () => {
    expect(countdownTo(null)).toBeNull();
  });

  it("does not shift with the local clock", () => {
    // A countdown is a date difference. Late evening local is the next UTC day,
    // and the count must not move — the bug that shipped once already.
    const evening = new Date(2026, 8, 14, 23, 30);
    expect(countdownTo(ev({ race_date: "2026-11-28" }), evening)!.days).toBe(75);
  });
});

describe("closeARaces", () => {
  it("warns when two A races are closer than the peak window", () => {
    const w = closeARaces(
      [ev({ race_date: "2026-10-17" }), ev({ race_date: "2026-11-28" })],
      TODAY,
    );
    expect(w).toHaveLength(1);
    expect(w[0]!.weeksApart).toBe(6);
  });

  it("stays quiet when they are far enough apart", () => {
    expect(
      closeARaces([ev({ race_date: "2026-10-17" }), ev({ race_date: "2027-01-16" })], TODAY),
    ).toHaveLength(0);
  });

  it("uses the documented window", () => {
    expect(CLOSE_A_RACE_WEEKS).toBe(8);
    // Exactly at the boundary is fine; one day short of it is not.
    const at = closeARaces(
      [ev({ race_date: "2026-10-01" }), ev({ race_date: "2026-11-26" })],
      TODAY,
    );
    expect(at).toHaveLength(0); // 56 days = 8 weeks
    const under = closeARaces(
      [ev({ race_date: "2026-10-01" }), ev({ race_date: "2026-11-25" })],
      TODAY,
    );
    expect(under).toHaveLength(1); // 55 days
  });

  it("never warns about a B or C race", () => {
    expect(
      closeARaces(
        [
          ev({ race_date: "2026-10-17", priority: "B" }),
          ev({ race_date: "2026-10-24", priority: "C" }),
        ],
        TODAY,
      ),
    ).toHaveLength(0);
  });

  it("reports adjacent pairs only — three A races give two warnings, not three", () => {
    const w = closeARaces(
      [
        ev({ race_date: "2026-10-03" }),
        ev({ race_date: "2026-10-31" }),
        ev({ race_date: "2026-11-28" }),
      ],
      TODAY,
    );
    expect(w).toHaveLength(2);
  });

  it("ignores A races that have already happened", () => {
    expect(
      closeARaces([ev({ race_date: "2026-08-01" }), ev({ race_date: "2026-08-20" })], TODAY),
    ).toHaveLength(0);
  });
});

describe("dateDrift", () => {
  const linked = ev({ race_date: "2026-11-28", program_id: "p1" });

  it("reports a disagreement between the event and the block built for it", () => {
    const d = dateDrift([linked], () => "2026-11-21");
    expect(d).toHaveLength(1);
    expect(d[0]!.daysApart).toBe(7);
    expect(d[0]!.programDate).toBe("2026-11-21");
  });

  it("says nothing when they agree", () => {
    expect(dateDrift([linked], () => "2026-11-28")).toHaveLength(0);
  });

  it("ignores an event with no program", () => {
    expect(dateDrift([ev({ race_date: "2026-11-28" })], () => "2026-01-01")).toHaveLength(0);
  });

  it("ignores a program whose date cannot be determined", () => {
    expect(dateDrift([linked], () => null)).toHaveLength(0);
  });

  it("signs the gap so the UI can say which way it moved", () => {
    expect(dateDrift([linked], () => "2026-12-05")[0]!.daysApart).toBe(-7);
  });
});

describe("eventTitle", () => {
  it("uses the name when there is one", () => {
    expect(eventTitle(ev({ race_date: "2026-11-28", name: "HYROX Dallas" }))).toBe("HYROX Dallas");
  });
  it("falls back to sport and date", () => {
    expect(eventTitle(ev({ race_date: "2026-11-28", sport: "HYROX" }))).toBe("HYROX — 2026-11-28");
  });
  it("copes with neither", () => {
    expect(eventTitle(ev({ race_date: "2026-11-28" }))).toBe("Race — 2026-11-28");
  });
  it("treats a whitespace-only name as absent", () => {
    expect(eventTitle(ev({ race_date: "2026-11-28", name: "   " }))).toBe("Race — 2026-11-28");
  });
});
