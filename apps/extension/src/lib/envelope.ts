import type {
  Decision,
  PaymentInfo,
  RiskEnvelope,
  SignalValue,
} from "../types";

const hex = (bytes: Uint8Array): string =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

export async function sha256Hex(text: string): Promise<string> {
  return hex(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)),
    ),
  );
}

export const randomHex = (bytes = 32): string =>
  hex(crypto.getRandomValues(new Uint8Array(bytes)));

export function paymentBinding(p: PaymentInfo): Promise<string> {
  return sha256Hex(
    `${p.payeeAccount}|${p.amountMinor}|${p.currency}|${p.paymentId}`,
  );
}

export async function buildEnvelope(
  sessionId: string,
  deviceId: string,
  signals: Record<string, SignalValue>,
  analyserDecision: Decision | null,
  payment: PaymentInfo,
  warningAck = false,
): Promise<RiskEnvelope> {
  const shown = !!analyserDecision && analyserDecision.action !== "allow";
  return {
    v: 1,
    envelope_id: crypto.randomUUID(),
    session_id: sessionId,
    device_id: deviceId,
    ts: Math.floor(Date.now() / 1000),
    nonce: randomHex(32), // 32 bytes = 64 hex chars
    payment_binding: await paymentBinding(payment),
    signals,
    analyser: {
      scam_type: analyserDecision?.scam_type ?? null,
      confidence_x100: Math.round((analyserDecision?.confidence ?? 0) * 100),
      warning_shown: shown ? 1 : 0,
      warning_ack: shown && warningAck ? 1 : 0,
    },
  };
}
