import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const store = vi.hoisted(() => new Map<string, string | null>());

vi.mock("server-only", () => ({}));
vi.mock("@/lib/platform-settings", () => ({
  getPlatformSetting: async (key: string) => store.get(key) ?? null,
  getPlatformSettingsMany: async (keys: readonly string[]) => Object.fromEntries(keys.map((k) => [k, store.get(k) ?? null])),
  setPlatformSetting: async (key: string, value: string | null) => {
    store.set(key, value);
    return true;
  },
}));

import { EF_ORTAK_FLAG_SETTING_KEY, EF_ORTAK_PROBE_OK_SETTING_KEY } from "@/lib/ef-credits/config";
import { EF_SETTING } from "./keys";
import { isOrtakFlagOn, makeOrtakHeaders, makeOrtakUserRef, ORTAK_ENDPOINTS_VERIFIED, ortakGate } from "./ortak";
import {
  assertAllowedOutbound,
  buildEmlakFiyatiHeaders,
  buildEmlakFiyatiPublicHeaders,
  EMLAKFIYATI_ALLOWED_PATHS,
  isAcceptableOrtakRefInput,
  isValidEmlakFiyatiKeyFormat,
  isValidOrtakUserRef,
  makeIdempotencyKey,
  maskEmlakFiyatiKey,
  validateQuery,
} from "./policy";
import { FAKE_KEY, FAKE_SECRETS_KEY } from "./test-fixtures";

const TENANT = "9d1c7a52-6b3e-4f08-a1d4-2e5f6a7b8c90";
const UUID = "3f2b8a9e-1c4d-4e6f-8a7b-9c0d1e2f3a4b";
const REPORT = "3f0c2d9e-1a2b-4c3d-8e4f-5a6b7c8d9e0f";

describe("ortak uçlar kapısı", () => {
  beforeEach(() => {
    store.clear();
    vi.stubEnv("PLATFORM_SECRETS_KEY", FAKE_SECRETS_KEY);
  });
  afterEach(() => vi.unstubAllEnvs());

  it("config anahtarları ile keys.ts ayar adları aynı", () => {
    expect(EF_SETTING.ortakEnabled).toBe(EF_ORTAK_FLAG_SETTING_KEY);
    expect(EF_SETTING.ortakProbeOkAt).toBe(EF_ORTAK_PROBE_OK_SETTING_KEY);
  });

  it("varsayılan KAPALI: 'etkin değil' (flag_off)", async () => {
    expect(await isOrtakFlagOn()).toBe(false);
    expect(await ortakGate()).toEqual({ enabled: false, reason: "flag_off" });
  });

  it("bayrak açık ama ortak yoklaması YOK: kapalı (probe_missing)", async () => {
    store.set(EF_ORTAK_FLAG_SETTING_KEY, "1");
    expect(ORTAK_ENDPOINTS_VERIFIED).toBe(true);
    expect(await ortakGate()).toEqual({ enabled: false, reason: "probe_missing" });
    store.set(EF_ORTAK_PROBE_OK_SETTING_KEY, "geçersiz");
    expect(await ortakGate()).toEqual({ enabled: false, reason: "probe_missing" });
  });

  it("yoklama var ama bayrak kapalı: kapalı", async () => {
    store.set(EF_ORTAK_PROBE_OK_SETTING_KEY, "2026-10-05T10:00:00.000Z");
    expect(await ortakGate()).toEqual({ enabled: false, reason: "flag_off" });
  });

  it("bayrak AÇIK + yoklama başarılı: açık", async () => {
    store.set(EF_ORTAK_FLAG_SETTING_KEY, "1");
    store.set(EF_ORTAK_PROBE_OK_SETTING_KEY, "2026-10-05T10:00:00.000Z");
    expect(await ortakGate()).toEqual({ enabled: true });
  });

  it("izinli GET listesinde ortak uç ve rapor YOK; ortak yollar yalnız ortak/referans beyaz listesinden geçer", () => {
    expect(EMLAKFIYATI_ALLOWED_PATHS.some((p) => p.includes("ortak"))).toBe(false);
    expect(EMLAKFIYATI_ALLOWED_PATHS.some((p) => p.includes("rapor"))).toBe(false);
    const h = buildEmlakFiyatiHeaders(FAKE_KEY, { userRef: "u-0123456789abcdef0123456789abcdef", idempotencyKey: "es-12345678" });
    expect(() => assertAllowedOutbound("https://emlakfiyati.com/api/ortak/v1/degerleme", h)).not.toThrow();
    expect(() => assertAllowedOutbound("https://emlakfiyati.com/api/ortak/v1/kullanim", h)).not.toThrow();
    expect(() => assertAllowedOutbound(`https://emlakfiyati.com/api/ortak/v1/rapor/${REPORT}`, h)).not.toThrow();
    expect(() => assertAllowedOutbound(`https://emlakfiyati.com/api/ortak/v1/rapor/${REPORT}.pdf`, h)).not.toThrow();
    // /api/parsel/rapor ASLA
    expect(() => assertAllowedOutbound("https://emlakfiyati.com/api/parsel/rapor?format=pdf", h)).toThrow();
    expect(() => assertAllowedOutbound("https://emlakfiyati.com/api/parsel/rapor", h)).toThrow();
    // UUID olmayan rapor yolu, başka ortak yolları
    expect(() => assertAllowedOutbound("https://emlakfiyati.com/api/ortak/v1/rapor/abc", h)).toThrow();
    expect(() => assertAllowedOutbound("https://emlakfiyati.com/api/ortak/v1/baska", h)).toThrow();
    expect(() => assertAllowedOutbound(`https://emlakfiyati.com/api/ortak/v2/rapor/${REPORT}`, h)).toThrow();
  });

  it("referans uçları yalnız 3 yol; kimlik/ortak başlığı taşıyamaz", () => {
    const pub = buildEmlakFiyatiPublicHeaders();
    expect(Object.keys(pub).some((k) => /authorization/i.test(k))).toBe(false);
    for (const p of ["iller", "ilceler", "mahalleler"]) {
      expect(() => assertAllowedOutbound(`https://emlakfiyati.com/api/musteri/${p}?x=1`, pub)).not.toThrow();
    }
    expect(() => assertAllowedOutbound("https://emlakfiyati.com/api/musteri/profil", pub)).toThrow();
    expect(() => assertAllowedOutbound("https://emlakfiyati.com/api/musteri/iller", buildEmlakFiyatiHeaders(FAKE_KEY))).toThrow();
  });
});

