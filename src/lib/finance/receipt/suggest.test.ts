import { describe, expect, it } from "vitest";
import { duplicateKeysOf, findDuplicates, matchParty, suggestCategory } from "./suggest";
import { applyFromDraft, draftFromExtraction, parseDraftAmount, primaryVatRate, shouldAutoRunAi } from "./review";
import type { ReceiptExtraction, ReceiptFields } from "./types";

const F = (over: Partial<ReceiptFields>): ReceiptFields => ({ ...over });
const seller = (name: string): Partial<ReceiptFields> => ({ sellerName: { value: name, confidence: 0.8, source: "ocr" } });

describe("kategori önerisi", () => {
  it("anahtar sözcük: akaryakıt → Ulaşım, portal → Portal, kırtasiye → Ofis, mali müşavir → Muhasebe", () => {
    expect(suggestCategory({ fields: F(seller("ÖZ ANADOLU PETROL ÜRÜNLERİ TİC. LTD. ŞTİ.")) })).toMatchObject({ value: "ulasim", reason: "anahtar" });
    expect(suggestCategory({ fields: F({ ...seller("OPET"), items: { value: [{ name: "KURŞUNSUZ 95", quantity: null, total: 1, vatRate: 20 }], confidence: 0.7, source: "ocr" } }) })?.value).toBe("ulasim");
    expect(suggestCategory({ fields: F(seller("Sahibinden Bilgi Teknolojileri Paz. ve Tic. A.Ş.")) })?.value).toBe("portal");
    expect(suggestCategory({ fields: F(seller("Hepsiemlak")) })?.value).toBe("portal");
    expect(suggestCategory({ fields: F(seller("Ankara Kırtasiye Ltd.")) })?.value).toBe("ofis");
    expect(suggestCategory({ fields: F(seller("Yılmaz SMMM Mali Müşavirlik")) })?.value).toBe("muhasebe");
    expect(suggestCategory({ fields: F({ ...seller("Ahmet Kaya"), docType: { value: "smm", confidence: 0.9, source: "karekod" }, items: { value: [{ name: "İşyeri kirası Eylül", quantity: null, total: 1, vatRate: null }], confidence: 0.7, source: "xml" } }) })?.value).toBe("kira");
  });

  it("kısa sözcükler yalnız tam kelime eşleşir (pos ≠ po)", () => {
    expect(suggestCategory({ fields: F(seller("POS CİHAZI SERVİSİ")) })).toBeUndefined();
  });

  it("öncelik: ofis kuralı > cari geçmişi > anahtar sözcük", () => {
    const fields = F(seller("OPET"));
    expect(suggestCategory({ fields, rule: { category: "x_arac" }, history: [{ category: "ofis", count: 5 }] })).toMatchObject({ value: "x_arac", reason: "kural" });
    expect(suggestCategory({ fields, history: [{ category: "reklam", count: 3 }] })).toMatchObject({ value: "reklam", reason: "gecmis" });
    expect(suggestCategory({ fields, history: [{ category: "reklam", count: 1 }] })).toMatchObject({ value: "ulasim", reason: "anahtar" });
  });
});

describe("cari eşleştirme", () => {
  const parties = [
    { id: "p1", name: "Öz Anadolu Petrol", taxId: "4810058590" },
    { id: "p2", name: "Yıldız Gıda Marketçilik", taxId: null },
    { id: "p3", name: "Sahibinden", taxId: "8760127958" },
  ];
  it("önce VKN birebir", () => {
    expect(matchParty(F({ sellerTaxId: { value: "4810058590", confidence: 0.99, source: "karekod" } }), parties)).toMatchObject({ id: "p1", reason: "vkn", confidence: 0.99 });
  });
  it("sonra ad benzerliği (unvan ekleri atılır)", () => {
    expect(matchParty(F(seller("YILDIZ GIDA MARKETÇİLİK A.Ş.")), parties)).toMatchObject({ id: "p2", reason: "ad" });
    expect(matchParty(F(seller("Kahve Durağı")), parties)).toBeUndefined();
  });
  it("farklı VKN'li cariyle ad benzer olsa da eşleşmez", () => {
    expect(matchParty(F({ ...seller("Sahibinden"), sellerTaxId: { value: "2650179910", confidence: 0.9, source: "ocr" } }), parties)).toBeUndefined();
  });
});

