import { describe, it, expect } from "vitest";
import { computeTriZones } from "./tri-zones";

describe("Triathlon per-discipline zones", () => {
  it("always shows swim and bike zones, with effort/%FTP fallbacks when anchors are missing", () => {
    const z = computeTriZones({});
    // Swim + bike are always present so the UI can show every discipline.
    expect(z.swim).toBeDefined();
    expect(z.bike).toBeDefined();
    expect(z.run).toBeUndefined(); // run still needs a running benchmark for VDOT
    // No anchors → no exact numbers, effort/%FTP ranges + a nudge instead.
    expect(z.swim!.cssPer100).toBeUndefined();
    expect(z.swim!.note).toBeTruthy();
    expect(z.swim!.zones).toHaveLength(5);
    expect(z.bike!.ftpWatts).toBeUndefined();
    expect(z.bike!.note).toBeTruthy();
    // Bike bands fall back to % of FTP and carry a secondary HR (% LTHR) target.
    const bikeEndurance = z.bike!.zones.find((r) => r.label.includes("Endurance"))!;
    expect(bikeEndurance.range).toContain("% FTP");
    expect(bikeEndurance.hr).toContain("LTHR");
  });

  it("builds swim zones from CSS with threshold band around CSS", () => {
    const z = computeTriZones({ cssPace: "1:40" });
    expect(z.swim).toBeDefined();
    expect(z.swim!.cssPer100).toBe("1:40");
    expect(z.swim!.zones).toHaveLength(5);
    const threshold = z.swim!.zones.find((r) => r.label.includes("Threshold"))!;
    // CSS ± 2s → 1:38–1:42 band around 1:40.
    expect(threshold.range).toContain("1:38");
    expect(threshold.range).toContain("1:42");
  });

  it("builds bike power zones from FTP (Coggan bands in watts)", () => {
    const z = computeTriZones({ ftpWatts: 250 });
    expect(z.bike).toBeDefined();
    expect(z.bike!.ftpWatts).toBe(250);
    expect(z.bike!.zones).toHaveLength(5);
    const ftp = z.bike!.zones.find((r) => r.label.includes("Threshold"))!;
    // 0.91–1.05 × 250 = 228–263W.
    expect(ftp.range).toBe("228–263W");
  });

  it("builds run zones from VDOT benchmarks", () => {
    const z = computeTriZones({ benchmarks: { fiveKTime: "22:00" } });
    expect(z.run).toBeDefined();
    expect(z.run!.vdot).toBeGreaterThan(0);
    expect(z.run!.zones).toHaveLength(4);
    for (const r of z.run!.zones) expect(r.range).toMatch(/\d:\d\d\/mi/);
  });

  it("uses exact watts for bike when FTP is given, effort fallback for swim without CSS", () => {
    const z = computeTriZones({ ftpWatts: 220 });
    expect(z.bike).toBeDefined();
    expect(z.bike!.ftpWatts).toBe(220);
    // Swim still shown (effort-based) even without a CSS anchor; run needs a benchmark.
    expect(z.swim).toBeDefined();
    expect(z.swim!.cssPer100).toBeUndefined();
    expect(z.run).toBeUndefined();
  });

  it("adds a secondary heart-rate target (% LTHR) to bike power bands", () => {
    const z = computeTriZones({ ftpWatts: 250 });
    for (const r of z.bike!.zones) expect(r.hr).toBeTruthy();
  });
});
