/**
 * REGRESSION — a feature flag must not fail closed on a plausible spelling.
 *
 * `STRAVA_WRITE_ENABLED` was set to `TRUE` in the Vercel dashboard on 2026-08-04.
 * Every consumer compared it with `=== "true"` — exact and case-sensitive — so
 * the flag read as OFF, the Strava write path stayed dark, and nothing logged an
 * error anywhere. `BILLING_ENABLED` and `EMAIL_ENABLED` sat on the same pattern,
 * which would have been considerably worse.
 */
import { describe, it, expect } from "vitest";
import { envFlag } from "./env";

describe("envFlag", () => {
  it("accepts the spellings a human actually types", () => {
    for (const v of ["true", "TRUE", "True", " true ", "1", "yes", "YES", "on", "ON"]) {
      expect(envFlag(v), v).toBe(true);
    }
  });

  it("is false for anything else, including unset", () => {
    for (const v of ["false", "FALSE", "0", "no", "off", "", "  ", "enabled", "tru"]) {
      expect(envFlag(v), JSON.stringify(v)).toBe(false);
    }
    expect(envFlag(undefined)).toBe(false);
    expect(envFlag(null)).toBe(false);
  });
});
