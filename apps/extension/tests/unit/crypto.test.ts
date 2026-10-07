import { expect, it } from "vitest";
import {
  base64ToBytes,
  generateKeyPair,
  signEnvelope,
  verifyEnvelope,
} from "../../src/lib/crypto";

it("sign + verify round trip, raw 64-byte signature", async () => {
  const kp = await generateKeyPair();
  const json = JSON.stringify({ a: 1 });
  const sig = await signEnvelope(json, kp.privateJwk);
  expect(base64ToBytes(sig).length).toBe(64);
  expect(await verifyEnvelope(json, sig, kp.publicJwk)).toBe(true);
  expect(
    await verifyEnvelope(JSON.stringify({ a: 2 }), sig, kp.publicJwk),
  ).toBe(false);
});
