import {
  checkHomoglyph,
  checkLookalike,
  detectCardOtpForm,
  isBankHost,
} from "../lib/detect";
import { makeSignal } from "../lib/signal";
import { injectPhishingOverlay } from "../ui/phishing-overlay";

const send = (signals: unknown[]) =>
  chrome.runtime.sendMessage({ type: "SIGNAL_BATCH", signals }).catch(() => {});

function watchCardOtp(): void {
  let timer: number | undefined;
  const scan = () => {
    if (!detectCardOtpForm(document)) return;
    obs.disconnect();
    void send([makeSignal("CARD_OTP_FORM")]);
  };
  const obs = new MutationObserver(() => {
    clearTimeout(timer);
    timer = window.setTimeout(scan, 800);
  });
  obs.observe(document.documentElement, { childList: true, subtree: true });
  document.addEventListener("DOMContentLoaded", scan);
}

function main(): void {
  const host = location.hostname;
  if (!host || isBankHost(host)) return; // genuine bank: nothing to do here
  const homo = checkHomoglyph(host);
  const hit = homo ?? checkLookalike(host);
  if (hit) {
    injectPhishingOverlay(hit.detected, hit.similar_to); // first, before the page is usable
    void send([
      makeSignal(homo ? "HOMOGLYPH_DOMAIN" : "LOOKALIKE_DOMAIN", {
        detected: hit.detected,
        similar_to: hit.similar_to,
      }),
    ]);
  }
  watchCardOtp();
}

main();
