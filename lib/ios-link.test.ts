import { describe, expect, it } from "vitest";
import { appleUrl, iosDestination } from "./ios-link";

describe("duravel.app/ios", () => {
  it("forwards to the App Store once it is set", () => {
    expect(
      iosDestination(
        "https://apps.apple.com/us/app/duravel/id123",
        "https://testflight.apple.com/join/X",
      ),
    ).toEqual({ kind: "app_store", url: "https://apps.apple.com/us/app/duravel/id123" });
  });
  it("offers the beta when only TestFlight is set", () => {
    expect(iosDestination("", "https://testflight.apple.com/join/AbC")).toEqual({
      kind: "testflight",
      url: "https://testflight.apple.com/join/AbC",
    });
  });
  it("takes a waitlist email when neither is set", () => {
    expect(iosDestination(undefined, undefined)).toEqual({ kind: "waitlist" });
  });
  it("never sends people to a non-Apple or non-https address", () => {
    expect(appleUrl("http://apps.apple.com/x")).toBeNull();
    expect(appleUrl("https://apps.apple.com.evil.example/x")).toBeNull();
    expect(appleUrl("https://example.com")).toBeNull();
    expect(appleUrl("not a url")).toBeNull();
    expect(iosDestination("https://evil.example", null)).toEqual({ kind: "waitlist" });
  });
});
