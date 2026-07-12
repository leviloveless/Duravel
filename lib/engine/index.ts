/** Periodization Engine — public surface (Milestone 3). */
export * from "./types";
export { allocateMesocycles, expandPhases, taperWeeksForPriority, topPriority } from "./mesocycles";
export { sequenceMicrocycles, microcyclePattern } from "./microcycles";
export { applyTapers } from "./taper";
export { assignDays, planWeek, buildRunSlots } from "./slots";
export { buildSkeleton, toEngineInput } from "./skeleton";
export {
  computeWeekSignals,
  decideAdaptation,
  applyDecisionToWeek,
  clampToBounds,
  adherenceStreak,
  type WeekSignals,
  type AdaptDecision,
  type AdaptContext,
  type AdaptRuleCode,
  type RevisedTargets,
} from "./adapt";
export { ADAPT } from "./adapt-config";
export {
  PHASE_ZONE_TARGETS,
  STARTING_MILEAGE,
  INCREASE_MILEAGE_FACTOR,
  INCREASE_CARDIO_FACTOR,
  DELOAD_FACTOR,
  startingMileage,
  startingCardioMinutes,
} from "./volume";
