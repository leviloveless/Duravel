import {
  asHours,
  formatSplit,
  type StationBand,
  type WeekHours,
  type ZoneSlice,
} from "@/lib/dashboard/derive";
import type { DayPoint } from "@/lib/dashboard/fitness";
import { ZONE_LABEL } from "@/lib/zones";

/**
 * The dashboard's three charts (2026-09-13), as plain server-rendered SVG.
 *
 * No charting library and no client JavaScript: every one of these is a static
 * picture of numbers the server already computed, and hover text comes from
 * native <title> elements, which work with no JS and are read out by screen
 * readers. A library would have cost a bundle, a hydration boundary and a
 * dependency, for a picture that never animates.
 *
 * Colours come from the CSS custom properties in globals.css so the charts and
 * the rest of the app cannot drift apart.
 */

const ZONE_FILL = [
  "var(--color-zone-1)",
  "var(--color-zone-2)",
  "var(--color-zone-3)",
  "var(--color-zone-4)",
  "var(--color-zone-5)",
] as const;

/** Ink that stays legible on each zone step — z1/z2 are light, z3+ are dark. */
const ZONE_INK = ["#0B3B41", "#0B3B41", "#FFFFFF", "#FFFFFF", "#FFFFFF"] as const;

// ── planned vs completed hours ──────────────────────────────────────────────

export function HoursChart({ weeks }: { weeks: readonly WeekHours[] }) {
  if (weeks.length === 0) return null;

  const BASE = 156;
  const TOP = 12;
  const X0 = 34;
  const width = 620;
  const slot = Math.max(24, (width - X0 - 6) / weeks.length);

  const peak = Math.max(...weeks.map((w) => Math.max(w.plannedMin, w.completedMin ?? 0)));
  // Round the axis up to a whole hour so the gridlines land on readable numbers.
  const maxHours = Math.max(2, Math.ceil(asHours(peak)));
  const y = (min: number) => BASE - (asHours(min) / maxHours) * (BASE - TOP);

  const ticks = Array.from({ length: 5 }, (_, i) => Math.round((maxHours / 4) * i));
  const barW = Math.min(15, (slot - 10) / 2);

  return (
    <figure className="m-0 flex flex-col gap-3">
      <svg
        viewBox={`0 0 ${width} 184`}
        className="block h-auto w-full"
        role="img"
        aria-label={`Planned and completed training hours for ${weeks.length} weeks.`}
      >
        {[...new Set(ticks)].map((t) => (
          <g key={t}>
            <line
              x1={X0}
              x2={width - 6}
              y1={y(t * 60)}
              y2={y(t * 60)}
              stroke="var(--color-line)"
              strokeWidth={1}
            />
            <text
              x={X0 - 7}
              y={y(t * 60) + 4}
              textAnchor="end"
              fontSize={10.5}
              fontFamily="var(--font-mono)"
              fill="#6A7180"
            >
              {t}
            </text>
          </g>
        ))}

        {weeks.map((w, i) => {
          const x0 = X0 + i * slot;
          const pad = (slot - barW * 2 - 2) / 2;
          const pct =
            w.completedMin != null && w.plannedMin > 0
              ? Math.round((w.completedMin / w.plannedMin) * 100)
              : null;
          return (
            <g key={w.weekNumber}>
              <title>
                {`Week ${w.weekNumber} — planned ${asHours(w.plannedMin)} h`}
                {w.completedMin != null
                  ? `, done ${asHours(w.completedMin)} h (${pct}%)`
                  : " · upcoming"}
              </title>
              <rect
                x={x0 + pad}
                y={y(w.plannedMin)}
                width={barW}
                height={BASE - y(w.plannedMin)}
                rx={3}
                fill="var(--color-line-strong)"
              />
              {w.completedMin != null && (
                <rect
                  x={x0 + pad + barW + 2}
                  y={y(w.completedMin)}
                  width={barW}
                  height={Math.max(0, BASE - y(w.completedMin))}
                  rx={3}
                  fill="var(--color-accent)"
                />
              )}
              <text
                x={x0 + slot / 2}
                y={174}
                textAnchor="middle"
                fontSize={10}
                fontFamily="var(--font-mono)"
                fill="#6A7180"
              >{`W${w.weekNumber}`}</text>
            </g>
          );
        })}

        <line
          x1={X0}
          x2={width - 6}
          y1={BASE}
          y2={BASE}
          stroke="var(--color-line-strong)"
          strokeWidth={1.5}
        />
      </svg>

      <figcaption className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-zinc-600">
        <span className="inline-flex items-center gap-1.5">
          <i
            className="block h-2.5 w-2.5 rounded-[3px]"
            style={{ background: "var(--color-line-strong)" }}
          />
          Planned
        </span>
        <span className="inline-flex items-center gap-1.5">
          <i
            className="block h-2.5 w-2.5 rounded-[3px]"
            style={{ background: "var(--color-accent)" }}
          />
          Completed
        </span>
        <span className="ml-auto text-zinc-500">hours per week</span>
      </figcaption>
    </figure>
  );
}

// ── intensity distribution ──────────────────────────────────────────────────

