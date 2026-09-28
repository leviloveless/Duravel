import { describe, expect, it } from "vitest";
import {
  csvField,
  normalizeSvgDataUrl,
  parsePromo,
  safeAnnouncementLink,
  summarizeActivity,
  toCsv,
  type PromoInput,
} from "./admin-account-rules";

const NOW = Date.parse("2026-09-27T12:00:00.000Z");
const DAY = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString();

describe("csvField — spreadsheet safety", () => {
  it("defuses anything that would run as a formula", () => {
    expect(csvField('=HYPERLINK("http://x","y")')).toBe(`"'=HYPERLINK(""http://x"",""y"")"`);
    expect(csvField("+1234")).toBe("'+1234");
    expect(csvField("-cmd")).toBe("'-cmd");
    expect(csvField("@SUM(A1)")).toBe("'@SUM(A1)");
  });
  it("leaves real numbers alone, negative included", () => {
    expect(csvField(-5)).toBe("-5");
    expect(csvField(12)).toBe("12");
  });
  it("quotes commas, quotes and newlines", () => {
    expect(csvField("Rivera, Sam")).toBe('"Rivera, Sam"');
    expect(csvField('say "hi"')).toBe('"say ""hi"""');
    expect(csvField("a\nb")).toBe('"a\nb"');
  });
  it("renders empties as empty", () => {
    expect(csvField(null)).toBe("");
    expect(csvField(undefined)).toBe("");
    expect(csvField(false)).toBe("false");
  });
  it("joins rows with CRLF and ends with one", () => {
    expect(
      toCsv([
        ["a", 1],
        ["b", 2],
      ]),
    ).toBe("a,1\r\nb,2\r\n");
  });
});

describe("summarizeActivity", () => {
  it("counts by status, the last 14 days, and finds the latest of each", () => {
    const s = summarizeActivity(
      [
        { status: "completed", logged_at: iso(NOW - 2 * DAY) },
        { status: "completed", logged_at: iso(NOW - 20 * DAY) },
        { status: "partial", logged_at: iso(NOW - 5 * DAY) },
        { status: "skipped", logged_at: iso(NOW - 1 * DAY) },
      ],
      [{ created_at: iso(NOW - 3 * DAY) }, { created_at: null }],
      NOW,
    );
    expect(s).toEqual({
      logged: 4,
      completed: 2,
      partial: 1,
      skipped: 1,
      last14: 3,
      lastLoggedAt: iso(NOW - 1 * DAY),
      extras: 2,
      lastExtraAt: iso(NOW - 3 * DAY),
    });
  });
  it("is all zeros and nulls for someone who never trained", () => {
    expect(summarizeActivity([], [], NOW)).toMatchObject({
      logged: 0,
      last14: 0,
      lastLoggedAt: null,
      lastExtraAt: null,
    });
  });
});

describe("safeAnnouncementLink", () => {
  it("accepts a site path and an https URL", () => {
    expect(safeAnnouncementLink("/library")).toBe("/library");
    expect(safeAnnouncementLink(" https://duravel.app/blog ")).toBe("https://duravel.app/blog");
  });
  it("refuses script, data, plain-http and protocol-relative links", () => {
    for (const bad of [
      "javascript:alert(1)",
      "data:text/html,x",
      "http://duravel.app",
      "//evil.com",
      "/has space",
    ]) {
      expect(safeAnnouncementLink(bad), bad).toBeNull();
    }
  });
  it("treats blank as no link", () => {
    expect(safeAnnouncementLink("   ")).toBeNull();
  });
});

describe("parsePromo", () => {
  const base: PromoInput = {
    code: "gym20",
    percentOff: "20",
    amountOff: "",
    duration: "once",
    months: "",
    maxRedemptions: "",
    expiresInDays: "",
    firstTimeOnly: false,
  };
  const plan = (o: Partial<PromoInput>) => {
    const r = parsePromo({ ...base, ...o }, NOW);
    if (!r.ok) throw new Error(r.error);
    return r.plan;
  };
  const err = (o: Partial<PromoInput>) => {
    const r = parsePromo({ ...base, ...o }, NOW);
    return r.ok ? null : r.error;
  };

  it("uppercases the code and builds a percent coupon", () => {
    expect(plan({})).toMatchObject({
      code: "GYM20",
      discount: { percent_off: 20 },
      duration: "once",
    });
  });
  it("turns dollars into cents, and accepts a leading $", () => {
    expect(plan({ percentOff: "", amountOff: "$10.50" }).discount).toEqual({
      amount_off: 1050,
      currency: "usd",
    });
  });
  it("requires exactly one of percent or amount", () => {
    expect(err({ amountOff: "5" })).toMatch(/one, not both/);
    expect(err({ percentOff: "" })).toMatch(/one, not both/);
  });
  it("refuses out-of-range discounts", () => {
    expect(err({ percentOff: "0" })).toBeTruthy();
    expect(err({ percentOff: "101" })).toBeTruthy();
    expect(err({ percentOff: "", amountOff: "-3" })).toBeTruthy();
  });
  it("needs a month count only for a repeating discount", () => {
    expect(err({ duration: "repeating" })).toMatch(/Months/);
    expect(plan({ duration: "repeating", months: "3" }).durationInMonths).toBe(3);
    expect(plan({ duration: "forever" }).durationInMonths).toBeNull();
  });
  it("refuses a malformed code", () => {
    for (const code of ["ab", "has space", "semi;colon", "-LEADING"])
      expect(err({ code }), code).toBeTruthy();
  });
  it("computes expiry in unix seconds", () => {
    expect(plan({ expiresInDays: "30" }).expiresAt).toBe(Math.floor(NOW / 1000) + 30 * 86400);
  });
  it("refuses a fractional or zero use limit", () => {
    expect(err({ maxRedemptions: "0" })).toBeTruthy();
    expect(err({ maxRedemptions: "2.5" })).toBeTruthy();
    expect(plan({ maxRedemptions: "50" }).maxRedemptions).toBe(50);
  });
  it("refuses an unknown duration", () => {
    expect(err({ duration: "weekly" })).toBeTruthy();
  });
});

describe("normalizeSvgDataUrl", () => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg"><rect fill="#000"/></svg>';
  it("encodes a raw SVG so a # can't truncate it", () => {
    const out = normalizeSvgDataUrl(`data:image/svg+xml;utf-8,${svg}`);
    expect(out.startsWith("data:image/svg+xml;charset=utf-8,")).toBe(true);
    expect(out).not.toContain("#");
    expect(decodeURIComponent(out.slice(out.indexOf(",") + 1))).toBe(svg);
  });
  it("is idempotent", () => {
    const once = normalizeSvgDataUrl(`data:image/svg+xml;utf-8,${svg}`);
    expect(normalizeSvgDataUrl(once)).toBe(once);
  });
  it("leaves anything that isn't an SVG data URL alone", () => {
    expect(normalizeSvgDataUrl("data:image/png;base64,AAAA")).toBe("data:image/png;base64,AAAA");
  });
});
