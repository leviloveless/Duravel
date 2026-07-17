import { describe, it, expect } from "vitest";
import { mintUnsubToken, verifyUnsubToken } from "./unsubscribe";

const SECRET = "test-secret-key";
const U = "22222222-2222-2222-2222-222222222222";

describe("unsubscribe HMAC tokens", () => {
  it("round-trips a category token", () => {
    const t = mintUnsubToken({ userId: U, category: "onboarding", issuedAt: 1000 }, SECRET);
    expect(verifyUnsubToken(t, SECRET)).toEqual({
      userId: U,
      category: "onboarding",
      issuedAt: 1000,
    });
  });

  it("round-trips a global (null-category) token", () => {
    const t = mintUnsubToken({ userId: U, category: null, issuedAt: 2000 }, SECRET);
    expect(verifyUnsubToken(t, SECRET)).toEqual({ userId: U, category: null, issuedAt: 2000 });
  });

  it("rejects a token signed with a different secret", () => {
    const t = mintUnsubToken({ userId: U, category: "race", issuedAt: 3000 }, SECRET);
    expect(verifyUnsubToken(t, "other-secret")).toBeNull();
  });

  it("rejects a tampered payload", () => {
    const t = mintUnsubToken({ userId: U, category: "race", issuedAt: 3000 }, SECRET);
    const tampered = "x" + t.slice(1);
    expect(verifyUnsubToken(tampered, SECRET)).toBeNull();
  });

  it("rejects malformed input", () => {
    expect(verifyUnsubToken("garbage", SECRET)).toBeNull();
    expect(verifyUnsubToken(".", SECRET)).toBeNull();
    expect(verifyUnsubToken("", SECRET)).toBeNull();
  });

  it("honors max age when provided", () => {
    const issuedAt = 10_000;
    const t = mintUnsubToken({ userId: U, category: null, issuedAt }, SECRET);
    // 2h later, 1h max age → expired
    expect(verifyUnsubToken(t, SECRET, { maxAgeMs: 3_600_000, nowMs: issuedAt + 7_200_000 })).toBeNull();
    // within max age → ok
    expect(
      verifyUnsubToken(t, SECRET, { maxAgeMs: 3_600_000, nowMs: issuedAt + 60_000 }),
    ).not.toBeNull();
  });
});
