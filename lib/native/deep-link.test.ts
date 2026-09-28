import { describe, expect, it } from "vitest";
import { appAuthRedirect, isNativeApp, webUrlForDeepLink } from "./deep-link";

describe("links into the iPhone app", () => {
  it("brings an OAuth return back to /auth/confirm on duravel.app, code and all", () => {
    expect(webUrlForDeepLink("duravel://auth/confirm?next=%2Fsetup&code=abc-123")).toBe(
      "https://duravel.app/auth/confirm?next=%2Fsetup&code=abc-123",
    );
  });

  it("round-trips the redirect it hands Supabase", () => {
    const back = `${appAuthRedirect("/dashboard")}&code=xyz`;
    expect(webUrlForDeepLink(back)).toBe(
      "https://duravel.app/auth/confirm?next=%2Fdashboard&code=xyz",
    );
  });

  it("opens a Universal Link at the same path", () => {
    expect(
      webUrlForDeepLink("https://duravel.app/auth/confirm?token_hash=t&type=email&next=/setup"),
    ).toBe("https://duravel.app/auth/confirm?token_hash=t&type=email&next=/setup");
    expect(webUrlForDeepLink("https://duravel.app/program/abc")).toBe(
      "https://duravel.app/program/abc",
    );
  });

  it("never sends the web view to another host", () => {
    for (const raw of [
      "https://evil.example/auth/confirm?code=1",
      "http://duravel.app/dashboard",
      "https://duravel.app.evil.example/x",
      "duravel:////evil.example/x",
      "otherapp://auth/confirm?code=1",
      "javascript:alert(1)",
      "not a url",
      "",
    ]) {
      const out = webUrlForDeepLink(raw);
      if (out !== null) expect(new URL(out).origin).toBe("https://duravel.app");
    }
    expect(webUrlForDeepLink("https://evil.example/auth/confirm?code=1")).toBeNull();
    expect(webUrlForDeepLink("otherapp://auth/confirm")).toBeNull();
  });

  it("is not the app outside Capacitor", () => {
    expect(isNativeApp()).toBe(false);
  });
});
