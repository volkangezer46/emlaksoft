import { describe, expect, it } from "vitest";
import { parseReceiptText, ratesInLine } from "./text-parser";
import { amountsInLine, datesInLine, fixOcrDigits, foldTr } from "./numbers";

const lines = (s: string) => s.split("\n");

// --- ÖKC (yazar kasa) fişleri: gerçek düzenlere yakın, OCR gürültülü ---
const FUEL_OCR = `ÖZ ANADOLU PETROL ÜRÜNLERİ
TEC. LTD. STİ.
ATATÜRK CAD. NO:12 ÇANKAYA/ANKARA
ÇANKAYA V.D. 4810058590
TARİH : 12.09.2026 SAAT : 14:32
FİŞ NO : 0042
KURŞUNSUZ 95 820 *1.250,00
TOPKDV *208,33
TOPLAM *1.250,00
KREDİ KARTI *1.250,00
ZNO : 0123 EKÜ NO : 0001
MF YAB 12345678`;

const MARKET_MULTI = `HOŞGELDİNİZ
YILDIZ GIDA MARKETÇİLİK A.Ş.
Kızılay Mah. Gazi Mustafa Kemal Blv. No:7
Çankaya / ANKARA
TEL: 0312 444 55 66
ÇANKAYA VERGİ DAİRESİ 2650179910
12/09/2026 09:41
FİŞ NO: 1187
EKMEK                %01        *12,50
SÜT 1 LT             %01        *34,90
DETERJAN 3 KG        %20       *189,90
KAĞIT HAVLU          %20        *79,90
KDV %1                           *0,47
KDV %20                         *44,97
TOPKDV                          *45,44
TOPLAM                         *317,20
NAKİT                          *350,00
PARA ÜSTÜ                       *32,80
Z NO:0456  EKÜ NO:0002
MF ABC 87654321`;

const CAFE_NOISY = `* KAHVE DURAĞI *
Kahve Durağı Gıda Turizm San. ve Tic. Ltd. Şti.
Moda Cad. No:5 Kadıköy/İST
KADIKÖY V.D. 8760127958
TARIH: 03-10-2026      SAAT: 08:05
FIS NO: 0009
LATTE   X20   *95,OO
SİMİT   X1O   *20,00
TOPKDV        *17,65
TOPLAM       *115,00
K.KARTI      *115,00`;

// --- e-Arşiv PDF metin katmanı (satır kurucu çıktısı: sütunlar 3 boşlukla) ---
const EARSIV_PDF = `ORNEK BILISIM HIZMETLERI A.S.
Kizilay Mah. Ataturk Blv. No:5 Cankaya/ANKARA
Vergi Dairesi: KAVAKLIDERE   VKN: 4810058590
e-ARŞİV FATURA
SAYIN   Fatura No:   GIB2026000000123
DEMO EMLAK GAYRIMENKUL LTD. STI.   Fatura Tarihi:   12-09-2026
VKN: 3130557669   Son Ödeme Tarihi:   30-09-2026
ETTN: 04e26a62-7c00-46d0-878c-6f7c60834525
Danışmanlık hizmeti   1 Adet   %20   1.000,00 TL
Mal Hizmet Toplam Tutarı   1.000,00 TL
Hesaplanan KDV(%20)   200,00 TL
Vergiler Dahil Toplam Tutar   1.200,00 TL
Ödenecek Tutar   1.200,00 TL`;

const SMM_PDF = `Av. Ayşe Yılmaz
Serbest Meslek Makbuzu
Belge No: GIB2026000000009   Tarih: 01.09.2026
TCKN: 10000000146
SAYIN DEMO EMLAK LTD. ŞTİ.
Brüt Ücret   10.000,00
GV Stopaj (%20)   2.000,00
Net Ücret   8.000,00
KDV (%20)   2.000,00
KDV Tevkifatı (5/10)   1.000,00
Tahsil Edilen Tutar   9.000,00`;

