import { describe, it, expect } from "vitest";
import { formatMs, normalizeSearchResults, normalizeResult } from "./hyrox-results";

describe("formatMs", () => {
  it("formats h:mm:ss and m:ss, null-safe", () => {
    expect(formatMs(5144000)).toBe("1:25:44"); // Levi's real doubles result
    expect(formatMs(3878000)).toBe("1:04:38");
    expect(formatMs(70000)).toBe("1:10");
    expect(formatMs(0)).toBe("0:00");
    expect(formatMs(null)).toBe("");
  });
});

// The exact shape returned by GET /api/v1/athletes/search (real response).
const REAL = {
  data: [
    {
      id: "eyJ0IjoicmFjZSIsInMiOiJzZWFzb24tOCIsImUiOiJIRF9MUjNNUzRKSTEyRUQiLCJpIjoiTFIzTVM0Skk0NzU0QzQiLCJoIjoibGV2aS1sb3ZlbGVzcyIsInYiOjF9",
      display_name: "Levi Loveless, Alex Herman",
      nationality: null,
      sex: "M",
      event_slug: "season-8-hd-lr3ms4ji12ed",
      event_name: "HYROX DOUBLES - Saturday",
      total_time_ms: 5144000,
      rank_overall: null,
      person_ref: "eyJ0IjoicGVyc29uI..._v1",
    },
  ],
  meta: { data_source: "database", count: 1 },
  errors: null,
};

describe("normalizeSearchResults (real API shape)", () => {
  it("builds a result straight from the search hit", () => {
    const [r] = normalizeSearchResults(REAL);
    expect(r).toBeTruthy();
    expect(r!.name).toBe("Levi Loveless, Alex Herman");
    expect(r!.event).toBe("HYROX DOUBLES - Saturday");
    expect(r!.totalTimeMs).toBe(5144000);
    expect(r!.finishTime).toBe("1:25:44");
    expect(r!.season).toBe("Season 8"); // parsed from event_slug
    expect(r!.id.length).toBeGreaterThan(10);
  });
  it("handles bare arrays / results / athletes envelopes and skips id-less hits", () => {
    expect(normalizeSearchResults([{ id: "x", total_time_ms: 60000 }])).toHaveLength(1);
    expect(normalizeSearchResults({ results: [{ id: "y", total_time_ms: 60000 }] })).toHaveLength(1);
    expect(normalizeSearchResults({ data: [{ display_name: "no id" }] })).toHaveLength(0);
    expect(normalizeSearchResults(null)).toHaveLength(0);
  });
});

describe("normalizeResult (splits endpoint, later use)", () => {
  it("reads total time + station splits defensively", () => {
    const r = normalizeResult("r1", {
      display_name: "Alex Morgan",
      total_time_ms: 3878000,
      splits: { skiErg_time_ms: 281000, wallBalls_time_ms: 302000 },
    });
    expect(r.finishTime).toBe("1:04:38");
    expect(r.splits.map((s) => s.station)).toContain("SkiErg");
    expect(r.splits.find((s) => s.station === "SkiErg")!.time).toBe("4:41");
  });
});
