import { GATEWAY_WS } from "../lib/config";

let ws: WebSocket | null = null;
let wanted = false;
let connecting = false;
let attempt = 0;
let reconnectTimer: number | undefined;
let pingTimer: number | undefined;
let pongTimer: number | undefined;

const send = (m: unknown) => chrome.runtime.sendMessage(m).catch(() => {});
const report = (state: string, code?: number) =>
  void send({ type: "WS_STATE", state, code });

async function requestToken(): Promise<string | null> {
  try {
    const r = await chrome.runtime.sendMessage({ type: "GET_TOKEN" });
    return r?.token ?? null;
  } catch {
    return null;
  }
}

function scheduleReconnect(): void {
  clearTimeout(reconnectTimer);
  const delay = Math.min(1000 * 2 ** attempt, 30_000); // 1s, 2s, 4s ... max 30s
  attempt += 1;
  reconnectTimer = window.setTimeout(() => void connect(), delay);
}

function drop(sock: WebSocket, code?: number): void {
  if (ws !== sock) return;
  ws = null;
  clearInterval(pingTimer);
  clearTimeout(pongTimer);
  try {
    sock.close();
  } catch {
    /* already closed */
  }
  report("closed", code);
  if (wanted) scheduleReconnect();
}

function startHeartbeat(sock: WebSocket): void {
  clearInterval(pingTimer);
  pingTimer = window.setInterval(() => {
    if (sock.readyState !== WebSocket.OPEN) return;
    sock.send(JSON.stringify({ type: "ping" }));
    clearTimeout(pongTimer);
    pongTimer = window.setTimeout(() => drop(sock), 5000); // no pong in 5s: reconnect
  }, 20_000);
}

async function connect(): Promise<void> {
  if (!wanted || connecting || (ws && ws.readyState <= WebSocket.OPEN)) return;
  connecting = true;
  report("connecting");
  const token = await requestToken(); // fresh JWT every time (15 min lifetime)
  connecting = false;
  if (!token) {
    report("closed");
    scheduleReconnect();
    return;
  }
  const sock = new WebSocket(
    `${GATEWAY_WS}?token=${encodeURIComponent(token)}`,
  );
  ws = sock;
  sock.onopen = () => {
    attempt = 0;
    report("open");
    startHeartbeat(sock);
  };
  sock.onmessage = (ev) => {
    clearTimeout(pongTimer);
    let msg: any;
    try {
      msg = JSON.parse(ev.data);
    } catch {
      return;
    }
    if (msg.type === "pong") return;
    if (msg.type === "DECISION")
      void send({ type: "DECISION", payload: msg.payload ?? msg });
    else void send({ type: "WS_MESSAGE", payload: msg });
  };
  sock.onclose = (ev) => drop(sock, ev.code);
  sock.onerror = () => {}; // onclose always follows
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.target !== "offscreen") return;
  if (msg.type === "WS_CONNECT") {
    wanted = true;
    if (msg.force && ws) {
      const old = ws;
      ws = null;
      old.close();
    }
    void connect();
  } else if (msg.type === "WS_SEND") {
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg.payload));
  } else if (msg.type === "WS_CLOSE") {
    wanted = false;
    clearTimeout(reconnectTimer);
    ws?.close();
    ws = null;
    report("closed");
  }
});

void send({ type: "OFFSCREEN_READY" });