describe("takma kullanıcı referansı", () => {
  beforeEach(() => vi.stubEnv("PLATFORM_SECRETS_KEY", FAKE_SECRETS_KEY));
  afterEach(() => vi.unstubAllEnvs());

  it("(tenant,kullanıcı) UUID'sinden `u-` + 32 hex, rakam içerir, kararlı, geri çevrilemez", () => {
    const ref = makeOrtakUserRef(TENANT, UUID);
    expect(ref).toMatch(/^u-[0-9a-f]{32}$/);
    expect(ref).toMatch(/\d/);
    expect(isValidOrtakUserRef(ref as string)).toBe(true);
    expect(makeOrtakUserRef(TENANT, UUID)).toBe(ref);
    expect(makeOrtakUserRef(TENANT.toUpperCase(), UUID.toUpperCase())).toBe(ref);
    expect(ref).not.toContain(UUID.replace(/-/g, ""));
    expect(ref).not.toContain(TENANT.replace(/-/g, ""));
    expect(makeOrtakUserRef(TENANT, "00000000-0000-4000-8000-000000000000")).not.toBe(ref);
    // Aynı kullanıcı farklı tenant'ta farklı takma kimlik alır.
    expect(makeOrtakUserRef("00000000-0000-4000-8000-000000000001", UUID)).not.toBe(ref);
  });

  it.each([
    "ali.veli@ornek.com",
    "05321234567",
    "+905321234567",
    "12345678901",
    "Ali Veli",
    "",
  ])("e-posta/telefon/TC/ad girdisi REDDEDİLİR: %s", (input) => {
    expect(isAcceptableOrtakRefInput(input)).toBe(false);
    expect(makeOrtakUserRef(TENANT, input)).toBeNull();
    expect(makeOrtakUserRef(input, UUID)).toBeNull();
    expect(makeOrtakHeaders(TENANT, input)).toBeNull();
  });

  it("sır anahtarı yoksa ref üretilmez", () => {
    vi.stubEnv("PLATFORM_SECRETS_KEY", "");
    vi.stubEnv("OTP_HMAC_SECRET", "");
    expect(makeOrtakUserRef(TENANT, UUID)).toBeNull();
  });

  it("ref doğrulayıcı: 8-64 karakter, [A-Za-z0-9_.:-], en az bir rakam, e-posta/yalnız rakam yok", () => {
    expect(isValidOrtakUserRef("a1".repeat(3) + "b")).toBe(false); // 7
    expect(isValidOrtakUserRef("abcdefg1")).toBe(true); // 8
    expect(isValidOrtakUserRef("a".repeat(7) + "1")).toBe(true);
    expect(isValidOrtakUserRef("a".repeat(8))).toBe(false); // rakamsız
    expect(isValidOrtakUserRef("a".repeat(63) + "1")).toBe(true);
    expect(isValidOrtakUserRef("a".repeat(64) + "1")).toBe(false);
    expect(isValidOrtakUserRef("12345678")).toBe(false);
    expect(isValidOrtakUserRef("abc defg1")).toBe(false);
    expect(isValidOrtakUserRef("abc@defg1")).toBe(false);
    expect(isValidOrtakUserRef("abc_.:-1234")).toBe(true);
  });

  it("Idempotency-Key her seferinde tekil; ortak başlıklar beyaz listede", () => {
    const a = makeIdempotencyKey();
    expect(a).not.toBe(makeIdempotencyKey());
    const headers = makeOrtakHeaders(TENANT, UUID, a);
    expect(headers).toEqual({ userRef: makeOrtakUserRef(TENANT, UUID), idempotencyKey: a });
    const built = buildEmlakFiyatiHeaders(FAKE_KEY, headers!);
    expect(built["X-Ortak-Kullanici-Ref"]).toBe(headers!.userRef);
    expect(built["Idempotency-Key"]).toBe(a);
    expect(() => assertAllowedOutbound("https://emlakfiyati.com/api/endeks", built)).not.toThrow();
    expect(() => buildEmlakFiyatiHeaders(FAKE_KEY, { userRef: "ali@x.com", idempotencyKey: a })).toThrow();
    expect(() => buildEmlakFiyatiHeaders(FAKE_KEY, { userRef: "u-12345678", idempotencyKey: "kisa" })).toThrow();
  });
});

