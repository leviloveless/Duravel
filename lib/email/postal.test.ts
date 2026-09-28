import { describe, expect, it } from "vitest";
import { footerAddress, postalAddressFrom } from "./postal";
import { MAILING_ADDRESS } from "./templates/styles";

describe("one footer address for every email", () => {
  it("the configured address wins when it is usable", () => {
    expect(footerAddress("PO Box 123, Houston, TX 77002", MAILING_ADDRESS)).toBe(
      "PO Box 123, Houston, TX 77002",
    );
  });
  it("otherwise the address the templates have always carried", () => {
    expect(footerAddress(undefined, MAILING_ADDRESS)).toBe(MAILING_ADDRESS);
    expect(footerAddress("  ", MAILING_ADDRESS)).toBe(MAILING_ADDRESS);
    expect(footerAddress("TBD", MAILING_ADDRESS)).toBe(MAILING_ADDRESS);
  });
  it("normalizes whitespace", () => {
    expect(postalAddressFrom(" 1 Main St,\n  Austin, TX ")).toBe("1 Main St, Austin, TX");
  });
});
