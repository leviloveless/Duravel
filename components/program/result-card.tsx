"use client";

import { forwardRef } from "react";

/**
 * Shareable "result card" — a pure presentational render of one card at its full
 * export size (1080px wide). Ported 1:1 from the standalone card generator
 * (docs/result-cards prototype): dark #0a0e14 + lime #c6ff3d brand, "DURAVEL"
 * wordmark with lime "DU", a KIND label, and the @duravel.app footer.
 *
 * All styling lives in a single scoped <style> block whose every class is
 * `rc-`-prefixed, so nothing collides with globals.css / Tailwind. The root node
 * (`.rc-stage`) is exactly what gets rasterized by html2canvas, so a `ref` is
 * forwarded straight to it.
 */

/** Ordered station / run labels for a HYROX race card (fixed race format). */
export const RACE_LABELS = [
  "Run 1",
  "SkiErg 1k",
  "Run 2",
  "Sled Push",
  "Run 3",
  "Sled Pull",
  "Run 4",
  "Burpee BJ",
  "Run 5",
  "Row 1k",
  "Run 6",
  "Farmers",
  "Run 7",
  "Lunges",
  "Run 8",
  "Wall Balls",
] as const;

/** One race split: [label, time]. Label is shown as-is on the card. */
export type RaceSplit = readonly [label: string, time: string];

export type CardFormat = "story" | "square";

/** Discriminated union of the four card types, carrying exactly the fields each
 *  renderer reads. Mirrors the generator's `state` shape per type. */
export type CardData =
  | {
      type: "race";
      athlete: string;
      event: string;
      division: string;
      total: string;
      rankDiv: string;
      rankOverall: string;
      splits: RaceSplit[];
    }
  | {
      type: "session";
      athlete: string;
      sessType: string;
      sessMain: string;
      sessVol: string;
      sessTime: string;
      sessHr: string;
      coachNote: string;
    }
  | {
      type: "pr";
      athlete: string;
      prTitle: string;
      prValue: string;
      prDelta: string;
      prContext: string;
    }
  | {
      type: "program";
      athlete: string;
      progTitle: string;
      progName: string;
      progStat1: string;
      progStat2: string;
      progNote: string;
    };

export type CardType = CardData["type"];

/** The KIND label shown top-right of each card. */
const KIND_LABEL: Record<CardType, string> = {
  race: "Race Result",
  session: "Session Complete",
  pr: "Personal Record",
  program: "Milestone",
};

export interface ResultCardProps {
  format: CardFormat;
  data: CardData;
}

/** Scoped card CSS. Every selector is `rc-`-prefixed; brand tokens are declared
 *  as `--rc-*` custom properties on `.rc-stage` so they never leak or collide. */
