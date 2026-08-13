/**
 * REGRESSION — a displayed timestamp must not depend on the runtime's zone
 * (Levi, 2026-08-13).
 *
 * `duravel.app/program/<uuid>` threw **`Minified React error #418`** on every
 * single page load — 5 for 5 during live verification, while `/dashboard` on the
 * same session was clean. `args[]=text` means a server/client TEXT mismatch.
 *
 * The cause was `new Date(iso).toLocaleString(undefined, { … hour, minute })`.
 * Both arguments are ambient: `undefined` takes the runtime's locale, and the
 * missing `timeZone` takes the runtime's zone. The server renders in UTC and the
 * browser in the athlete's zone, so `Last sync: Aug 13, 4:24 PM` was hydrated
 * against `Last sync: Aug 13, 10:24 AM` and React discarded the subtree.
 *
 * ⚠️ This was written off as a "transient hydration artifact" on 2026-08-06,
 * after it made the link-suggestions banner appear to vanish and sent that
 * session hunting a regression that did not exist. It was never transient.
 *
 * These tests simulate the two runtimes by formatting the SAME instant for two
 * different zones — which is exactly the server/client split — and assert the
 * output depends only on the arguments, never on the ambient environment.
 */
import { describe, it, expect } from "vitest";
import { formatInstant, resolveTimeZone, UTC } from "./timezone";

const INSTANT = "2026-08-13T16:24:00.000Z"; // 11:24 CDT / 16:24 UTC

describe("formatInstant is stable across runtimes", () => {
  it("renders the SAME string for the same zone, however it is called", () => {
    // The server and the browser both pass the athlete's stored zone, so both
    // produce this. That equality IS the fix.
    const server = formatInstant(INSTANT, "America/Chicago");
    const client = formatInstant(INSTANT, "America/Chicago");
    expect(server).toBe(client);
    expect(server).toContain("11:24");
  });

  it("actually converts — a UTC render and a Chicago render differ", () => {
    // Proves the zone argument is doing real work. If these were equal the test
    // above would pass for the wrong reason.
    expect(formatInstant(INSTANT, UTC)).not.toBe(formatInstant(INSTANT, "America/Chicago"));
    expect(formatInstant(INSTANT, UTC)).toContain("4:24");
  });

  it("pins the LOCALE too, not just the zone", () => {
    // `undefined` locale is the other ambient knob: a server with a different
    // ICU default would order or punctuate the date differently. en-US is fixed.
    expect(formatInstant(INSTANT, UTC)).toBe("Aug 13, 4:24 PM");
  });

  it("falls back to UTC on a missing, empty or bogus zone", () => {
    const utc = formatInstant(INSTANT, UTC);
    for (const tz of [null, undefined, "", "Not/AZone", "Europe/Nowhere"]) {
      expect(formatInstant(INSTANT, tz), String(tz)).toBe(utc);
    }
    expect(resolveTimeZone("Not/AZone")).toBe(UTC);
  });

  it("never throws on a null or unparseable instant", () => {
    // `last_sync_at` is null until the athlete's first sync, and the component
    // renders before any request completes.
    expect(formatInstant(null, "America/Chicago")).toBe("never");
    expect(formatInstant(undefined, "America/Chicago")).toBe("never");
    expect(formatInstant("not-a-date", "America/Chicago")).toBe("never");
    expect(formatInstant("", "America/Chicago")).toBe("never");
  });

  it("takes a caller-supplied fallback, so an empty slot can stay empty", () => {
    expect(formatInstant(null, UTC, undefined, "")).toBe("");
  });

  it("honours custom option sets and still pins the zone", () => {
    const opts: Intl.DateTimeFormatOptions = {
      month: "short",
      day: "numeric",
      year: "numeric",
    };
    // A date-only render of a late-evening UTC instant lands on DIFFERENT
    // calendar days in the two zones — the exact off-by-one that makes a
    // date-only `toLocaleDateString()` a hydration bug too.
    const lateNight = "2026-08-14T02:30:00.000Z";
    expect(formatInstant(lateNight, UTC, opts)).toBe("Aug 14, 2026");
    expect(formatInstant(lateNight, "America/Chicago", opts)).toBe("Aug 13, 2026");
  });
});
