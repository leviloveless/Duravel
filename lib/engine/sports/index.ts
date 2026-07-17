/**
 * Sport registry (P0). Resolve a `SportConfig` by `SportId`. HYROX is the only
 * registered sport at P0; DEKA / triathlon / general-fitness are added in later
 * phases against this same contract (docs/future-phases/16–18).
 */
import type { SportConfig, SportId } from "./types";
import { hyrox } from "./hyrox";
import { deka_fit, deka_mile, deka_strong, deka_atlas, deka_ultra } from "./deka";
import { general_fitness } from "./general-fitness";
import { tri_70_3, tri_140_6 } from "./triathlon";

export * from "./types";
export { hyrox } from "./hyrox";
export { deka_fit, deka_mile, deka_strong, deka_atlas, deka_ultra } from "./deka";
export { general_fitness } from "./general-fitness";
export { tri_70_3, tri_140_6 } from "./triathlon";

export const SPORTS = {
  hyrox,
  deka_fit,
  deka_mile,
  deka_strong,
  deka_atlas,
  deka_ultra,
  general_fitness,
  tri_70_3,
  tri_140_6,
} satisfies Partial<Record<SportId, SportConfig>>;

/** Resolve a sport config, defaulting to HYROX for unknown/legacy ids. */
export function getSport(id: SportId | undefined): SportConfig {
  const cfg = (SPORTS as Partial<Record<SportId, SportConfig>>)[id ?? "hyrox"];
  return cfg ?? hyrox;
}
