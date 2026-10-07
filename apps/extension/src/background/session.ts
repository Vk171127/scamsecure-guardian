import { GATEWAY_HTTP } from "../lib/config";
import { generateKeyPair, signEnvelope, type KeyPairJwk } from "../lib/crypto";
import type { StoredSession } from "../types";

const FAIL_COOLDOWN_MS = 15_000;
const REFRESH_MARGIN_MS = 60_000;
const DEFAULT_JWT_TTL_S = 900; // 15 min, used if the Gateway omits jwt_expires_in

let inflight: Promise<StoredSession | null> | null = null;
let refreshing: Promise<string | null> | null = null;
let lastFailAt = 0;

// ---------------------------------------------------------------------------
// GATEWAY CONTRACT (assumed). Change only this block when the real API exists.
// ---------------------------------------------------------------------------
async function api(
  path: string,
  opts: { jwt?: string; body?: unknown } = {},
): Promise<any> {
  const res = await fetch(`${GATEWAY_HTTP}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(opts.jwt ? { Authorization: `Bearer ${opts.jwt}` } : {}),
    },
    body: JSON.stringify(opts.body ?? {}),
    signal: AbortSignal.timeout(3000),
  });
  if (!res.ok)
    throw Object.assign(new Error(`gateway ${res.status}`), {
      status: res.status,
    });
  return res.json();
}

const createSessionCall = (body: unknown) => api("/v1/sessions", { body });
const refreshCall = (id: string, body: unknown) =>
  api(`/v1/sessions/${encodeURIComponent(id)}/refresh`, { body });
const pairingTokenCall = (id: string, jwt: string) =>
  api(`/v1/sessions/${encodeURIComponent(id)}/pairing-token`, { jwt });
const refreshMessage = (id: string, device: string, ts: number) =>
  `refresh|${id}|${device}|${ts}`;
// ---------------------------------------------------------------------------

function merge(data: any, prev?: StoredSession): StoredSession {
  const now = Date.now();
  return {
    session_id: data.session_id ?? prev!.session_id,
    jwt: data.jwt ?? prev!.jwt,
    jwt_expires_at: data.jwt
      ? now + (data.jwt_expires_in ?? DEFAULT_JWT_TTL_S) * 1000
      : prev!.jwt_expires_at,
    pair_token: data.pair_token ?? prev?.pair_token,
    pair_url: data.pair_url ?? prev?.pair_url,
    pairing_expires_at: data.pair_token
      ? now + (data.pairing_expires_in ?? 300) * 1000
      : prev?.pairing_expires_at,
    created_at: prev?.created_at ?? now,
  };
}

export async function getDeviceId(): Promise<string> {
  const { device_id } = await chrome.storage.local.get("device_id");
  if (device_id) return device_id as string;
  const id = crypto.randomUUID();
  await chrome.storage.local.set({ device_id: id });
  return id;
}

// Key pair lives in storage.session (cleared on browser close), as the spec says.
export async function getKeys(): Promise<KeyPairJwk> {
  const { keypair } = await chrome.storage.session.get("keypair");
  if (keypair) return keypair as KeyPairJwk;
  const kp = await generateKeyPair();
  await chrome.storage.session.set({ keypair: kp });
  return kp;
}

export async function getSession(): Promise<StoredSession | null> {
  const { session } = await chrome.storage.session.get("session");
  return (session as StoredSession | undefined) ?? null;
}

export async function clearSession(): Promise<void> {
  await chrome.storage.session.remove([
    "session",
    "keypair",
    "peer",
    "ws_state",
  ]);
}

export function ensureSession(): Promise<StoredSession | null> {
  if (inflight) return inflight;
  const p = (async () => {
    const existing = await getSession();
    if (existing) return existing;
    if (Date.now() - lastFailAt < FAIL_COOLDOWN_MS) return null;
    try {
      const keys = await getKeys();
      const data = await createSessionCall({
        device_id: await getDeviceId(),
        client: "extension",
        version: chrome.runtime.getManifest().version,
        public_key: keys.publicJwk,
      });
      const session = merge(data);
      await chrome.storage.session.set({ session });
      return session;
    } catch (e) {
      lastFailAt = Date.now();
      console.warn("[ScamSecure] session create failed", e);
      return null;
    }
  })();
  inflight = p;
  void p.finally(() => {
    inflight = null;
  });
  return p;
}

/** Returns a JWT that is valid for at least a minute, refreshing it (same session_id) if needed. */
export function getValidJwt(): Promise<string | null> {
  if (refreshing) return refreshing;
  const p = (async () => {
    const s = await getSession();
    if (!s) return null;
    if (s.jwt_expires_at - Date.now() > REFRESH_MARGIN_MS) return s.jwt;
    try {
      const keys = await getKeys();
      const device = await getDeviceId();
      const ts = Math.floor(Date.now() / 1000);
      const signature = await signEnvelope(
        refreshMessage(s.session_id, device, ts),
        keys.privateJwk,
      );
      const data = await refreshCall(s.session_id, {
        device_id: device,
        ts,
        signature,
      });
      const next = merge(data, s);
      await chrome.storage.session.set({ session: next });
      return next.jwt;
    } catch (e) {
      const status = (e as { status?: number }).status;
      if (status === 401 || status === 403 || status === 404)
        await clearSession(); // session is gone: next ensureSession() starts a new one
      return null;
    }
  })();
  refreshing = p;
  void p.finally(() => {
    refreshing = null;
  });
  return p;
}

/** "Refresh QR" button: new raw pairing token for the same session. */
export async function refreshPairingToken(): Promise<StoredSession | null> {
  const jwt = await getValidJwt();
  const s = await getSession();
  if (!jwt || !s) return null;
  try {
    const next = merge(await pairingTokenCall(s.session_id, jwt), s);
    await chrome.storage.session.set({ session: next });
    return next;
  } catch {
    return null;
  }
}

/** Called when the Gateway reports the phone joined: drop the raw pairing token. */
export async function markPaired(): Promise<void> {
  const s = await getSession();
  if (!s) return;
  const { pair_token, pair_url, pairing_expires_at, ...rest } = s;
  await chrome.storage.session.set({ session: rest });
}
