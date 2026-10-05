import { describe, expect, it } from "vitest";
import {
  buildOrtakValuationBody,
  classifyOrtakStatus,
  EMLAKFIYATI_ORTAK_TIMEOUT_MS,
  extractOrtakErrorCode,
  freeTextHasPersonalData,
  isPseudonymousUserRef,
  ortakRetryDelayMs,
  ortakValuationInputSchema,
  parseOrtakValuation,
  parseRetryAfterSeconds,
  rateBackoffMs,
  sanitizeRequestId,
  summarizeOrtakUsage,
} from "./ortak-contract";

const RID = "3f0c2d9e-1a2b-4c3d-8e4f-5a6b7c8d9e0f";

describe("istemci zaman aşımı", () => {
  it("değerleme ve PDF için en az 90 sn", () => {
    expect(EMLAKFIYATI_ORTAK_TIMEOUT_MS).toBeGreaterThanOrEqual(90_000);
  });
});

describe("girdi doğrulama", () => {
  it("arsa: ada yalnız rakam (1-12), parsel rakam / - (1-20)", () => {
    expect(ortakValuationInputSchema.safeParse({ mahalleId: 162, ada: "101", parsel: "1" }).success).toBe(true);
    expect(ortakValuationInputSchema.safeParse({ mahalleId: 162, ada: "101", parsel: "12/3-4" }).success).toBe(true);
    for (const bad of [
      { mahalleId: 0, ada: "1", parsel: "1" },
      { mahalleId: 1, ada: "", parsel: "1" },
      { mahalleId: 1, ada: "1".repeat(13), parsel: "1" },
      { mahalleId: 1, ada: "12a", parsel: "1" },
      { mahalleId: 1, ada: "1", parsel: "a" },
      { mahalleId: 1, ada: "1", parsel: "1".repeat(21) },
    ]) {
      expect(ortakValuationInputSchema.safeParse(bad).success).toBe(false);
    }
  });

  it("konutta alan (m²) zorunlu; kat > toplam kat reddedilir", () => {
    expect(ortakValuationInputSchema.safeParse({ mahalleId: 1, ada: "1", parsel: "1", tip: "konut" }).success).toBe(false);
    expect(ortakValuationInputSchema.safeParse({ mahalleId: 1, ada: "1", parsel: "1", tip: "konut", konut: { konutM2: 0 } }).success).toBe(false);
    expect(ortakValuationInputSchema.safeParse({ mahalleId: 1, ada: "1", parsel: "1", tip: "konut", konut: { konutM2: 90, kat: 6, katToplam: 5 } }).success).toBe(false);
    expect(ortakValuationInputSchema.safeParse({ mahalleId: 1, ada: "1", parsel: "1", tip: "konut", konut: { konutM2: 90, kat: 3, katToplam: 5 } }).success).toBe(true);
  });

  it("serbest metin: @ ve 11 hane (TC/telefon) reddedilir; site adı geçer", () => {
    expect(freeTextHasPersonalData("ali@ornek.com")).toBe(true);
    expect(freeTextHasPersonalData("12345678901")).toBe(true);
    expect(freeTextHasPersonalData("123 456 789 01")).toBe(true);
    expect(freeTextHasPersonalData("0532 123 45 67")).toBe(true);
    expect(freeTextHasPersonalData("Güneş Sitesi A Blok")).toBe(false);
    expect(freeTextHasPersonalData("Bahçeşehir 2. Kısım 34")).toBe(false);
    for (const field of ["siteAdi", "apartmanAdi", "blok"] as const) {
      const r = ortakValuationInputSchema.safeParse({
        mahalleId: 1, ada: "1", parsel: "1", tip: "konut", konut: { konutM2: 90, [field]: "ali@x.com" },
      });
      expect(r.success, field).toBe(false);
    }
  });

  it("gövde: bilinmeyen boolean'lar HİÇ gönderilmez; yalnız true olan olanaklar gider; arsada konut alanı yok", () => {
    const arsa = buildOrtakValuationBody(ortakValuationInputSchema.parse({ mahalleId: 162, ada: "101", parsel: "1" }));
    expect(JSON.parse(arsa as string)).toEqual({ mahalle_id: 162, ada: "101", parsel: "1", tip: "arsa" });

    const konut = buildOrtakValuationBody(
      ortakValuationInputSchema.parse({
        mahalleId: 162, ada: "101", parsel: "1", tip: "konut",
        konut: { konutM2: 95.5, site: true, asansor: false, acikHavuz: true, kapaliHavuz: false, siteAdi: " Güneş " },
      }),
    );
    const k = JSON.parse(konut as string).konut_ozellikleri;
    expect(k).toMatchObject({ konut_tipi: "daire", konut_m2: 95.5, site: true, asansor: false, acik_havuz: true, site_adi: "Güneş" });
    expect("otopark" in k).toBe(false);
    expect("kapali_havuz" in k).toBe(false);
  });
});

