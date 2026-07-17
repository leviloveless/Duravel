import type { Session } from "@/lib/schemas";
import {
  LIFT_TYPE_LABEL,
  elementLine,
  hybridHeader,
  movementLine,
  powerElementLine,
  raceLabel,
  runLine,
} from "./format";

const KIND_TAG: Record<Session["kind"], { label: string; className: string }> = {
  run: { label: "Run", className: "bg-sky-100 text-sky-800" },
  lift: { label: "Lift", className: "bg-zinc-200 text-zinc-800" },
  hybrid: { label: "Hybrid", className: "bg-orange-100 text-orange-800" },
  race: { label: "Race", className: "bg-red-100 text-red-800" },
  cardio: { label: "Cardio", className: "bg-teal-100 text-teal-800" },
  swim: { label: "Swim", className: "bg-cyan-100 text-cyan-800" },
  bike: { label: "Bike", className: "bg-indigo-100 text-indigo-800" },
  brick: { label: "Brick", className: "bg-amber-100 text-amber-800" },
};

function Tag({ kind }: { kind: Session["kind"] }) {
  const t = KIND_TAG[kind];
  return (
    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${t.className}`}>
      {t.label}
    </span>
  );
}

/** Renders one session in the spec §5 output format. */
export default function SessionCard({ session }: { session: Session }) {
  if (session.kind === "run") {
    return (
      <div className="flex items-start gap-2">
        <Tag kind="run" />
        <div className="text-sm text-zinc-800">
          <p>{runLine(session)}</p>
          {session.description && (
            <p className="mt-0.5 text-xs text-zinc-500">{session.description}</p>
          )}
        </div>
      </div>
    );
  }

  if (session.kind === "lift") {
    return (
      <div className="flex items-start gap-2">
        <Tag kind="lift" />
        <div className="text-sm text-zinc-800">
          <p className="font-medium">{LIFT_TYPE_LABEL[session.liftType]}</p>
          <ul className="mt-0.5 flex flex-col gap-0.5">
            {session.movements.map((m, i) => (
              <li key={i} className="text-zinc-700">
                {movementLine(m)}
              </li>
            ))}
          </ul>
          {powerElementLine(session.power) && (
            <p className="mt-1 text-xs text-zinc-500">{powerElementLine(session.power)}</p>
          )}
        </div>
      </div>
    );
  }

  if (session.kind === "hybrid") {
    return (
      <div className="flex items-start gap-2">
        <Tag kind="hybrid" />
        <div className="text-sm text-zinc-800">
          <p className="font-medium">{hybridHeader(session)}</p>
          <ul className="mt-0.5 flex flex-col gap-0.5">
            {session.elements.map((el, i) => (
              <li key={i} className="text-zinc-700">
                {elementLine(el)}
              </li>
            ))}
          </ul>
        </div>
      </div>
    );
  }

  if (session.kind === "cardio") {
    return (
      <div className="flex items-start gap-2">
        <Tag kind="cardio" />
        <div className="text-sm text-zinc-800">
          <p>
            {session.modality ?? "Zone 1–2 cardio"} — {Math.round(session.durationMin)} min — Goal HR: Zone {session.goalZone}
          </p>
          {session.description && <p className="mt-0.5 text-xs text-zinc-500">{session.description}</p>}
        </div>
      </div>
    );
  }

  if (session.kind === "swim") {
    return (
      <div className="flex items-start gap-2">
        <Tag kind="swim" />
        <div className="text-sm text-zinc-800">
          <p>
            <span className="font-medium capitalize">{session.sessionType.replace(/_/g, " ")}</span> swim —{" "}
            {Math.round(session.durationMin)} min — Zone {session.goalZone}
          </p>
          {session.description && <p className="mt-0.5 text-xs text-zinc-500">{session.description}</p>}
        </div>
      </div>
    );
  }

  if (session.kind === "bike") {
    return (
      <div className="flex items-start gap-2">
        <Tag kind="bike" />
        <div className="text-sm text-zinc-800">
          <p>
            <span className="font-medium capitalize">{session.sessionType.replace(/_/g, " ")}</span> ride
            {session.isLong ? " (long)" : ""} — {Math.round(session.durationMin)} min — Zone {session.goalZone}
          </p>
          {session.description && <p className="mt-0.5 text-xs text-zinc-500">{session.description}</p>}
        </div>
      </div>
    );
  }

  if (session.kind === "brick") {
    return (
      <div className="flex items-start gap-2">
        <Tag kind="brick" />
        <div className="text-sm text-zinc-800">
          <p className="font-medium">Brick</p>
          <ul className="mt-0.5 flex flex-col gap-0.5">
            {session.segments.map((s, i) => (
              <li key={i} className="capitalize text-zinc-700">
                {s.discipline} — {Math.round(s.durationMin)} min — Zone {s.goalZone}
              </li>
            ))}
          </ul>
          {session.description && <p className="mt-0.5 text-xs text-zinc-500">{session.description}</p>}
        </div>
      </div>
    );
  }

  // race
  return (
    <div className="flex items-start gap-2">
      <Tag kind="race" />
      <p className="text-sm font-medium text-red-700">{raceLabel(session.priority)}</p>
    </div>
  );
}
