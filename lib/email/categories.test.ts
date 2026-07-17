import { describe, it, expect } from "vitest";
import { isServiceTier, templateMeta } from "./categories";
import type { EmailTemplate } from "./types";

describe("templateMeta", () => {
  it("welcome and onboarding_nudge share a category but differ in tier", () => {
    const w = templateMeta("welcome");
    const n = templateMeta("onboarding_nudge");
    expect(w.category).toBe("onboarding");
    expect(n.category).toBe("onboarding");
    expect(w.tier).toBe("service"); // always sent
    expect(n.tier).toBe("lifecycle"); // suppressible
  });

  it("service-tier templates have no preference column", () => {
    expect(templateMeta("welcome").prefCategory).toBeNull();
    expect(templateMeta("trial_ending").prefCategory).toBeNull();
    expect(templateMeta("receipt").prefCategory).toBeNull();
  });

  it("lifecycle templates name the email_preferences column to check", () => {
    expect(templateMeta("onboarding_nudge").prefCategory).toBe("onboarding");
  });

  it("billing templates are categorized billing", () => {
    expect(templateMeta("trial_ending").category).toBe("billing");
    expect(templateMeta("receipt").category).toBe("billing");
  });
});

describe("isServiceTier", () => {
  it("classifies every template", () => {
    const expected: Record<EmailTemplate, boolean> = {
      welcome: true,
      onboarding_nudge: false,
      trial_ending: true,
      receipt: true,
    };
    (Object.keys(expected) as EmailTemplate[]).forEach((t) => {
      expect(isServiceTier(t)).toBe(expected[t]);
    });
  });
});
