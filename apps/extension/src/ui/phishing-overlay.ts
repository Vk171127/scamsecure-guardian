import { E2E } from "../lib/config";

const CSS = `
*{box-sizing:border-box;font-family:system-ui,'Segoe UI',sans-serif}
.overlay{position:fixed;inset:0;background:#7f1d1d;color:#fff;display:flex;align-items:center;justify-content:center;padding:16px}
.card{max-width:520px;text-align:center}
h1{font-size:26px;margin:0 0 12px}
p{line-height:1.5;margin:8px 0}
.host{font-family:ui-monospace,monospace;background:rgba(0,0,0,.3);padding:2px 8px;border-radius:6px}
button{display:block;width:100%;margin-top:12px;padding:13px;font-size:16px;border-radius:8px;border:0;cursor:pointer}
.safe{background:#fff;color:#7f1d1d;font-weight:700}
.risk{background:transparent;color:#fff;border:1px solid rgba(255,255,255,.6);font-size:14px}
button:disabled{opacity:.5;cursor:not-allowed}`;

export function injectPhishingOverlay(
  detected: string,
  similarTo: string,
): void {
  const host = document.createElement("div");
  host.id = "ss-phishing-host";
  host.style.setProperty("all", "initial", "important");
  for (const [k, v] of Object.entries({
    position: "fixed",
    inset: "0",
    "z-index": "2147483647",
    display: "block",
  }))
    host.style.setProperty(k, v, "important");
  const root = host.attachShadow({ mode: E2E ? "open" : "closed" });
  let dismissed = false;

  const el = (tag: string, cls?: string, text?: string) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text) n.textContent = text;
    return n;
  };
  const style = el("style");
  style.textContent = CSS;
  const overlay = el("div", "overlay");
  const card = el("div", "card");
  const p1 = el("p");
  p1.append(
    el("span", "host", detected),
    " is pretending to be ",
    el("span", "host", similarTo),
    ".",
  );
  card.append(el("h1", "", "Fake bank website suspected"), p1);
  card.append(
    el(
      "p",
      "",
      "Scammers copy bank sites to steal your login, card details and OTP. Do not enter anything here.",
    ),
  );

  const scheme = similarTo.endsWith(".localhost") ? "http:" : "https:";
  const port =
    similarTo.endsWith(".localhost") && location.port
      ? ":" + location.port
      : "";
  const safe = el("button", "safe", `Go to the real ${similarTo}`);
  safe.addEventListener("click", () => {
    location.href = `${scheme}//${similarTo}${port}/`;
  });
  let left = 5;
  const risk = el("button", "risk", "") as HTMLButtonElement;
  risk.disabled = true;
  risk.textContent = `I understand the risk, continue (${left})`;
  const timer = window.setInterval(() => {
    left -= 1;
    if (left <= 0) {
      clearInterval(timer);
      risk.disabled = false;
      risk.textContent = "I understand the risk, continue";
    } else risk.textContent = `I understand the risk, continue (${left})`;
  }, 1000);
  risk.addEventListener("click", (e) => {
    if (!e.isTrusted || risk.disabled) return;
    dismissed = true;
    host.remove();
    document.body?.removeAttribute("inert");
  });
  card.append(safe, risk);
  overlay.append(card);
  root.append(style, overlay);

  // document_start: <html> may not exist yet; the page may also try to remove the overlay.
  const mount = (): boolean => {
    if (!document.documentElement) return false;
    document.documentElement.appendChild(host);
    return true;
  };
  if (!mount()) {
    const o = new MutationObserver(() => mount() && o.disconnect());
    o.observe(document, { childList: true });
  }
  const guard = new MutationObserver(() => {
    if (dismissed) return guard.disconnect();
    if (!host.isConnected) mount();
    if (document.body && !document.body.hasAttribute("inert"))
      document.body.setAttribute("inert", ""); // blocks keyboard access to the form
  });
  guard.observe(document, { childList: true, subtree: true });
}
