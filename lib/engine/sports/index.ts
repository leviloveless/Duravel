/**
 * Sport registry (P0). Resolve a `SportConfig` by `SportId`. HYROX is the only
 * registered sport at P0; DEKA / triathlon / general-fitness are added in later
 * phases against this same contract (docs/future-phases/16–18).
 */
import type { SportConfig, SportId } from "./types";
import { hyrox } from "./hyrox";

export * from "./types";
export { hyrox } from "./hyrox";

export const SPORTS = {
  hyrox,
} satisfies Partial<Record<SportId, SportConfig>>;

/** Resolve a sport config, defaulting to HYROX for unknown/legacy ids. */
export function getSport(id: SportId | undefined): SportConfig {
  const cfg = (SPORTS as Partial<Record<SportId, SportConfig>>)[id ?? "hyrox"];
  return cfg ?? hyrox;
}