const DEKONT = `TÜRKİYE İŞ BANKASI A.Ş.
HESAP HAREKETİ / DEKONT
İşlem Tarihi: 05.10.2026 11:20
Alıcı: SAHİBİNDEN BİLGİ TEKNOLOJİLERİ
IBAN: TR12 0006 4000 0011 2345 6789 01
Açıklama: EFT sahibinden kurumsal üyelik
İşlem Tutarı: 4.500,00 TL`;

describe("sayı/tarih yardımcıları", () => {
  it("tutar adayları: TR, US, yıldızlı; tarih ve saat tutar sayılmaz", () => {
    expect(amountsInLine("TOPLAM *1.250,00")).toEqual([1250]);
    expect(amountsInLine("Total 1,250.50 USD")).toEqual([1250.5]);
    expect(amountsInLine("TARİH 12.09.2026 SAAT 14:32")).toEqual([]);
    expect(amountsInLine("KDV %20 *208,33")).toEqual([208.33]);
    expect(amountsInLine("LATTE X20 *95,OO")).toEqual([95]);
  });
  it("OCR rakam düzeltmesi yalnız sayı bağlamında", () => {
    expect(fixOcrDigits("*1.25O,OO")).toBe("*1.250,00");
    expect(fixOcrDigits("KOZYATAĞI")).toBe("KOZYATAĞI");
  });
  it("tarih biçimleri", () => {
    expect(datesInLine("12/09/2026 09:41", foldTr)).toEqual(["2026-09-12"]);
    expect(datesInLine("Tarih: 2026-09-12", foldTr)).toEqual(["2026-09-12"]);
    expect(datesInLine("Düzenleme: 12 Eylül 2026", foldTr)).toEqual(["2026-09-12"]);
    expect(datesInLine("31.02.2026", foldTr)).toEqual([]);
  });
  it("KDV oranı belirteçleri (OCR % hataları dahil)", () => {
    expect(ratesInLine("EKMEK %01 *12,50")).toEqual([1]);
    expect(ratesInLine("Hesaplanan KDV(%20) 200,00")).toEqual([20]);
    expect(ratesInLine("KURŞUNSUZ 95 820 *1.250,00")).toEqual([20]);
    expect(ratesInLine("LATTE X20 *95,00")).toEqual([20]);
    expect(ratesInLine("ADET 820 1.250,00")).toEqual([]); // yıldızsız rakam karışması kabul edilmez
  });
});

describe("ÖKC fişleri", () => {
  it("akaryakıt fişi (OCR: % → 8, TİC → TEC)", () => {
    const f = parseReceiptText({ lines: lines(FUEL_OCR), source: "ocr", quality: 0.9 });
    expect(f.docType?.value).toBe("okc_fis");
    expect(f.total?.value).toBe(1250);
    expect(f.vatTotal?.value).toBe(208.33);
    expect(f.vatLines?.value.map((v) => v.rate)).toEqual([20]);
    expect(f.date?.value).toBe("2026-09-12");
    expect(f.time?.value).toBe("14:32");
    expect(f.documentNo?.value).toBe("0042");
    expect(f.zNo?.value).toBe("0123");
    expect(f.sellerTaxId?.value).toBe("4810058590");
    expect(f.sellerTaxOffice?.value).toBe("ÇANKAYA");
    expect(f.sellerName?.value).toBe("ÖZ ANADOLU PETROL ÜRÜNLERİ TEC. LTD. STİ.");
    expect(f.paymentMethod?.value).toBe("kart");
    expect(f.total!.source).toBe("ocr");
    expect(f.total!.confidence).toBeLessThan(0.9); // OCR tavanı
  });

  it("çok oranlı market fişi: oran bazında KDV, nakit + para üstü toplamı bozmaz, telefon VKN sanılmaz", () => {
    const f = parseReceiptText({ lines: lines(MARKET_MULTI), source: "ocr", quality: 0.85 });
    expect(f.total?.value).toBe(317.2);
    expect(f.vatTotal?.value).toBe(45.44);
    expect(f.vatLines?.value).toEqual([
      { rate: 20, base: null, amount: 44.97 },
      { rate: 1, base: null, amount: 0.47 },
    ]);
    expect(f.date?.value).toBe("2026-09-12");
    expect(f.sellerName?.value).toBe("YILDIZ GIDA MARKETÇİLİK A.Ş.");
    expect(f.sellerTaxId?.value).toBe("2650179910");
    expect(f.paymentMethod?.value).toBe("nakit");
    expect(f.items?.value.length).toBe(4);
    expect(f.items?.value[0]).toMatchObject({ name: "EKMEK", total: 12.5, vatRate: 1 });
  });

  it("gürültülü kafe fişi: O/0 karışması, X% okuması, tire ile tarih", () => {
    const f = parseReceiptText({ lines: lines(CAFE_NOISY), source: "ocr", quality: 0.7 });
    expect(f.total?.value).toBe(115);
    expect(f.date?.value).toBe("2026-10-03");
    expect(f.time?.value).toBe("08:05");
    expect(f.sellerName?.value).toBe("Kahve Durağı Gıda Turizm San. ve Tic. Ltd. Şti.");
    expect(f.sellerTaxId?.value).toBe("8760127958");
    expect(f.vatTotal?.value).toBe(17.65);
    expect(f.vatLines).toBeUndefined(); // iki oran (20 + 10) → tek oran çıkarımı yapılmaz
  });
});

