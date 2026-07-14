/**
 * Dev-only engine preview (not part of the app build).
 *
 * Prints a full deterministic program skeleton to the console so you can
 * eyeball the periodization before the onboarding UI (M4) and program view
 * (M6) exist. Edit `input` below and re-run.
 *
 *   npx tsx scripts/preview.ts
 *
 * (npx fetches tsx on demand — no dependency is added to the project.)
 */

import { buildSkeleton } from "../lib/engine/index";
import type { EngineInput } from "../lib/engine/types";

// --- Change these to preview different athletes / programs ---
const input: EngineInput = {
  trainingClass: "non_highly_trained", // or "highly_trained"
  runningExp: "intermediate", // beginner | intermediate | advanced
  hybridExp: "beginner",
  liftingExp: "intermediate",
  programType: "goal_event", // goal_event | fixed_duration | general_fitness
  durationWeeks: 20, // 4–24
  trainingDays: ["mon", "tue", "wed", "thu", "fri", "sat"],
  races: [{ weekNumber: 20, priority: "A" }], // [] for general fitness
};

const s = buildSkeleton(input);

console.log(`\nProgram: ${s.durationWeeks} wks | class=${s.trainingClass}`);
console.log(
  `Mesocycles: Base ${s.allocation.base} / Build ${s.allocation.build} / Peak ${s.allocation.peak} / Taper ${s.allocation.taper}\n`,
);
console.log("Wk  Phase  Micro     Miles  Cardio  Sessions (by training day)");
console.log("--  -----  --------  -----  ------  ------------------------------------------");

for (const w of s.weeks) {
  const sess = w.days
    .map((d) =>
      d.sessions
        .map((x) =>
          x.kind === "run"
            ? x.runType.slice(0, 4)
            : x.kind === "lift"
              ? "L:" + x.liftType.slice(0, 2)
              : x.kind === "hybrid"
                ? "HYB"
                : x.kind === "race"
                  ? "RACE"
                  : "rest",
        )
        .join("+"),
    )
    .join("  ");
  console.log(
    `${String(w.weekNumber).padStart(2)}  ${w.phase.padEnd(5)}  ${w.microWeek.padEnd(8)}  ${String(
      w.targetMileage,
    ).padStart(5)}  ${String(w.targetCardioMinutes).padStart(6)}  ${sess}`,
  );
}
