"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import ResultCard, {
  RACE_LABELS,
  type CardData,
  type CardFormat,
  type CardType,
  type RaceSplit,
} from "./result-card";

/**
 * "Result card studio" — an in-app modal that ports the standalone card
 * generator. Left: type + format toggles and the editable field form for the
 * active type. Right: a live, scaled-down preview of <ResultCard>. The download
 * button rasterizes the full-size card to a 1080px PNG via html2canvas, which is
 * imported dynamically inside the click handler so it never loads on SSR/first
 * paint.
 */

/** Flat editable field bag — a superset of every card type's fields. The active
 *  `type` selects which subset is assembled into the CardData union below. */
interface StudioFields {
  athlete: string;
  // race
  event: string;
  division: string;
  total: string;
  rankDiv: string;
  rankOverall: string;
  splits: RaceSplit[];
  // session
  sessType: string;
  sessMain: string;
  sessVol: string;
  sessTime: string;
  sessHr: string;
  coachNote: string;
  // pr
  prTitle: string;
  prValue: string;
  prDelta: string;
  prContext: string;
  // program
  progTitle: string;
  progName: string;
  progStat1: string;
  progStat2: string;
  progNote: string;
}

/** Default race split times, paired with RACE_LABELS (matches the generator's
 *  sample data). */
const DEFAULT_SPLIT_TIMES = [
  "4:41",
  "3:52",
  "4:55",
  "2:47",
  "5:02",
  "3:10",
  "5:08",
  "4:20",
  "5:14",
  "3:38",
  "5:20",
  "1:44",
  "5:25",
  "3:55",
  "5:31",
  "5:02",
];

const DEFAULT_SPLITS: RaceSplit[] = RACE_LABELS.map(
  (label, i) => [label, DEFAULT_SPLIT_TIMES[i] ?? "0:00"] as RaceSplit,
);

/** Sample data mirroring the generator's initial `state`. */
const DEFAULTS: StudioFields = {
  athlete: "ALEX MORGAN",
  event: "HYROX Dallas",
  division: "Men's Open",
  total: "1:04:38",
  rankDiv: "12 / 340",
  rankOverall: "88 / 2,140",
  splits: DEFAULT_SPLITS,
  sessType: "Threshold Intervals",
  sessMain: "6 × 1km @ 4:05",
  sessVol: "12.4 km",
  sessTime: "58:20",
  sessHr: "Avg 162 bpm",
  coachNote:
    "Nailed the pacing — last rep was your fastest. Ready to drop threshold pace next block.",
  prTitle: "NEW 1KM PR",
  prValue: "3:38",
  prDelta: "−7s",
  prContext: "Rowing station · HYROX Dallas",
  progTitle: "RACE READY",
  progName: "12-Week HYROX Build",
  progStat1: "42 / 42",
  progStat2: "+18%",
  progNote: "Twelve weeks done. Every session logged. Time to race.",
};

/** Subset of DEFAULTS overridable via `initial`. `initial` is a Partial of the
 *  public CardData union; we read it through this concrete shape so seeding
 *  stays fully typed (no `any`). */
type SeedShape = Partial<StudioFields> & { type?: CardType };

