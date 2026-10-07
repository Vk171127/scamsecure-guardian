import { DECISION_TIMEOUT_MS } from "../lib/config";
import { signEnvelope } from "../lib/crypto";
import { buildEnvelope, paymentBinding } from "../lib/envelope";
import type { Decision, PaymentInfo, SignalEvent, SignalValue } from "../types";
import {
  connectGateway,
  createOffscreenIfNeeded,
  getWsState,
  postSignals,
  wsSend,
} from "./gateway";
import {
  ensureSession,
  getDeviceId,
  getKeys,
  getSession,
  getValidJwt,
  markPaired,
  refreshPairingToken,
} from "./session";
import { collectTabSignals, forgetTab, markTabAsScripted } from "./tabs";

const pending = new Map<string, (d: Decision | null) => void>();
const ALLOW: Decision = { action: "allow", scam_type: null, confidence: 0 };
type ActiveSignal = { behaviour: string; at: number };

chrome.runtime.onInstalled.addListener(() => void createOffscreenIfNeeded());
chrome.runtime.onStartup.addListener(() => void createOffscreenIfNeeded());
chrome.tabs.onCreated.addListener((tab) => {
  if (tab.id != null && tab.openerTabId != null) void markTabAsScripted(tab.id);
});
chrome.tabs.onRemoved.addListener((id) => void forgetTab(id));

async function isPaused(): Promise<boolean> {
  const { paused_until } = await chrome.storage.session.get("paused_until");
  return typeof paused_until === "number" && paused_until > Date.now();
}

const numericAttr = (s: SignalEvent): number =>
  typeof s.attrs.seconds === "number"
    ? s.attrs.seconds
    : typeof s.attrs.confidence_x100 === "number"
      ? s.attrs.confidence_x100
      : 1;

// active_signals feeds the popup; signal_window feeds the signed envelope.
async function recordSignals(signals: SignalEvent[]): Promise<void> {
  if (!signals.length) return;
  const stored = await chrome.storage.session.get([
    "active_signals",
    "signal_window",
  ]);
  const active = (stored.active_signals ?? []) as ActiveSignal[];
  const win: Record<string, SignalValue> = {
    ...((stored.signal_window ?? {}) as Record<string, SignalValue>),
  };
  for (const s of signals) win[s.behaviour] = numericAttr(s);
  const act = [
    ...signals.map((s) => ({ behaviour: s.behaviour, at: s.ts })),
    ...active,
  ]
    .filter(
      (x, i, arr) => arr.findIndex((y) => y.behaviour === x.behaviour) === i,
    )
    .slice(0, 10);
  await chrome.storage.session.set({ active_signals: act, signal_window: win });
}
async function storeDecision(d: Decision): Promise<void> {
  await chrome.storage.session.set({
    last_decision: { action: d.action, scam_type: d.scam_type, at: Date.now() },
  });
}

async function onSignalBatch(
  signals: SignalEvent[],
  sender: chrome.runtime.MessageSender,
) {
  if (await isPaused()) return { paused: true };
  const session = await getSession();
  if (!session) {
    void connectGateway(); // creates the session; these signals are dropped, the next batch will go through
    return { sent: 0 };
  }
  const all = [
    ...(signals ?? []),
    ...(await collectTabSignals(sender.tab?.id, true)),
  ];
  await recordSignals(all);
  if ((await getWsState()) === "open") {
    await wsSend({
      type: "SIGNAL_BATCH",
      session_id: session.session_id,
      signals: all,
      ts: Date.now(),
    });
  } else {
    await postSignals(session, all);
  }
  return { sent: all.length };
}

