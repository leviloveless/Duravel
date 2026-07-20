import { describe, it, expect } from "vitest";
import { buildBrandedDescription, brandTagLine, stripBrandTag, BRAND_MARKER } from "./branding";
import { hasWriteScope, STRAVA_SCOPE } from "./strava";

describe("brandTagLine", () => {
  it("assembles — Duravel · session · week · program · domain", () => {
    const line = brandTagLine({ sessionLabel: "Threshold run", weekNumber: 6, programName: "12-Week HYROX Build" });
    expect(line).toBe("— Duravel · Threshold run · Week 6 · 12-Week HYROX Build · duravel.app");
  });
  it("degrades gracefully with no context", () => {
    expect(brandTagLine({})).toBe("— Duravel · duravel.app");
  });
});

describe("buildBrandedDescription", () => {
  it("appends the tag under the athlete's own text", () => {
    const out = buildBrandedDescription("Felt strong today!", { sessionLabel: "Easy run", weekNumber: 2 });
    expect(out.startsWith("Felt strong today!")).toBe(true);
    expect(out).toContain(BRAND_MARKER);
  });
  it("is idempotent — re-branding never stacks tags", () => {
    const first = buildBrandedDescription("My run", { sessionLabel: "Easy run", weekNumber: 2 });
    const second = buildBrandedDescription(first, { sessionLabel: "Easy run", weekNumber: 2 });
    expect(second).toBe(first);
    expect(second.match(/Duravel/g)).toHaveLength(1);
  });
  it("updates an existing tag to new context without duplicating", () => {
    const wk2 = buildBrandedDescription("Log", { weekNumber: 2, sessionLabel: "Easy run" });
    const wk3 = buildBrandedDescription(wk2, { weekNumber: 3, sessionLabel: "Long run" });
    expect(wk3.match(/Duravel/g)).toHaveLength(1);
    expect(wk3).toContain("Week 3");
    expect(wk3).not.toContain("Week 2");
    expect(wk3.startsWith("Log")).toBe(true);
  });
  it("handles an empty base", () => {
    const out = buildBrandedDescription("", { sessionLabel: "Session" });
    expect(out).toBe("— Duravel · Session · duravel.app");
  });
  it("stripBrandTag removes trailing tag + whitespace", () => {
    expect(stripBrandTag("Hi\n\n— Duravel · Session · duravel.app")).toBe("Hi");
  });
});

describe("hasWriteScope", () => {
  it("detects activity:write in a granted scope string", () => {
    expect(hasWriteScope("read,activity:read_all,activity:write")).toBe(true);
    expect(hasWriteScope("read,activity:read_all")).toBe(false);
    expect(hasWriteScope(null)).toBe(false);
    expect(hasWriteScope(STRAVA_SCOPE)).toBe(true);
  });
});
