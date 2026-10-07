import { E2E } from "../lib/config";
import { SIGNAL_LABELS } from "../lib/constants";
import type { Decision } from "../types";

const CSS = `
*{box-sizing:border-box;font-family:system-ui,'Segoe UI',sans-serif}
.overlay{position:fixed;inset:0;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center}
.card{background:#fff;color:#111;width:min(460px,calc(100% - 32px));border-radius:14px;padding:22px;border-top:6px solid var(--accent);box-shadow:0 12px 40px rgba(0,0,0,.45)}
.badge{display:inline-block;font-size:12px;font-weight:700;letter-spacing:.06em;color:#fff;background:var(--accent);padding:3px 9px;border-radius:999px}
h2{margin:10px 0 6px;font-size:20px}
p{margin:8px 0;line-height:1.45}
.pills{display:flex;flex-wrap:wrap;gap:6px;margin:10px 0}
.pill{background:#f1f3f4;border-radius:999px;padding:4px 10px;font-size:13px}
.q{font-weight:600}
.row{display:flex;gap:10px;margin-top:16px}
button{flex:1;padding:12px;border-radius:8px;border:1px solid #bbb;font-size:15px;cursor:pointer;background:#f3f3f3}
button.primary{background:#188038;border-color:#188038;color:#fff;font-weight:600}
button:disabled{opacity:.5;cursor:not-allowed}`;

function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text) n.textContent = text; // textContent only: Gateway text is never parsed as HTML
  return n;
}

const TITLES = {
  warn: "CHECK THIS PAYMENT",
  hold: "PAYMENT ON HOLD",
  block: "PAYMENT BLOCKED",
} as const;

export function injectWarningCard(
  decision: Decision,
): Promise<"cancel" | "proceed"> {
  return new Promise((resolve) => {
    const host = document.createElement("div");
    host.id = "ss-warning-host";
    host.style.setProperty("all", "initial", "important");
    for (const [k, v] of Object.entries({
      position: "fixed",
      inset: "0",
      "z-index": "2147483647",
      display: "block",
    }))
      host.style.setProperty(k, v, "important");
    const root = host.attachShadow({ mode: E2E ? "open" : "closed" }); // closed: page scripts cannot reach inside
    const style = h("style");
    style.textContent = CSS;

    const action = decision.action === "allow" ? "warn" : decision.action;
    const overlay = h("div", "overlay");
    overlay.style.setProperty(
      "--accent",
      action === "warn" ? "#b45309" : "#d93025",
    );
    overlay.setAttribute("role", "alertdialog");
    overlay.setAttribute("aria-modal", "true");
    const card = h("div", "card");
    card.append(
      h("span", "badge", TITLES[action]),
      h("h2", "", decision.scam_type ?? "Suspicious payment"),
    );
    card.append(
      h(
        "p",
        "",
        decision.intervention?.body ??
          "This payment looks risky. Stop and check before sending money.",
      ),
    );

    const pills = h("div", "pills");
    for (const r of (decision.reasons ?? []).slice(0, 3))
      pills.append(
        h("span", "pill", r.label ?? SIGNAL_LABELS[r.behaviour] ?? r.behaviour),
      );
    if (pills.childElementCount) card.append(pills);
    if (decision.intervention?.question)
      card.append(h("p", "q", decision.intervention.question));

    // Countdown applies to the hold tier (and block, with a longer wait); plain warnings can continue at once.
    let left =
      action === "block"
        ? 30
        : action === "hold"
          ? (decision.intervention?.hold_seconds ?? 10)
          : 0;
    const cancel = h("button", "primary", "Cancel payment");
    const proceed = h("button", "", "");
    const label = () =>
      left > 0 ? `I understand, continue (${left})` : "I understand, continue";
    proceed.textContent = label();
    proceed.disabled = left > 0;
    const timer = window.setInterval(() => {
      left -= 1;
      if (left <= 0) {
        clearInterval(timer);
        proceed.disabled = false;
      }
      proceed.textContent = label();
    }, 1000);

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") finish("cancel");
    };
    const finish = (choice: "cancel" | "proceed") => {
      clearInterval(timer);
      document.removeEventListener("keydown", onKey, true);
      host.remove();
      resolve(choice);
    };
    cancel.addEventListener("click", (e) => e.isTrusted && finish("cancel")); // ignore scripted clicks
    proceed.addEventListener(
      "click",
      (e) => e.isTrusted && !proceed.disabled && finish("proceed"),
    );
    document.addEventListener("keydown", onKey, true);

    const row = h("div", "row");
    row.append(cancel, proceed);
    card.append(row);
    overlay.append(card);
    root.append(style, overlay);
    document.documentElement.appendChild(host);
    cancel.focus();
  });
}
