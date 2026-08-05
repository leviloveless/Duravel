/**
 * REGRESSION — the branded write must use the PROVIDER's activity id.
 *
 * Seen live 2026-08-04: "To Strava" returned 400. `SyncActivitySummary.activityId`
 * is DURAVEL's row id (a UUID) — correct for linking inside Duravel, wrong for
 * Strava's API, which keys off `external_id`. A 36-char UUID also failed the
 * route's own 32-char bound, so it never even reached Strava.
 */
import { describe, it, expect } from "vitest";
import { z } from "zod";

// Mirrors the bound in app/api/wearables/strava/brand/route.ts.
const ActivityId = z.string().min(1).max(32);

describe("Strava activity id", () => {
  it("a Duravel row UUID does not satisfy the endpoint's bound", () => {
    const duravelRowId = "d81ef85c-aad1-41fb-a85f-131d242cdb40";
    expect(duravelRowId).toHaveLength(36);
    expect(ActivityId.safeParse(duravelRowId).success).toBe(false);
  });

  it("a real Strava activity id does", () => {
    for (const id of ["14958372910", "1", "9".repeat(20)]) {
      expect(ActivityId.safeParse(id).success, id).toBe(true);
    }
  });
});
