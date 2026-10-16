import { describe, expect, it } from "vitest";
import { looksLikeGibQr, parseGibQr } from "./karekod";
import { isValidTckn, isValidVkn, classifyTaxId, vknWithChecksum } from "./tax-id";

// GİB "Karekod Standardı Kılavuzu" (Şubat 2023) örnekleri + gerçek dünyada görülen sapmalar.
const EFATURA = `{"vkntckn":"1111111111",
"avkntckn":"1111111111",
"senaryo":"TEMELFATURA",
"tip":"SATIS",
"tarih":"2022-08-17",
"no":"GIB2022000000001",
"ettn":"04e26a62-7c00-46d0-878c-6f7c60834525",
"parabirimi":"TRY",
"malhizmettoplam":"1000.00",
"kdvmatrah(8)":"1000.00",
"hesaplanankdv(8)":"80.00",
"vergidahil":"1080.00",
"odenecek":"1080.00"}`;

const EARSIV_SPACE = `{"vkntckn":"4810058590","avkntckn":"11111111111","senaryo":"EARSIVFATURA","tip":"SATIS","tarih":"2026-09-12","no":"ABC2026000000042","ettn":"7EF629D7-5FEA-4102-86D4-6620C963B071","parabirimi":"TRY","malhizmettoplam":"1500.00","kdvmatrah (20)":"1000.00","hesaplanankdv (20)":"200.00","kdvmatrah(10)":"500.00","hesaplanankdv(10)":"50.00","vergidahil":"1750.00","odenecek":"1750.00"}`;

const ESMM = `{"vkntckn":"11111111111","avkntckn":"3130557669","tarih":"2026-09-01","no":"GIB2026000000007","ettn":"05e37a73-8c10-46d0-878c-6f7c60834525","parabirimi":"TRY","brutucret":"1000.00","tahsilkdv":"90.00","kdvtevkifat":"90.00","gvstopaj":"200.00","kdvtutari":"180.00","netucret":"800.00","tahsilat":"890.00"}`;

// Kılavuzdaki e-MM örneğinde olduğu gibi BOZUK JSON (açılış tırnağı eksik).
const EMM_BROKEN = `{"vkntckn":"1111111111",
"avkntckn":"1111111111",
"senaryo":"EARSIVBELGE",
"tip":"MUHTAHSILMAKBUZU",
"tarih":"2022-08-17",
"no":"GIB2022000000001",
"ettn":"04e35a62-7c00-45d0-968c-6f7c60834525",
"parabirimi":"TRY",
"malhizmettoplam":"5000.00",
"gvstopaj":"200.00",
"merafonu":"100.00",
"borsatescilucreti":92.00",
"sgkprimkesintisi":"100.00",
"odenecek":"4508.00"}`;

const TEVKIFAT = JSON.stringify({ vkntckn: "2650179910", avkntckn: "3130557669", senaryo: "TICARIFATURA", tip: "TEVKIFAT", tarih: "2026-08-30", no: "TVK2026000000101", ettn: "11111111-2222-4333-8444-555555555555", parabirimi: "TRY", malhizmettoplam: "10000.00", "kdvmatrah(20)": "10000.00", "hesaplanankdv(20)": "2000.00", vergidahil: "12000.00", odenecek: "10400.00" });

describe("VKN / TCKN sağlaması", () => {
  it("gerçek VKN'leri doğrular, rastgeleleri reddeder", () => {
    for (const v of ["3130557669", "2650179910", "8760127958", "4810058590"]) expect(isValidVkn(v)).toBe(true);
    for (const v of ["1111111111", "3130557668", "123456789", "abcdefghij"]) expect(isValidVkn(v)).toBe(false);
    expect(isValidVkn(vknWithChecksum("123456789"))).toBe(true);
  });
  it("TCKN algoritması", () => {
    expect(isValidTckn("10000000146")).toBe(true);
    expect(isValidTckn("12345678901")).toBe(false);
    expect(isValidTckn("01234567890")).toBe(false);
  });
  it("sınıflandırma rakam dışını atar", () => {
    expect(classifyTaxId("481 005 8590")).toEqual({ value: "4810058590", kind: "vkn", valid: true });
    expect(classifyTaxId("10000000146")).toEqual({ value: "10000000146", kind: "tckn", valid: true });
    expect(classifyTaxId("12345")).toBeNull();
  });
});