export function ZoneChart({ slices }: { slices: readonly ZoneSlice[] }) {
  const W = 620;
  const GAP = 2;

  const bar = (key: "actual" | "target", yPos: number, h: number, labelled: boolean) => {
    let x = 0;
    return slices.map((s, i) => {
      const full = (s[key] / 100) * W;
      const w = Math.max(0, full - (i < slices.length - 1 ? GAP : 0));
      const node = (
        <g key={s.zone}>
          <title>{`Zone ${s.zone} — ${ZONE_LABEL[s.zone]}: you ${s.actual}%, target ${s.target}%`}</title>
          <rect x={x} y={yPos} width={w} height={h} rx={3} fill={ZONE_FILL[s.zone - 1]} />
          {labelled && w > 34 && (
            <text
              x={x + w / 2}
              y={yPos + h / 2 + 4}
              textAnchor="middle"
              fontSize={11.5}
              fontWeight={600}
              fontFamily="var(--font-mono)"
              fill={ZONE_INK[s.zone - 1]}
            >
              {`${s[key]}%`}
            </text>
          )}
        </g>
      );
      x += full;
      return node;
    });
  };

  return (
    <figure className="m-0 flex flex-col gap-3">
      <svg
        viewBox={`0 0 ${W} 126`}
        className="block h-auto w-full"
        role="img"
        aria-label="Your heart-rate zone distribution compared with Duravel's target of 20, 60, 10, 5 and 5 percent."
      >
        <text
          x={0}
          y={10}
          fontSize={10}
          letterSpacing={1.4}
          fontFamily="var(--font-mono)"
          fill="#6A7180"
        >
          YOUR PROGRAM
        </text>
        {bar("actual", 18, 36, true)}
        <text
          x={0}
          y={80}
          fontSize={10}
          letterSpacing={1.4}
          fontFamily="var(--font-mono)"
          fill="#6A7180"
        >
          DURAVEL TARGET
        </text>
        {bar("target", 88, 20, false)}
      </svg>

      <figcaption className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-zinc-600">
        {slices.map((s) => (
          <span key={s.zone} className="inline-flex items-center gap-1.5">
            <i
              className="block h-2.5 w-2.5 rounded-[3px]"
              style={{ background: ZONE_FILL[s.zone - 1] }}
            />
            {`Z${s.zone} ${ZONE_LABEL[s.zone]}`}
          </span>
        ))}
      </figcaption>
    </figure>
  );
}

// ── station benchmarks against the field ────────────────────────────────────

export function StationBandChart({ rows }: { rows: readonly StationBand[] }) {
  const X0 = 5;
  const X1 = 235;
  const at = (p: number) => X0 + p * (X1 - X0);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2 text-[11px] text-zinc-500">
        <span className="font-mono">← novice ceiling</span>
        <span className="h-px flex-1 bg-zinc-200" />
        <span className="font-mono">elite floor →</span>
      </div>

      {rows.map((r) => (
        <div
          key={r.key}
          className="grid grid-cols-[7rem_minmax(0,1fr)_3.25rem_3rem] items-center gap-2 sm:grid-cols-[8rem_minmax(0,1fr)_3.25rem_3.25rem] sm:gap-2.5"
        >
          <span className="truncate text-xs text-zinc-700">{r.label}</span>

          <svg
            viewBox="0 0 240 20"
            className="block h-5 w-full"
            role="img"
            aria-label={`${r.label}: ${formatSplit(r.seconds)}, ${Math.round(r.position * 100)} percent of the reference band.`}
          >
            <title>{`${r.label} — ${formatSplit(r.seconds)} · ${Math.round(r.position * 100)}% of the band`}</title>
            <rect x={X0} y={7} width={X1 - X0} height={6} rx={3} fill="var(--color-line)" />
            {[0.25, 0.5, 0.75].map((t) => (
              <line
                key={t}
                x1={at(t)}
                x2={at(t)}
                y1={4}
                y2={16}
                stroke="var(--color-line-strong)"
                strokeWidth={1}
              />
            ))}
            <rect
              x={X0}
              y={7}
              width={Math.max(0, at(r.position) - X0)}
              height={6}
              rx={3}
              fill="var(--color-accent)"
              opacity={0.28}
            />
            {r.goalPosition != null && (
              <path
                d={`M${at(r.goalPosition)} 4 L${at(r.goalPosition) + 4.5} 10 L${at(r.goalPosition)} 16 L${at(r.goalPosition) - 4.5} 10 Z`}
                fill="none"
                stroke="#6A7180"
                strokeWidth={1.6}
              />
            )}
            <circle
              cx={at(r.position)}
              cy={10}
              r={5.5}
              fill="var(--color-accent)"
              stroke="#FFFFFF"
              strokeWidth={2}
            />
          </svg>

          <span className="text-right font-mono text-xs font-medium">{formatSplit(r.seconds)}</span>
          <span>
            {r.focus && (
              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-800">
                Focus
              </span>
            )}
          </span>
        </div>
      ))}
    </div>
  );
}

// ── fitness / fatigue / form ────────────────────────────────────────────────

