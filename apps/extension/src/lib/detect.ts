import { BANK_DOMAINS, SCAM_PHRASES } from "./constants";

export function levenshtein(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    prev = cur;
  }
  return prev[b.length];
}

export const normalizeHost = (h: string): string =>
  h.trim().toLowerCase().replace(/\.$/, "");

const tail = (host: string, n: number): string | null => {
  const labels = host.split(".");
  return labels.length >= n ? labels.slice(-n).join(".") : null;
};

/** The bank domain this host genuinely belongs to (exact or subdomain), else null. */
export function genuineBank(
  host: string,
  known: string[] = BANK_DOMAINS,
): string | null {
  const h = normalizeHost(host);
  for (const k of known) if (h === k || h.endsWith("." + k)) return k;
  return null;
}
export const isBankHost = (
  host: string,
  known: string[] = BANK_DOMAINS,
): boolean => genuineBank(host, known) !== null;

export interface DomainHit {
  detected: string;
  similar_to: string;
  method: "edit_distance" | "brand_in_host" | "homoglyph";
}

export function checkLookalike(
  host: string,
  known: string[] = BANK_DOMAINS,
): DomainHit | null {
  const h = normalizeHost(host);
  if (genuineBank(h, known)) return null;
  let best: DomainHit | null = null;
  let bestD = Infinity;
  for (const k of known) {
    const t = tail(h, k.split(".").length);
    if (!t) continue;
    const d = levenshtein(t, k);
    const max = k.length <= 10 ? 1 : 2;
    if (d > 0 && d <= max && d < bestD) {
      best = { detected: h, similar_to: k, method: "edit_distance" };
      bestD = d;
    }
  }
  if (best) return best;
  for (const k of known) {
    const brand = k.split(".")[0];
    if (brand.length >= 6 && h.includes(brand))
      return { detected: h, similar_to: k, method: "brand_in_host" };
  }
  return null;
}

// ---- Punycode (RFC 3492) decoder: location.hostname arrives as xn--... ----
function adapt(delta: number, numPoints: number, first: boolean): number {
  delta = first ? Math.floor(delta / 700) : delta >> 1;
  delta += Math.floor(delta / numPoints);
  let k = 0;
  while (delta > 455) {
    delta = Math.floor(delta / 35);
    k += 36;
  }
  return Math.floor(k + (36 * delta) / (delta + 38));
}

export function punycodeDecode(input: string): string {
  const out: number[] = [];
  let basic = input.lastIndexOf("-");
  if (basic < 0) basic = 0;
  for (let j = 0; j < basic; j++) out.push(input.charCodeAt(j));
  let n = 128;
  let i = 0;
  let bias = 72;
  for (let idx = basic > 0 ? basic + 1 : 0; idx < input.length; ) {
    const oldi = i;
    for (let w = 1, k = 36; ; k += 36) {
      if (idx >= input.length) throw new Error("bad punycode");
      const cp = input.charCodeAt(idx++);
      const digit =
        cp - 48 < 10
          ? cp - 22
          : cp - 65 < 26
            ? cp - 65
            : cp - 97 < 26
              ? cp - 97
              : 36;
      if (digit >= 36) throw new Error("bad punycode");
      i += digit * w;
      const t = k <= bias ? 1 : k >= bias + 26 ? 26 : k - bias;
      if (digit < t) break;
      w *= 36 - t;
    }
    bias = adapt(i - oldi, out.length + 1, oldi === 0);
    n += Math.floor(i / (out.length + 1));
    i %= out.length + 1;
    out.splice(i++, 0, n);
  }
  return String.fromCodePoint(...out);
}

export function decodeHost(host: string): string {
  return normalizeHost(host)
    .split(".")
    .map((label) => {
      if (!label.startsWith("xn--")) return label;
      try {
        return punycodeDecode(label.slice(4));
      } catch {
        return label;
      }
    })
    .join(".");
}

// Cyrillic / Greek / Latin-extended letters that render like ASCII letters.
const CONFUSABLES: Record<string, string> = {
  "\u0430": "a",
  "\u0435": "e",
  "\u043e": "o",
  "\u0440": "p",
  "\u0441": "c",
  "\u0445": "x",
  "\u0443": "y",
  "\u0456": "i",
  "\u0458": "j",
  "\u0455": "s",
  "\u04bb": "h",
  "\u0501": "d",
  "\u04cf": "l",
  "\u051b": "q",
  "\u051d": "w",
  "\u043a": "k",
  "\u03bf": "o",
  "\u03bd": "v",
  "\u03c1": "p",
  "\u03b9": "i",
  "\u03b1": "a",
  "\u03ba": "k",
  "\u03c4": "t",
  "\u03c5": "u",
  "\u0251": "a",
  "\u0261": "g",
  "\u217c": "l",
};

export function skeleton(s: string): string {
  const base = s.normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
  return Array.from(base, (ch) => CONFUSABLES[ch] ?? ch).join("");
}

export function checkHomoglyph(
  host: string,
  known: string[] = BANK_DOMAINS,
): DomainHit | null {
  const decoded = decodeHost(host);
  if (!/[^\x00-\x7f]/.test(decoded)) return null; // pure ASCII: not a homoglyph case
  const sk = skeleton(decoded);
  const detected = normalizeHost(host);
  const exact = genuineBank(sk, known);
  if (exact) return { detected, similar_to: exact, method: "homoglyph" };
  const near = checkLookalike(sk, known);
  return near
    ? { detected, similar_to: near.similar_to, method: "homoglyph" }
    : null;
}

export function scamPhraseClass(text: string): string | null {
  for (const p of SCAM_PHRASES) if (p.pattern.test(text)) return p.class;
  return null;
}

// Card number + CVV + OTP fields on one page. Heuristic: attribute hints, not values.
const hint = (el: HTMLInputElement): string =>
  [
    el.name,
    el.id,
    el.placeholder,
    el.getAttribute("aria-label"),
    el.autocomplete,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

export function detectCardOtpForm(root: ParentNode = document): boolean {
  let card = false;
  let cvv = false;
  let otp = false;
  for (const el of Array.from(
    root.querySelectorAll<HTMLInputElement>("input"),
  )) {
    if (["hidden", "checkbox", "radio", "button", "submit"].includes(el.type))
      continue;
    const h = hint(el);
    if (
      /cc-number|card.?(no|num)|cardnumber/.test(h) ||
      (/card/.test(h) && el.maxLength >= 16 && el.maxLength <= 19)
    )
      card = true;
    else if (/cc-csc|cvv|cvc|security.?code/.test(h)) cvv = true;
    else if (/one-time-code|otp|one.?time|verification.?code/.test(h))
      otp = true;
  }
  return card && cvv && otp;
}