function seedFields(initial: Partial<CardData> | undefined): StudioFields {
  const seed = (initial ?? {}) as SeedShape;
  return {
    athlete: seed.athlete ?? DEFAULTS.athlete,
    event: seed.event ?? DEFAULTS.event,
    division: seed.division ?? DEFAULTS.division,
    total: seed.total ?? DEFAULTS.total,
    rankDiv: seed.rankDiv ?? DEFAULTS.rankDiv,
    rankOverall: seed.rankOverall ?? DEFAULTS.rankOverall,
    splits: seed.splits ?? DEFAULTS.splits,
    sessType: seed.sessType ?? DEFAULTS.sessType,
    sessMain: seed.sessMain ?? DEFAULTS.sessMain,
    sessVol: seed.sessVol ?? DEFAULTS.sessVol,
    sessTime: seed.sessTime ?? DEFAULTS.sessTime,
    sessHr: seed.sessHr ?? DEFAULTS.sessHr,
    coachNote: seed.coachNote ?? DEFAULTS.coachNote,
    prTitle: seed.prTitle ?? DEFAULTS.prTitle,
    prValue: seed.prValue ?? DEFAULTS.prValue,
    prDelta: seed.prDelta ?? DEFAULTS.prDelta,
    prContext: seed.prContext ?? DEFAULTS.prContext,
    progTitle: seed.progTitle ?? DEFAULTS.progTitle,
    progName: seed.progName ?? DEFAULTS.progName,
    progStat1: seed.progStat1 ?? DEFAULTS.progStat1,
    progStat2: seed.progStat2 ?? DEFAULTS.progStat2,
    progNote: seed.progNote ?? DEFAULTS.progNote,
  };
}

const TYPE_OPTIONS: { key: CardType; label: string }[] = [
  { key: "race", label: "Race result" },
  { key: "session", label: "Session" },
  { key: "pr", label: "PR / milestone" },
  { key: "program", label: "Program done" },
];

const FORMAT_OPTIONS: { key: CardFormat; label: string }[] = [
  { key: "story", label: "Story 9:16" },
  { key: "square", label: "Feed 1:1" },
];

/** Preview target width (px). The 1080px card is scaled to fit this. */
const PREVIEW_WIDTH = 360;
const PREVIEW_SCALE = PREVIEW_WIDTH / 1080;

export interface ResultCardStudioProps {
  open: boolean;
  onClose: () => void;
  /** Seed values for the initial card (e.g. a program-done card). */
  initial?: Partial<CardData>;
}