describe("hata sınıfı", () => {
  it.each([
    [400, "gecersiz_json", "bad_request"],
    [401, "kimlik_gerekli", "auth"],
    [403, "kapsam_yok", "forbidden"],
    [403, "ortak_bagi_yok", "forbidden"],
    [403, "ortak_pasif", "forbidden"],
    [404, "rapor_yok", "not_found"],
    [409, "istek_isleniyor", "busy"],
    [413, "govde_cok_buyuk", "too_large"],
    [422, "kullanici_ref_gecersiz", "invalid_input"],
    [422, "anahtar_tekrar_kullanimi", "invalid_input"],
    [429, "istek_siniri", "rate_limited"],
    [503, "kademeli_kuyruk", "unavailable"],
    [502, "pdf_uretilemedi", "pdf_failed"],
    [502, null, "server"],
    [500, null, "server"],
  ] as const)("%s %s -> %s", (status, code, kind) => {
    expect(classifyOrtakStatus(status, code)).toBe(kind);
  });

  it("hata gövdesinden önce `kod`, yoksa error.code; metin ASLA taşınmaz", () => {
    expect(extractOrtakErrorCode({ hata: "Türkçe açıklama", kod: "rapor_yok" })).toBe("rapor_yok");
    expect(extractOrtakErrorCode({ hata: "x", error: { code: "anahtar_tekrar_kullanimi" } })).toBe("anahtar_tekrar_kullanimi");
    expect(extractOrtakErrorCode({ hata: "operator veya admin yetkisi gerekli" })).toBeNull();
    expect(extractOrtakErrorCode({ kod: "Kötü Kod!" })).toBeNull();
    expect(extractOrtakErrorCode(null)).toBeNull();
  });

  it("Retry-After ve X-Istek-Id ayrıştırma", () => {
    expect(parseRetryAfterSeconds("5")).toBe(5);
    expect(parseRetryAfterSeconds(null)).toBeNull();
    expect(parseRetryAfterSeconds("Wed, 21 Oct 2026 07:28:00 GMT")).toBeNull();
    expect(sanitizeRequestId("req_ABC-123")).toBe("req_ABC-123");
    expect(sanitizeRequestId("a b\nc")).toBeNull();
    expect(sanitizeRequestId("x".repeat(101))).toBeNull();
  });
});

