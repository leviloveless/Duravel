import type { EmailTemplate, PrefCategory, Tier } from "./types";

/**
 * Template → (category, consent tier, preference column) registry.
 *
 * IMPORTANT: consent tier is per-TEMPLATE, not per-category. `welcome` and
 * `onboarding_nudge` share category "onboarding" but differ in tier — welcome is
 * transactional/service (always sent), the nudge is suppressible/lifecycle. The tier
 * decides whether the preference + frequency-cap gates apply; the prefCategory names
 * which email_preferences column to check when they do.
 */
interface TemplateMeta {
  /** Coarse category recorded on email_sends.category. */
  category: string;
  /** service = non-suppressible transactional; lifecycle = suppressible. */
  tier: Tier;
  /** email_preferences column to check (lifecycle only); null for service tier. */
  prefCategory: PrefCategory | null;
}

const REGISTRY: Record<EmailTemplate, TemplateMeta> = {
  welcome: { category: "onboarding", tier: "service", prefCategory: null },
  onboarding_nudge: { category: "onboarding", tier: "lifecycle", prefCategory: "onboarding" },
  trial_ending: { category: "billing", tier: "service", prefCategory: null },
  receipt: { category: "billing", tier: "service", prefCategory: null },
};

export function templateMeta(template: EmailTemplate): TemplateMeta {
  return REGISTRY[template];
}

export function isServiceTier(template: EmailTemplate): boolean {
  return REGISTRY[template].tier === "service";
}
