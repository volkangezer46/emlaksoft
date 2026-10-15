import { describe, expect, it } from "vitest";
import {
  balanceAfter,
  budgetImpact,
  bulkTotals,
  categoryFromHistory,
  computeEntryTotals,
  entryEditHref,
  entryHref,
  entryTabsFor,
  findDuplicates,
  parseBulkPaste,
  parseDayCell,
  parseEntryPrefill,
  similarEntries,
  validateBulkRow,
  type BulkCategory,
  type RecentEntry,
} from "./entry-workspace";

const UUID = "11111111-2222-3333-4444-555555555555";
const UUID2 = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

describe("önceden doldurma (URL)", () => {
  it("geçerli parametreleri okur, geçersizleri atar", () => {
    const p = parseEntryPrefill({ tur: "gelir", tutar: "48k", cari: UUID, cari_ad: "Ahmet Yılmaz", hesap: UUID2, kdv: "20", tarih: "2026-10-01", kategori: "komisyon" });
    expect(p).toMatchObject({ tab: "gelir", amount: 48000, partyId: UUID, partyName: "Ahmet Yılmaz", accountId: UUID2, vatRate: 20, date: "2026-10-01", category: "komisyon", personal: false });
    const bad = parseEntryPrefill({ tur: "x", tutar: "-5", cari: "drop table", hesap: "1", kdv: "18", tarih: "2026-02-30", kategori: "Kira!" });
    expect(bad).toMatchObject({ tab: null, amount: null, partyId: null, accountId: null, vatRate: null, date: null, category: null });
  });

  it("kişisel kapsam ve dizi değerleri", () => {
    expect(parseEntryPrefill({ kapsam: "kisisel", tur: ["gider", "gelir"] })).toMatchObject({ personal: true, tab: "gider" });
  });

  it("bağlantı üretimi ↔ ayrıştırma gidiş-dönüş", () => {
    const href = entryHref({ tab: "gider", amount: 1250.5, partyId: UUID, partyName: "ABC Ltd", attachmentId: UUID2, vatRate: 10 });
    expect(href.startsWith("/app/giderler/kayit?")).toBe(true);
    const p = parseEntryPrefill(Object.fromEntries(new URL(href, "https://x").searchParams));
    expect(p).toMatchObject({ tab: "gider", amount: 1250.5, partyId: UUID, partyName: "ABC Ltd", attachmentId: UUID2, vatRate: 10 });
    expect(entryHref()).toBe("/app/giderler/kayit");
    expect(entryHref({ personal: true, tab: "gelir" })).toBe("/app/giderler/kayit?tur=gelir&kapsam=kisisel");
    expect(entryEditHref(UUID)).toBe(`/app/giderler/kayit/${UUID}`);
    expect(entryEditHref(UUID, { personal: true })).toBe(`/app/giderler/kayit/${UUID}?kapsam=kisisel`);
  });

  it("kişisel kipte belge sekmesi yok", () => {
    expect(entryTabsFor(true)).not.toContain("belge");
    expect(entryTabsFor(false)).toEqual(["gider", "gelir", "transfer", "belge", "toplu"]);
  });
});

