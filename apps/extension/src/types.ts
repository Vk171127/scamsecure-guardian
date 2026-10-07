export type Action = "allow" | "warn" | "hold" | "block";

export interface Intervention {
  body: string;
  question?: string;
  hold_seconds?: number;
}

export interface Decision {
  request_id?: string;
  action: Action;
  scam_type: string | null;
  confidence: number; // 0..1
  reasons?: { behaviour: string; label?: string }[];
  intervention?: Intervention;
}

export interface SignalEvent {
  behaviour: string;
  attrs: Record<string, unknown>;
  source: "laptop" | "phone";
  trust: number;
  ts: number;
}

export interface PaymentInfo {
  payeeAccount: string;
  amountMinor: number;
  currency: string;
  paymentId: string;
}

export type SignalValue = number | string | null;

export interface RiskEnvelope {
  v: 1;
  envelope_id: string;
  session_id: string;
  device_id: string;
  ts: number;
  nonce: string;
  payment_binding: string;
  signals: Record<string, SignalValue>;
  analyser: {
    scam_type: string | null;
    confidence_x100: number;
    warning_shown: 0 | 1;
    warning_ack: 0 | 1;
  };
}

export interface StoredSession {
  session_id: string;
  jwt: string;
  jwt_expires_at: number; // epoch ms
  pair_token?: string; // RAW pairing token. Kept only until the phone pairs.
  pair_url?: string; // the QR content
  pairing_expires_at?: number; // epoch ms
  created_at: number;
}

export type WsState = "closed" | "connecting" | "open";