describe("geri çekilme", () => {
  const r0 = () => 0;
  it("429/503: Retry-After VARSA ona uyar (en çok 60 sn); yoksa 5 sn'den ikiye katlar (en çok 60 sn) + jitter", () => {
    expect(rateBackoffMs(0, 3, r0)).toBe(3000);
    expect(rateBackoffMs(0, 500, r0)).toBe(60_000);
    expect(rateBackoffMs(0, null, r0)).toBe(5000);
    expect(rateBackoffMs(1, null, r0)).toBe(10_000);
    expect(rateBackoffMs(2, null, r0)).toBe(20_000);
    expect(rateBackoffMs(9, null, r0)).toBe(60_000);
    expect(rateBackoffMs(0, null, () => 1)).toBe(6000); // +1 sn jitter
  });

  it("409 istek_isleniyor: 2 sn sonra AYNI anahtarla (en çok 5 kez)", () => {
    expect(ortakRetryDelayMs({ kind: "busy", retryIndex: 0, retryAfterSec: null, random: r0 })).toBe(2000);
    expect(ortakRetryDelayMs({ kind: "busy", retryIndex: 5, retryAfterSec: null, random: r0 })).toBeNull();
  });

  it("502 pdf_uretilemedi: 10 sn ve 30 sn'de en çok 2 deneme", () => {
    expect(ortakRetryDelayMs({ kind: "pdf_failed", retryIndex: 0, retryAfterSec: 10, random: r0 })).toBe(10_000);
    expect(ortakRetryDelayMs({ kind: "pdf_failed", retryIndex: 1, retryAfterSec: 10, random: r0 })).toBe(30_000);
    expect(ortakRetryDelayMs({ kind: "pdf_failed", retryIndex: 2, retryAfterSec: 10, random: r0 })).toBeNull();
  });

  it("5xx: en çok 2 deneme (10 sn, 30 sn); ağ: en çok 2; zaman aşımı: 1", () => {
    expect(ortakRetryDelayMs({ kind: "server", retryIndex: 0, retryAfterSec: null, random: r0 })).toBe(10_000);
    expect(ortakRetryDelayMs({ kind: "server", retryIndex: 1, retryAfterSec: null, random: r0 })).toBe(30_000);
    expect(ortakRetryDelayMs({ kind: "server", retryIndex: 2, retryAfterSec: null, random: r0 })).toBeNull();
    expect(ortakRetryDelayMs({ kind: "network", retryIndex: 1, retryAfterSec: null, random: r0 })).not.toBeNull();
    expect(ortakRetryDelayMs({ kind: "network", retryIndex: 2, retryAfterSec: null, random: r0 })).toBeNull();
    expect(ortakRetryDelayMs({ kind: "timeout", retryIndex: 0, retryAfterSec: null, random: r0 })).not.toBeNull();
    expect(ortakRetryDelayMs({ kind: "timeout", retryIndex: 1, retryAfterSec: null, random: r0 })).toBeNull();
  });

  it("400/401/403/404/413/422 ASLA yeniden denenmez", () => {
    for (const kind of ["bad_request", "auth", "forbidden", "not_found", "too_large", "invalid_input", "invalid_response", "disabled"] as const) {
      expect(ortakRetryDelayMs({ kind, retryIndex: 0, retryAfterSec: 1, random: r0 }), kind).toBeNull();
    }
  });
});

