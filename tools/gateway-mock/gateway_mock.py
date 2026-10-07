"""Dev/test STUB of the Gateway (GW-01). Not the real backend. Run: python gateway_mock.py"""
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
STATE: dict[str, Any] = {"mode": "allow", "ws": "up", "jwt_ttl": 900}
SESSIONS: dict[str, dict] = {}   # session_id -> {"behaviours": [...]}
TOKENS: dict[str, str] = {}      # jwt -> session_id
SOCKETS: dict[str, WebSocket] = {}
LOG: list[dict] = []


def log(kind: str, **data: Any) -> None:
    LOG.append({"t": time.time(), "kind": kind, **data})


def new_jwt(sid: str) -> str:
    jwt = "mock." + secrets.token_urlsafe(24)
    TOKENS[jwt] = sid
    return jwt


def new_pairing(sid: str) -> dict:
    token = secrets.token_urlsafe(12)  # the real Gateway would store only a hash of this
    return {"pair_token": token, "pair_url": f"http://localhost:5173/join?session={sid}&token={token}", "pairing_expires_in": 300}


def session_for(auth: str) -> dict | None:
    sid = TOKENS.get(auth.removeprefix("Bearer ").strip())
    return SESSIONS.get(sid) if sid else None


def make_decision(session: dict, request_id: str | None) -> dict:
    mode = STATE["mode"]
    if mode == "allow":
        return {"request_id": request_id, "action": "allow", "scam_type": None, "confidence": 0.05}
    seen = list(dict.fromkeys(session["behaviours"]))[-3:] or ["PASTE_PAYEE"]
    return {
        "request_id": request_id,
        "action": mode,
        "scam_type": "Digital Arrest Scam",
        "confidence": 0.82,
        "reasons": [{"behaviour": b} for b in seen],
        "intervention": {
            "body": "Police and courts never ask you to move money to a safe account. Stop and hang up.",
            "question": "Is someone on the phone telling you to make this payment?",
            "hold_seconds": 5,
        },
    }


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
    SOCKETS[sid] = ws
    log("ws_open", session_id=sid)
    try:
        while True:
            msg = json.loads(await ws.receive_text())
            if msg.get("type") == "ping":
                await ws.send_text(json.dumps({"type": "pong"}))
                continue
            reply = handle(SESSIONS[sid], msg, "ws")
            if reply:
                await ws.send_text(json.dumps(reply))
    except WebSocketDisconnect:
        log("ws_close", session_id=sid)


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


@app.post("/debug/phone-joined")
async def phone_joined():  # simulates the PWA pairing: pushes PEER_STATUS to the extension
    for ws in SOCKETS.values():
        await ws.send_text(json.dumps({"type": "PEER_STATUS", "phone": True}))
    return {"notified": len(SOCKETS)}


@app.get("/debug/log")
def get_log():
    return LOG


@app.post("/debug/reset")
def reset():
    LOG.clear()
    STATE.update(mode="allow", ws="up", jwt_ttl=900)
    return STATE


if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=8000)