export default function ResultCardStudio({ open, onClose, initial }: ResultCardStudioProps) {
  const [type, setType] = useState<CardType>(initial?.type ?? "race");
  const [format, setFormat] = useState<CardFormat>("story");
  const [fields, setFields] = useState<StudioFields>(() => seedFields(initial));
  const [busy, setBusy] = useState(false);

  const cardRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);

  function upd<K extends keyof StudioFields>(key: K, value: StudioFields[K]) {
    setFields((f) => ({ ...f, [key]: value }));
  }
  function updSplit(index: number, value: string) {
    setFields((f) => ({
      ...f,
      splits: f.splits.map((s, i) => (i === index ? ([s[0], value] as RaceSplit) : s)),
    }));
  }

  // Assemble the CardData union for the active type from the flat field bag.
  const data = useMemo<CardData>(() => {
    switch (type) {
      case "race":
        return {
          type,
          athlete: fields.athlete,
          event: fields.event,
          division: fields.division,
          total: fields.total,
          rankDiv: fields.rankDiv,
          rankOverall: fields.rankOverall,
          splits: fields.splits,
        };
      case "session":
        return {
          type,
          athlete: fields.athlete,
          sessType: fields.sessType,
          sessMain: fields.sessMain,
          sessVol: fields.sessVol,
          sessTime: fields.sessTime,
          sessHr: fields.sessHr,
          coachNote: fields.coachNote,
        };
      case "pr":
        return {
          type,
          athlete: fields.athlete,
          prTitle: fields.prTitle,
          prValue: fields.prValue,
          prDelta: fields.prDelta,
          prContext: fields.prContext,
        };
      case "program":
        return {
          type,
          athlete: fields.athlete,
          progTitle: fields.progTitle,
          progName: fields.progName,
          progStat1: fields.progStat1,
          progStat2: fields.progStat2,
          progNote: fields.progNote,
        };
    }
  }, [type, fields]);

  const previewHeight = format === "story" ? 1920 : 1080;

  // Keep the preview scaled to fit. Applied imperatively on the card node itself
  // (the same node html2canvas rasterizes) so the download handler can clear and
  // restore the transform around capture, exactly like the generator.
  useEffect(() => {
    if (!open) return;
    const node = cardRef.current;
    if (!node) return;
    node.style.transformOrigin = "top left";
    node.style.transform = `scale(${PREVIEW_SCALE})`;
  }, [open, type, format, data]);

  // Accessible modal: focus the panel on open, close on Escape, restore focus.
  useEffect(() => {
    if (!open) return;
    restoreFocusRef.current = document.activeElement as HTMLElement | null;
    dialogRef.current?.focus();
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      restoreFocusRef.current?.focus();
    };
  }, [open, onClose]);

  async function download() {
    const node = cardRef.current;
    if (!node) return;
    setBusy(true);
    const prevTransform = node.style.transform;
    node.style.transform = "none";
    try {
      const html2canvas = (await import("html2canvas")).default;
      const canvas = await html2canvas(node, {
        width: 1080,
        height: previewHeight,
        scale: 1,
        backgroundColor: "#0a0e14",
        useCORS: true,
      });
      const a = document.createElement("a");
      a.download = `duravel_${type}_${format}.png`;
      a.href = canvas.toDataURL("image/png");
      a.click();
    } finally {
      node.style.transform = prevTransform;
      setBusy(false);
    }
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-stretch justify-center bg-black/50 p-0 sm:items-center sm:p-6"
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="result-card-studio-title"
        tabIndex={-1}
        className="flex w-full max-w-4xl flex-col overflow-hidden bg-white shadow-xl outline-none sm:max-h-[92vh] sm:flex-row sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Controls */}
        <div className="flex flex-1 flex-col gap-5 overflow-y-auto p-5 sm:max-w-sm">
          <div className="flex items-start justify-between">
            <div>
              <h3 id="result-card-studio-title" className="text-sm font-semibold">
                Result card
              </h3>
              <p className="mt-0.5 text-xs text-zinc-500">
                Pick a type and format, edit the details, download a share-ready PNG.
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="rounded-md px-2 py-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600"
            >
              ✕
            </button>
          </div>

          {/* Type toggle */}
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">Card type</p>
            <div className="mt-1.5 grid grid-cols-2 gap-2">
              {TYPE_OPTIONS.map((o) => (
                <button
                  key={o.key}
                  type="button"
                  aria-pressed={type === o.key}
                  onClick={() => setType(o.key)}
                  className={`rounded-lg border px-2 py-2 text-sm font-medium transition-colors ${
                    type === o.key
                      ? "border-black bg-black text-white"
                      : "border-zinc-300 text-zinc-700 hover:bg-zinc-50"
                  }`}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </div>

          {/* Format toggle */}
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">Format</p>
            <div className="mt-1.5 grid grid-cols-2 gap-2">
              {FORMAT_OPTIONS.map((o) => (
                <button
                  key={o.key}
                  type="button"
                  aria-pressed={format === o.key}
                  onClick={() => setFormat(o.key)}
                  className={`rounded-lg border px-2 py-2 text-sm font-medium transition-colors ${
                    format === o.key
                      ? "border-black bg-black text-white"
                      : "border-zinc-300 text-zinc-700 hover:bg-zinc-50"
                  }`}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </div>

          {/* Fields for the active type */}
          <div className="flex flex-col gap-3">
            {type === "race" && (
              <>
                <TextField label="Athlete" value={fields.athlete} onChange={(v) => upd("athlete", v)} />
                <div className="grid grid-cols-2 gap-2">
                  <TextField label="Event" value={fields.event} onChange={(v) => upd("event", v)} />
                  <TextField label="Division" value={fields.division} onChange={(v) => upd("division", v)} />
                </div>
                <TextField label="Total time" value={fields.total} onChange={(v) => upd("total", v)} />
                <div className="grid grid-cols-2 gap-2">
                  <TextField label="Division rank" value={fields.rankDiv} onChange={(v) => upd("rankDiv", v)} />
                  <TextField label="Overall rank" value={fields.rankOverall} onChange={(v) => upd("rankOverall", v)} />
                </div>
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
                    Station / run splits
                  </p>
                  <div className="mt-1.5 flex flex-col gap-1.5">
                    {fields.splits.map((s, i) => (
                      <div key={`${s[0]}-${i}`} className="flex items-center gap-2">
                        <span className="w-28 shrink-0 text-[11px] text-zinc-500">{s[0]}</span>
                        <input
                          value={s[1]}
                          onChange={(e) => updSplit(i, e.target.value)}
                          className="w-full rounded-md border border-zinc-300 px-2 py-1 text-sm text-zinc-800"
                        />
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}

            {type === "session" && (
              <>
                <TextField label="Athlete" value={fields.athlete} onChange={(v) => upd("athlete", v)} />
                <TextField label="Session type" value={fields.sessType} onChange={(v) => upd("sessType", v)} />
                <TextField label="Main set" value={fields.sessMain} onChange={(v) => upd("sessMain", v)} />
                <div className="grid grid-cols-2 gap-2">
                  <TextField label="Volume" value={fields.sessVol} onChange={(v) => upd("sessVol", v)} />
                  <TextField label="Time" value={fields.sessTime} onChange={(v) => upd("sessTime", v)} />
                </div>
                <TextField label="Heart rate" value={fields.sessHr} onChange={(v) => upd("sessHr", v)} />
                <TextField label="Coach note" value={fields.coachNote} onChange={(v) => upd("coachNote", v)} />
              </>
            )}

            {type === "pr" && (
              <>
                <TextField label="Athlete" value={fields.athlete} onChange={(v) => upd("athlete", v)} />
                <TextField label="PR title" value={fields.prTitle} onChange={(v) => upd("prTitle", v)} />
                <div className="grid grid-cols-2 gap-2">
                  <TextField label="New value" value={fields.prValue} onChange={(v) => upd("prValue", v)} />
                  <TextField label="Improvement" value={fields.prDelta} onChange={(v) => upd("prDelta", v)} />
                </div>
                <TextField label="Context" value={fields.prContext} onChange={(v) => upd("prContext", v)} />
              </>
            )}

            {type === "program" && (
              <>
                <TextField label="Athlete" value={fields.athlete} onChange={(v) => upd("athlete", v)} />
                <TextField label="Badge title" value={fields.progTitle} onChange={(v) => upd("progTitle", v)} />
                <TextField label="Program name" value={fields.progName} onChange={(v) => upd("progName", v)} />
                <div className="grid grid-cols-2 gap-2">
                  <TextField label="Sessions done" value={fields.progStat1} onChange={(v) => upd("progStat1", v)} />
                  <TextField label="Fitness gain" value={fields.progStat2} onChange={(v) => upd("progStat2", v)} />
                </div>
                <TextField label="Note" value={fields.progNote} onChange={(v) => upd("progNote", v)} />
              </>
            )}
          </div>

          <Button variant="primary" onClick={() => void download()} disabled={busy} className="w-full">
            {busy ? "Rendering…" : "⬇ Download PNG"}
          </Button>
        </div>

        {/* Live preview */}
        <div className="flex flex-1 items-center justify-center overflow-auto border-t border-zinc-200 bg-zinc-100 p-6 sm:border-l sm:border-t-0">
          <div
            className="overflow-hidden rounded-xl shadow-[0_20px_60px_rgba(0,0,0,.35)]"
            style={{ width: PREVIEW_WIDTH, height: previewHeight * PREVIEW_SCALE }}
          >
            <ResultCard ref={cardRef} format={format} data={data} />
          </div>
        </div>
      </div>
    </div>
  );
}

function TextField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-md border border-zinc-300 px-2 py-1.5 text-sm text-zinc-800"
      />
    </label>
  );
}
