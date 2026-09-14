/**
 * The workout library (2026-09-13).
 *
 * ⚠️ WORKOUTS ARE FILED BY GOAL, NOT BY MUSCLE GROUP OR BODY PART. That is not a
 * UI preference — it is the taxonomy the engine already uses. A lift session
 * carries an `emphasis` (`max_strength` / `strength` / `endurance` / `power`)
 * and a run carries a `runType`, and both answer the same question: what
 * adaptation is this session buying? Filing the library the same way is what
 * makes a workout an athlete picks here schedulable by the same code that
 * schedules a generated one.
 *
 * The seven goals below are therefore a deliberate superset of the engine's
 * vocabulary, not a second one: `aerobic`/`threshold`/`vo2` line up with run
 * types and cardio zones, `max_strength`/`power`/`hypertrophy` line up with lift
 * emphases, and `durability` is the one that only exists in this sport — the
 * ability to keep running after eight stations have already happened.
 */

export const GOALS = [
  "threshold",
  "aerobic",
  "vo2",
  "durability",
  "hypertrophy",
  "max_strength",
  "max_power",
] as const;
export type Goal = (typeof GOALS)[number];

/**
 * ⚠️ THIS ORDER IS LOAD-BEARING. The seven goal colours are a colourblind-
 * validated categorical set, and the validation was run against this exact
 * sequence: gold, red and green are separated by blue/teal/violet so that no two
 * of the three ever sit adjacent in a legend or a stacked chart. Reordering the
 * array reorders the swatches and can silently break that. Do not sort it.
 */
export const GOAL_LABEL: Record<Goal, string> = {
  threshold: "Lactate threshold",
  aerobic: "Aerobic base",
  vo2: "VO₂ max",
  durability: "Running durability",
  hypertrophy: "Hypertrophy",
  max_strength: "Max strength",
  max_power: "Max power",
};

/** Tailwind token names from `globals.css`, in the same validated order. */
export const GOAL_COLOR_VAR: Record<Goal, string> = {
  threshold: "var(--color-goal-threshold)",
  aerobic: "var(--color-goal-aerobic)",
  vo2: "var(--color-goal-vo2)",
  durability: "var(--color-goal-durability)",
  hypertrophy: "var(--color-goal-hypertrophy)",
  max_strength: "var(--color-goal-maxstrength)",
  max_power: "var(--color-goal-maxpower)",
};

/** One line of why this goal exists, shown when it is the active filter. */
export const GOAL_BLURB: Record<Goal, string> = {
  threshold:
    "The pace you can hold for about an hour. Raising it raises every hard split in the race.",
  aerobic:
    "The base everything else is spent from. Cheap to build, slow to build, and the first thing to go.",
  vo2: "Your ceiling. Trained in short, genuinely hard efforts — and it decays without them.",
  durability:
    "Holding form and pace when the legs are already wrecked. The quality this sport is actually about.",
  hypertrophy: "More muscle. Bought in the off-season, spent on the sled for years afterwards.",
  max_strength: "The force ceiling every loaded station draws from.",
  max_power: "How fast you can express that force. The only strength quality that decays quietly.",
};

export const DISCIPLINES = ["hybrid", "run", "lift", "erg"] as const;
export type Discipline = (typeof DISCIPLINES)[number];

export const DISCIPLINE_LABEL: Record<Discipline, string> = {
  hybrid: "Hybrid",
  run: "Run",
  lift: "Lift",
  erg: "Erg",
};

/** Where in a block this session belongs. Matches the engine's phase language. */
export const PHASES = ["Base", "Build", "Peak"] as const;
export type LibraryPhase = (typeof PHASES)[number];

export interface LibraryWorkout {
  /** Stable slug. Never renumber — a saved or scheduled workout refers to this. */
  id: string;
  name: string;
  discipline: Discipline;
  goal: Goal;
  /** Total session time INCLUDING warm-up and cool-down, in minutes. */
  minutes: number;
  phase: LibraryPhase;
  /** The session itself, one line per block. Rendered in order. */
  structure: readonly string[];
  /** One sentence: what this buys, and why it is in the library at all. */
  why: string;
}
