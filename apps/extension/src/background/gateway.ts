import { GATEWAY_HTTP } from "../lib/config";
import type { Decision, SignalEvent, StoredSession, WsState } from "../types";
import { ensureSession, getValidJwt } from "./session";

let creating: Promise<void> | null = null;

export async function createOffscreenIfNeeded(): Promise<void> {
  const existing = await chrome.runtime.getContexts({
    contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
  });
  if (existing.length > 0) return;
  if (!creating) {
    creating = chrome.offscreen
      .createDocument({
        url: "background/offscreen.html",
        reasons: [chrome.offscreen.Reason.WORKERS],
        justification:
          "Keep a WebSocket to the ScamSecure Gateway open while the service worker sleeps",
      })
      .finally(() => {
        creating = null;
      });
  }
  await creating;
}

export async function getWsState(): Promise<WsState> {
  const { ws_state } = await chrome.storage.session.get("ws_state");
  return (ws_state as WsState) ?? "closed";
}

/** Make sure a session exists, the offscreen document is up, and it is told to connect. */
export async function connectGateway(force = false): Promise<void> {
  if (!(await ensureSession())) return;
  await createOffscreenIfNeeded();
  chrome.runtime
    .sendMessage({ target: "offscreen", type: "WS_CONNECT", force })
    .catch(() => {});
}

export async function wsSend(payload: unknown): Promise<void> {
  await createOffscreenIfNeeded();
  chrome.runtime
    .sendMessage({ target: "offscreen", type: "WS_SEND", payload })
    .catch(() => {});
}

/** HTTP fallback when the WebSocket is down. Pay checks get their decision in the response. */
export async function postSignals(
  session: StoredSession,
  signals: SignalEvent[],
  extra: Record<string, unknown> = {},
  timeoutMs = 3000,
): Promise<Decision | null> {
  const jwt = await getValidJwt();
  if (!jwt) return null;
  try {
    const res = await fetch(`${GATEWAY_HTTP}/v1/signals`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${jwt}`,
      },
      body: JSON.stringify({
        session_id: session.session_id,
        signals,
        ...extra,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return null;
    const data = await res.json().catch(() => null);
    return (data?.decision as Decision | null) ?? null;
  } catch {
    return null;
  }
}
