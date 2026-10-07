import {
  FAST_PAY_SECONDS,
  FLUSH_INTERVAL_MS,
  HESITATION_SECONDS,
  type PaymentProfile,
} from "../lib/constants";
import { scamPhraseClass } from "../lib/detect";
import { makeSignal } from "../lib/signal";
import type { SignalEvent } from "../types";

const queue: SignalEvent[] = [];
const emitted = new Set<string>();
let formLoadedAt: number | null = null;

export function emit(
  behaviour: string,
  attrs: Record<string, unknown> = {},
  onceKey?: string,
): void {
  if (onceKey) {
    if (emitted.has(onceKey)) return;
    emitted.add(onceKey);
  }
  queue.push(makeSignal(behaviour, attrs));
}

export const drain = (): SignalEvent[] => queue.splice(0, queue.length);

export async function flush(): Promise<void> {
  const signals = drain();
  if (!signals.length) return;
  try {
    await chrome.runtime.sendMessage({ type: "SIGNAL_BATCH", signals });
  } catch {
    /* extension reloaded or worker unavailable: drop this batch */
  }
}

export function markFormLoaded(): void {
  formLoadedAt ??= Date.now();
}

/** Called at Pay click: timing signals plus a final remarks scan (covers values set without input events). */
export function collectAtPay(profile: PaymentProfile): void {
  if (formLoadedAt) {
    const seconds = Math.round((Date.now() - formLoadedAt) / 1000);
    if (seconds > HESITATION_SECONDS) emit("HESITATION_LONG", { seconds });
    else if (seconds < FAST_PAY_SECONDS) emit("FAST_PAY", { seconds });
  }
  const remarks = profile.remarks
    ? (document.querySelector<HTMLInputElement>(profile.remarks)?.value ?? "")
    : "";
  const cls = scamPhraseClass(remarks);
  if (cls)
    emit("SCAM_PHRASE_IN_REMARKS", { phrase_class: cls }, `phrase:${cls}`); // the text itself is never sent
}

export function startCollectors(profile: PaymentProfile): void {
  const is = (t: EventTarget | null, sel?: string): boolean =>
    !!sel && t instanceof Element && t.matches(sel);

  window.addEventListener(
    "paste",
    (e) => {
      if (is(e.target, profile.account))
        emit("PASTE_PAYEE", { field: "account" }, "paste_payee");
      else if (is(e.target, profile.amount))
        emit("PASTE_AMOUNT", { field: "amount" }, "paste_amount");
    },
    true,
  );

  let timer: number | undefined;
  window.addEventListener(
    "input",
    (e) => {
      if (!is(e.target, profile.remarks)) return;
      const value = (e.target as HTMLInputElement).value;
      clearTimeout(timer);
      timer = window.setTimeout(() => {
        const cls = scamPhraseClass(value);
        if (cls)
          emit(
            "SCAM_PHRASE_IN_REMARKS",
            { phrase_class: cls },
            `phrase:${cls}`,
          );
      }, 250);
    },
    true,
  );

  if (navigator.webdriver === true) emit("WEBDRIVER_DETECTED", {}, "webdriver");

  window.setInterval(() => void flush(), FLUSH_INTERVAL_MS);
  window.addEventListener("pagehide", () => void flush());
}
