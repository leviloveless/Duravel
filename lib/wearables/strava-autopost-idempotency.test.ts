/**
 * REGRESSION — one logged session must own ONE Strava activity, forever.
 *
 * Observed live 2026-08-06: THREE Strava activities for a single week-1 Thursday
 * threshold run (19626903555, 19628136284, 19628388163). `POST /api/logs`
 * upserts the log row on (program, week, day, session_index) — so a correction
 * edits one row — and then called `createManualActivity` unconditionally. Each
 * re-log left another copy on Strava, and the athlete cannot bulk-remove them:
 * the v3 API has no DELETE for activities.
 *
 * The rule now lives in `syncAutoPost`, with its I/O injected — the repo mocks
 * nothing (`vi.mock` appears nowhere in it), so the only honest seam is a
 * parameter. These fakes count calls, which is precisely what went wrong.
 */
import { describe, it, expect } from "vitest";
import type { Session } from "@/lib/schemas";
import {
  syncAutoPost,
  buildAutoPostActivity,
  buildAutoPostText,
  withAutoPostFooter,
  AUTOPOST_FOOTER,
  type AutoPostContext,
} from "./strava-autopost";
import { stripWorkoutBlock } from "./branding";

type RunSession = Extract<Session, { kind: "run" }>;

/** Week 1 / Thursday — the very session that produced the three duplicates. */
const THRESHOLD_RUN: RunSession = {
  kind: "run",
  runType: "threshold",
  distanceMiles: 1,
  durationMin: 8,
  paceMinMile: "8:00",
  goalZone: 4,
  overheadMiles: 1.5,
  description: [
    "Warm up: 12 min easy (~0.9 mi) @ 13:20/mi",
    "Work: 1 x 1 mile at 8:00/mi (4:58/km)",
    "Cooldown: 8 min easy (~0.6 mi) @ 13:20/mi",
  ].join("\n"),
} as RunSession;

function ctx(over: Partial<AutoPostContext> = {}): AutoPostContext {
  return {
    session: THRESHOLD_RUN,
    status: "completed",
    weekNumber: 1,
    dayKey: "thu",
    programName: "Fall prep",
    ...over,
  };
}

/** A fake Strava that records what was asked of it. */
function fakeStrava(opts: { missing?: string[] } = {}) {
  const calls = { created: 0, refreshed: [] as string[] };
  let next = 19626903555;
  return {
    calls,
    io: {
      create: async () => {
        calls.created += 1;
        return String(next++);
      },
      refresh: async (id: string) => {
        if (opts.missing?.includes(id)) throw new Error("strava_activity_missing");
        calls.refreshed.push(id);
      },
    },
  };
}

describe("auto-post idempotency", () => {
  it("posts once when the session has never been posted", async () => {
    const s = fakeStrava();
    const r = await syncAutoPost(null, s.io);
    expect(r.created).toBe(true);
    expect(r.activityId).toBe("19626903555");
    expect(s.calls.created).toBe(1);
    expect(s.calls.refreshed).toEqual([]);
  });

  it("REFRESHES rather than creating a second activity on a re-log", async () => {
    const s = fakeStrava();
    const r = await syncAutoPost("19626903555", s.io);
    expect(r.created).toBe(false);
    expect(r.activityId).toBe("19626903555");
    // The whole bug in one assertion.
    expect(s.calls.created).toBe(0);
    expect(s.calls.refreshed).toEqual(["19626903555"]);
  });

  it("three corrections in a row leave ONE activity, not three", async () => {
    const s = fakeStrava();
    let id: string | null = null;
    for (let i = 0; i < 3; i++) {
      id = (await syncAutoPost(id, s.io)).activityId;
    }
    expect(s.calls.created).toBe(1);
    expect(id).toBe("19626903555");
    // Live on 2026-08-06 this produced 19626903555, 19628136284 AND 19628388163.
    expect(s.calls.refreshed).toEqual(["19626903555", "19626903555"]);
  });

  it("posts afresh when the athlete deleted the activity on Strava", async () => {
    // A 404 from the PUT is the only signal we get that the id went stale.
    const s = fakeStrava({ missing: ["19628136284"] });
    const r = await syncAutoPost("19628136284", s.io);
    expect(r.created).toBe(true);
    expect(r.activityId).toBe("19626903555");
    expect(s.calls.created).toBe(1);
    // Otherwise that session could never reach Strava again.
    expect(s.calls.refreshed).toEqual([]);
  });

  it("a refresh failure that is NOT a deletion never silently duplicates", async () => {
    const calls = { created: 0 };
    await expect(
      syncAutoPost("19626903555", {
        create: async () => {
          calls.created += 1;
          return "1";
        },
        refresh: async () => {
          throw new Error("strava_write_forbidden");
        },
      }),
    ).rejects.toThrow("strava_write_forbidden");
    // A revoked write scope must not be papered over with a duplicate post.
    expect(calls.created).toBe(0);
  });

  it("the refresh payload is the SAME text the create path posts", () => {
    const c = ctx();
    const created = buildAutoPostActivity(c, "2026-08-06T13:00:00.000Z");
    const text = buildAutoPostText(c);
    // If these ever diverge, a re-log silently retitles the athlete's activity.
    expect(text.name).toBe(created.name);
    expect(text.description).toBe(created.description);
    expect(text.name).toBe("Week 1 - Thursday - Threshold Run");
  });
});

/**
 * The footer only goes on activities DURAVEL posted (Levi, 2026-08-06). It is a
 * deliberate exception to the 2026-08-05 "clean description" rule, which still
 * governs the Copy button and the manual "To Strava" write.
 */
describe("auto-post footer", () => {
  it("signs the auto-posted description", () => {
    const d = buildAutoPostText(ctx()).description;
    expect(d.endsWith(AUTOPOST_FOOTER)).toBe(true);
    expect(d).toContain("Work: 1 x 1 mile at 8:00/mi (4:58/km)");
    // Separated by a blank line, not jammed onto the last prescription line.
    expect(d.endsWith(`\n\n${AUTOPOST_FOOTER}`)).toBe(true);
  });

  it("never stacks on a re-log", () => {
    // The refresh path re-writes the description of an activity that already
    // carries the footer — twice, three times, however often it is corrected.
    const once = withAutoPostFooter("Week 1 - Thursday - Threshold Run\nWork: 1 mile");
    expect(withAutoPostFooter(withAutoPostFooter(once))).toBe(once);
    expect(once.match(/Duravel/g)).toHaveLength(1);
  });

  it("is removed with the workout block, never stranded above a rewrite", () => {
    // `stripWorkoutBlock` cuts from the `Week N - …` title to the END, so an
    // athlete's own text above it survives and the footer does not pile up.
    const athlete = "Felt great today.";
    const full = `${athlete}\n\n${buildAutoPostText(ctx()).description}`;
    expect(stripWorkoutBlock(full)).toBe(athlete);
  });

  it("degenerate input still yields a valid footer", () => {
    expect(withAutoPostFooter("")).toBe(AUTOPOST_FOOTER);
    expect(withAutoPostFooter("   \n\n ")).toBe(AUTOPOST_FOOTER);
  });
});