describe("canlı özet", () => {
  it("KDV dahil + stopaj: net, KDV, brüt, hesaba yansıyan", () => {
    const t = computeEntryTotals({ amount: 12000, direction: "out", vatRate: 20, vatIncluded: true, withholdingRate: 20, office: true })!;
    expect(t.net).toBe(10000);
    expect(t.vat).toBe(2000);
    expect(t.gross).toBe(12000);
    expect(t.withheld).toBe(2000);
    expect(t.cash).toBe(10000);
    expect(t.signedCash).toBe(-10000);
    expect(balanceAfter(15000, t)).toBe(5000);
  });

  it("kişisel hesapta oranlar yok sayılır; gelir artı yazar; tutarsız giriş null", () => {
    const t = computeEntryTotals({ amount: 500, direction: "in", vatRate: 20, vatIncluded: false, withholdingRate: 20, office: false })!;
    expect(t.cash).toBe(500);
    expect(t.signedCash).toBe(500);
    expect(computeEntryTotals({ amount: null, direction: "in", vatRate: null, vatIncluded: true, withholdingRate: null, office: true })).toBeNull();
    expect(balanceAfter(100, null)).toBe(100);
  });

  it("bütçe etkisi: bütçe yoksa null, aşımı işaretler", () => {
    expect(budgetImpact(null, 100, 50)).toBeNull();
    expect(budgetImpact(0, 100, 50)).toBeNull();
    expect(budgetImpact(1000, 800, 300)).toEqual({ budget: 1000, before: 800, after: 1100, pctAfter: 110, over: true, remaining: -100 });
    expect(budgetImpact(1000, 200, 300)?.over).toBe(false);
  });
});

const recent: RecentEntry[] = [
  { id: "a", accountId: "k", direction: "out", amount: 4500, date: "2026-10-10", category: "portal", title: "Sahibinden paketi", counterparty: "Sahibinden A.Ş." },
  { id: "b", accountId: "k", direction: "out", amount: 4500, date: "2026-08-01", category: "portal", title: "Sahibinden paketi", counterparty: "Sahibinden" },
  { id: "c", accountId: "k", direction: "out", amount: 1200, date: "2026-10-12", category: "ofis", title: "Kırtasiye", counterparty: "Kırtasiyeci" },
  { id: "d", accountId: "k", direction: "out", amount: 1200, date: "2026-10-13", category: "ofis", title: "Toner", counterparty: null },
  { id: "e", accountId: "k", direction: "in", amount: 4500, date: "2026-10-10", category: "komisyon", title: "Komisyon", counterparty: "Sahibinden" },
  { id: "f", accountId: "k", direction: "out", amount: 300, date: "2026-09-20", category: "reklam", title: "Sahibinden doping", counterparty: "Sahibinden" },
];

describe("mükerrer ve benzer kayıt", () => {
  it("aynı tutar + cari (ekler yok sayılır) son 30 günde uyarı; yön ve pencere dışı hariç", () => {
    const hits = findDuplicates({ direction: "out", cash: 4500, date: "2026-10-15", counterparty: "sahibinden as", category: "portal" }, recent);
    expect(hits.map((h) => h.entry.id)).toEqual(["a"]);
    expect(hits[0]!.reason).toContain("5 gün");
  });

  it("carisiz: aynı tutar + kategori ancak ≤3 gün; düzenlenen kayıt hariç", () => {
    expect(findDuplicates({ direction: "out", cash: 1200, date: "2026-10-14", counterparty: null, category: "ofis" }, recent).map((h) => h.entry.id)).toEqual(["d", "c"]);
    expect(findDuplicates({ id: "d", direction: "out", cash: 1200, date: "2026-10-13", counterparty: null, category: "ofis" }, recent).map((h) => h.entry.id)).toEqual(["c"]);
    expect(findDuplicates({ direction: "out", cash: 1200, date: "2026-10-30", counterparty: null, category: "ofis" }, recent)).toEqual([]);
    expect(findDuplicates({ direction: "transfer", cash: 1200, date: "2026-10-13", counterparty: null, category: null }, recent)).toEqual([]);
  });

  it("benzer kayıtlar: cari > ortak sözcük > kategori", () => {
    const s = similarEntries({ direction: "out", cash: 100, date: "2026-10-15", counterparty: "Sahibinden", category: "portal", title: "paket" }, recent, 3);
    expect(s.map((e) => e.id)).toEqual(["a", "b", "f"]);
    expect(similarEntries({ direction: "out", cash: 100, date: "2026-10-15", counterparty: "Sahibinden", category: null }, recent, 4, new Set(["a"])).map((e) => e.id)).not.toContain("a");
  });

  it("cariden kategori: en sık, eşitlikte en yeni; izinli kategoriler", () => {
    const allowed = new Set(["portal", "reklam", "ofis"]);
    expect(categoryFromHistory("SAHİBİNDEN", "out", recent, allowed)).toEqual({ category: "portal", count: 2 });
    expect(categoryFromHistory("Sahibinden", "out", recent, new Set(["reklam"]))).toEqual({ category: "reklam", count: 1 });
    expect(categoryFromHistory("Bilinmeyen", "out", recent, allowed)).toBeNull();
    expect(categoryFromHistory("", "out", recent, allowed)).toBeNull();
  });
});

