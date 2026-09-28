import { describe, expect, it } from "vitest";
import {
  BULK_DELETE_MAX,
  parseBulkDelete,
  parseNewAccount,
  summarizeBulkDelete,
} from "./admin-account-rules";

const base = {
  email: "  Jane.Doe@Example.com ",
  firstName: " Jane ",
  lastName: "",
  onboarding: "set_password",
  access: "default",
  tier: "standard",
  days: "",
  note: "",
};

describe("parseNewAccount", () => {
  it("normalizes the email and trims names; blanks become null", () => {
    expect(parseNewAccount(base)).toEqual({
      email: "jane.doe@example.com",
      firstName: "Jane",
      lastName: null,
      onboarding: "set_password",
      comp: null,
      note: null,
    });
  });
  it("rejects a malformed email", () => {
    expect(() => parseNewAccount({ ...base, email: "jane@" })).toThrow(/email/);
  });
  it("an unknown onboarding value falls back to the set-a-password email", () => {
    expect(parseNewAccount({ ...base, onboarding: "carrier-pigeon" }).onboarding).toBe(
      "set_password",
    );
    expect(parseNewAccount({ ...base, onboarding: "none" }).onboarding).toBe("none");
    expect(parseNewAccount({ ...base, onboarding: "invite" }).onboarding).toBe("invite");
  });
  it("a comp carries its tier and length; blank length is open-ended", () => {
    expect(parseNewAccount({ ...base, access: "grant", tier: "custom", days: "30" }).comp).toEqual({
      tier: "custom",
      days: 30,
    });
    expect(parseNewAccount({ ...base, access: "grant", days: "" }).comp).toEqual({
      tier: "standard",
      days: null,
    });
  });
  it("tier and days are ignored unless it is a comp", () => {
    expect(parseNewAccount({ ...base, tier: "custom", days: "30" }).comp).toBeNull();
  });
  it("rejects a nonsense comp length", () => {
    for (const days of ["0", "-3", "abc", "99999"]) {
      expect(() => parseNewAccount({ ...base, access: "grant", days })).toThrow(/days/);
    }
  });
});

const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ME = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

describe("parseBulkDelete", () => {
  it("requires DELETE typed (any case, surrounding space ok)", () => {
    expect(() => parseBulkDelete([A], "", ME)).toThrow(/DELETE/);
    expect(() => parseBulkDelete([A], "yes", ME)).toThrow(/DELETE/);
    expect(parseBulkDelete([A], " delete ", ME).ids).toEqual([A]);
  });
  it("deduplicates", () => {
    expect(parseBulkDelete([A, A, B], "DELETE", ME).ids).toEqual([A, B]);
  });
  it("never includes the admin's own account", () => {
    expect(parseBulkDelete([A, ME], "DELETE", ME)).toEqual({ ids: [A], skippedSelf: true });
    expect(() => parseBulkDelete([ME], "DELETE", ME)).toThrow(/your own/);
  });
  it("needs a selection, and refuses a malformed id", () => {
    expect(() => parseBulkDelete([], "DELETE", ME)).toThrow(/at least one/);
    expect(() => parseBulkDelete(["not-an-id"], "DELETE", ME)).toThrow(/Invalid/);
  });
  it("caps the batch", () => {
    const many = Array.from(
      { length: BULK_DELETE_MAX + 1 },
      (_, i) => `aaaaaaaa-aaaa-4aaa-8aaa-${String(i).padStart(12, "0")}`,
    );
    expect(() => parseBulkDelete(many, "DELETE", ME)).toThrow(/at most/);
  });
});

describe("summarizeBulkDelete", () => {
  it("counts deletions and names each skip with its reason", () => {
    expect(
      summarizeBulkDelete(
        [
          { email: "a@x.com", result: "deleted" },
          { email: "b@x.com", result: "skipped", reason: "live Stripe subscription" },
        ],
        true,
      ),
    ).toBe(
      "Deleted 1 account. Skipped 1: b@x.com — live Stripe subscription. Your own account was left alone.",
    );
  });
});