async function onPayIntercepted(
  msg: { signals?: SignalEvent[]; payment: PaymentInfo },
  sender: chrome.runtime.MessageSender,
) {
  if (await isPaused()) return { decision: ALLOW };
  const session = await getSession();
  if (!session) {
    void connectGateway();
    return { decision: null }; // no session yet: fail open
  }
  const signals = [
    ...(msg.signals ?? []),
    ...(await collectTabSignals(sender.tab?.id, false)),
  ];
  await recordSignals(signals);
  const [binding, deviceId] = await Promise.all([
    paymentBinding(msg.payment),
    getDeviceId(),
  ]);
  const request_id = crypto.randomUUID();
  const budget = Math.max(DECISION_TIMEOUT_MS - 20, 50);
  let decision: Decision | null;
  if ((await getWsState()) === "open") {
    const waiting = new Promise<Decision | null>((resolve) => {
      pending.set(request_id, resolve);
      setTimeout(() => {
        if (pending.delete(request_id)) resolve(null);
      }, budget);
    });
    await wsSend({
      type: "PAY_INTERCEPTED",
      request_id,
      session_id: session.session_id,
      device_id: deviceId,
      payment_binding: binding,
      signals,
      ts: Date.now(),
    });
    decision = await waiting;
  } else {
    decision = await postSignals(
      session,
      signals,
      { request_id, device_id: deviceId, pay: { payment_binding: binding } },
      budget,
    );
  }
  if (decision) await storeDecision(decision);
  return { decision };
}

async function onBuildEnvelope(msg: {
  payment: PaymentInfo;
  decision: Decision | null;
  warning_ack?: boolean;
}) {
  const session = await getSession();
  if (!session) return { envelope_json: null };
  const keys = await getKeys(); // the private key never leaves the service worker
  const stored = await chrome.storage.session.get("signal_window");
  const signal_window = (stored.signal_window ?? {}) as Record<
    string,
    SignalValue
  >;
  const env = await buildEnvelope(
    session.session_id,
    await getDeviceId(),
    signal_window,
    msg.decision ?? null,
    msg.payment,
    !!msg.warning_ack,
  );
  const envelope_json = JSON.stringify(env); // sign and send these exact bytes
  const signature = await signEnvelope(envelope_json, keys.privateJwk);
  await chrome.storage.session.remove("signal_window");
  return { envelope_json, signature };
}

async function onDecision(d: Decision): Promise<void> {
  if (!d) return;
  const id = d.request_id ?? [...pending.keys()].at(-1); // fallback if the Gateway forgets to echo request_id
  const resolve = id ? pending.get(id) : undefined;
  if (id && resolve) {
    pending.delete(id);
    resolve(d);
  }
  await storeDecision(d);
}

async function onWsMessage(p: {
  type?: string;
  phone?: boolean;
}): Promise<void> {
  if (p?.type === "PEER_STATUS") {
    await chrome.storage.session.set({ peer: { phone: !!p.phone } });
    if (p.phone) await markPaired();
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.target === "offscreen") return false;
  const reply = (p: Promise<unknown>) => {
    p.then(sendResponse).catch((e) => sendResponse({ error: String(e) }));
    return true; // async response
  };
  switch (msg.type) {
    case "BANK_PAGE_LOADED":
    case "ENSURE_SESSION":
      return reply(connectGateway().then(() => ({ ok: true })));
    case "SIGNAL_BATCH":
      return reply(onSignalBatch(msg.signals, sender));
    case "PAY_INTERCEPTED":
      return reply(onPayIntercepted(msg, sender));
    case "BUILD_ENVELOPE":
      return reply(onBuildEnvelope(msg));
    case "PAY_OUTCOME":
      return reply(
        wsSend({
          type: "PAY_OUTCOME",
          outcome: msg.outcome,
          ts: Date.now(),
        }).then(() => ({ ok: true })),
      );
    case "GET_SESSION":
      return reply(getSession());
    case "GET_TOKEN": // offscreen asks before every (re)connect
      return reply(
        ensureSession()
          .then(() => getValidJwt())
          .then((token) => ({ token })),
      );
    case "REFRESH_PAIRING":
      return reply(refreshPairingToken().then((s) => ({ ok: !!s })));
    case "OFFSCREEN_READY":
      void connectGateway();
      return false;
    case "WS_STATE":
      void chrome.storage.session.set({ ws_state: msg.state });
      return false;
    case "WS_MESSAGE":
      void onWsMessage(msg.payload);
      return false;
    case "DECISION":
      void onDecision(msg.payload);
      return false;
    default:
      return false;
  }
});