describe("GİB karekodu", () => {
  it("kılavuz e-Fatura örneğini birebir okur", () => {
    const f = parseGibQr(EFATURA)!;
    expect(f.total).toMatchObject({ value: 1080, source: "karekod" });
    expect(f.total!.confidence).toBeGreaterThanOrEqual(0.99);
    expect(f.grossTotal?.value).toBe(1080);
    expect(f.net?.value).toBe(1000);
    expect(f.vatTotal?.value).toBe(80);
    expect(f.vatLines?.value).toEqual([{ rate: 8, base: 1000, amount: 80 }]);
    expect(f.date?.value).toBe("2022-08-17");
    expect(f.documentNo?.value).toBe("GIB2022000000001");
    expect(f.ettn?.value).toBe("04e26a62-7c00-46d0-878c-6f7c60834525");
    expect(f.currency?.value).toBe("TRY");
    expect(f.docType?.value).toBe("e_fatura");
    // Kılavuz örnek VKN'si sağlamayı tutmaz → değer korunur, güven düşer (doğrulama uyarı üretir).
    expect(f.sellerTaxId).toMatchObject({ value: "1111111111" });
    expect(f.sellerTaxId!.confidence).toBeLessThan(0.7);
  });

  it("e-Arşiv: anahtardaki boşluk, büyük harf ETTN, iki KDV oranı", () => {
    const f = parseGibQr(EARSIV_SPACE)!;
    expect(f.docType?.value).toBe("e_arsiv");
    expect(f.vatLines?.value).toEqual([
      { rate: 20, base: 1000, amount: 200 },
      { rate: 10, base: 500, amount: 50 },
    ]);
    expect(f.vatTotal?.value).toBe(250);
    expect(f.net?.value).toBe(1500);
    expect(f.total?.value).toBe(1750);
    expect(f.ettn?.value).toBe("7ef629d7-5fea-4102-86d4-6620c963b071");
    expect(f.buyerTaxId?.value).toBe("11111111111");
    expect(f.sellerTaxId!.confidence).toBeGreaterThanOrEqual(0.99);
  });

  it("e-SMM: tahsilat, stopaj ve tevkifat", () => {
    const f = parseGibQr(ESMM)!;
    expect(f.docType?.value).toBe("smm");
    expect(f.total?.value).toBe(890);
    expect(f.net?.value).toBe(1000);
    expect(f.vatTotal?.value).toBe(180);
    expect(f.incomeTaxWithholding?.value).toBe(200);
    expect(f.vatWithholding?.value).toBe(90);
  });

  it("bozuk JSON (kılavuzdaki e-MM örneği) anahtar-değer okumasıyla çözülür", () => {
    const f = parseGibQr(EMM_BROKEN)!;
    expect(f.total?.value).toBe(4508);
    expect(f.incomeTaxWithholding?.value).toBe(200);
    expect(f.docType?.value).toBe("makbuz");
  });

  it("TEVKIFAT tipinde ödenecek ile vergi dahil farkı KDV tevkifatıdır", () => {
    const f = parseGibQr(TEVKIFAT)!;
    expect(f.total?.value).toBe(10400);
    expect(f.grossTotal?.value).toBe(12000);
    expect(f.vatWithholding?.value).toBe(1600);
  });

  it("GİB karekodu olmayan içerik reddedilir", () => {
    expect(parseGibQr("https://example.com/odeme")).toBeNull();
    expect(parseGibQr('{"a":1,"b":2}')).toBeNull();
    expect(looksLikeGibQr(EFATURA)).toBe(true);
    expect(parseGibQr("x".repeat(9000))).toBeNull();
  });
});
