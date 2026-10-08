"""Dev/test STUB of the Gateway (GW-01). Not the real backend. Run: python gateway_mock.py

Serves the laptop extension AND the phone PWA:
  extension: /v1/sessions, /v1/sessions/{id}/refresh, /v1/sessions/{id}/pairing-token, /v1/signals, WS /v1/ws
  phone PWA: /v1/sessions/{id}/join, /v1/fcm-token, /v1/pwa-hash, /v1/share-target, WS /v1/ws (phone JWT)
"""
import json
import secrets
import time
from typing import Any

import uvicorn
from fastapi import FastAPI, Header, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

app = FastAPI(title="Gateway mock")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

# mode: allow | warn | hold | block | drop (drop = never answer a pay check)
STATE: dict[str, Any] = {"mode": "allow", "ws": "up", "jwt_ttl": 900, "pwa_hash": ""}
SESSIONS: dict[str, dict] = {}  # session_id -> {"behaviours": [...]}
TOKENS: dict[str, str] = {}  # jwt -> session_id
ROLES: dict[str, str] = {}  # jwt -> "phone" (anything else is the extension)
PAIR_TOKENS: dict[str, str] = {}  # raw pairing token -> session_id (the real Gateway stores only a hash)
LAST_PAIR: dict[str, str] = {}  # most recent pair_url, so you can open it on the laptop instead of scanning
SOCKETS: dict[str, WebSocket] = {}  # session_id -> extension socket
PHONES: dict[str, WebSocket] = {}  # session_id -> phone socket
LOG: list[dict] = []

SCAM_WORDS = ("safe account", "digital arrest", "cbi", "arrest", "kyc", "lottery", "prize", "refund", "otp", "anydesk")


def log(kind: str, **data: Any) -> None:
    LOG.append({"t": time.time(), "kind": kind, **data})


def new_jwt(sid: str, role: str = "extension") -> str:
    jwt = "mock." + secrets.token_urlsafe(24)
    TOKENS[jwt] = sid
    if role != "extension":
        ROLES[jwt] = role
    return jwt


def new_pairing(sid: str) -> dict:
    token = secrets.token_urlsafe(12)
    PAIR_TOKENS[token] = sid
    pair_url = f"http://localhost:5173/join?session={sid}&token={token}"
    LAST_PAIR["pair_url"] = pair_url
    return {"pair_token": token, "pair_url": pair_url, "pairing_expires_in": 300}


def session_for(auth: str) -> dict | None:
    sid = TOKENS.get(auth.removeprefix("Bearer ").strip())
    return SESSIONS.get(sid) if sid else None


def scam_decision(session: dict, request_id: str | None, action: str) -> dict:
    seen = list(dict.fromkeys(session["behaviours"]))[-3:] or ["PASTE_PAYEE"]
    return {
        "request_id": request_id,
        "action": action,
        "scam_type": "Digital Arrest Scam",
        "confidence": 0.82,
        "reasons": [{"behaviour": b} for b in seen],
        "intervention": {
            "body": "Police and courts never ask you to move money to a safe account. Stop and hang up.",
            "question": "Is someone on the phone telling you to make this payment?",
            "hold_seconds": 5,
        },
    }


def make_decision(session: dict, request_id: str | None) -> dict:
    mode = STATE["mode"]
    if mode == "allow":
        return {"request_id": request_id, "action": "allow", "scam_type": None, "confidence": 0.05}
    return scam_decision(session, request_id, mode)


def handle(session: dict, msg: dict, transport: str) -> dict | None:
    t = msg.get("type")
    if t in ("SIGNAL_BATCH", "PAY_INTERCEPTED"):
        for s in msg.get("signals", []):
            session["behaviours"].append(s.get("behaviour"))
            log("signal", behaviour=s.get("behaviour"), attrs=s.get("attrs"), transport=transport)
        if t == "PAY_INTERCEPTED":
            log("pay", request_id=msg.get("request_id"), payment_binding=msg.get("payment_binding"), transport=transport)
            if STATE["mode"] == "drop":
                return None
            return {"type": "DECISION", "payload": make_decision(session, msg.get("request_id"))}
    if t == "PAY_OUTCOME":
        log("outcome", outcome=msg.get("outcome"))
    return None


# ---------------------------------------------------------------- extension endpoints
@app.post("/v1/sessions")
async def create_session(request: Request):
    body = await request.json()
    sid = "sess-" + secrets.token_hex(5)
    SESSIONS[sid] = {"behaviours": []}
    log("session", device_id=body.get("device_id"), has_public_key=bool(body.get("public_key")))
    return {"session_id": sid, "jwt": new_jwt(sid), "jwt_expires_in": STATE["jwt_ttl"], **new_pairing(sid)}


@app.post("/v1/sessions/{sid}/refresh")
async def refresh(sid: str, request: Request):
    body = await request.json()
    if sid not in SESSIONS or not body.get("signature"):
        return JSONResponse({"error": "unknown session"}, status_code=404)
    log("refresh", session_id=sid)  # a real Gateway verifies the ECDSA signature here
    return {"jwt": new_jwt(sid), "jwt_expires_in": STATE["jwt_ttl"]}


@app.post("/v1/sessions/{sid}/pairing-token")
async def pairing_token(sid: str, authorization: str = Header(default="")):
    if not session_for(authorization):
        return JSONResponse({"error": "unauthorized"}, status_code=401)
    log("pairing_token", session_id=sid)
    return new_pairing(sid)