const RC_STYLES = `
.rc-stage{position:relative;
  --rc-accent:#c6ff3d;--rc-accent2:#3dd6ff;--rc-line:#26303f;
  background:
    radial-gradient(120% 80% at 50% -10%, #16351a 0%, rgba(22,53,26,0) 45%),
    radial-gradient(120% 90% at 90% 110%, #10202b 0%, rgba(16,32,43,0) 50%),
    #0a0e14;
  color:#e8eef6;overflow:hidden;
  font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif}
.rc-stage.rc-story{width:1080px;height:1920px;padding:96px 90px}
.rc-stage.rc-square{width:1080px;height:1080px;padding:80px 84px}
.rc-stage:before{content:"";position:absolute;inset:0;
  background:linear-gradient(180deg,rgba(198,255,61,0) 60%,rgba(198,255,61,.05) 100%);pointer-events:none}
.rc-stage .rc-edge{position:absolute;left:0;right:0;height:8px;
  background:linear-gradient(90deg,var(--rc-accent),#8fe0ff)}
.rc-stage .rc-edge.rc-top{top:0}.rc-stage .rc-edge.rc-bot{bottom:0}

.rc-stage .rc-brandrow{display:flex;align-items:center;justify-content:space-between;position:relative;z-index:2}
.rc-stage .rc-wordmark{font-weight:900;font-size:40px;letter-spacing:-.02em}
.rc-stage .rc-wordmark .rc-d{color:var(--rc-accent)}
.rc-stage .rc-kind{font-size:22px;font-weight:800;letter-spacing:.22em;text-transform:uppercase;color:#9aa8bd}

.rc-stage .rc-body{position:relative;z-index:2;display:flex;flex-direction:column;height:100%}
.rc-stage .rc-spacer{flex:1}

.rc-stage .rc-eyebrow{font-size:26px;font-weight:800;letter-spacing:.2em;text-transform:uppercase;color:var(--rc-accent)}
.rc-stage .rc-headline{font-weight:900;letter-spacing:-.02em;line-height:.96;margin-top:14px}
.rc-stage.rc-story .rc-headline{font-size:96px}
.rc-stage.rc-square .rc-headline{font-size:74px}
.rc-stage .rc-subhead{font-size:34px;color:#9aa8bd;margin-top:18px;font-weight:600}

.rc-stage .rc-bigstat{margin-top:40px}
.rc-stage .rc-bigstat .rc-lab{font-size:26px;letter-spacing:.18em;text-transform:uppercase;color:#6b7a90;font-weight:700}
.rc-stage .rc-bigstat .rc-val{font-weight:900;letter-spacing:-.03em;line-height:1;font-variant-numeric:tabular-nums}
.rc-stage.rc-story .rc-bigstat .rc-val{font-size:180px}
.rc-stage.rc-square .rc-bigstat .rc-val{font-size:140px}
.rc-stage .rc-bigstat .rc-val small{font-size:.42em;color:var(--rc-accent);font-weight:800;margin-left:10px}

.rc-stage .rc-pills{display:flex;gap:16px;margin-top:34px;flex-wrap:wrap}
.rc-stage .rc-pillstat{background:rgba(255,255,255,.04);border:1px solid var(--rc-line);
  border-radius:18px;padding:22px 26px;flex:1;min-width:210px}
.rc-stage .rc-pillstat .rc-k{font-size:20px;letter-spacing:.12em;text-transform:uppercase;color:#6b7a90;font-weight:700}
.rc-stage .rc-pillstat .rc-v{font-size:52px;font-weight:900;letter-spacing:-.02em;margin-top:8px;font-variant-numeric:tabular-nums}
.rc-stage .rc-pillstat .rc-v.rc-acc{color:var(--rc-accent)}

.rc-stage .rc-splits{margin-top:40px;display:grid;grid-template-columns:1fr 1fr;gap:14px 40px}
.rc-stage .rc-splits .rc-s{display:flex;justify-content:space-between;align-items:baseline;
  border-bottom:1px solid rgba(255,255,255,.09);padding-bottom:11px}
.rc-stage .rc-splits .rc-s .rc-n{font-size:25px;color:#c3cede;font-weight:600}
.rc-stage .rc-splits .rc-s .rc-t{font-size:27px;font-weight:800;font-variant-numeric:tabular-nums}

.rc-stage .rc-footer{display:flex;align-items:center;justify-content:space-between;margin-top:auto;
  position:relative;z-index:2;border-top:1px solid rgba(255,255,255,.1);padding-top:26px}
.rc-stage .rc-footer .rc-handle{font-size:28px;font-weight:700;color:#c6ff3d}
.rc-stage .rc-footer .rc-tag{font-size:24px;color:#6b7a90;font-weight:600}

.rc-stage .rc-badge{display:inline-flex;align-items:center;gap:14px;background:rgba(198,255,61,.12);
  border:1px solid rgba(198,255,61,.4);border-radius:999px;padding:16px 30px;margin-top:30px}
.rc-stage .rc-badge .rc-dot{width:18px;height:18px;border-radius:50%;background:var(--rc-accent)}
.rc-stage .rc-badge .rc-txt{font-size:28px;font-weight:800;letter-spacing:.04em;color:var(--rc-accent)}

.rc-stage .rc-note{font-size:30px;color:#c3cede;line-height:1.4;margin-top:34px;font-weight:500;font-style:italic}
`;

/** The lime accent, reused for a couple of inline overrides that the generator
 *  applied via `style="color:var(--accent)"`. */
const ACCENT = "#c6ff3d";
const DIM = "#6b7a90";

