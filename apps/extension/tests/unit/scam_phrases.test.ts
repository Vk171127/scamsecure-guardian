import { expect, it } from "vitest";
import { scamPhraseClass } from "../../src/lib/detect";

it("classifies scam phrases", () => {
  expect(scamPhraseClass("please move to safe account")).toBe("safe_account");
  expect(scamPhraseClass("CBI officer on the line")).toBe("authority_cbi");
  expect(scamPhraseClass("FIR registered against you")).toBe("arrest_threat");
  expect(scamPhraseClass("arrest warrant issued")).toBe("arrest_threat");
  expect(scamPhraseClass("digital arrest")).toBe("digital_arrest");
  expect(scamPhraseClass("update KYC now")).toBe("kyc_expiry");
});

it("does not fire on normal words", () => {
  expect(scamPhraseClass("first payment, please confirm")).toBeNull();
  expect(scamPhraseClass("extended warranty")).toBeNull();
  expect(scamPhraseClass("rent for October")).toBeNull();
});
