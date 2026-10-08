import { describe, expect, it } from "vitest";
import {
  EF_DEFAULT_PACKS,
  EF_DEFAULT_TARIFF,
  EF_WELCOME_DEFAULT_UNITS,
  efEntryValuationUnits,
  efPacksSchema,
  parseEfWelcomeUnits,
  EF_RPC,
  efIdempotencyKey,
  efPackUnitPriceTry,
  efPackWarnings,
  efUnitsFor,
  parseEfPacks,
  parseEfTariff,
  serializeEfPacks,
  serializeEfTariff,
  type EfPack,
} from "./config";

const pack = (over: Partial<EfPack>): EfPack => ({
  id: "baslangic",
  name: "Başlangıç",
  units: 10,
  priceNetTry: 100,
  active: true,
  order: 1,
  ...over,
});

describe("ef-credits config: tarife", () => {
  it("ayar yok/bozuk/geçersiz → varsayılan tarife", () => {
    expect(parseEfTariff(null)).toEqual(EF_DEFAULT_TARIFF);
    expect(parseEfTariff("{")).toEqual(EF_DEFAULT_TARIFF);
    expect(parseEfTariff(JSON.stringify({ valuationArsa: -1 }))).toEqual(EF_DEFAULT_TARIFF);
    expect(parseEfTariff(JSON.stringify({ ...EF_DEFAULT_TARIFF, pdfFirst: 1.5 }))).toEqual(EF_DEFAULT_TARIFF);
  });
  it("varsayılan tarife (1 kontör = 1 TL): konut 700, arsa 850, ticari 1.050, ilan analizi 1, ilk PDF rapora dahil (0)", () => {
    expect(EF_DEFAULT_TARIFF).toEqual({
      valuationArsa: 850,
      valuationKonut: 700,
      valuationTicari: 1050,
      listingAnalysis: 1,
      pdfFirst: 0,
      reportDetail: 0,
    });
    expect(efUnitsFor("valuation_ticari")).toBe(1050);
    expect(efUnitsFor("listing_analysis")).toBe(1);
    expect(efEntryValuationUnits(EF_DEFAULT_TARIFF)).toBe(700);
    expect(efEntryValuationUnits({ valuationArsa: 0, valuationKonut: 0, valuationTicari: 0 })).toBe(0);
  });
  it("eski (4 alanlı) kayıt geçerli kalır: eksik alanlar yeni varsayılanla tamamlanır, kayıtlı değerler korunur", () => {
    const old = parseEfTariff(JSON.stringify({ valuationArsa: 5, valuationKonut: 5, pdfFirst: 2, reportDetail: 0 }));
    expect(old).toEqual({ valuationArsa: 5, valuationKonut: 5, pdfFirst: 2, reportDetail: 0, valuationTicari: 1050, listingAnalysis: 1 });
  });
  it("tek işlem 10.000 kontöre kadar girilebilir; üstü reddedilir", () => {
    expect(parseEfTariff(JSON.stringify({ ...EF_DEFAULT_TARIFF, valuationTicari: 10000 })).valuationTicari).toBe(10000);
    expect(parseEfTariff(JSON.stringify({ ...EF_DEFAULT_TARIFF, valuationTicari: 10001 }))).toEqual(EF_DEFAULT_TARIFF);
  });
  it("gidiş-dönüş ve kalem eşleme", () => {
    const t = { valuationArsa: 7, valuationKonut: 9, pdfFirst: 2, reportDetail: 0, valuationTicari: 11, listingAnalysis: 1 };
    expect(parseEfTariff(serializeEfTariff(t))).toEqual(t);
    expect(efUnitsFor("valuation_arsa", t)).toBe(7);
    expect(efUnitsFor("valuation_konut", t)).toBe(9);
    expect(efUnitsFor("pdf_first", t)).toBe(2);
    expect(efUnitsFor("report_detail", t)).toBe(0);
  });
});

