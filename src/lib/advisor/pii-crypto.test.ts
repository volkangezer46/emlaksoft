import { describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { decryptPii, encryptPii, parsePiiKey, piiAad } from "./pii-crypto";

const KEY = randomBytes(32);
const AAD = piiAad("11111111-1111-4111-8111-111111111111", "national_id");

describe("parsePiiKey", () => {
  it("64 hex ve 32 bayt base64 kabul eder", () => {
    expect(parsePiiKey(KEY.toString("hex"))?.equals(KEY)).toBe(true);
    expect(parsePiiKey(KEY.toString("base64"))?.equals(KEY)).toBe(true);
    expect(parsePiiKey(KEY.toString("base64url"))?.equals(KEY)).toBe(true);
  });
  it("boş, kısa veya geçersiz anahtarı reddeder (alanlar kapalı kalır)", () => {
    expect(parsePiiKey(undefined)).toBeNull();
    expect(parsePiiKey("")).toBeNull();
    expect(parsePiiKey("   ")).toBeNull();
    expect(parsePiiKey("kisa")).toBeNull();
    expect(parsePiiKey("ab".repeat(16))).toBeNull();
    expect(parsePiiKey("not base64 !!!")).toBeNull();
  });
});

describe("AES-256-GCM", () => {
  it("şifreler ve çözer; şifreli metin açık değeri içermez", () => {
    const enc = encryptPii("10000000146", KEY, AAD);
    expect(enc.startsWith("v1.")).toBe(true);
    expect(enc).not.toContain("10000000146");
    expect(decryptPii(enc, KEY, AAD)).toBe("10000000146");
  });
  it("her şifreleme farklı IV üretir", () => {
    expect(encryptPii("x", KEY, AAD)).not.toBe(encryptPii("x", KEY, AAD));
  });
  it("yanlış anahtar, farklı satır/alan (AAD) ve bozuk veri çözülemez", () => {
    const enc = encryptPii("TR330006100519786457841326", KEY, AAD);
    expect(decryptPii(enc, randomBytes(32), AAD)).toBeNull();
    expect(decryptPii(enc, KEY, piiAad("22222222-2222-4222-8222-222222222222", "national_id"))).toBeNull();
    expect(decryptPii(enc, KEY, piiAad("11111111-1111-4111-8111-111111111111", "iban"))).toBeNull();
    const parts = enc.split(".");
    parts[3] = Buffer.from("tampered").toString("base64url");
    expect(decryptPii(parts.join("."), KEY, AAD)).toBeNull();
    expect(decryptPii("v9.a.b.c", KEY, AAD)).toBeNull();
    expect(decryptPii(null, KEY, AAD)).toBeNull();
    expect(decryptPii("", KEY, AAD)).toBeNull();
  });
});
