import { describe, expect, it } from "vitest";
import {
  checkHomoglyph,
  checkLookalike,
  decodeHost,
  isBankHost,
  levenshtein,
} from "../../src/lib/detect";

describe("levenshtein", () => {
  it("computes distances", () => {
    expect(levenshtein("a", "a")).toBe(0);
    expect(levenshtein("", "abc")).toBe(3);
    expect(levenshtein("abc", "")).toBe(3);
    expect(levenshtein("hdfcbank.com", "hdfcbnk.com")).toBe(1);
  });
});

describe("checkLookalike", () => {
  it("flags hdfcbnk.com (distance 1)", () => {
    expect(checkLookalike("hdfcbnk.com")).toMatchObject({
      similar_to: "hdfcbank.com",
      method: "edit_distance",
    });
  });
  it("flags rn-for-m on the mock bank", () => {
    expect(checkLookalike("rnockbank.localhost")?.similar_to).toBe(
      "mockbank.localhost",
    );
  });
  it("flags a typo in a subdomain host", () => {
    expect(checkLookalike("netbanking.hdfcbamk.com")?.similar_to).toBe(
      "hdfcbank.com",
    );
  });
  it("flags the bank name inside a foreign host", () => {
    expect(checkLookalike("hdfcbank.com.evil.io")?.method).toBe(
      "brand_in_host",
    );
    expect(checkLookalike("hdfcbank-secure.com")?.method).toBe("brand_in_host");
  });
  it("ignores genuine hosts, subdomains and unrelated hosts", () => {
    expect(checkLookalike("hdfcbank.com")).toBeNull();
    expect(checkLookalike("netbanking.hdfcbank.com")).toBeNull();
    expect(checkLookalike("example.org")).toBeNull();
    expect(checkLookalike("hdfcxyz.com")).toBeNull(); // 4 edits away and no brand name inside
  });

  it("flags the same brand on a different TLD", () => {
    expect(checkLookalike("hdfcbank.in")?.method).toBe("brand_in_host");
  });
});

describe("isBankHost", () => {
  it("matches exact and subdomains only", () => {
    expect(isBankHost("www.hdfcbank.com")).toBe(true);
    expect(isBankHost("nothdfcbank.com")).toBe(false);
  });
});

describe("homoglyphs", () => {
  it("decodes punycode", () => {
    expect(decodeHost("xn--mnchen-3ya.de")).toBe("m\u00fcnchen.de");
  });
  it("flags a Cyrillic a in hdfcbank", () => {
    expect(checkHomoglyph("hdfcb\u0430nk.com")).toMatchObject({
      similar_to: "hdfcbank.com",
      method: "homoglyph",
    });
  });
  it("ignores plain ASCII", () => {
    expect(checkHomoglyph("hdfcbank.com")).toBeNull();
  });
});
