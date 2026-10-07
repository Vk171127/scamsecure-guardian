import { DECISION_TIMEOUT_MS } from "../lib/config";
import {
  GENERIC_PROFILE,
  PAYMENT_PROFILES,
  type PaymentProfile,
} from "../lib/constants";
import { isBankHost, normalizeHost } from "../lib/detect";
import { injectWarningCard } from "../ui/warning-card";
import type { Decision, PaymentInfo } from "../types";
import {
  collectAtPay,
  drain,
  markFormLoaded,
  startCollectors,
} from "./signals";

type Envelope = { envelope_json?: string | null; signature?: string } | null;

let profile!: PaymentProfile;
let bypass = false; // true only while we replay the user's click
let busy = false;
let fallbackPaymentId = crypto.randomUUID();

async function safeSend<T = any>(msg: unknown): Promise<T | null> {
  try {
    return (await chrome.runtime.sendMessage(msg)) as T;
  } catch {
    return null; // context invalidated / worker unavailable
  }
}

const timeout = <T>(ms: number, value: T) =>
  new Promise<T>((r) => setTimeout(() => r(value), ms));

function resolveProfile(host: string): PaymentProfile {
  const h = normalizeHost(host);
  return (
    PAYMENT_PROFILES.find((p) => h === p.host || h.endsWith("." + p.host))
      ?.profile ?? GENERIC_PROFILE
  );
}

function isPayButton(el: Element): el is HTMLElement {
  if (!el.matches(profile.pay)) return false;
  if (!profile.payText) return true;
  const label =
    el instanceof HTMLInputElement ? el.value : (el.textContent ?? "");
  return profile.payText.test(label);
}

function findPayButton(target: EventTarget | null): HTMLElement | null {
  let el: Element | null = target instanceof Element ? target : null;
  while (el) {
    if (isPayButton(el)) return el;
    el = el.parentElement;
  }
  return null;
}

// Raw values stay inside this function's result; only the hash of them is ever sent out.
function readPayment(form: HTMLFormElement | null): PaymentInfo {
  const root: ParentNode = form ?? document;
  const val = (sel?: string) =>
    sel ? (root.querySelector<HTMLInputElement>(sel)?.value ?? "") : "";
  const amount = parseFloat(val(profile.amount).replace(/[^0-9.]/g, ""));
  return {
    payeeAccount: val(profile.account).replace(/[\s-]/g, "").toUpperCase(),
    amountMinor: Number.isFinite(amount) ? Math.round(amount * 100) : 0,
    currency: profile.currency,
    paymentId:
      root.querySelector<HTMLInputElement>('[name="payment_id"]')?.value ||
      fallbackPaymentId,
  };
}

async function requestDecision(payment: PaymentInfo): Promise<Decision | null> {
  const signals = drain();
  const call = safeSend<{ decision?: Decision | null }>({
    type: "PAY_INTERCEPTED",
    signals,
    payment,
  }).then((r) => r?.decision ?? null);
  return Promise.race([
    call,
    timeout<Decision | null>(DECISION_TIMEOUT_MS, null),
  ]); // fail open
}

function setHidden(form: HTMLFormElement, name: string, value: string): void {
  let input = form.querySelector<HTMLInputElement>(`input[name="${name}"]`);
  if (!input) {
    input = document.createElement("input");
    input.type = "hidden";
    input.name = name;
    form.appendChild(input);
  }
  input.value = value;
}

// Replays the original action. We replay the click / requestSubmit() rather than
// form.submit(), because form.submit() skips the page's own submit handlers.
function proceed(
  form: HTMLFormElement | null,
  btn: HTMLElement | null,
  env: Envelope,
): void {
  if (env?.envelope_json && env.signature) {
    if (form) {
      setHidden(form, "ss_envelope", env.envelope_json);
      setHidden(form, "ss_envelope_sig", env.signature);
    }
    window.postMessage(
      {
        source: "scamsecure-guardian",
        type: "ENVELOPE",
        envelope_json: env.envelope_json,
        signature: env.signature,
      },
      window.location.origin,
    );
  }
  bypass = true;
  try {
    if (btn) btn.click();
    else form?.requestSubmit();
  } finally {
    bypass = false;
  }
  fallbackPaymentId = crypto.randomUUID();
}

async function release(
  form: HTMLFormElement | null,
  btn: HTMLElement | null,
  payment: PaymentInfo,
  decision: Decision | null,
  ack: boolean,
) {
  const env = await Promise.race([
    safeSend<Envelope>({
      type: "BUILD_ENVELOPE",
      payment,
      decision,
      warning_ack: ack,
    }),
    timeout<Envelope>(300, null), // no envelope is better than a stuck payment
  ]);
  proceed(form, btn, env);
}

async function intercept(
  form: HTMLFormElement | null,
  btn: HTMLElement | null,
): Promise<void> {
  if (busy) return;
  busy = true;
  try {
    collectAtPay(profile);
    const payment = readPayment(form);
    const decision = await requestDecision(payment);
    if (!decision || decision.action === "allow") {
      await release(form, btn, payment, decision, false);
      return;
    }
    const choice = await injectWarningCard(decision);
    void safeSend({
      type: "PAY_OUTCOME",
      outcome: choice === "cancel" ? "cancelled" : "proceeded",
    });
    if (choice === "proceed") await release(form, btn, payment, decision, true);
  } finally {
    busy = false;
  }
}

function onClick(e: MouseEvent): void {
  if (bypass) return;
  const btn = findPayButton(e.target);
  if (!btn) return;
  e.preventDefault();
  e.stopImmediatePropagation();
  void intercept(btn.closest("form"), btn);
}

// Backstop for forms submitted without a click on the Pay button.
function onSubmit(e: SubmitEvent): void {
  if (bypass) return;
  const form = e.target;
  if (
    !(form instanceof HTMLFormElement) ||
    !form.querySelector(profile.account)
  )
    return;
  e.preventDefault();
  e.stopImmediatePropagation();
  void intercept(form, null);
}

function watchForPayButton(): void {
  const check = () => {
    if (Array.from(document.querySelectorAll(profile.pay)).some(isPayButton)) {
      markFormLoaded();
      obs.disconnect();
    }
  };
  const obs = new MutationObserver(check);
  obs.observe(document.documentElement, { childList: true, subtree: true });
  check();
}

export function initPayment(): void {
  if (!isBankHost(location.hostname)) return; // payment protection only runs on known bank domains
  profile = resolveProfile(location.hostname);
  startCollectors(profile);
  void safeSend({ type: "BANK_PAGE_LOADED" });
  watchForPayButton();
  window.addEventListener("click", onClick, true);
  window.addEventListener("submit", onSubmit, true);
}
