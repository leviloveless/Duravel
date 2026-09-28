import { describe, expect, it } from "vitest";
import { mfaSatisfied } from "./admin";
import { isAdminIdentity } from "./admin-access";

const LIST = "levi.loveless@duravel.app";
const CONFIRMED = "2026-09-01T00:00:00.000Z";

describe("isAdminIdentity — allowlist AND a confirmed email", () => {
  it("admits the administrator with a confirmed email, any capitalization", () => {
    expect(isAdminIdentity(LIST, "levi.loveless@duravel.app", CONFIRMED)).toBe(true);
    expect(isAdminIdentity(LIST, " Levi.Loveless@Duravel.app ", CONFIRMED)).toBe(true);
  });

  it("refuses the right address when it is NOT confirmed", () => {
    // Were email confirmation ever switched off in Supabase, anyone could
    // register this address; confirmation ties the gate to the inbox.
    for (const c of [null, undefined, ""]) expect(isAdminIdentity(LIST, LIST, c)).toBe(false);
  });

  it("refuses look-alikes a substring match would let in", () => {
    for (const email of [
      "levi.loveless@duravel.app.attacker.com",
      "xlevi.loveless@duravel.app",
      "levi.loveless@duravel.apps",
      "levi.loveless+admin@duravel.app",
      "levi_loveless@duravel.app",
    ]) {
      expect(isAdminIdentity(LIST, email, CONFIRMED), email).toBe(false);
    }
  });

  it("admits nobody when ADMIN_EMAILS is unset — the gate fails closed", () => {
    expect(isAdminIdentity(undefined, "levi.loveless@duravel.app", CONFIRMED)).toBe(false);
    expect(isAdminIdentity("", "levi.loveless@duravel.app", CONFIRMED)).toBe(false);
  });
});

describe("mfaSatisfied", () => {
  it("accepts only a session that has verified a second factor", () => {
    expect(mfaSatisfied("aal2")).toBe(true);
    for (const l of ["aal1", null, undefined, "AAL2", "aal3"]) expect(mfaSatisfied(l)).toBe(false);
  });
});