/**
 * The three curves, on ONE axis.
 *
 * Form is fitness minus fatigue, so it shares their units and belongs on the
 * same scale — which is lucky, because a second y-axis is the single most
 * common way a chart like this starts lying. Form runs negative through a build
 * block, so the scale carries a zero rule and the domain covers it.
 *
 * Fitness and fatigue are the two lines worth reading; form is drawn as a
 * recessive band around zero because it is derived from them and shouting it
 * three times would flatten the hierarchy.
 */
export function FitnessChart({ points }: { points: readonly DayPoint[] }) {
  if (points.length < 2) return null;

  const W = 620;
  const H = 190;
  const TOP = 12;
  const BASE = 150;
  const X0 = 34;

  const values = points.flatMap((p) => [p.fitness, p.fatigue, p.form]);
  const hi = Math.max(...values, 1);
  const lo = Math.min(...values, 0);
  const pad = (hi - lo) * 0.08 || 1;
  const max = hi + pad;
  const min = lo - pad;

  const x = (i: number) => X0 + (i / (points.length - 1)) * (W - X0 - 8);
  const y = (v: number) => BASE - ((v - min) / (max - min)) * (BASE - TOP);
  const line = (key: "fitness" | "fatigue" | "form") =>
    points
      .map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)} ${y(p[key]).toFixed(1)}`)
      .join(" ");

  const zeroY = y(0);
  const last = points[points.length - 1]!;

  // Roughly monthly ticks, without pulling in a date library for four labels.
  const ticks = points.map((p, i) => ({ p, i })).filter(({ p }) => p.date.slice(8, 10) === "01");

  return (
    <figure className="m-0 flex flex-col gap-3">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="block h-auto w-full"
        role="img"
        aria-label={`Fitness, fatigue and form over ${points.length} days. Fitness now ${last.fitness}, fatigue ${last.fatigue}, form ${last.form}.`}
      >
        {[max, (max + min) / 2, min].map((v, i) => (
          <g key={i}>
            <line
              x1={X0}
              x2={W - 8}
              y1={y(v)}
              y2={y(v)}
              stroke="var(--color-line)"
              strokeWidth={1}
            />
            <text
              x={X0 - 6}
              y={y(v) + 4}
              textAnchor="end"
              fontSize={10}
              fontFamily="var(--font-mono)"
              fill="#6A7180"
            >
              {Math.round(v)}
            </text>
          </g>
        ))}

        {/* Zero matters here: it is the line form crosses on the way into a taper. */}
        {min < 0 && max > 0 && (
          <line
            x1={X0}
            x2={W - 8}
            y1={zeroY}
            y2={zeroY}
            stroke="var(--color-line-strong)"
            strokeWidth={1}
            strokeDasharray="3 3"
          />
        )}

        {/* Form, recessive — it is derived from the two lines above it. */}
        <path
          d={`${line("form")} L${x(points.length - 1).toFixed(1)} ${zeroY.toFixed(1)} L${x(0).toFixed(1)} ${zeroY.toFixed(1)} Z`}
          fill="var(--color-line-strong)"
          opacity={0.28}
          stroke="none"
        />

        <path
          d={line("fatigue")}
          fill="none"
          stroke="var(--color-goal-maxstrength)"
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        <path
          d={line("fitness")}
          fill="none"
          stroke="var(--color-accent)"
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
        />

        {/* An emphasised endpoint: the number the athlete came to read. */}
        <circle
          cx={x(points.length - 1)}
          cy={y(last.fitness)}
          r={3.5}
          fill="var(--color-accent)"
          stroke="#FFFFFF"
          strokeWidth={1.5}
        />

        {ticks.map(({ p, i }) => (
          <text
            key={p.date}
            x={x(i)}
            y={H - 20}
            textAnchor="middle"
            fontSize={10}
            fontFamily="var(--font-mono)"
            fill="#6A7180"
          >
            {p.date.slice(5, 7)}/{p.date.slice(2, 4)}
          </text>
        ))}

        <line
          x1={X0}
          x2={W - 8}
          y1={BASE}
          y2={BASE}
          stroke="var(--color-line-strong)"
          strokeWidth={1.5}
        />
      </svg>

      <figcaption className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-zinc-600">
        <span className="inline-flex items-center gap-1.5">
          <i
            className="block h-2.5 w-2.5 rounded-[3px]"
            style={{ background: "var(--color-accent)" }}
          />
          Fitness <span className="font-mono text-zinc-900">{last.fitness}</span>
        </span>
        <span className="inline-flex items-center gap-1.5">
          <i
            className="block h-2.5 w-2.5 rounded-[3px]"
            style={{ background: "var(--color-goal-maxstrength)" }}
          />
          Fatigue <span className="font-mono text-zinc-900">{last.fatigue}</span>
        </span>
        <span className="inline-flex items-center gap-1.5">
          <i
            className="block h-2.5 w-2.5 rounded-[3px]"
            style={{ background: "var(--color-line-strong)" }}
          />
          Form <span className="font-mono text-zinc-900">{last.form}</span>
        </span>
      </figcaption>
    </figure>
  );
}
