import { describe, expect, it } from "vitest";
import {
  accessLabel,
  chunk,
  deleteConfirmationMatches,
  expiryFromDays,
  formatMoney,
  isSelfLockout,
  isSuspended,
  matchesFilter,
  matchesQuery,
  parseFilter,
  type AccountLite,
} from "./admin-account-rules";

const NOW = Date.parse("2026-09-27T12:00:00.000Z");
const acct = (o: Partial<AccountLite> = {}): AccountLite => ({
  id: "11111111-1111-1111-1111-111111111111",
  email: "athlete@example.com",
  name: "Sam Rivera",
  hasProfile: true,
  suspended: false,
  access: { entitled: true, source: "trial" },
  ...o,
});

describe("isSuspended", () => {
  it("is false with no ban, or a ban in the past", () => {
    expect(isSuspended(null, NOW)).toBe(false);
    expect(isSuspended("2026-09-26T00:00:00.000Z", NOW)).toBe(false);
  });
  it("is true while a ban is in force", () => {
    expect(isSuspended("2126-09-27T00:00:00.000Z", NOW)).toBe(true);
  });
  it("is false for garbage rather than inventing a ban", () => {
    expect(isSuspended("never", NOW)).toBe(false);
  });
});

describe("accessLabel", () => {
  it("shows suspension above everything, even a paying subscription", () => {
    expect(accessLabel({ source: "subscription", trialDaysLeft: null }, true)).toEqual({
      label: "Suspended",
      tone: "red",
    });
  });
  it("counts trial days and gets the plural right", () => {
    expect(accessLabel({ source: "trial", trialDaysLeft: 1 }, false).label).toBe(
      "Trial · 1 day left",
    );
    expect(accessLabel({ source: "trial", trialDaysLeft: 5 }, false).label).toBe(
      "Trial · 5 days left",
    );
  });
  it("names the card-model states", () => {
    expect(accessLabel({ source: "none", trialDaysLeft: null }, false).label).toBe("No card yet");
    expect(accessLabel({ source: "lapsed", trialDaysLeft: null }, false).label).toBe("Lapsed");
  });
  it("names comps and revokes plainly", () => {
    expect(accessLabel({ source: "override_grant", trialDaysLeft: null }, false).label).toBe(
      "Comped",
    );
    expect(accessLabel({ source: "override_revoke", trialDaysLeft: null }, false).label).toBe(
      "Revoked",
    );
  });
});

describe("matchesFilter", () => {
  it("files never-checked-out, lapsed and trialing accounts separately", () => {
    expect(matchesFilter(acct({ access: { entitled: false, source: "none" } }), "no_card")).toBe(
      true,
    );
    expect(matchesFilter(acct({ access: { entitled: false, source: "lapsed" } }), "lapsed")).toBe(
      true,
    );
    expect(matchesFilter(acct({ access: { entitled: false, source: "lapsed" } }), "no_card")).toBe(
      false,
    );
    expect(matchesFilter(acct({ access: { entitled: true, source: "trial" } }), "trial")).toBe(
      true,
    );
  });
  it("finds accounts with no profile row — the bug class behind the missing trials", () => {
    expect(matchesFilter(acct({ hasProfile: false }), "no_profile")).toBe(true);
    expect(matchesFilter(acct(), "no_profile")).toBe(false);
  });
  it("files a suspended account under Suspended, not its billing state", () => {
    const s = acct({ suspended: true, access: { entitled: true, source: "trial" } });
    expect(matchesFilter(s, "suspended")).toBe(true);
    expect(matchesFilter(s, "trial")).toBe(false);
    expect(matchesFilter(s, "no_profile")).toBe(false);
    expect(matchesFilter({ ...s, hasProfile: false }, "no_profile")).toBe(true);
  });
  it("'all' includes everyone", () => {
    expect(matchesFilter(acct({ suspended: true }), "all")).toBe(true);
  });
});

describe("parseFilter", () => {
  it("accepts a known key and falls back to 'all' for anything else", () => {
    expect(parseFilter("comped")).toBe("comped");
    expect(parseFilter("drop table")).toBe("all");
    expect(parseFilter(undefined)).toBe("all");
  });
});

describe("matchesQuery", () => {
  it("matches email and name case-insensitively", () => {
    expect(matchesQuery(acct(), "ATHLETE@")).toBe(true);
    expect(matchesQuery(acct(), "rivera")).toBe(true);
    expect(matchesQuery(acct(), "nobody")).toBe(false);
  });
  it("matches an exact user id", () => {
    expect(matchesQuery(acct(), "11111111-1111-1111-1111-111111111111")).toBe(true);
  });
  it("an empty query matches everything", () => {
    expect(matchesQuery(acct(), "   ")).toBe(true);
  });
  it("tolerates a missing name and email", () => {
    expect(matchesQuery(acct({ email: null, name: null }), "x")).toBe(false);
  });
});

describe("chunk", () => {
  it("splits into batches with a short tail", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });
  it("returns nothing for nothing", () => {
    expect(chunk([], 3)).toEqual([]);
  });
  it("refuses a non-positive size instead of looping forever", () => {
    expect(() => chunk([1], 0)).toThrow();
  });
});

describe("deleteConfirmationMatches", () => {
  it("requires the account's exact email, ignoring case and whitespace", () => {
    expect(deleteConfirmationMatches(" Athlete@Example.com ", "athlete@example.com")).toBe(true);
  });
  it("refuses a near miss", () => {
    expect(deleteConfirmationMatches("athlete@example.co", "athlete@example.com")).toBe(false);
  });
  it("refuses an empty entry, and an account with no email at all", () => {
    expect(deleteConfirmationMatches("", "athlete@example.com")).toBe(false);
    expect(deleteConfirmationMatches("", null)).toBe(false);
    expect(deleteConfirmationMatches("anything", null)).toBe(false);
  });
});

describe("isSelfLockout", () => {
  it("is true only for the administrator's own account", () => {
    expect(isSelfLockout("a", "a")).toBe(true);
    expect(isSelfLockout("a", "b")).toBe(false);
  });
});

describe("expiryFromDays", () => {
  it("is null for an open-ended grant", () => {
    expect(expiryFromDays(null, NOW)).toBeNull();
  });
  it("adds whole days", () => {
    expect(expiryFromDays(30, NOW)).toBe("2026-10-27T12:00:00.000Z");
  });
  it("refuses zero, negative and non-finite", () => {
    expect(() => expiryFromDays(0, NOW)).toThrow();
    expect(() => expiryFromDays(-3, NOW)).toThrow();
    expect(() => expiryFromDays(Number.NaN, NOW)).toThrow();
  });
});

describe("formatMoney", () => {
  it("formats minor units", () => {
    expect(formatMoney(1299, "usd")).toBe("$12.99");
    expect(formatMoney(0, "usd")).toBe("$0.00");
  });
});
