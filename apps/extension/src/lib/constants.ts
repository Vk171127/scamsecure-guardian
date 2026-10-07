export const FLUSH_INTERVAL_MS = 3000;
export const HESITATION_SECONDS = 45;
export const FAST_PAY_SECONDS = 5;
export const PAUSE_MINUTES = 15;

// Verify every entry before shipping. A legitimate bank domain missing here
// shows a false "fake bank" overlay.
export const BANK_DOMAINS: string[] = [
  "hdfcbank.com",
  "icicibank.com",
  "sbi.co.in",
  "onlinesbi.sbi",
  "axisbank.com",
  "kotak.com",
  "pnbindia.in",
  "bankofbaroda.in",
  "canarabank.com",
  "idfcfirstbank.com",
  "yesbank.in",
  "indusind.com",
  "mockbank.localhost", // dev only: remove before shipping
];

export const SCREEN_SHARE_APPS: string[] = [
  "meet.google.com",
  "zoom.us",
  "teams.microsoft.com",
  "webex.com",
  "whereby.com",
];
export const REMOTE_ACCESS_TOOLS: string[] = [
  "anydesk.com",
  "teamviewer.com",
  "rustdesk.com",
  "remotedesktop.google.com",
  "getscreen.me",
  "splashtop.com",
];

// Order matters: first match wins, so specific classes come before generic ones.
export const SCAM_PHRASES: { pattern: RegExp; class: string }[] = [
  { pattern: /digital\s*arrest/i, class: "digital_arrest" },
  { pattern: /safe\s*account/i, class: "safe_account" },
  { pattern: /\bcbi\b|\bcustoms\b|narcotics/i, class: "authority_cbi" },
  { pattern: /arrest|\bfir\b|complaint|\bwarrant\b/i, class: "arrest_threat" },
  {
    pattern: /\bkyc\b|account\s*(block|freez|suspend)|sim\s*(block|deactiv)/i,
    class: "kyc_expiry",
  },
  {
    pattern: /lottery|lucky\s*draw|\bprize\b|jackpot/i,
    class: "lottery_prize",
  },
  {
    pattern:
      /guaranteed\s*return|double\s*your|task\s*(payment|reward)|crypto\s*(invest|trading)/i,
    class: "investment_returns",
  },
  { pattern: /refund|cashback\s*claim|reversal/i, class: "refund_fee" },
];

export const SIGNAL_LABELS: Record<string, string> = {
  PASTE_PAYEE: "Account number was pasted, not typed",
  PASTE_AMOUNT: "Amount was pasted, not typed",
  SCAM_PHRASE_IN_REMARKS: "Remarks contain a known scam phrase",
  SCREEN_SHARE_LIKELY: "A screen-sharing app is open",
  REMOTE_ACCESS_TOOL_OPEN: "A remote-access tool is open",
  WHATSAPP_WEB_OPEN: "WhatsApp Web is open",
  HESITATION_LONG: "Long hesitation before paying",
  FAST_PAY: "Paid unusually fast",
  WEBDRIVER_DETECTED: "Browser is being automated",
  LOOKALIKE_DOMAIN: "Website address imitates a bank",
  HOMOGLYPH_DOMAIN: "Website address uses look-alike characters",
  CARD_OTP_FORM: "Page asks for card, CVV and OTP together",
  TAB_OPENED_BY_SCRIPT: "This tab was opened by another page",
};

export interface PaymentProfile {
  pay: string; // CSS selector for the Pay button
  payText?: RegExp; // optional extra check on the button label (generic profile)
  account: string;
  amount: string;
  remarks?: string;
  currency: string;
}

// One entry per bank. Real bank markup changes, so expect to maintain these.
export const PAYMENT_PROFILES: { host: string; profile: PaymentProfile }[] = [
  {
    host: "mockbank.localhost",
    profile: {
      pay: "#payBtn",
      account: "#account",
      amount: "#amount",
      remarks: "#remarks",
      currency: "INR",
    },
  },
];

// Fallback for bank hosts without a profile: guess by field names and button text.
export const GENERIC_PROFILE: PaymentProfile = {
  pay: "button, input[type=submit], [role=button]",
  payText:
    /^\s*(pay|pay now|make payment|confirm payment|transfer|send money|submit)\s*$/i,
  account:
    "input[name*=account i], input[id*=account i], input[name*=vpa i], input[id*=vpa i], input[name*=beneficiary i]",
  amount: "input[name*=amount i], input[id*=amount i]",
  remarks:
    "input[name*=remark i], input[id*=remark i], input[name*=narration i], textarea[name*=remark i]",
  currency: "INR",
};
