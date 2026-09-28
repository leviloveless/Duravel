import { createElement } from "react";
import { render } from "@react-email/render";
import { describe, expect, it } from "vitest";
import { Broadcast } from "./templates/Broadcast";
import { templateMeta } from "./categories";
import { buildDedupKey } from "./dedup";
import { evaluatePreClaim } from "./gate";

const props = {
  firstName: "Sam",
  subject: "New",
  paragraphs: ["We shipped <b>tapers</b> & more.", "Second."],
  button: { label: "Open", url: "https://duravel.app/library" },
  unsubscribeUrl: "https://duravel.app/api/email/unsubscribe?token=abc",
  manageUrl: "https://duravel.app/settings/email",
  postalAddress: "PO Box 123, Houston, TX 77002",
};

describe("group email", () => {
  it("carries the postal address, an unsubscribe link, and escapes the admin's text", async () => {
    const html = await render(createElement(Broadcast, props));
    expect(html).toContain("PO Box 123, Houston, TX 77002");
    expect(html).toContain("https://duravel.app/api/email/unsubscribe?token=abc");
    expect(html).toContain("&lt;b&gt;tapers&lt;/b&gt;");
    expect(html).not.toContain("<b>tapers</b>");
    const text = await render(createElement(Broadcast, props), { plainText: true });
    expect(text).toContain("Hi Sam,");
  });
  it("is suppressible marketing mail under product updates", () => {
    expect(templateMeta("broadcast")).toEqual({
      category: "product",
      tier: "lifecycle",
      prefCategory: "product",
    });
    const base = {
      template: "broadcast" as const,
      emailEnabled: true,
      recipient: "a@b.com",
      suppressed: false,
      lastLifecycleEmailAt: null,
      nowMs: 0,
    };
    expect(
      evaluatePreClaim({ ...base, prefs: { unsubscribedAll: false, categoryEnabled: false } }),
    ).toEqual({ proceed: false, reason: "category_off" });
    expect(
      evaluatePreClaim({ ...base, prefs: { unsubscribedAll: true, categoryEnabled: true } }),
    ).toEqual({ proceed: false, reason: "unsubscribed_all" });
  });
  it("one send per athlete per broadcast", () => {
    expect(buildDedupKey({ template: "broadcast", broadcastId: "b1", userId: "u1" })).toBe(
      "broadcast:b1:u1",
    );
  });
});
