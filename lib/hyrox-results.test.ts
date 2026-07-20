import { describe, it, expect } from "vitest";
import { formatMs, normalizeSearchResults, normalizeResult, normalizeSplits } from "./hyrox-results";

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

// The exact shape returned by GET /api/v1/athletes/{id}/splits (real response,
// trimmed to a representative subset: two run legs, two stations, roxzone + totals).
const REAL_SPLITS = {
  data: [
    { canonical_key: "run1_time", label_original: "Running 1", order_index: 0, time_ms: 400000, time_text: "00:06:40", place: null, result_id: 744979 },
    { canonical_key: "skiErg_time", label_original: "1000m SkiErg", order_index: 1, time_ms: 241000, time_text: "00:04:01", place: 364, result_id: 744979 },
    { canonical_key: "run2_time", label_original: "Running 2", order_index: 2, time_ms: 333000, time_text: "00:05:33", place: null, result_id: 744979 },
    { canonical_key: "wallBalls_time", label_original: "Wall Balls", order_index: 15, time_ms: 261000, time_text: "00:04:21", place: 360, result_id: 744979 },
    { canonical_key: "roxzone_time", label_original: "Roxzone Time", order_index: 16, time_ms: 424000, time_text: "00:07:04", place: 436, result_id: 744979 },
    { canonical_key: "run_time", label_original: "Run Total", order_index: 17, time_ms: 3104000, time_text: "00:51:44", place: 698, result_id: 744979 },
    { canonical_key: "best_run_lap_time", label_original: "Best Run Lap", order_index: 18, time_ms: 333000, time_text: "00:05:33", place: 677, result_id: 744979 },
  ],
  meta: { data_source: "database" },
  errors: null,
};

describe("normalizeSplits (real /athletes/{id}/splits shape)", () => {
  const splits = normalizeSplits(REAL_SPLITS);

  it("keeps every timed row, in race order, with API labels", () => {
    expect(splits).toHaveLength(7);
    expect(splits.map((s) => s.order)).toEqual([...splits.map((s) => s.order)].sort((a, b) => a - b));
    const run1 = splits.find((s) => s.key === "run1_time")!;
    expect(run1.label).toBe("Running 1");
    expect(run1.time).toBe("6:40");
  });

  it("classifies runs, stations, roxzone, and aggregate rows", () => {
    const kind = (k: string) => splits.find((s) => s.key === k)!.kind;
    expect(kind("run1_time")).toBe("run");
    expect(kind("skiErg_time")).toBe("station");
    expect(kind("wallBalls_time")).toBe("station");
    expect(kind("roxzone_time")).toBe("roxzone");
    expect(kind("run_time")).toBe("summary");
    expect(kind("best_run_lap_time")).toBe("summary");
  });

  it("carries the field placing when present, null otherwise", () => {
    expect(splits.find((s) => s.key === "skiErg_time")!.place).toBe(364);
    expect(splits.find((s) => s.key === "run1_time")!.place).toBeNull();
  });

  it("falls back to a prettified label when the API omits one", () => {
    const [s] = normalizeSplits({ data: [{ canonical_key: "sledPush_time", time_ms: 107000, order_index: 3 }] });
    expect(s!.label).toBe("Sled Push");
    expect(s!.kind).toBe("station");
  });
});

describe("normalizeResult (splits endpoint)", () => {
  it("wraps the ordered splits; name/total stay null (splits carry neither)", () => {
    const r = normalizeResult("r1", REAL_SPLITS);
    expect(r.id).toBe("r1");
    expect(r.name).toBeNull();
    expect(r.totalTimeMs).toBeNull();
    expect(r.finishTime).toBe("");
    expect(r.splits).toHaveLength(7);
    expect(r.splits.filter((s) => s.kind === "run")).toHaveLength(2);
  });
});
