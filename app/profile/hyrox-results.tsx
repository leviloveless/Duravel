"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import HyroxLookup from "@/components/onboarding/hyrox-lookup";
import { saveHyroxResults, type HyroxSaveState } from "./actions";

const initialState: HyroxSaveState = { error: null, saved: false };

/** The station / run / roxzone split inputs, in race order. */
const SPLIT_INPUTS: { name: string; label: string }[] = [
  { name: "hyroxSkiErg", label: "SkiErg (1000m)" },
  { name: "hyroxSledPush", label: "Sled Push (50m)" },
  { name: "hyroxSledPull", label: "Sled Pull (50m)" },
  { name: "hyroxBurpeeBroadJump", label: "Burpee Broad Jump (80m)" },
  { name: "hyroxRow", label: "Row (1000m)" },
  { name: "hyroxFarmersCarry", label: "Farmers Carry (200m)" },
  { name: "hyroxSandbagLunge", label: "Sandbag Lunges (100m)" },
  { name: "hyroxWallBalls", label: "Wall Balls" },
  { name: "hyroxRunTotal", label: "Run total (8x1km)" },
  { name: "hyroxRoxzone", label: "Roxzone (transitions)" },
];

/** Result-lookup split key -> the profile field it fills. */
const SPLIT_FIELD: Record<string, string> = {
  skiErg_time: "hyroxSkiErg",
  sledPush_time: "hyroxSledPush",
  sledPull_time: "hyroxSledPull",
  burpeeBroadJump_time: "hyroxBurpeeBroadJump",
  row_time: "hyroxRow",
  farmersCarry_time: "hyroxFarmersCarry",
  sandbagLunges_time: "hyroxSandbagLunge",
  wallBalls_time: "hyroxWallBalls",
  run_time: "hyroxRunTotal",
  roxzone_time: "hyroxRoxzone",
};

export type SavedHyrox = Record<string, string | undefined>;

const RACE_TYPE_LABEL: Record<string, string> = {
  singles: "Singles",
  doubles: "Doubles",
  relay: "Relay",
  unknown: "Unknown",
};

/**
 * Profile HYROX-results section. Shows the athlete's saved race splits and lets
 * them look up an official result (auto-fill) or type/edit the splits, then save
 * to their profile. Saved splits then pre-fill every future program's onboarding.
 */
export default function HyroxResults({ saved }: { saved: SavedHyrox }) {
  const [state, formAction, pending] = useActionState(saveHyroxResults, initialState);
  const [open, setOpen] = useState(false);
  const raceTypeRef = useRef<HTMLSelectElement | null>(null);
  const splitRefs = useRef<Record<string, HTMLInputElement | null>>({});

  // Collapse back to the summary once a save succeeds (the server re-renders with
  // the freshly saved values).
  useEffect(() => {
    if (state.saved) setOpen(false);
  }, [state.saved]);

  const savedSplits = SPLIT_INPUTS.filter((s) => saved[s.name]);
  const hasSaved = savedSplits.length > 0 || !!saved.hyroxRaceType;

  return (
    <section className="flex flex-col gap-4 rounded-xl border border-zinc-200 p-5">
      <div className="flex flex-col gap-1">
        <h2 className="text-sm font-semibold">HYROX results</h2>
        <p className="text-sm text-zinc-500">
          Save your race splits here so they auto-fill every time you build a program - no more
          looking them up.
        </p>
      </div>

      {!open && (
        <>
          {hasSaved ? (
            <div className="flex flex-col gap-1.5 text-sm">
              {saved.hyroxRaceType && (
                <span className="text-xs uppercase tracking-wide text-zinc-400">
                  {RACE_TYPE_LABEL[saved.hyroxRaceType] ?? saved.hyroxRaceType}
                </span>
              )}
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-zinc-700">
                {savedSplits.map((s) => (
                  <span key={s.name} className="tabular-nums">
                    <span className="text-zinc-500">{s.label.split(" (")[0]}:</span> {saved[s.name]}
                  </span>
                ))}
              </div>
            </div>
          ) : (
            <p className="text-sm text-zinc-400">No HYROX result saved yet.</p>
          )}
          {state.saved && <p className="text-sm text-emerald-700">Saved.</p>}
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="self-start rounded-full border border-zinc-300 px-5 py-2 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-50"
          >
            {hasSaved ? "Edit results" : "Add my HYROX results"}
          </button>
        </>
      )}

      {open && (
        <form action={formAction} className="flex flex-col gap-4">
          <details className="rounded-lg border border-zinc-200 p-3">
            <summary className="cursor-pointer text-sm font-medium text-zinc-700">
              Look up my HYROX result
            </summary>
            <div className="mt-3">
              <HyroxLookup
                onPick={(r) => {
                  if (raceTypeRef.current) {
                    const ev = (r.event ?? "").toLowerCase();
                    raceTypeRef.current.value = ev.includes("doubles")
                      ? "doubles"
                      : ev.includes("relay")
                        ? "relay"
                        : "singles";
                  }
                  for (const s of r.splits) {
                    const field = SPLIT_FIELD[s.key];
                    const input = field ? splitRefs.current[field] : null;
                    if (input && s.time) input.value = s.time;
                  }
                }}
              />
              <p className="mt-2 text-xs text-zinc-500">
                Picking a result fills the fields below (you can still edit them).
              </p>
            </div>
          </details>

          <label className="flex flex-col gap-1 text-sm">
            Race type
            <select
              name="hyroxRaceType"
              ref={raceTypeRef}
              defaultValue={saved.hyroxRaceType ?? ""}
              className="rounded-md border border-zinc-300 px-3 py-2"
            >
              <option value="">—</option>
              <option value="singles">Singles</option>
              <option value="doubles">Doubles</option>
              <option value="relay">Relay</option>
            </select>
          </label>

          <div className="grid grid-cols-2 gap-3 text-sm">
            {SPLIT_INPUTS.map(({ name, label }) => (
              <label key={name} className="flex flex-col gap-1">
                {label} (mm:ss)
                <input
                  ref={(el) => {
                    splitRefs.current[name] = el;
                  }}
                  name={name}
                  type="text"
                  defaultValue={saved[name] ?? ""}
                  placeholder="mm:ss"
                  className="rounded-md border border-zinc-300 px-3 py-2"
                />
              </label>
            ))}
          </div>

          {state.error && <p className="text-sm text-red-600">{state.error}</p>}

          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={pending}
              className="rounded-full bg-black px-5 py-2 text-sm text-white transition-colors hover:bg-zinc-800 disabled:opacity-50"
            >
              {pending ? "Saving…" : "Save results"}
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="text-sm text-zinc-600 underline hover:text-black"
            >
              Cancel
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
