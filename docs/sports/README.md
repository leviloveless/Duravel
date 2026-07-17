# Multi-sport design & specifications

Design docs, sport research, and per-sport specifications for the multi-sport
expansion (HYROX → DEKA · Triathlon · General Fitness). These are the reference
material behind `lib/engine/sports/*` and the sport-abstraction (P0) layer.

| Doc | What it covers |
| --- | --- |
| [00-multisport-overview.md](./00-multisport-overview.md) | The overall multi-sport plan: sport families, phased rollout, cross-cutting decisions. |
| [01-p0-abstraction-design.md](./01-p0-abstraction-design.md) | The P0 sport-abstraction architecture — `SportConfig` registry, `ProgramType` behavior, byte-identical HYROX preservation via golden oracles. |
| [02-p0-interface.md](./02-p0-interface.md) | The `SportConfig` / `ProgramType` interface contract as built. |
| [03-research-deka.md](./03-research-deka.md) | DEKA research: formats, station catalogs, standards, energy systems. |
| [04-research-triathlon.md](./04-research-triathlon.md) | Triathlon research: Friel/Seiler periodization, per-discipline volume, brick training. |
| [05-research-general-fitness.md](./05-research-general-fitness.md) | General-fitness research: rotating-emphasis blocks, sub-goals. |
| [06-spec-deka.md](./06-spec-deka.md) | DEKA Stage-1 spec (Fit / Mile / Strong / Atlas / Ultra). |
| [07-spec-triathlon.md](./07-spec-triathlon.md) | Triathlon Stage-1 spec (Ironman 70.3 / 140.6). |
| [08-spec-general-fitness.md](./08-spec-general-fitness.md) | General-fitness Stage-1 spec. |

## Implementation status (this branch)

All nine sports are selectable and generate end-to-end; HYROX is byte-identical
(frozen by `lib/engine/golden-hyrox.test.ts`). Beyond the base build, the
following per-sport refinements are implemented:

- **DEKA** — race pacing plan (`lib/engine/deka-pacing.ts`); ATLAS-specific needs
  scorers (`lib/engine/needs-atlas.ts`): absolute strength / overhead-pressing
  endurance / glycolytic capacity.
- **Triathlon** — per-discipline zones (`lib/engine/tri-zones.ts`); per-discipline
  volume tiering (explicit swim/bike experience selectors, else derived from
  CSS/FTP); deterministic weekly adaptation; individualized swim/bike/brick
  session content.
- **General Fitness** — rotating-emphasis blocks, no-race `ProgramType`.

Notes on values: DEKA loads are kg (engine convention) but DEKA standards are lb
— verify against the versioned Rules PDF for the target season. Coaching
reference times/anchors in the pacing and needs modules are deliberately coarse
and centralized for one-file tuning.
