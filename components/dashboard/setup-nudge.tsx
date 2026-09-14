import Link from "next/link";

/**
 * Shown until the athlete has been through account setup (2026-09-13).
 *
 * `profiles.setup_completed_at` was written by the wizard from the day it
 * shipped and read by nothing, which is the same failure shape as an env var
 * declared in the schema but never pulled out of `process.env`: it looks wired
 * from every angle except the one that decides. This is the reader.
 *
 * It names what is actually missing rather than nagging in general — an athlete
 * who has benchmarks but no resting HR should be told that, not told to "finish
 * setting up". A generic nudge gets dismissed; a specific one gets acted on.
 */
export default function SetupNudge({
  hasBenchmarks,
  hasRestingHr,
  hasBodyWeight,
}: {
  hasBenchmarks: boolean;
  hasRestingHr: boolean;
  hasBodyWeight: boolean;
}) {
  const missing = [
    !hasBenchmarks && "a benchmark to compute your paces from",
    !hasBodyWeight && "your body weight, which sets sled and carry loads",
    !hasRestingHr && "your resting heart rate, which makes your zones accurate",
  ].filter((x): x is string => typeof x === "string");

  if (missing.length === 0) return null;

  return (
    <section className="border-line flex flex-col gap-2 rounded-xl border bg-amber-50 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-[10px] tracking-[0.14em] text-amber-800 uppercase">
          Finish setting up
        </span>
        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-900">
          {missing.length} {missing.length === 1 ? "thing" : "things"} left
        </span>
      </div>

      <p className="text-sm text-zinc-700">
        Your program is being built without{" "}
        {missing.length === 1 ? (
          missing[0]
        ) : (
          <>
            {missing.slice(0, -1).join(", ")} and {missing[missing.length - 1]}
          </>
        )}
        . Two minutes now makes every number after it more accurate.
      </p>

      <Link
        href="/setup"
        className="bg-accent hover:bg-accent-hi self-start rounded-md px-4 py-2 text-sm font-semibold text-white"
      >
        Finish setup
      </Link>
    </section>
  );
}