const CATS: BulkCategory[] = [
  { value: "kira", label: "Kira", direction: "out" },
  { value: "portal", label: "Portal üyeliği", direction: "out" },
  { value: "komisyon", label: "Komisyon", direction: "in" },
];
const today = "2026-10-15";

describe("toplu giriş yapıştırma", () => {
  it("Excel (sekme) + başlık satırı", () => {
    const text = "Tarih\tTür\tTutar\tKategori\tAçıklama\tCari\tKDV\n01.10.2026\tGider\t12.500,00\tKira\tEkim kirası\tMülk sahibi\t%20\n03.10.2026\tGelir\t48k\tKomisyon\tSatış\tAhmet\t";
    const rows = parseBulkPaste(text, { categories: CATS, today, defaultDirection: "out" });
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ date: "2026-10-01", direction: "out", amountText: "12500", category: "kira", title: "Ekim kirası", counterparty: "Mülk sahibi", vatRate: 20 });
    expect(rows[1]).toMatchObject({ date: "2026-10-03", direction: "in", amountText: "48000", category: "komisyon", counterparty: "Ahmet" });
    expect(rows.every((r) => validateBulkRow(r, today, CATS).length === 0)).toBe(true);
  });

  it("başlıksız TR CSV (noktalı virgül, tırnak): hücre türünden tanır; negatif tutar gider", () => {
    const rows = parseBulkPaste('2026-10-02;-1.250,50;Portal üyeliği;"Sahibinden; paket";Sahibinden\n\n05/10/2026;3000;Komisyon', { categories: CATS, today, defaultDirection: "in" });
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ date: "2026-10-02", direction: "out", amountText: "1250,5", category: "portal", title: "Sahibinden; paket", counterparty: "Sahibinden" });
    expect(rows[1]).toMatchObject({ date: "2026-10-05", direction: "in", category: "komisyon" });
  });

  it("satır doğrulaması: tutar, gelecek tarih, yönle çelişen kategori", () => {
    const [r] = parseBulkPaste("2026-12-01,abc,Kira", { categories: CATS, today, defaultDirection: "in" });
    const errs = validateBulkRow(r!, today, CATS).map((e) => e.field);
    expect(errs).toEqual(expect.arrayContaining(["amount", "date"]));
    // "Kira" gider kategorisi: yön belirtilmediği için gidere döner, kategori kalır.
    expect(r!.direction).toBe("out");
    const [g] = parseBulkPaste("Gelir\t100\tKira", { categories: CATS, today, defaultDirection: "out" });
    expect(g!.category).toBe("");
    expect(validateBulkRow(g!, today, CATS).map((e) => e.field)).toEqual(["category"]);
  });

  it("toplamlar yalnız geçerli satırlardan", () => {
    const rows = parseBulkPaste("01.10.2026\tGider\t100\tKira\n01.10.2026\tGelir\t250\tKomisyon\n01.10.2026\tGider\tx\tKira", { categories: CATS, today, defaultDirection: "out" });
    expect(bulkTotals(rows, today, CATS)).toEqual({ income: 250, expense: 100, net: 150, valid: 2, invalid: 1 });
  });

  it("tarih hücresi biçimleri", () => {
    expect(parseDayCell("5.3.26")).toBe("2026-03-05");
    expect(parseDayCell("2026-3-5")).toBe("2026-03-05");
    expect(parseDayCell("31.02.2026")).toBeNull();
  });
});