@app.post("/v1/signals")
async def post_signals(request: Request, authorization: str = Header(default="")):
    session = session_for(authorization)
    if not session:
        return JSONResponse({"error": "unauthorized"}, status_code=401)
    body = await request.json()
    msg = {"type": "PAY_INTERCEPTED" if body.get("pay") else "SIGNAL_BATCH", **body}
    msg["payment_binding"] = (body.get("pay") or {}).get("payment_binding")
    reply = handle(session, msg, "http")
    return {"decision": reply["payload"] if reply else None}


# ---------------------------------------------------------------- phone PWA endpoints
@app.post("/v1/sessions/{sid}/join")
async def join(sid: str, request: Request):
    body = await request.json()
    token = body.get("token", "")
    if sid not in SESSIONS or PAIR_TOKENS.get(token) != sid:
        log("join_rejected", session_id=sid)
        return JSONResponse({"error": "invalid or expired token"}, status_code=401)
    del PAIR_TOKENS[token]  # single use
    log("join", session_id=sid)
    ext = SOCKETS.get(sid)
    if ext:
        await ext.send_text(json.dumps({"type": "PEER_STATUS", "phone": True}))
    return {"jwt": new_jwt(sid, "phone"), "jwt_expires_in": STATE["jwt_ttl"]}


@app.post("/v1/fcm-token")
async def fcm_token(request: Request, authorization: str = Header(default="")):
    if not session_for(authorization):
        return JSONResponse({"error": "unauthorized"}, status_code=401)
    body = await request.json()
    log("fcm_token", has_token=bool(body.get("fcm_token")))
    return {"ok": True}


@app.get("/v1/pwa-hash")
def pwa_hash():
    return {"hash": STATE["pwa_hash"]}  # empty = nothing published, so the PWA skips the comparison


@app.post("/v1/share-target")
async def share_target(request: Request, authorization: str = Header(default="")):
    if not session_for(authorization):
        return JSONResponse({"error": "unauthorized"}, status_code=401)
    text = ((await request.json()).get("text") or "").lower()
    log("share_target", length=len(text))  # never log the text itself
    if any(w in text for w in SCAM_WORDS):
        return {
            "action": "warn",
            "scam_type": "Suspicious message",
            "confidence": 0.8,
            "reasons": [{"behaviour": "SCAM_PHRASE_IN_MESSAGE", "label": "Contains a known scam phrase"}],
            "intervention": {"body": "Do not reply, click links or share OTPs. Call your bank on the number printed on your card."},
        }
    return {"action": "allow", "scam_type": None, "confidence": 0.05}


# ---------------------------------------------------------------- WebSocket (extension and phone)
@app.websocket("/v1/ws")
async def ws_endpoint(ws: WebSocket, token: str = ""):
    if STATE["ws"] == "down":
        await ws.close()  # refuse the handshake
        return
    await ws.accept()
    sid = TOKENS.get(token)
    if not sid:
        await ws.close(code=4401)
        return
    role = ROLES.get(token, "extension")
    (PHONES if role == "phone" else SOCKETS)[sid] = ws
    log("ws_open", session_id=sid, role=role)
    try:
        while True:
            msg = json.loads(await ws.receive_text())
            if msg.get("type") == "ping":
                await ws.send_text(json.dumps({"type": "pong"}))
                continue
            if role == "phone":
                for s in msg.get("signals", []):
                    SESSIONS[sid]["behaviours"].append(s.get("behaviour"))
                    log("signal", behaviour=s.get("behaviour"), attrs=s.get("attrs"), transport="ws", source="phone")
                continue
            reply = handle(SESSIONS[sid], msg, "ws")
            if reply:
                await ws.send_text(json.dumps(reply))
    except WebSocketDisconnect:
        log("ws_close", session_id=sid, role=role)
        if role == "phone":
            PHONES.pop(sid, None)
            ext = SOCKETS.get(sid)
            if ext:
                try:
                    await ext.send_text(json.dumps({"type": "PEER_STATUS", "phone": False}))
                except Exception:
                    pass


# ---------------------------------------------------------------- debug controls
@app.post("/debug/mode/{mode}")
def set_mode(mode: str):
    STATE["mode"] = mode
    return STATE


@app.post("/debug/ws/{state}")
def set_ws(state: str):
    STATE["ws"] = state  # up | down
    return STATE


@app.post("/debug/jwt-ttl/{seconds}")
def set_ttl(seconds: int):
    STATE["jwt_ttl"] = seconds
    return STATE


@app.post("/debug/pwa-hash/{value}")
def set_pwa_hash(value: str):
    STATE["pwa_hash"] = "" if value == "none" else value  # any value other than the real hash = mismatch
    return STATE


@app.post("/debug/phone-joined")
async def phone_joined():  # simulates the PWA pairing: pushes PEER_STATUS to the extension
    for ws in SOCKETS.values():
        await ws.send_text(json.dumps({"type": "PEER_STATUS", "phone": True}))
    return {"notified": len(SOCKETS)}


@app.post("/debug/alert/{action}")
async def debug_alert(action: str):  # push a hold/block decision to every connected phone
    decision = scam_decision({"behaviours": []}, None, action)
    for ws in PHONES.values():
        await ws.send_text(json.dumps({"type": "DECISION", "payload": decision}))
    return {"notified": len(PHONES)}


@app.get("/debug/pair-url")
def debug_pair_url():  # open this URL in a laptop tab to play the phone without scanning
    return LAST_PAIR


@app.get("/debug/log")
def get_log():
    return LOG


@app.post("/debug/reset")
def reset():
    LOG.clear()
    STATE.update(mode="allow", ws="up", jwt_ttl=900, pwa_hash="")
    return STATE


if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=8000)
