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

import { EF_SETTING } from "./keys";
import { isOrtakFlagOn, makeOrtakHeaders, makeOrtakUserRef, ORTAK_ENDPOINTS_VERIFIED, ortakGate } from "./ortak";
import {
  assertAllowedOutbound,
  buildEmlakFiyatiHeaders,
  EMLAKFIYATI_ALLOWED_PATHS,
  isAcceptableOrtakRefInput,
  isValidEmlakFiyatiKeyFormat,
  isValidOrtakUserRef,
  makeIdempotencyKey,
  maskEmlakFiyatiKey,
  validateQuery,
} from "./policy";
import { FAKE_KEY, FAKE_SECRETS_KEY } from "./test-fixtures";

const UUID = "3f2b8a9e-1c4d-4e6f-8a7b-9c0d1e2f3a4b";

describe("ortak uçlar kapısı", () => {
  beforeEach(() => {
    store.clear();
    vi.stubEnv("PLATFORM_SECRETS_KEY", FAKE_SECRETS_KEY);
  });
  afterEach(() => vi.unstubAllEnvs());

  it("varsayılan KAPALI: 'etkin değil' (flag_off)", async () => {
    expect(await isOrtakFlagOn()).toBe(false);
    expect(await ortakGate()).toEqual({ enabled: false, reason: "flag_off" });
  });

  it("bayrak açık olsa bile uçlar henüz yok: çağrı üretilmez (pending_endpoints)", async () => {
    store.set(EF_SETTING.ortakEnabled, "1");
    expect(ORTAK_ENDPOINTS_VERIFIED).toBe(false);
    expect(await ortakGate()).toEqual({ enabled: false, reason: "pending_endpoints" });
  });

  it("izinli yol listesinde ortak uç ve PDF raporu YOK", () => {
    expect(EMLAKFIYATI_ALLOWED_PATHS.some((p) => p.includes("ortak"))).toBe(false);
    expect(EMLAKFIYATI_ALLOWED_PATHS.some((p) => p.includes("rapor"))).toBe(false);
    expect(() => assertAllowedOutbound("https://emlakfiyati.com/api/ortak/v1/degerleme", {})).toThrow();
    expect(() => assertAllowedOutbound("https://emlakfiyati.com/api/parsel/rapor?format=pdf", {})).toThrow();
  });
});

describe("takma kullanıcı referansı", () => {
  beforeEach(() => vi.stubEnv("PLATFORM_SECRETS_KEY", FAKE_SECRETS_KEY));
  afterEach(() => vi.unstubAllEnvs());

  it("UUID'den kararlı, geçerli biçimli, geri çevrilemez ref üretir", () => {
    const ref = makeOrtakUserRef(UUID);
    expect(ref).toMatch(/^u_[0-9a-f]{48}$/);
    expect(isValidOrtakUserRef(ref as string)).toBe(true);
    expect(makeOrtakUserRef(UUID)).toBe(ref);
    expect(makeOrtakUserRef(UUID.toUpperCase())).toBe(ref);
    expect(ref).not.toContain(UUID.replace(/-/g, ""));
    expect(makeOrtakUserRef("00000000-0000-4000-8000-000000000000")).not.toBe(ref);
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
    expect(makeOrtakUserRef(input)).toBeNull();
    expect(makeOrtakHeaders(input)).toBeNull();
  });

  it("sır anahtarı yoksa ref üretilmez", () => {
    vi.stubEnv("PLATFORM_SECRETS_KEY", "");
    expect(makeOrtakUserRef(UUID)).toBeNull();
  });

  it("ref doğrulayıcı: 8-64 karakter ve [A-Za-z0-9_.:-]", () => {
    expect(isValidOrtakUserRef("a".repeat(7))).toBe(false);
    expect(isValidOrtakUserRef("a".repeat(8))).toBe(true);
    expect(isValidOrtakUserRef("a".repeat(64))).toBe(true);
    expect(isValidOrtakUserRef("a".repeat(65))).toBe(false);
    expect(isValidOrtakUserRef("abc defgh")).toBe(false);
    expect(isValidOrtakUserRef("abc@defgh")).toBe(false);
    expect(isValidOrtakUserRef("abc_.:-1234")).toBe(true);
  });

  it("Idempotency-Key her seferinde tekil; ortak başlıklar beyaz listede", () => {
    const a = makeIdempotencyKey();
    expect(a).not.toBe(makeIdempotencyKey());
    const headers = makeOrtakHeaders(UUID, a);
    expect(headers).toEqual({ userRef: makeOrtakUserRef(UUID), idempotencyKey: a });
    const built = buildEmlakFiyatiHeaders(FAKE_KEY, headers!);
    expect(built["X-Ortak-Kullanici-Ref"]).toBe(headers!.userRef);
    expect(built["Idempotency-Key"]).toBe(a);
    expect(() => assertAllowedOutbound("https://emlakfiyati.com/api/endeks", built)).not.toThrow();
    expect(() => buildEmlakFiyatiHeaders(FAKE_KEY, { userRef: "ali@x.com", idempotencyKey: a })).toThrow();
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
