import QRCode from "qrcode";
import { PAUSE_MINUTES, SIGNAL_LABELS } from "../../lib/constants";
import type { StoredSession } from "../../types";

const $ = <T extends HTMLElement = HTMLElement>(id: string) =>
  document.getElementById(id) as T;
let shownUrl = "";

const mmss = (ms: number) =>
  `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, "0")}`;

async function render(): Promise<void> {
  const s = await chrome.storage.session.get([
    "session",
    "ws_state",
    "peer",
    "active_signals",
    "last_decision",
    "paused_until",
  ]);
  const session = s.session as StoredSession | undefined;
  const paired = !!(s.peer as { phone?: boolean } | undefined)?.phone;

  let status = "No session";
  if (session)
    status =
      s.ws_state !== "open"
        ? "Connecting..."
        : paired
          ? "Paired with phone"
          : "Connected, waiting for phone";
  $("status").textContent = status;
  $("help").hidden = !!session;
  $("retry").hidden = !!session;

  const showQr = !!session?.pair_url && !paired;
  $("qrBox").hidden = !showQr;
  if (showQr && session?.pair_url && shownUrl !== session.pair_url) {
    shownUrl = session.pair_url;
    QRCode.toDataURL(session.pair_url, { width: 200, margin: 1 }).then(
      (url) => (($("qr") as HTMLImageElement).src = url),
    );
  }
  if (showQr) {
    const left = (session?.pairing_expires_at ?? 0) - Date.now();
    $("qrNote").textContent =
      left > 0 ? `QR expires in ${mmss(left)}` : "QR expired. Refresh it.";
  }

  const d = s.last_decision as { action: string; at: number } | undefined;
  const fresh = d && Date.now() - d.at < 5 * 60_000;
  $("dot").className =
    !fresh || d.action === "allow" ? "" : d.action === "warn" ? "amber" : "red";

  const sigs = (s.active_signals ?? []) as { behaviour: string }[];
  $("sigWrap").hidden = sigs.length === 0;
  $("signals").replaceChildren(
    ...sigs.slice(0, 8).map((x) =>
      Object.assign(document.createElement("li"), {
        textContent: SIGNAL_LABELS[x.behaviour] ?? x.behaviour,
      }),
    ),
  );

  const left =
    typeof s.paused_until === "number" ? s.paused_until - Date.now() : 0;
  $("pause").textContent =
    left > 0
      ? `Resume protection (${mmss(left)} left)`
      : `Pause protection (${PAUSE_MINUTES} min)`;
}

$("pause").addEventListener("click", async () => {
  const { paused_until } = await chrome.storage.session.get("paused_until");
  if (typeof paused_until === "number" && paused_until > Date.now())
    await chrome.storage.session.remove("paused_until");
  else
    await chrome.storage.session.set({
      paused_until: Date.now() + PAUSE_MINUTES * 60_000,
    });
  void render();
});
$("refreshQr").addEventListener("click", async () => {
  await chrome.runtime.sendMessage({ type: "REFRESH_PAIRING" }).catch(() => {});
  void render();
});
$("retry").addEventListener("click", async () => {
  await chrome.runtime.sendMessage({ type: "ENSURE_SESSION" }).catch(() => {});
  void render();
});
chrome.storage.onChanged.addListener(
  (_c, area) => area === "session" && void render(),
);
setInterval(() => void render(), 1000);
void render();
