import { afterEach, describe, expect, it, vi } from "vitest";
import { leadHashCandidates, phoneHash, phoneHashCandidates, phoneHashV1, phoneHashV2 } from "./phone-hash";

const KEY = "k".repeat(40);

describe("telefon özeti v1/v2 (GUVENLIK2-03)", () => {
  afterEach(() => vi.unstubAllEnvs());

  function noKeys() {
    for (const n of ["FSBO_PHONE_HMAC_KEY", "OTP_HMAC_SECRET", "TWO_FACTOR_COOKIE_SECRET", "PROPERTY_MEDIA_SIGNING_SECRET"]) vi.stubEnv(n, "");
  }

  it("anahtar yoksa v1'e düşer ve yalnız v1 aranır", () => {
    noKeys();
    expect(phoneHashV2("t1", "05321234567")).toBeNull();
    expect(phoneHash("t1", "05321234567")).toBe(phoneHashV1("t1", "05321234567"));
    expect(phoneHashCandidates("t1", "05321234567")).toEqual([phoneHashV1("t1", "05321234567")]);
  });

  it("anahtar varsa yeni kayıt v2'dir; arama v2 + v1 birlikte bakar (geçiş dönemi)", () => {
    noKeys();
    vi.stubEnv("FSBO_PHONE_HMAC_KEY", KEY);
    const v2 = phoneHashV2("t1", "05321234567");
    expect(v2).toMatch(/^[0-9a-f]{64}$/);
    expect(phoneHash("t1", "05321234567")).toBe(v2);
    expect(v2).not.toBe(phoneHashV1("t1", "05321234567"));
    expect(phoneHashCandidates("t1", "05321234567")).toEqual([v2, phoneHashV1("t1", "05321234567")]);
    // Kiracı ve anahtar ayrımı: kiracı UUID'sini bilmek tek başına özeti üretmeye yetmez.
    expect(phoneHashV2("t2", "05321234567")).not.toBe(v2);
    vi.stubEnv("FSBO_PHONE_HMAC_KEY", "x".repeat(40));
    expect(phoneHashV2("t1", "05321234567")).not.toBe(v2);
  });

  it("kısa anahtar yok sayılır; yedek: zorunlu sunucu sırrından türetilmiş anahtar", () => {
    noKeys();
    vi.stubEnv("FSBO_PHONE_HMAC_KEY", "kisa");
    expect(phoneHashV2("t1", "05321234567")).toBeNull();
    vi.stubEnv("OTP_HMAC_SECRET", "o".repeat(40));
    expect(phoneHashV2("t1", "05321234567")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("kayıtlı özet her zaman aday listesindedir; telefon yoksa yalnız o", () => {
    noKeys();
    expect(leadHashCandidates("t1", null, "a".repeat(64))).toEqual(["a".repeat(64)]);
    expect(leadHashCandidates("t1", null, null)).toEqual([]);
    expect(leadHashCandidates("t1", "05321234567", "a".repeat(64))).toEqual([phoneHashV1("t1", "05321234567"), "a".repeat(64)]);
  });
});
