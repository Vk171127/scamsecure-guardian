const ALG = { name: "ECDSA", namedCurve: "P-256" } as const;
const SIG = { name: "ECDSA", hash: "SHA-256" } as const;

export interface KeyPairJwk {
  publicJwk: JsonWebKey;
  privateJwk: JsonWebKey;
}

// Newer TypeScript types Uint8Array as possibly SharedArrayBuffer-backed;
// WebCrypto only accepts ArrayBuffer-backed arrays, so these return that type.
const enc = (s: string): Uint8Array<ArrayBuffer> =>
  new TextEncoder().encode(s) as Uint8Array<ArrayBuffer>;

export function bytesToBase64(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

export function base64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

export async function generateKeyPair(): Promise<KeyPairJwk> {
  const kp = await crypto.subtle.generateKey(ALG, true, ["sign", "verify"]);
  return {
    publicJwk: await crypto.subtle.exportKey("jwk", kp.publicKey),
    privateJwk: await crypto.subtle.exportKey("jwk", kp.privateKey),
  };
}

/** Signs any string. Returns base64 of raw r||s (64 bytes), the WebCrypto ECDSA format. */
export async function signEnvelope(
  text: string,
  privateJwk: JsonWebKey,
): Promise<string> {
  const key = await crypto.subtle.importKey("jwk", privateJwk, ALG, false, [
    "sign",
  ]);
  const sig = await crypto.subtle.sign(SIG, key, enc(text));
  return bytesToBase64(new Uint8Array(sig));
}

export async function verifyEnvelope(
  text: string,
  signatureB64: string,
  publicJwk: JsonWebKey,
): Promise<boolean> {
  const key = await crypto.subtle.importKey("jwk", publicJwk, ALG, false, [
    "verify",
  ]);
  return crypto.subtle.verify(SIG, key, base64ToBytes(signatureB64), enc(text));
}
