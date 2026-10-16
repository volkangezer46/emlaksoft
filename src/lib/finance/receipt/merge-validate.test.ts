import { describe, expect, it } from "vitest";
import { mergeLayers, nameSimilarity } from "./merge";
import { toLegacySuggestion, validateFields } from "./validate";
import { assembleExtraction, compactForStorage, readStoredExtraction, withSuggestions } from "./assemble";
import { parseAiReceipt } from "./ai-parse";
import type { LayerFields, ReceiptFields } from "./types";

const TODAY = "2026-10-16";

describe("katman birleştirme (öncelik: karekod > XML > PDF > OCR > AI)", () => {
  it("üst kaynak kazanır; aynı değeri veren alt kaynak güveni artırır", () => {
    const qr: LayerFields = { total: { value: 1200, confidence: 0.99, source: "karekod" }, date: { value: "2026-09-12", confidence: 0.99, source: "karekod" } };
    const ocr: LayerFields = { total: { value: 1200, confidence: 0.7, source: "ocr" }, sellerName: { value: "ÖRNEK A.Ş.", confidence: 0.6, source: "ocr" } };
    const { fields, warnings } = mergeLayers([ocr, qr]);
    expect(fields.total).toEqual({ value: 1200, confidence: 0.99, source: "karekod" });
    expect(fields.sellerName?.source).toBe("ocr"); // karekodda unvan yok → alt katman doldurur
    expect(warnings).toEqual([]);
  });

  it("çelişkide üst kaynak kalır, uyarı üretilir ve güven düşer", () => {
    const pdf: LayerFields = { total: { value: 1200, confidence: 0.93, source: "pdf-text" } };
    const ocr: LayerFields = { total: { value: 1290, confidence: 0.8, source: "ocr" } };
    const { fields, warnings } = mergeLayers([pdf, ocr]);
    expect(fields.total?.value).toBe(1200);
    expect(fields.total!.confidence).toBeLessThan(0.93);
    expect(warnings[0]).toMatchObject({ code: "conflict", field: "total" });
    expect(warnings[0]!.message).toContain("PDF metni");
  });

  it("çok düşük güvenli üst kaynağı güçlü yapay zekâ adayı geçer", () => {
    const ocr: LayerFields = { date: { value: "2026-09-21", confidence: 0.4, source: "ocr" } };
    const ai: LayerFields = { date: { value: "2026-09-12", confidence: 0.85, source: "ai" } };
    expect(mergeLayers([ocr, ai]).fields.date?.value).toBe("2026-09-12");
  });

  it("ad benzerliği unvan eklerini yok sayar", () => {
    expect(nameSimilarity("ÖZ ANADOLU PETROL ÜRÜNLERİ TİC. LTD. ŞTİ.", "Öz Anadolu Petrol Ürünleri")).toBeGreaterThanOrEqual(0.9);
    expect(nameSimilarity("Migros", "Opet")).toBe(0);
  });
});

describe("doğrulama", () => {
  const base = (over: Partial<ReceiptFields>): ReceiptFields => ({
    total: { value: 1200, confidence: 0.8, source: "pdf-text" },
    net: { value: 1000, confidence: 0.8, source: "pdf-text" },
    vatTotal: { value: 200, confidence: 0.8, source: "pdf-text" },
    date: { value: "2026-09-12", confidence: 0.9, source: "pdf-text" },
    ...over,
  });

  it("matrah + KDV = toplam ise güven artar", () => {
    const { fields, warnings } = validateFields(base({}), TODAY);
    expect(warnings).toEqual([]);
    expect(fields.total!.confidence).toBeGreaterThan(0.8);
    expect(fields.vatTotal!.confidence).toBeGreaterThan(0.8);
  });

  it("tutmayan toplam uyarı üretir", () => {
    const { warnings, fields } = validateFields(base({ total: { value: 1290, confidence: 0.9, source: "ocr" } }), TODAY);
    expect(warnings.map((w) => w.code)).toContain("total_mismatch");
    expect(fields.total!.confidence).toBeLessThanOrEqual(0.75);
  });

  it("tevkifatlı faturada ödenecek + tevkifat = matrah + KDV", () => {
    const { warnings } = validateFields(
      base({ total: { value: 1100, confidence: 0.9, source: "pdf-text" }, vatWithholding: { value: 100, confidence: 0.9, source: "pdf-text" } }),
      TODAY,
    );
    expect(warnings).toEqual([]);
  });

  it("tek oranda KDV = toplam × oran / (100 + oran) denetimi (ÖKC)", () => {
    const ok = validateFields(
      { total: { value: 1250, confidence: 0.79, source: "ocr" }, vatTotal: { value: 208.33, confidence: 0.79, source: "ocr" }, vatLines: { value: [{ rate: 20, base: null, amount: 208.33 }], confidence: 0.7, source: "ocr" } },
      TODAY,
    );
    expect(ok.warnings).toEqual([]);
    expect(ok.fields.total!.confidence).toBeGreaterThan(0.79);
    const bad = validateFields(
      { total: { value: 1250, confidence: 0.79, source: "ocr" }, vatTotal: { value: 113.64, confidence: 0.79, source: "ocr" }, vatLines: { value: [{ rate: 20, base: null, amount: 113.64 }], confidence: 0.7, source: "ocr" } },
      TODAY,
    );
    expect(bad.warnings.map((w) => w.code)).toContain("vat_mismatch");
  });

  it("oran satırında matrah × oran ≠ KDV ise uyarı", () => {
    const { warnings } = validateFields(base({ vatLines: { value: [{ rate: 20, base: 1000, amount: 180 }], confidence: 0.9, source: "pdf-text" } }), TODAY);
    expect(warnings.map((w) => w.code)).toContain("vat_mismatch");
  });

  it("VKN/TCKN sağlaması tutmazsa uyarı + düşük güven", () => {
    const { warnings, fields } = validateFields(base({ sellerTaxId: { value: "1111111111", confidence: 0.99, source: "karekod" } }), TODAY);
    expect(warnings.find((w) => w.code === "vkn_checksum")?.field).toBe("sellerTaxId");
    expect(fields.sellerTaxId!.confidence).toBeLessThanOrEqual(0.45);
    const t = validateFields(base({ buyerTaxId: { value: "12345678901", confidence: 0.8, source: "ocr" } }), TODAY);
    expect(t.warnings.map((w) => w.code)).toContain("tckn_checksum");
  });

  it("gelecek tarih ve 1 yıldan eski tarih uyarısı; yabancı para", () => {
    expect(validateFields(base({ date: { value: "2026-11-30", confidence: 0.9, source: "ocr" } }), TODAY).warnings.map((w) => w.code)).toContain("future_date");
    expect(validateFields(base({ date: { value: "2025-06-01", confidence: 0.9, source: "ocr" } }), TODAY).warnings.map((w) => w.code)).toContain("old_date");
    expect(validateFields(base({ currency: { value: "EUR", confidence: 0.9, source: "xml" } }), TODAY).warnings.map((w) => w.code)).toContain("foreign_currency");
  });

  it("eski biçim öneri yalnız güvenli alanları taşır; çok oranda KDV oranı verilmez", () => {
    const legacy = toLegacySuggestion({
      total: { value: 317.2, confidence: 0.8, source: "ocr" },
      date: { value: "2026-09-12", confidence: 0.4, source: "ocr" },
      vatLines: { value: [{ rate: 20, base: null, amount: 1 }, { rate: 1, base: null, amount: 1 }], confidence: 0.8, source: "ocr" },
      sellerName: { value: "YILDIZ GIDA", confidence: 0.7, source: "ocr" },
    });
    expect(legacy).toEqual({ amount: 317.2, vendor: "YILDIZ GIDA" });
  });
});

