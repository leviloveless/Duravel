import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { TRIAL_DAYS, isTrialEligible } from "./billing-constants";

/**
 * What the product SAYS about the trial must match what it DOES (2026-09-28).
 *
 * On 2026-09-20 the trial became 7 days, card required, run by Stripe. Eight days
 * later the Terms, the Refund Policy, the signup page, the post-signup page, the
 * in-trial banner, the welcome email, the onboarding nudge and two API error
 * messages still promised a 14-day trial with no card — and the Refund Policy
 * said the trial "does not convert to a paid subscription automatically", which
 * is exactly what it now does. Nothing failed, because copy is not code.
 *
 * This reads the source of every surface that describes the trial and fails if
 * the old promise comes back, or if the legal pages drift from `TRIAL_DAYS`.
 */

const ROOT = join(__dirname, "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

const SURFACES = [
  "app/terms/page.tsx",
  "app/refunds/page.tsx",
  "app/signup/page.tsx",
  "app/start/page.tsx",
  "components/trial-banner.tsx",
  "lib/email/templates/Welcome.tsx",
  "lib/email/templates/OnboardingNudge.tsx",
  "app/api/generate/route.ts",
  "app/api/adapt/apply/route.ts",
];

const STALE = [
  /14[- ]day (free )?trial/i,
  /no (payment )?card required/i,
  /do not collect payment/i,
  /does not convert to a paid/i,
  /trial is (running|live)/i,
];

describe("trial copy matches the carded Stripe trial", () => {
  for (const file of SURFACES) {
    it(`${file} makes no no-card or 14-day promise`, () => {
      const src = read(file);
      for (const pattern of STALE) expect(src, `${file} matches ${pattern}`).not.toMatch(pattern);
    });
  }

  for (const file of ["app/terms/page.tsx", "app/refunds/page.tsx"]) {
    it(`${file} states the real trial length and that it converts automatically`, () => {
      const src = read(file).replace(/\s+/g, " ");
      expect(src).toMatch(new RegExp(`\\b${TRIAL_DAYS}[- ]days?\\b`));
      expect(src).toMatch(/automatically/);
      expect(src).toMatch(/once per person/);
    });
  }
});

describe("isTrialEligible — one trial per athlete", () => {
  it("offers the trial to someone who has never subscribed", () => {
    expect(isTrialEligible(false)).toBe(true);
  });
  it("does not offer it again to a returning subscriber", () => {
    expect(isTrialEligible(true)).toBe(false);
  });
});
