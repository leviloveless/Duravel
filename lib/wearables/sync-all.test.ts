/**
 * "Sync workouts" from EVERY connected source — the program-view control
 * (2026-08-12).
 *
 * Before this, the only sync buttons were per-provider: the Activity page
 * pulled Strava ONLY, and Settings made you press one button per connection.
 * An athlete with both Strava and Oura connected had no single action that
 * brought their program up to date.
 *
 * The rules that matter, and that these tests pin:
 *
 *  1. Only CONNECTED providers are pulled — a sync function for a provider the
 *     athlete never connected must not be called at all (it would throw
 *     "X is not connected" and turn a fine sync into a visible failure).
 *  2. One provider failing does not take the others down. A dead Oura refresh
 *     token still has to let Strava import.
 *  3. Apple Health is PUSH-ONLY — the phone POSTs to /api/ingest/healthkit and
 *     there is nothing to pull. It is reported, never pulled, never counted
 *     (Levi's call, 2026-08-12: a connected source that vanishes silently reads
 *     as a bug).
 *
 * I/O is injected because this repo mocks nothing — `vi.mock` appears nowhere
 * in it, so a parameter is the only honest seam. These fakes COUNT CALLS, which
 * is exactly what rule 1 is about.
 */
import { describe, it, expect } from "vitest";
import {
  syncAllConnected,
  summarizeSyncAll,
  PULL_SYNCS,
  PUSH_ONLY_PROVIDERS,
  type SyncAllIo,
} from "./sync-all";
import type { WearableProvider } from "./types";

const USER = "user-1";

/** Build an injectable I/O whose sync functions record every call. */
function io(opts: {
  connected: WearableProvider[];
  imported?: Partial<Record<string, number>>;
  fail?: Partial<Record<string, string>>;
}): SyncAllIo & { calls: string[] } {
  const calls: string[] = [];
  const make = (provider: string) => async (userId: string) => {
    calls.push(`${provider}:${userId}`);
    const err = opts.fail?.[provider];
    if (err) throw new Error(err);
    return { imported: opts.imported?.[provider] ?? 0 };
  };
  return {
    calls,
    statuses: async () =>
      (["strava", "garmin", "oura", "whoop", "apple_health"] as WearableProvider[]).map((p) => ({
        provider: p,
        connected: opts.connected.includes(p),
      })),
    pullSyncs: { strava: make("strava"), oura: make("oura") },
    pushOnly: ["apple_health"],
  };
}

describe("syncAllConnected", () => {
  it("pulls every connected pull source and totals the imports", async () => {
    const fake = io({ connected: ["strava", "oura"], imported: { strava: 3, oura: 1 } });
    const res = await syncAllConnected(USER, fake);

    expect(fake.calls.sort()).toEqual([`oura:${USER}`, `strava:${USER}`]);
    expect(res.imported).toBe(4);
    expect(res.noConnections).toBe(false);
    expect(res.results.map((r) => [r.provider, r.ok, r.imported])).toEqual([
      ["strava", true, 3],
      ["oura", true, 1],
    ]);
  });

  it("never calls the sync of a provider that is not connected", async () => {
    const fake = io({ connected: ["strava"], imported: { strava: 2 } });
    const res = await syncAllConnected(USER, fake);

    expect(fake.calls).toEqual([`strava:${USER}`]);
    expect(res.results.map((r) => r.provider)).toEqual(["strava"]);
    expect(res.imported).toBe(2);
  });

  it("one provider failing does not stop the others (rule 2)", async () => {
    const fake = io({
      connected: ["strava", "oura"],
      imported: { strava: 5 },
      fail: { oura: "Oura token expired" },
    });
    const res = await syncAllConnected(USER, fake);

    // Strava still ran and still imported.
    expect(fake.calls.sort()).toEqual([`oura:${USER}`, `strava:${USER}`]);
    expect(res.imported).toBe(5);

    const strava = res.results.find((r) => r.provider === "strava")!;
    const oura = res.results.find((r) => r.provider === "oura")!;
    expect(strava.ok).toBe(true);
    expect(oura.ok).toBe(false);
    expect(oura.error).toBe("Oura token expired");
    expect(oura.imported).toBe(0);
  });

  it("reports Apple Health as push-only without pulling it (rule 3)", async () => {
    const fake = io({ connected: ["strava", "apple_health"], imported: { strava: 1 } });
    const res = await syncAllConnected(USER, fake);

    // Only strava was actually invoked — there is no apple_health pull.
    expect(fake.calls).toEqual([`strava:${USER}`]);

    const apple = res.results.find((r) => r.provider === "apple_health")!;
    expect(apple.mode).toBe("push");
    expect(apple.ok).toBe(true);
    expect(apple.imported).toBe(0);
    // Push sources never inflate the import total.
    expect(res.imported).toBe(1);
  });

  it("flags the no-connections case instead of reporting a successful empty sync", async () => {
    const fake = io({ connected: [] });
    const res = await syncAllConnected(USER, fake);

    expect(fake.calls).toEqual([]);
    expect(res.results).toEqual([]);
    expect(res.noConnections).toBe(true);
    expect(summarizeSyncAll(res)).toMatch(/No sources connected/);
  });

  it("does not throw when every connected provider fails", async () => {
    const fake = io({
      connected: ["strava", "oura"],
      fail: { strava: "Strava is not connected.", oura: "429 rate limited" },
    });
    const res = await syncAllConnected(USER, fake);

    expect(res.imported).toBe(0);
    expect(res.results.every((r) => !r.ok)).toBe(true);
    expect(summarizeSyncAll(res)).toContain("429 rate limited");
  });
});

describe("summarizeSyncAll", () => {
  it("names each source and its count", async () => {
    const res = await syncAllConnected(
      USER,
      io({ connected: ["strava", "oura"], imported: { strava: 3, oura: 1 } }),
    );
    expect(summarizeSyncAll(res)).toBe("Imported 4 workouts (Strava 3, Oura 1).");
  });

  it("says '1 workout', not '1 workouts'", async () => {
    const res = await syncAllConnected(
      USER,
      io({ connected: ["strava"], imported: { strava: 1 } }),
    );
    expect(summarizeSyncAll(res)).toBe("Imported 1 workout (Strava 1).");
  });

  it("mentions the push-only source alongside the pulled ones", async () => {
    const res = await syncAllConnected(
      USER,
      io({ connected: ["strava", "apple_health"], imported: { strava: 2 } }),
    );
    expect(summarizeSyncAll(res)).toBe(
      "Imported 2 workouts (Strava 2) · Apple Health syncs from your phone.",
    );
  });

  it("explains a push-only-only setup rather than claiming success", async () => {
    const res = await syncAllConnected(USER, io({ connected: ["apple_health"] }));
    expect(summarizeSyncAll(res)).toBe("Nothing to pull · Apple Health syncs from your phone.");
  });

  it("surfaces the failing provider by name", async () => {
    const res = await syncAllConnected(
      USER,
      io({
        connected: ["strava", "oura"],
        imported: { strava: 2 },
        fail: { oura: "Oura token expired" },
      }),
    );
    expect(summarizeSyncAll(res)).toBe(
      "Imported 2 workouts (Strava 2) · Oura failed: Oura token expired.",
    );
  });
});

describe("provider registry", () => {
  it("wires the real pull syncs, and Apple Health is not one of them", () => {
    expect(Object.keys(PULL_SYNCS).sort()).toEqual(["oura", "strava"]);
    expect(PUSH_ONLY_PROVIDERS).toEqual(["apple_health"]);
    for (const fn of Object.values(PULL_SYNCS)) expect(typeof fn).toBe("function");
  });
});
