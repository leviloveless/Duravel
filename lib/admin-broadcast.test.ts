import { describe, expect, it } from "vitest";
import {
  BROADCAST_SEGMENTS,
  absoluteLink,
  broadcastKey,
  broadcastRecipients,
  isBroadcastId,
  parseBroadcast,
  postalAddressFrom,
  sendConfirmationMatches,
} from "./admin-broadcast";

const ok = {
  segment: "trial",
  subject: "  New:   race-week tapers ",
  body: "Hi all,\n\nWe shipped\nsomething.\r\n\r\n\r\nSecond para.",
  buttonLabel: "",
  buttonUrl: "",
};

describe("parseBroadcast", () => {
  it("normalizes subject and splits paragraphs on blank lines", () => {
    expect(parseBroadcast(ok)).toEqual({
      segment: "trial",
      subject: "New: race-week tapers",
      paragraphs: ["Hi all,", "We shipped something.", "Second para."],
      button: null,
    });
  });
  it("never offers suspended or revoked accounts as a segment", () => {
    const keys = BROADCAST_SEGMENTS.map((s) => s.key);
    expect(keys).not.toContain("suspended");
    expect(keys).not.toContain("revoked");
    expect(() => parseBroadcast({ ...ok, segment: "suspended" })).toThrow(/who it goes to/);
  });
  it("rejects an empty subject or message", () => {
    expect(() => parseBroadcast({ ...ok, subject: "a" })).toThrow(/subject/);
    expect(() => parseBroadcast({ ...ok, body: "short" })).toThrow(/sentence/);
  });
  it("a button needs both parts and a safe link", () => {
    expect(parseBroadcast({ ...ok, buttonLabel: "Open", buttonUrl: "/library" }).button).toEqual({
      label: "Open",
      url: "/library",
    });
    expect(() => parseBroadcast({ ...ok, buttonLabel: "Open" })).toThrow(/both/);
    expect(() =>
      parseBroadcast({ ...ok, buttonLabel: "x", buttonUrl: "javascript:alert(1)" }),
    ).toThrow(/https/);
    expect(() => parseBroadcast({ ...ok, buttonLabel: "x", buttonUrl: "http://x.com" })).toThrow(
      /https/,
    );
  });
  it("makes site paths absolute for the email", () => {
    expect(absoluteLink("/library", "https://duravel.app/")).toBe("https://duravel.app/library");
    expect(absoluteLink("https://x.com/a", "https://duravel.app")).toBe("https://x.com/a");
  });
});

const acct = (over: Record<string, unknown>) => ({
  id: "u",
  email: "a@b.com",
  name: null,
  hasProfile: true,
  suspended: false,
  emailConfirmed: true,
  access: { entitled: true, source: "trial" as const },
  ...over,
});

describe("broadcastRecipients", () => {
  it("skips suspended, unconfirmed and emailless accounts, whatever the segment", () => {
    const list = [
      acct({ id: "1" }),
      acct({ id: "2", suspended: true }),
      acct({ id: "3", emailConfirmed: false }),
      acct({ id: "4", email: null }),
      acct({ id: "5", access: { entitled: false, source: "none" } }),
    ];
    expect(broadcastRecipients(list, "all").map((a) => a.id)).toEqual(["1", "5"]);
    expect(broadcastRecipients(list, "trial").map((a) => a.id)).toEqual(["1"]);
  });
});

describe("guards", () => {
  it("sending needs the exact recipient count typed", () => {
    expect(sendConfirmationMatches("12", 12)).toBe(true);
    expect(sendConfirmationMatches("1,200", 1200)).toBe(true);
    expect(sendConfirmationMatches("yes", 12)).toBe(false);
    expect(sendConfirmationMatches("", 0)).toBe(false);
  });
  it("no plausible postal address, no sending", () => {
    expect(postalAddressFrom(undefined)).toBeNull();
    expect(postalAddressFrom("  TBD ")).toBeNull();
    expect(postalAddressFrom(" PO Box 123,\n Houston, TX 77002 ")).toBe(
      "PO Box 123, Houston, TX 77002",
    );
  });
  it("keys and ids", () => {
    expect(broadcastKey("b", "u")).toBe("broadcast:b:u");
    expect(isBroadcastId("12345678-1234-4234-8234-123456789012")).toBe(true);
    expect(isBroadcastId("x")).toBe(false);
  });
});