describe("istek politikası (kişisel veri çıkışı kilidi)", () => {
  it("izinsiz host/şema/başlık/yol reddedilir", () => {
    const h = buildEmlakFiyatiHeaders(FAKE_KEY);
    expect(() => assertAllowedOutbound("https://emlakfiyati.com/api/endeks?path=a&tip=konut", h)).not.toThrow();
    expect(() => assertAllowedOutbound("http://emlakfiyati.com/api/endeks", h)).toThrow();
    expect(() => assertAllowedOutbound("https://evil.example.com/api/endeks", h)).toThrow();
    expect(() => assertAllowedOutbound("https://emlakfiyati.com.evil.com/api/endeks", h)).toThrow();
    expect(() => assertAllowedOutbound("https://u:p@emlakfiyati.com/api/endeks", h)).toThrow();
    expect(() => assertAllowedOutbound("https://emlakfiyati.com/api/baska", h)).toThrow();
    expect(() => assertAllowedOutbound("https://emlakfiyati.com/api/endeks", { ...h, "x-api-key": "k" })).toThrow();
    expect(() => assertAllowedOutbound("https://emlakfiyati.com/api/endeks", { ...h, Cookie: "a=b" })).toThrow();
  });

  it("sorgu: e-posta, telefon/TC benzeri uzun rakam dizisi ve şüpheli anahtarlar reddedilir; ada/parsel geçer", () => {
    expect(() => validateQuery({ q: "ali@ornek.com" })).toThrow();
    expect(() => validateQuery({ q: "05321234567" })).toThrow();
    expect(() => validateQuery({ q: "123 456 789 01" })).toThrow();
    expect(() => validateQuery({ "Bad Key": "x" })).toThrow();
    expect(validateQuery({ ada: 1234, parsel: 56, il: "istanbul" }).toString()).toBe("ada=1234&il=istanbul&parsel=56");
  });

  it("anahtar biçimi: önek + makul uzunluk; maske yalnız son 4", () => {
    expect(isValidEmlakFiyatiKeyFormat(FAKE_KEY)).toBe(true);
    expect(isValidEmlakFiyatiKeyFormat("x" + FAKE_KEY)).toBe(false);
    expect(isValidEmlakFiyatiKeyFormat("kisa")).toBe(false);
    expect(isValidEmlakFiyatiKeyFormat(`${FAKE_KEY} `)).toBe(false);
    expect(isValidEmlakFiyatiKeyFormat(`${FAKE_KEY}\nX-Evil: 1`)).toBe(false);
    const masked = maskEmlakFiyatiKey(FAKE_KEY) as string;
    expect(masked.endsWith(FAKE_KEY.slice(-4))).toBe(true);
    expect(masked).toContain("****");
    expect(masked).not.toContain("NOT_REAL");
  });
});
