import type { SignalEvent } from "../types";

const TRUST: Record<string, number> = {
  PASTE_PAYEE: 0.9,
  PASTE_AMOUNT: 0.9,
  SCAM_PHRASE_IN_REMARKS: 0.85,
  SCREEN_SHARE_LIKELY: 0.6,
  REMOTE_ACCESS_TOOL_OPEN: 0.7,
  WHATSAPP_WEB_OPEN: 0.5,
  HESITATION_LONG: 0.5,
  FAST_PAY: 0.5,
  WEBDRIVER_DETECTED: 0.6,
  LOOKALIKE_DOMAIN: 0.95,
  HOMOGLYPH_DOMAIN: 0.95,
  CARD_OTP_FORM: 0.8,
  TAB_OPENED_BY_SCRIPT: 0.3,
};

export function makeSignal(
  behaviour: string,
  attrs: Record<string, unknown> = {},
): SignalEvent {
  return {
    behaviour,
    attrs,
    source: "laptop",
    trust: TRUST[behaviour] ?? 0.7,
    ts: Date.now(),
  };
}