describe("mükerrer tespiti", () => {
  const stored = (o: Record<string, unknown>) => ({ version: 1, fields: Object.fromEntries(Object.entries(o).map(([k, v]) => [k, { value: v, confidence: 0.9, source: "ocr" }])) });
  const attachments = [
    { id: "a1", entryId: "e1", extraction: duplicateKeysOf(stored({ ettn: "04e26a62-7c00-46d0-878c-6f7c60834525", total: 1200, date: "2026-09-12" })) },
    { id: "a2", entryId: null, extraction: duplicateKeysOf(stored({ sellerTaxId: "4810058590", documentNo: "0042", total: 1250, date: "2026-09-12", zNo: "0123" })) },
    { id: "a3", entryId: null, extraction: duplicateKeysOf(stored({ sellerName: "Yıldız Gıda", total: 317.2, date: "2026-09-11" })) },
  ];
  it("ETTN, satıcı VKN + belge no, tutar + tarih + satıcı", () => {
    const byEttn = findDuplicates(F({ ettn: { value: "04E26A62-7C00-46D0-878C-6F7C60834525", confidence: 0.99, source: "karekod" } }), { attachments, entries: [] });
    expect(byEttn).toMatchObject([{ kind: "ettn", attachmentId: "a1", entryId: "e1" }]);
    expect(byEttn[0]!.href).toMatch(/\/kayit\/e1$/);
    const byNo = findDuplicates(F({ sellerTaxId: { value: "4810058590", confidence: 0.9, source: "ocr" }, documentNo: { value: "0042", confidence: 0.8, source: "ocr" } }), { attachments, entries: [] });
    expect(byNo).toMatchObject([{ kind: "belge_no", attachmentId: "a2" }]);
    expect(byNo[0]!.href).toMatch(/sekme=belgeler$/);
    const byAmount = findDuplicates(F({ ...seller("YILDIZ GIDA MARKETÇİLİK"), total: { value: 317.2, confidence: 0.8, source: "ocr" }, date: { value: "2026-09-12", confidence: 0.8, source: "ocr" } }), { attachments, entries: [] });
    expect(byAmount).toMatchObject([{ kind: "tutar_tarih", attachmentId: "a3" }]);
  });
  it("kendi eki ve farklı satıcı sayılmaz; kayıtlarla tutar+tarih eşleşmesi", () => {
    expect(findDuplicates(F({ ettn: { value: "04e26a62-7c00-46d0-878c-6f7c60834525", confidence: 0.99, source: "karekod" } }), { selfId: "a1", attachments, entries: [] })).toEqual([]);
    const hits = findDuplicates(F({ ...seller("OPET"), total: { value: 317.2, confidence: 0.8, source: "ocr" }, date: { value: "2026-09-12", confidence: 0.8, source: "ocr" } }), {
      attachments,
      entries: [
        { id: "e9", amount: 317.2, date: "2026-09-13", counterparty: "Opet", title: "Akaryakıt" },
        { id: "e8", amount: 317.2, date: "2026-09-20", counterparty: "Opet", title: "Akaryakıt" },
      ],
    });
    expect(hits.map((h) => h.entryId)).toEqual(["e9"]);
  });
});

describe("inceleme taslağı", () => {
  const x: ReceiptExtraction = {
    version: 1,
    fields: {
      total: { value: 1250, confidence: 0.86, source: "ocr" },
      date: { value: "2026-09-12", confidence: 0.4, source: "ocr" },
      vatLines: { value: [{ rate: 20, base: null, amount: 208.33 }], confidence: 0.8, source: "ocr" },
      sellerName: { value: "ÖZ ANADOLU PETROL", confidence: 0.75, source: "ocr" },
      documentNo: { value: "0042", confidence: 0.7, source: "ocr" },
      docType: { value: "okc_fis", confidence: 0.9, source: "ocr" },
    },
    layers: [],
    warnings: [],
    duplicates: [],
    category: { value: "ulasim", label: "Ulaşım", confidence: 0.82, reason: "anahtar" },
    party: { id: "p1", name: "Öz Anadolu Petrol", confidence: 0.99, reason: "vkn" },
    ai: "available",
    extractedAt: "",
  };
  it("düşük güvenli alan varsayılan olarak aktarılmaz; cari adı satıcı adını geçer", () => {
    const d = draftFromExtraction(x);
    expect(d.amount).toBe("1.250,00");
    expect(d.use.date).toBe(false);
    expect(d.vendor).toBe("Öz Anadolu Petrol");
    const a = applyFromDraft(d, x);
    expect(a).toEqual({ amount: 1250, date: null, vatRate: 20, vendor: "Öz Anadolu Petrol", partyId: "p1", category: "ulasim", title: "Öz Anadolu Petrol · Fiş 0042" });
  });
  it("düzenlenen tutar ayrıştırılır", () => {
    expect(parseDraftAmount("1.250,50")).toBe(1250.5);
    expect(parseDraftAmount("1250.5")).toBe(1250.5);
    expect(parseDraftAmount("1.250")).toBe(1250);
    expect(parseDraftAmount("abc")).toBeNull();
  });
  it("çok oranda en büyük matrahlı oran; yapay zekâ yalnız eksik/zayıf sonuçta kendiliğinden istenir", () => {
    expect(primaryVatRate({ vatLines: { value: [{ rate: 1, base: 50, amount: 0.5 }, { rate: 20, base: 200, amount: 40 }], confidence: 0.8, source: "ocr" } })).toBe(20);
    expect(shouldAutoRunAi(x)).toBe(true); // tarih zayıf
    expect(shouldAutoRunAi({ ...x, ai: "off" })).toBe(false);
    expect(shouldAutoRunAi({ ...x, fields: { ...x.fields, total: { value: 1, confidence: 0.99, source: "karekod" } } })).toBe(false); // cari VKN ile eşleşti
  });
});
