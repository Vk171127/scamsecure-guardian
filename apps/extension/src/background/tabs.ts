import { REMOTE_ACCESS_TOOLS, SCREEN_SHARE_APPS } from "../lib/constants";
import { makeSignal } from "../lib/signal";
import type { SignalEvent } from "../types";

const hostIs = (host: string, domain: string) =>
  host === domain || host.endsWith("." + domain);

export async function markTabAsScripted(id: number): Promise<void> {
  const { scripted_tabs = [] } =
    await chrome.storage.session.get("scripted_tabs");
  await chrome.storage.session.set({
    scripted_tabs: [...(scripted_tabs as number[]), id].slice(-50),
  });
}

export async function forgetTab(id: number): Promise<void> {
  const { scripted_tabs = [] } =
    await chrome.storage.session.get("scripted_tabs");
  await chrome.storage.session.set({
    scripted_tabs: (scripted_tabs as number[]).filter((t) => t !== id),
  });
}

/** Signals that need a look at all open tabs. onlyNew=true skips ones already reported. */
export async function collectTabSignals(
  senderTabId: number | undefined,
  onlyNew: boolean,
): Promise<SignalEvent[]> {
  const found = new Map<string, SignalEvent>();
  for (const t of await chrome.tabs.query({})) {
    let host = "";
    try {
      host = new URL(t.url ?? "").hostname.toLowerCase();
    } catch {
      continue;
    }
    for (const d of SCREEN_SHARE_APPS)
      if (hostIs(host, d))
        found.set(
          `SCREEN_SHARE_LIKELY:${d}`,
          makeSignal("SCREEN_SHARE_LIKELY", { app_name: d }),
        );
    for (const d of REMOTE_ACCESS_TOOLS)
      if (hostIs(host, d))
        found.set(
          `REMOTE_ACCESS_TOOL_OPEN:${d}`,
          makeSignal("REMOTE_ACCESS_TOOL_OPEN", { app_name: d }),
        );
    if (host === "web.whatsapp.com")
      found.set("WHATSAPP_WEB_OPEN", makeSignal("WHATSAPP_WEB_OPEN"));
  }
  const { scripted_tabs = [] } =
    await chrome.storage.session.get("scripted_tabs");
  if (
    senderTabId != null &&
    (scripted_tabs as number[]).includes(senderTabId)
  ) {
    found.set("TAB_OPENED_BY_SCRIPT", makeSignal("TAB_OPENED_BY_SCRIPT"));
  }
  const { tab_sigs_seen = [] } =
    await chrome.storage.session.get("tab_sigs_seen");
  await chrome.storage.session.set({ tab_sigs_seen: [...found.keys()] });
  return [...found]
    .filter(([k]) => !onlyNew || !(tab_sigs_seen as string[]).includes(k))
    .map(([, v]) => v);
}