function CardInner({ format, data }: ResultCardProps) {
  switch (data.type) {
    case "race":
      return (
        <>
          <div className="rc-eyebrow">{data.event}</div>
          <div className="rc-headline">{data.athlete}</div>
          <div className="rc-subhead">{data.division}</div>
          <div className="rc-bigstat">
            <div className="rc-lab">Finish time</div>
            <div className="rc-val">{data.total}</div>
          </div>
          <div className="rc-pills">
            <div className="rc-pillstat">
              <div className="rc-k">Division rank</div>
              <div className="rc-v rc-acc">{data.rankDiv}</div>
            </div>
            <div className="rc-pillstat">
              <div className="rc-k">Overall</div>
              <div className="rc-v">{data.rankOverall}</div>
            </div>
          </div>
          {format === "story" && (
            <div className="rc-splits">
              {data.splits.map((s, i) => (
                <div className="rc-s" key={`${s[0]}-${i}`}>
                  <span className="rc-n">{s[0]}</span>
                  <span className="rc-t">{s[1]}</span>
                </div>
              ))}
            </div>
          )}
          <div className="rc-spacer" />
        </>
      );
    case "session":
      return (
        <>
          <div className="rc-eyebrow">Today&rsquo;s Session</div>
          <div className="rc-headline">{data.sessType}</div>
          <div className="rc-subhead">{data.sessMain}</div>
          <div className="rc-pills">
            <div className="rc-pillstat">
              <div className="rc-k">Volume</div>
              <div className="rc-v rc-acc">{data.sessVol}</div>
            </div>
            <div className="rc-pillstat">
              <div className="rc-k">Time</div>
              <div className="rc-v">{data.sessTime}</div>
            </div>
            <div className="rc-pillstat">
              <div className="rc-k">Heart rate</div>
              <div className="rc-v">{data.sessHr}</div>
            </div>
          </div>
          <div className="rc-note">{`“${data.coachNote}”`}</div>
          <div className="rc-spacer" />
          <div className="rc-badge">
            <div className="rc-dot" />
            <div className="rc-txt">{data.athlete}</div>
          </div>
        </>
      );
    case "pr":
      return (
        <>
          <div className="rc-spacer" />
          <div className="rc-eyebrow">{data.athlete}</div>
          <div className="rc-headline" style={{ color: ACCENT }}>
            {data.prTitle}
          </div>
          <div className="rc-bigstat">
            <div className="rc-lab">{data.prContext}</div>
            <div className="rc-val">
              {data.prValue}
              <small>{data.prDelta}</small>
            </div>
          </div>
          <div className="rc-spacer" />
        </>
      );
    case "program":
      return (
        <>
          <div className="rc-spacer" />
          <div className="rc-badge">
            <div className="rc-dot" />
            <div className="rc-txt">{data.progTitle}</div>
          </div>
          <div className="rc-headline" style={{ marginTop: 26 }}>
            {data.progName}
          </div>
          <div className="rc-pills">
            <div className="rc-pillstat">
              <div className="rc-k">Sessions</div>
              <div className="rc-v rc-acc">{data.progStat1}</div>
            </div>
            <div className="rc-pillstat">
              <div className="rc-k">Est. fitness gain</div>
              <div className="rc-v">{data.progStat2}</div>
            </div>
          </div>
          <div className="rc-note">{data.progNote}</div>
          <div className="rc-spacer" />
          <div className="rc-eyebrow" style={{ color: DIM }}>
            {data.athlete}
          </div>
        </>
      );
  }
}

const ResultCard = forwardRef<HTMLDivElement, ResultCardProps>(function ResultCard(
  { format, data },
  ref,
) {
  return (
    <div ref={ref} className={`rc-stage rc-${format}`}>
      <style>{RC_STYLES}</style>
      <div className="rc-edge rc-top" />
      <div className="rc-edge rc-bot" />
      <div className="rc-body">
        <div className="rc-brandrow">
          <div className="rc-wordmark">
            <span className="rc-d">DU</span>RAVEL
          </div>
          <div className="rc-kind">{KIND_LABEL[data.type]}</div>
        </div>
        <CardInner format={format} data={data} />
        <div className="rc-footer">
          <div className="rc-handle">@duravel.app</div>
          <div className="rc-tag">AI hybrid coaching</div>
        </div>
      </div>
    </div>
  );
});

export default ResultCard;
