import { createElement } from "react";
import { render } from "@react-email/render";
import { describe, expect, it } from "vitest";
import {
  chargeStillPending,
  endingNoticeDue,
  formatCharge,
  formatChargeDate,
  perInterval,
  planLabelFor,
  trialNoticeKey,
} from "./trial-notice";
import { buildDedupKey } from "./dedup";
import { evaluatePostClaim } from "./gate";
import { templateMeta } from "./categories";
import { TrialNotice } from "./templates/TrialNotice";
import type { TrialNoticeProps } from "./templates/types";

const H = 60 * 60 * 1000;
const D = 24 * H;
const NOW = Date.UTC(2026, 8, 28, 15);
const trialing = (endIn: number, cancel = false) => ({
  status: "trialing",
  cancelAtPeriodEnd: cancel,
  trialEndMs: NOW + endIn,
});

describe("the charge is still coming", () => {
  it("only while trialing, not set to cancel, and ending in the future", () => {
    expect(chargeStillPending(trialing(3 * D), NOW)).toBe(true);
    expect(chargeStillPending(trialing(3 * D, true), NOW)).toBe(false);
    expect(chargeStillPending(trialing(-H), NOW)).toBe(false);
    expect(chargeStillPending({ ...trialing(3 * D), status: "active" }, NOW)).toBe(false);
    expect(chargeStillPending({ ...trialing(3 * D), trialEndMs: null }, NOW)).toBe(false);
  });
});

describe("the cron backstop's window", () => {
  it("covers Stripe's own three-day mark, from half a day to three and a half days out", () => {
    expect(endingNoticeDue(trialing(3 * D), NOW)).toBe(true);
    expect(endingNoticeDue(trialing(12 * H), NOW)).toBe(true);
    expect(endingNoticeDue(trialing(3.5 * D), NOW)).toBe(true);
    expect(endingNoticeDue(trialing(11 * H), NOW)).toBe(false);
    expect(endingNoticeDue(trialing(4 * D), NOW)).toBe(false);
    expect(endingNoticeDue(trialing(2 * D, true), NOW)).toBe(false);
  });
});

describe("one notice per subscription and trial end", () => {
  it("the webhook and the cron build the same key", () => {
    const viaDedup = buildDedupKey({
      template: "trial_notice",
      kind: "ending",
      subscriptionId: "sub_1",
      trialEndUnix: 1790000000,
    });
    expect(viaDedup).toBe(trialNoticeKey("ending", "sub_1", 1790000000));
  });
  it("moving the trial end earns a fresh reminder; started and ending never collide", () => {
    expect(trialNoticeKey("ending", "sub_1", 1)).not.toBe(trialNoticeKey("ending", "sub_1", 2));
    expect(trialNoticeKey("started", "sub_1", 1)).not.toBe(trialNoticeKey("ending", "sub_1", 1));
  });
});

describe("gate", () => {
  it("a trial notice goes only with a pending charge", () => {
    expect(
      evaluatePostClaim({
        template: "trial_notice",
        subscriptionActive: true,
        chargePending: true,
      }),
    ).toEqual({ proceed: true });
    expect(
      evaluatePostClaim({
        template: "trial_notice",
        subscriptionActive: true,
        chargePending: false,
      }),
    ).toEqual({ proceed: false, reason: "no_pending_charge" });
    expect(evaluatePostClaim({ template: "trial_notice", subscriptionActive: true })).toEqual({
      proceed: false,
      reason: "no_pending_charge",
    });
  });
  it("is a non-suppressible billing notice", () => {
    expect(templateMeta("trial_notice")).toEqual({
      category: "billing",
      tier: "service",
      prefCategory: null,
    });
  });
});

describe("formatting", () => {
  it("dates in the athlete's zone, falling back to UTC", () => {
    const unix = Date.UTC(2026, 9, 5, 2) / 1000; // 02:00 UTC = the evening before in Chicago
    expect(formatChargeDate(unix, "America/Chicago")).toBe("Oct 4, 2026");
    expect(formatChargeDate(unix, null)).toBe("Oct 5, 2026");
    expect(formatChargeDate(unix, "Not/AZone")).toBe("Oct 5, 2026");
  });
  it("money, interval and plan", () => {
    expect(formatCharge(1999, "usd")).toBe("$19.99");
    expect(perInterval("month")).toBe("/month");
    expect(perInterval("year")).toBe("/year");
    expect(planLabelFor("annual", "standard")).toBe("Duravel Annual");
    expect(planLabelFor("monthly", "custom")).toBe("Duravel Custom");
  });
});

const props: TrialNoticeProps = {
  kind: "ending",
  firstName: "Sam",
  planLabel: "Duravel Monthly",
  priceLine: "$19.99/month",
  chargeDate: "Oct 5, 2026",
  trialDays: 7,
  cancelUrl: "https://duravel.app/settings",
  planUrl: "https://duravel.app/dashboard",
  manageUrl: "https://duravel.app/settings/email",
};

describe("the email says what, how much, when, and how to stop it", () => {
  for (const kind of ["started", "ending"] as const) {
    it(kind, async () => {
      const text = await render(createElement(TrialNotice, { ...props, kind }), {
        plainText: true,
      });
      expect(text).toContain("$19.99/month");
      expect(text).toContain("Oct 5, 2026");
      expect(text).toMatch(/continues automatically/);
      expect(text).toMatch(/Cancel before Oct 5, 2026/);
      expect(text).toContain("https://duravel.app/settings");
      if (kind === "started") expect(text).toMatch(/Nothing is charged today/);
    });
  }
});
