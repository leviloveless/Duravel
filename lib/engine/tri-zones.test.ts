import { describe, it, expect } from "vitest";
import { computeTriZones } from "./tri-zones";

describe("Triathlon per-discipline zones", () => {
  it("returns nothing when no anchors are supplied", () => {
    const z = computeTriZones({});
    expect(z.swim).toBeUndefined();
    expect(z.bike).toBeUndefined();
    expect(z.run).toBeUndefined();
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

  it("returns only the disciplines with anchors", () => {
    const z = computeTriZones({ ftpWatts: 220 });
    expect(z.bike).toBeDefined();
    expect(z.swim).toBeUndefined();
    expect(z.run).toBeUndefined();
  });
});