describe("ef-credits config: paketler", () => {
  it("ayar yoksa/boşsa varsayılan paketler; bozuk veri boş; admin boş liste kaydettiyse boş", () => {
    expect(parseEfPacks(null)).toEqual(EF_DEFAULT_PACKS);
    expect(parseEfPacks("  ")).toEqual(EF_DEFAULT_PACKS);
    expect(parseEfPacks("[]")).toEqual([]);
    expect(parseEfPacks("[")).toEqual([]);
    expect(parseEfPacks(JSON.stringify([{ id: "X", name: "a", units: 0 }]))).toEqual([]);
  });
  it("varsayılan paketler: 100→100, 500→475, 1.000→900, 2.500→2.125, 5.000→4.000 TL; birim fiyat azalır, uyarı yok", () => {
    expect(EF_DEFAULT_PACKS.map((p) => [p.units, p.priceNetTry])).toEqual([[100, 100], [500, 475], [1000, 900], [2500, 2125], [5000, 4000]]);
    expect(EF_DEFAULT_PACKS.map((p) => efPackUnitPriceTry(p))).toEqual([1, 0.95, 0.9, 0.85, 0.8]);
    expect(efPackWarnings([...EF_DEFAULT_PACKS])).toEqual([]);
    expect(efPacksSchema.safeParse(EF_DEFAULT_PACKS).success).toBe(true);
    expect(EF_DEFAULT_PACKS.filter((p) => p.popular)).toHaveLength(1);
  });
  it("sıralar, yinelenen kimliği atar, gidiş-dönüş çalışır", () => {
    const list = [pack({ id: "buyuk", units: 100, priceNetTry: 800, order: 2 }), pack({}), pack({ id: "buyuk", units: 5 })];
    const parsed = parseEfPacks(JSON.stringify(list));
    expect(parsed.map((p) => p.id)).toEqual(["baslangic", "buyuk"]);
    expect(parseEfPacks(serializeEfPacks(parsed))).toEqual(parsed);
  });
  it("kontör başı fiyat ve mantıksız büyük paket uyarısı", () => {
    expect(efPackUnitPriceTry(pack({ units: 10, priceNetTry: 100 }))).toBe(10);
    const warn = efPackWarnings([pack({}), pack({ id: "buyuk", name: "Büyük", units: 100, priceNetTry: 2000, order: 2 })]);
    expect(warn.join(" ")).toContain("mantıksız");
    expect(efPackWarnings([pack({ active: false })]).join(" ")).toContain("Aktif paket yok");
    expect(efPackWarnings([])).toEqual([]);
  });
});

describe("ef-credits config: sözleşme sabitleri", () => {
  it("idempotency anahtarı EmlakFiyati kuralına uyar (8-128, [A-Za-z0-9_.:-])", () => {
    const key = efIdempotencyKey("3f0c2d9e-1a4b-4c5d-8e6f-7a8b9c0d1e2f");
    expect(key).toMatch(/^[A-Za-z0-9_.:-]{8,128}$/);
    expect(efIdempotencyKey("a")).toBe("es-a");
  });
  it("RPC adları sabit (SQL ve TS aynı sözleşmeyi kullanır)", () => {
    expect(EF_RPC).toEqual({
      balance: "ef_credit_balance",
      reserve: "ef_credit_reserve",
      commit: "ef_credit_commit",
      release: "ef_credit_release",
      grant: "ef_credit_grant",
      sweep: "ef_credit_sweep",
    });
  });
});

describe("ef-credits config: hoş geldin kontörü", () => {
  it("varsayılan 100; geçersiz değer varsayılana düşer; 0 kapalı demektir", () => {
    expect(EF_WELCOME_DEFAULT_UNITS).toBe(100);
    expect(parseEfWelcomeUnits(null)).toBe(EF_WELCOME_DEFAULT_UNITS);
    expect(parseEfWelcomeUnits("")).toBe(100);
    expect(parseEfWelcomeUnits("25")).toBe(25);
    expect(parseEfWelcomeUnits("0")).toBe(0);
    expect(parseEfWelcomeUnits("-3")).toBe(100);
    expect(parseEfWelcomeUnits("1.5")).toBe(100);
    expect(parseEfWelcomeUnits("abc")).toBe(100);
    expect(parseEfWelcomeUnits("5000")).toBe(100);
  });
  it("hoş geldin kontörü ilan analizini (1 kontör) karşılar ama tek başına değerleme raporunu karşılamaz", () => {
    expect(EF_WELCOME_DEFAULT_UNITS / EF_DEFAULT_TARIFF.listingAnalysis).toBe(100);
    expect(EF_WELCOME_DEFAULT_UNITS).toBeLessThan(efEntryValuationUnits(EF_DEFAULT_TARIFF));
  });
});
