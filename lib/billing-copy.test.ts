import { describe, expect, it } from "vitest";
import { DEFAULT_SELECTION, planName, trialTerms } from "./billing-copy";

describe("trial terms shown where the card is asked for", () => {
  it("defaults to the Standard monthly plan", () => {
    expect(DEFAULT_SELECTION).toBe("monthly");
    expect(planName(DEFAULT_SELECTION)).toBe("Standard monthly");
  });

  it("says nothing is charged today, when the charge happens, and what it will be", () => {
    const t = trialTerms("monthly", 7);
    expect(t).toMatch(/won't be charged today/);
    expect(t).toMatch(/7-day free trial ends/);
    expect(t).toMatch(/\$19\.99\/month on the Standard monthly plan/);
    expect(t).toMatch(/pay nothing/);
  });

  it("names the plan actually chosen", () => {
    expect(trialTerms("annual", 7)).toMatch(/\$159\.99\/year on the Standard annual plan/);
    expect(trialTerms("custom_monthly", 7)).toMatch(/\$29\.99\/month on the Custom monthly plan/);
    expect(trialTerms("custom_annual", 7)).toMatch(/\$239\.99\/year on the Custom annual plan/);
  });

  it("fits Stripe's custom-text limit", () => {
    for (const s of ["monthly", "annual", "custom_monthly", "custom_annual"] as const) {
      expect(trialTerms(s, 30).length).toBeLessThan(1200);
    }
  });
});
