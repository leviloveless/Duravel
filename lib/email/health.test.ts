/**
 * The email ledger has to answer ONE question without anybody guessing:
 * is email actually going out, and if not, why (Levi, 2026-08-13)?
 *
 * ## The incident this came from
 *
 * Nothing in the app surfaced `email_sends`. On 2026-08-13 a stale index line in
 * project memory claimed the lifecycle system was gated off; it had in fact been
 * live since 2026-07-20, and "turn on the lifecycle emails" was recommended and
 * accepted as the next task before the contradiction surfaced. A system whose
 * state can only be checked in a third-party dashboard gets re-litigated from
 * memory, and memory goes stale.
 *
 * ## Why the ledger can answer it definitively
 *
 * `sendEmail()` writes a `skipped` row for every gated send with the
 * `GateSkipReason` in `error`. `disabled` is written when and only when
 * `emailEnabled()` is false — so the presence of one is PROOF the kill switch is
 * off, with no access to env needed. That is what `verdict` reports.
 *
 * The other thing these tests pin: a `skipped` row is not a failure.
 * `unsubscribed_all` / `category_off` / `frequency_cap` are the system working
 * correctly, and a panel that painted them red would train Levi to ignore it.
 */
import { describe, it, expect } from "vitest";
import { rollupEmailHealth, isBenignSkip, skipReasonLabel, type EmailSendRow } from "./health";

function row(over: Partial<EmailSendRow> = {}): EmailSendRow {
  return {
    template: "welcome",
    category: "onboarding",
    status: "delivered",
    error: null,
    created_at: "2026-08-13T10:00:00.000Z",
    ...over,
  };
}

describe("the verdict answers 'is email working?'", () => {
  it("says GATED OFF when a 'disabled' skip is present — the flag question, settled", () => {
    const h = rollupEmailHealth([row({ status: "skipped", error: "disabled" })]);
    expect(h.verdict).toBe("gated_off");
    expect(h.headline).toContain("EMAIL_ENABLED is OFF");
  });

  it("still says GATED OFF when earlier sends succeeded — the flag can flip mid-window", () => {
    // This is the case that would otherwise read as healthy: real sends at the
    // start of the month, then someone turns the switch off and everything goes
    // quiet. "Some emails went out" must not outrank direct evidence.
    const h = rollupEmailHealth([
      row({ status: "delivered" }),
      row({ status: "delivered" }),
      row({ status: "skipped", error: "disabled" }),
    ]);
    expect(h.verdict).toBe("gated_off");
    expect(h.headline).toContain("2 email(s) went out earlier");
  });

  it("says SENDING when mail reached the provider", () => {
    const h = rollupEmailHealth([row({ status: "delivered" }), row({ status: "sent" })]);
    expect(h.verdict).toBe("sending");
    expect(h.reachedProvider).toBe(2);
  });

  it("distinguishes 'nothing sent because nothing was due' from 'nothing works'", () => {
    // All-benign skips: the athlete unsubscribed, or the frequency cap held. The
    // system did exactly the right thing and the panel must not cry wolf.
    const h = rollupEmailHealth([
      row({ status: "skipped", error: "unsubscribed_all" }),
      row({ status: "skipped", error: "frequency_cap" }),
    ]);
    expect(h.verdict).toBe("suppressed_only");
    expect(h.headline).toContain("nothing is broken");
  });

  it("flags attempts that never succeed", () => {
    const h = rollupEmailHealth([
      row({ status: "failed", error: "no_client_or_recipient" }),
      row({ status: "bounced" }),
    ]);
    expect(h.verdict).toBe("attempting_but_failing");
  });

  it("flags total silence — which points at the cron, not the flag", () => {
    const h = rollupEmailHealth([]);
    expect(h.verdict).toBe("no_activity");
    expect(h.headline).toContain("cron");
  });
});

describe("the rollup", () => {
  it("counts every known template even at zero, so a silent one is visible", () => {
    // A receipt template that has sent nothing all month is exactly the thing
    // worth noticing; it must not be absent from the table.
    const h = rollupEmailHealth([row({ template: "welcome" })]);
    const names = h.byTemplate.map((t) => t.template);
    expect(names).toContain("welcome");
    expect(names).toContain("onboarding_nudge");
    expect(names).toContain("trial_ending");
    expect(names).toContain("receipt");
    expect(h.byTemplate.find((t) => t.template === "receipt")!.total).toBe(0);
  });

  it("includes an unknown template rather than dropping it", () => {
    const h = rollupEmailHealth([row({ template: "weekly_summary" })]);
    expect(h.byTemplate.find((t) => t.template === "weekly_summary")?.total).toBe(1);
  });

  it("treats opened/clicked as delivered too — rows only advance forward", () => {
    const h = rollupEmailHealth([
      row({ status: "sent" }),
      row({ status: "delivered" }),
      row({ status: "opened" }),
      row({ status: "clicked" }),
    ]);
    expect(h.reachedProvider).toBe(4);
    // 3 of the 4 are at or past 'delivered'; 'sent' has not been confirmed yet.
    expect(h.deliveryRate).toBeCloseTo(0.75);
  });

  it("has no delivery rate when nothing was sent — not a misleading zero", () => {
    const h = rollupEmailHealth([row({ status: "skipped", error: "disabled" })]);
    expect(h.deliveryRate).toBeNull();
  });

  it("reports the most recent SEND, ignoring skips", () => {
    const h = rollupEmailHealth([
      row({ status: "delivered", created_at: "2026-08-01T00:00:00.000Z" }),
      row({ status: "skipped", error: "category_off", created_at: "2026-08-30T00:00:00.000Z" }),
    ]);
    expect(h.lastSendAt).toBe("2026-08-01T00:00:00.000Z");
  });

  it("ranks skip reasons by frequency", () => {
    const h = rollupEmailHealth([
      row({ status: "skipped", error: "category_off" }),
      row({ status: "skipped", error: "frequency_cap" }),
      row({ status: "skipped", error: "frequency_cap" }),
    ]);
    expect(h.skipReasons[0]).toEqual({ reason: "frequency_cap", count: 2 });
  });

  it("buckets a skip with no recorded reason instead of losing it", () => {
    const h = rollupEmailHealth([row({ status: "skipped", error: null })]);
    expect(h.skipReasons).toEqual([{ reason: "unknown", count: 1 }]);
  });
});

describe("skip-reason presentation", () => {
  it("knows which skips are benign", () => {
    for (const r of ["unsubscribed_all", "category_off", "frequency_cap", "duplicate"]) {
      expect(isBenignSkip(r), r).toBe(true);
    }
    for (const r of ["disabled", "no_recipient", "suppressed"]) {
      expect(isBenignSkip(r), r).toBe(false);
    }
  });

  it("labels every reason sendEmail can actually write", () => {
    // Guards the pair: a new GateSkipReason with no label would render as a raw
    // snake_case string in the admin UI.
    const reasons = [
      "disabled",
      "no_recipient",
      "suppressed",
      "unsubscribed_all",
      "category_off",
      "frequency_cap",
      "now_subscribed",
      "duplicate",
    ];
    for (const r of reasons) {
      expect(skipReasonLabel(r), r).not.toBe(r);
    }
  });

  it("falls back to the raw reason rather than throwing", () => {
    expect(skipReasonLabel("something_new")).toBe("something_new");
  });
});
