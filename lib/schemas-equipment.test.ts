import { describe, it, expect } from "vitest";
import { Equipment, ProfileSchema } from "./schemas";

const baseProfile = {
  firstName: "Levi", age: 30, bodyWeight: 180, weightUnit: "lbs",
  runningExp: "intermediate", hybridExp: "intermediate", liftingExp: "intermediate",
  trainingClass: "non_highly_trained", trainingDays: ["mon", "wed", "fri"],
};

describe("Equipment + currentDaysPerWeek on ProfileSchema", () => {
  it("Equipment enum has the expected keys", () => {
    expect(Equipment.options).toContain("barbell");
    expect(Equipment.options).toContain("ski_erg");
    expect(Equipment.options).toContain("bodyweight_only");
  });
  it("accepts a profile with equipment + currentDaysPerWeek", () => {
    const r = ProfileSchema.safeParse({ ...baseProfile, equipment: ["barbell", "rower"], currentDaysPerWeek: 4 });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.equipment).toEqual(["barbell", "rower"]);
      expect(r.data.currentDaysPerWeek).toBe(4);
    }
  });
  it("still accepts a profile WITHOUT the new fields (back-compat)", () => {
    expect(ProfileSchema.safeParse(baseProfile).success).toBe(true);
  });
  it("rejects an invalid equipment value and out-of-range days", () => {
    expect(ProfileSchema.safeParse({ ...baseProfile, equipment: ["moon_boots"] }).success).toBe(false);
    expect(ProfileSchema.safeParse({ ...baseProfile, currentDaysPerWeek: 9 }).success).toBe(false);
  });
});