describe("K10 yanıt ayrıştırma", () => {
  const base = {
    sonuc_durumu: "deger",
    ucretlendirilir: true,
    rapor_id: RID,
    tip: "arsa",
    parsel: { ada: "101", parsel: "1", ilce_ad: "Çukurova", alan_m2: "500" },
    rapor_gecerlilik: { gun: 30, expires_at: "2026-11-04T09:00:00.000Z" },
    yeni_bilinmeyen_alan: { x: 1 },
  };

  it("normal güvenli sonuç: bilinmeyen alanlar yok sayılır, TL korunur", () => {
    const r = parseOrtakValuation({ ...base, tahmin: { deger_tl: 1_500_000 }, fiyat_yayin: { guven_sinifi: "orta", deger_tl: 1_500_000 } });
    expect(r.ok).toBe(true);
    if (!r.ok || r.value.durum !== "deger") throw new Error("beklenmeyen");
    expect(r.value.dusukGuven).toBe(false);
    expect(r.value.ucretlendirilir).toBe(true);
    expect(r.value.raporId).toBe(RID);
    expect(r.value.expiresAt).toBe("2026-11-04T09:00:00.000Z");
    expect((r.value.tahmin as { deger_tl: number }).deger_tl).toBe(1_500_000);
  });

  it("düşük güven: null TL null kalır (0/bilinmiyor DEĞİL); sızan sayılar savunma olarak maskelenir; guven_sunumu korunur", () => {
    const r = parseOrtakValuation({
      ...base,
      tahmin: { deger_tl: null, birim_fiyat_tl_m2: 12345, emsal_adedi: 4 },
      fiyat_yayin: { guven_sinifi: "dusuk", toplam_tl: 9_999_999, guven_sunumu: { aralik_alt: 1_000_000, aralik_ust: 2_000_000, metin: "Veri sınırlı." } },
    });
    if (!r.ok || r.value.durum !== "deger") throw new Error("beklenmeyen");
    expect(r.value.dusukGuven).toBe(true);
    const tahmin = r.value.tahmin as Record<string, unknown>;
    expect(tahmin.deger_tl).toBeNull();
    expect(tahmin.birim_fiyat_tl_m2).toBeNull();
    expect(tahmin.emsal_adedi).toBe(4);
    const fy = r.value.fiyatYayin as Record<string, unknown>;
    expect(fy.toplam_tl).toBeNull();
    expect(r.value.guvenSunumu).toEqual({ aralik_alt: 1_000_000, aralik_ust: 2_000_000, metin: "Veri sınırlı." });
  });

  it("yetersiz: HATA DEĞİL, ücretlendirilmez, rapor_id yok", () => {
    const r = parseOrtakValuation({ sonuc_durumu: "yetersiz", ucretlendirilir: false, mesaj: "Veri yok", nedenler: ["deger_yok"] });
    expect(r).toEqual({ ok: true, value: { durum: "yetersiz", ucretlendirilir: false, mesaj: "Veri yok", nedenler: ["deger_yok"] } });
  });

  it("ucretlendirilir eksikse FALSE sayılır (kontör kesinleşmez); geçersiz rapor_id null", () => {
    const r = parseOrtakValuation({ ...base, ucretlendirilir: undefined, rapor_id: "../x" });
    if (!r.ok || r.value.durum !== "deger") throw new Error("beklenmeyen");
    expect(r.value.ucretlendirilir).toBe(false);
    expect(r.value.raporId).toBeNull();
  });

  it("bozuk yanıt reddedilir", () => {
    expect(parseOrtakValuation("x").ok).toBe(false);
    expect(parseOrtakValuation({ sonuc_durumu: "baska" }).ok).toBe(false);
  });

  it("kullanım özeti: sınırlar ve tarife.surum", () => {
    const s = summarizeOrtakUsage({
      ortak: { kod: "emlaksoft", ad: "Emlaksoft" },
      tarife: { sorgu_tl: 0, pdf_tl: 0, surum: "v1:0:0" },
      sinirlar: { istek_dakika: 1200, pdf_dakika: 60, esz_pdf: 3, esz_degerleme: 6 },
      toplam: { istek: 5, degerleme: 2, pdf: 1 },
      yeni: 1,
    });
    expect(s).toMatchObject({ tarifeSurum: "v1:0:0", sinirlar: { eszDegerleme: 6, eszPdf: 3, pdfDakika: 60, istekDakika: 1200 }, toplam: { degerleme: 2, pdf: 1 } });
    expect(summarizeOrtakUsage(null)).toBeNull();
  });
});

describe("takma kimlik son doğrulaması", () => {
  it("rakamsız / yalnız rakam / @ / boşluk reddedilir", () => {
    expect(isPseudonymousUserRef("u-0123456789abcdef0123456789abcdef")).toBe(true);
    expect(isPseudonymousUserRef("u-abcdefabcdefabcdefabcdefabcdefab")).toBe(false);
    expect(isPseudonymousUserRef("05321234567")).toBe(false);
    expect(isPseudonymousUserRef("ali@x.com1")).toBe(false);
    expect(isPseudonymousUserRef("ahmet yilmaz1")).toBe(false);
  });
});