describe("PDF metni", () => {
  it("e-Arşiv: ödenecek, KDV, matrah, belge no, ETTN; satıcı/alıcı ayrımı; son ödeme tarihi belge tarihi sayılmaz", () => {
    const f = parseReceiptText({ lines: lines(EARSIV_PDF), source: "pdf-text" });
    expect(f.docType?.value).toBe("e_arsiv");
    expect(f.total).toMatchObject({ value: 1200, source: "pdf-text" });
    expect(f.total!.confidence).toBeGreaterThanOrEqual(0.9);
    expect(f.grossTotal?.value).toBe(1200);
    expect(f.net?.value).toBe(1000);
    expect(f.vatLines?.value).toEqual([{ rate: 20, base: null, amount: 200 }]);
    expect(f.date?.value).toBe("2026-09-12");
    expect(f.documentNo?.value).toBe("GIB2026000000123");
    expect(f.ettn?.value).toBe("04e26a62-7c00-46d0-878c-6f7c60834525");
    expect(f.sellerTaxId?.value).toBe("4810058590");
    expect(f.buyerTaxId?.value).toBe("3130557669");
    expect(f.sellerName?.value).toBe("ORNEK BILISIM HIZMETLERI A.S.");
    expect(f.buyerName?.value).toBe("DEMO EMLAK GAYRIMENKUL LTD. STI.");
    expect(f.sellerTaxOffice?.value).toBe("KAVAKLIDERE");
    expect(f.items?.value[0]).toMatchObject({ name: "Danışmanlık hizmeti", total: 1000, vatRate: 20 });
    expect(f.currency?.value).toBe("TRY");
  });

  it("serbest meslek makbuzu: tahsilat, stopaj, tevkifat, TCKN", () => {
    const f = parseReceiptText({ lines: lines(SMM_PDF), source: "pdf-text" });
    expect(f.docType?.value).toBe("smm");
    expect(f.total?.value).toBe(9000);
    expect(f.incomeTaxWithholding?.value).toBe(2000);
    expect(f.vatWithholding?.value).toBe(1000);
    expect(f.sellerTaxId?.value).toBe("10000000146");
    expect(f.date?.value).toBe("2026-09-01");
    expect(f.documentNo?.value).toBe("GIB2026000000009");
  });

  it("banka dekontu: işlem tutarı ve tarihi, IBAN satırı VKN sanılmaz", () => {
    const f = parseReceiptText({ lines: lines(DEKONT), source: "pdf-text" });
    expect(f.docType?.value).toBe("dekont");
    expect(f.total?.value).toBe(4500);
    expect(f.date?.value).toBe("2026-10-05");
    expect(f.sellerTaxId).toBeUndefined();
  });

  it("boş ya da alakasız metinde alan uydurulmaz", () => {
    expect(parseReceiptText({ lines: [], source: "pdf-text" })).toEqual({});
    const f = parseReceiptText({ lines: ["Merhaba", "Toplantı notları"], source: "pdf-text" });
    expect(f.total).toBeUndefined();
    expect(f.date).toBeUndefined();
  });
});
