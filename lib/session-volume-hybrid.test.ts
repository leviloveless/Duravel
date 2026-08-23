/**
 * The weekly training-time breakdown calls hybrid work HYBRID, not "metcon"
 * (Levi, 2026-08-22).
 *
 * "Metcon" is CrossFit's word, and it was the only place in the product that
 * used it: the sessions themselves are labelled `Hybrid (HYROX)` on every week
 * card, the session kind in the schema is `hybrid`, and the onboarding asks for
 * "Hybrid fitness experience". One column header disagreed with all of it.
 *
 * Renaming the FIELD and not just the header is the point — a `metcon` key left
 * in `WeekTimeBreakdown` is how the word creeps back into the next component
 * that reads it.
 *
 * Imports only what `main` already exports, so it fails there on BEHAVIOUR:
 * vitest strips types, `w.hybrid` is simply `undefined` on the old shape, and
 * the first assertion goes red.
 */
import { describe, it, expect } from "vitest";
import type { Session } from "@/lib/schemas";
import { weekTimeByCategory } from "./session-volume";

const HYBRID = { kind: "hybrid", workMin: 40, elements: [] } as unknown as Session;
const LIFT = { kind: "lift", liftType: "full", exercises: [] } as unknown as Session;

const week = { days: [{ sessions: [HYBRID, LIFT] }] };

describe("hybrid, not metcon", () => {
  it("reports hybrid session time under `hybrid`", () => {
    const t = weekTimeByCategory(week);
    expect(t.hybrid).toBeGreaterThan(0);
    expect(t.hybrid).toBe(t.total - t.strength);
  });

  it("has no `metcon` key left to read", () => {
    expect("metcon" in weekTimeByCategory(week)).toBe(false);
  });

  it("still splits lifting out of it", () => {
    const t = weekTimeByCategory(week);
    expect(t.strength).toBeGreaterThan(0);
    expect(t.total).toBe(t.hybrid + t.strength + t.running + t.nonRunningCardio);
  });
});