describe("derleme ve saklama", () => {
  it("katmanları birleştirir, doğrular, mükerrer uyarısını öne alır, ham metin taşımaz", () => {
    const x = assembleExtraction({
      layers: [{ total: { value: 1200, confidence: 0.99, source: "karekod" }, sellerTaxId: { value: "1111111111", confidence: 0.99, source: "karekod" } }],
      reports: [{ source: "karekod", status: "done" }],
      todayIso: TODAY,
      nowIso: "2026-10-16T10:00:00.000Z",
      ai: "off",
    });
    const y = withSuggestions(x, { duplicates: [{ kind: "ettn", label: "Aynı ETTN", href: "/x" }] });
    expect(y.warnings[0]!.code).toBe("duplicate");
    expect(JSON.stringify(y)).not.toMatch(/lines|text/i);
    expect(readStoredExtraction(JSON.parse(JSON.stringify(y)))).toEqual(y);
    expect(readStoredExtraction({ version: 2 })).toBeNull();
  });

  it("saklama sınırını aşınca kalemler atılır", () => {
    const items = Array.from({ length: 20 }, (_, i) => ({ name: `Kalem ${"x".repeat(70)} ${i}`, quantity: 1, total: 1, vatRate: 20 }));
    const x = assembleExtraction({ layers: [{ items: { value: items, confidence: 0.9, source: "xml" } }], reports: [], todayIso: TODAY, nowIso: "", ai: "off" });
    expect(compactForStorage(x, 1000).fields.items).toBeUndefined();
    expect(compactForStorage(x).fields.items?.value.length).toBe(20);
  });
});

describe("yapay zekâ yanıtı", () => {
  it("zengin şemayı doğrulayarak okur; güveni 0,9 ile sınırlar; maskeli/geçersiz değeri atar", () => {
    const f = parseAiReceipt(
      JSON.stringify({
        belge_turu: "e_arsiv",
        belge_no: "GIB2026000000123",
        ettn: "04E26A62-7C00-46D0-878C-6F7C60834525",
        tarih: "12.09.2026",
        saat: "14:32",
        para_birimi: "TRY",
        toplam: "1.200,00",
        matrah: "1.000,00",
        kdv_toplam: "200,00",
        kdv_kirilimi: [{ oran: 20, matrah: "1.000,00", kdv: "200,00" }, { oran: 18.5, matrah: "1", kdv: "1" }],
        satici_unvan: "ÖRNEK A.Ş.",
        satici_vkn_tckn: "481 005 8590",
        alici_unvan: "[TELEFON_1]",
        odeme_sekli: "kart",
        kalemler: [{ ad: "Danışmanlık", miktar: 1, tutar: "1.000,00", kdv_orani: 20 }],
        guven: { toplam: 0.98, tarih: 0.9, satici_unvan: 0.5 },
      }),
      TODAY,
    );
    expect(f.total).toMatchObject({ value: 1200, source: "ai" });
    expect(f.total!.confidence).toBeLessThanOrEqual(0.9);
    expect(f.sellerName!.confidence).toBeLessThan(0.5);
    expect(f.vatLines?.value).toEqual([{ rate: 20, base: 1000, amount: 200 }]);
    expect(f.sellerTaxId?.value).toBe("4810058590");
    expect(f.buyerName).toBeUndefined();
    expect(f.ettn?.value).toBe("04e26a62-7c00-46d0-878c-6f7c60834525");
    expect(f.date?.value).toBe("2026-09-12");
    expect(f.paymentMethod?.value).toBe("kart");
    expect(f.items?.value[0]).toMatchObject({ name: "Danışmanlık", total: 1000, vatRate: 20 });
    expect(parseAiReceipt("çöp", TODAY)).toEqual({});
  });
});
