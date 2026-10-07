import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { buildEnvelope } from "../../src/lib/envelope";
import type { Decision } from "../../src/types";

const payment = {
  payeeAccount: "1234567890",
  amountMinor: 400000,
  currency: "INR",
  paymentId: "pay_1",
};
const warn: Decision = {
  action: "warn",
  scam_type: "Digital Arrest Scam",
  confidence: 0.826,
};

describe("buildEnvelope", () => {
  it("payment_binding is sha256(payee|amount|currency|payment_id)", async () => {
    const env = await buildEnvelope(
      "s1",
      "d1",
      { PASTE_PAYEE: 1 },
      warn,
      payment,
    );
    expect(env.payment_binding).toBe(
      createHash("sha256").update("1234567890|400000|INR|pay_1").digest("hex"),
    );
  });
  it("has all required fields", async () => {
    const env = await buildEnvelope(
      "s1",
      "d1",
      { PASTE_PAYEE: 1 },
      warn,
      payment,
    );
    expect(env).toMatchObject({
      v: 1,
      session_id: "s1",
      device_id: "d1",
      signals: { PASTE_PAYEE: 1 },
    });
    expect(env.envelope_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(env.nonce).toMatch(/^[0-9a-f]{64}$/);
    expect(Number.isInteger(env.ts)).toBe(true);
  });
  it("maps the decision and the ack flag", async () => {
    const shown = await buildEnvelope("s", "d", {}, warn, payment, true);
    expect(shown.analyser).toEqual({
      scam_type: "Digital Arrest Scam",
      confidence_x100: 83,
      warning_shown: 1,
      warning_ack: 1,
    });
    const none = await buildEnvelope(
      "s",
      "d",
      {},
      { action: "allow", scam_type: null, confidence: 0 },
      payment,
      true,
    );
    expect(none.analyser).toMatchObject({ warning_shown: 0, warning_ack: 0 });
    expect(
      (await buildEnvelope("s", "d", {}, null, payment)).analyser.warning_shown,
    ).toBe(0);
  });
});
