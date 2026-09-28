import { describe, expect, it } from "vitest";
import {
  completionNeeds,
  isGatedPath,
  needsCompletion,
  onlyTermsUpdate,
  safeNext,
} from "./account-completion";
import { TERMS_VERSION } from "./signup-checks";

// What /signup writes to the auth user today.
const signupForm = {
  first_name: "Sam",
  last_name: "Rivera",
  date_of_birth: "1995-04-02",
  age: 31,
  sex: "male",
  primary_sport: "hyrox",
  terms_accepted_at: "2026-09-28T12:00:00Z",
  terms_version: TERMS_VERSION,
};

describe("who has to finish their account", () => {
  it("someone who came through /signup today: nobody is stopped", () => {
    expect(needsCompletion(completionNeeds(signupForm))).toBe(false);
  });

  it("an account the admin made by hand: everything but the name, plus a password", () => {
    const n = completionNeeds({
      first_name: "New",
      last_name: "Person",
      full_name: "New Person",
      created_by_admin: true,
    });
    expect(n).toEqual({
      terms: true,
      termsUpdated: false,
      name: false,
      dob: true,
      sex: true,
      sport: true,
      password: true,
    });
  });

  it("…whose owner already chose a password through the emailed link is not asked again", () => {
    expect(
      completionNeeds({ first_name: "New", created_by_admin: true, password_set: true }).password,
    ).toBe(false);
  });

  it("a Google sign-in: a name and nothing else", () => {
    const n = completionNeeds({ full_name: "Jo Park", name: "Jo Park", email_verified: true });
    expect(n.name).toBe(false);
    expect(n.terms && n.dob && n.sex && n.sport).toBe(true);
    expect(n.password).toBe(false); // Google owns their login
  });

  it("an account older than the signup page: no metadata at all", () => {
    const n = completionNeeds({});
    expect(needsCompletion(n)).toBe(true);
    expect(n.name).toBe(true);
    expect(completionNeeds(null)).toEqual(n);
  });

  it("accepted an earlier Terms version: only the Terms step", () => {
    const n = completionNeeds({ ...signupForm, terms_version: "2026-09-13" });
    expect(needsCompletion(n)).toBe(true);
    expect(onlyTermsUpdate(n)).toBe(true);
    // Moving the constant is all it takes to ask everyone again.
    expect(needsCompletion(completionNeeds(signupForm, "2027-01-01"))).toBe(true);
  });

  it("junk values count as missing", () => {
    const n = completionNeeds({
      ...signupForm,
      date_of_birth: "04/02/1995",
      sex: "robot",
      primary_sport: "curling",
      terms_accepted_at: "  ",
    });
    expect(n.dob && n.sex && n.sport && n.terms).toBe(true);
  });
});

describe("where the gate applies", () => {
  it("the signed-in app", () => {
    for (const p of ["/dashboard", "/program/abc", "/setup", "/settings/email", "/onboarding"]) {
      expect(isGatedPath(p)).toBe(true);
    }
  });
  it("never the Terms themselves, auth, APIs, the admin, or the welcome step", () => {
    for (const p of [
      "/",
      "/terms",
      "/privacy",
      "/refunds",
      "/login",
      "/signup",
      "/auth/confirm",
      "/account/update-password",
      "/api/stripe/webhook",
      "/admin/users",
      "/welcome",
      "/dashboardish",
    ]) {
      expect(isGatedPath(p)).toBe(false);
    }
  });
  it("returns only to a path on this site", () => {
    expect(safeNext("/program/abc?week=2")).toBe("/program/abc?week=2");
    expect(safeNext("https://evil.example")).toBe("/setup");
    expect(safeNext("//evil.example")).toBe("/setup");
    expect(safeNext("/\\evil.example")).toBe("/setup");
    expect(safeNext("/welcome?next=/x")).toBe("/setup");
    expect(safeNext(undefined)).toBe("/setup");
  });
});
