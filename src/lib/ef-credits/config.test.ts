import { describe, expect, it } from "vitest";
import {
  EF_DEFAULT_PACKS,
  EF_DEFAULT_TARIFF,
  EF_PACK_MONTHS,
  EF_WELCOME_DEFAULT_UNITS,
  EF_WELCOME_VALID_DAYS,
  buildDefaultEfPacks,
  efPackMonthlyUnits,
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
  months: 1,
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
    expect(parseEfTariff(JSON.stringify({ ...EF_DEFAULT_TARIFF, valuationTicari: 1.5 }))).toEqual(EF_DEFAULT_TARIFF);
  });
  it("varsayılan tarife (1 kontör = 1 TL): konut 700, arsa 850, ticari 1.050; kontör YALNIZ değerleme için (başka kalem yok)", () => {
    expect(EF_DEFAULT_TARIFF).toEqual({
      valuationArsa: 850,
      valuationKonut: 700,
      valuationTicari: 1050,
    });
    expect(Object.keys(EF_DEFAULT_TARIFF).every((k) => k.startsWith("valuation"))).toBe(true);
    expect(efUnitsFor("valuation_ticari")).toBe(1050);
    expect(efEntryValuationUnits(EF_DEFAULT_TARIFF)).toBe(700);
    expect(efEntryValuationUnits({ valuationArsa: 0, valuationKonut: 0, valuationTicari: 0 })).toBe(0);
  });
  it("eski (pdfFirst/reportDetail/listingAnalysis içeren) kayıt geçerli kalır: kontörsüz kalemler yok sayılır, değerleme değerleri korunur", () => {
    const old = parseEfTariff(JSON.stringify({ valuationArsa: 5, valuationKonut: 5, pdfFirst: 2, reportDetail: 0, listingAnalysis: 1 }));
    expect(old).toEqual({ valuationArsa: 5, valuationKonut: 5, valuationTicari: 1050 });
  });
  it("tek işlem 10.000 kontöre kadar girilebilir; üstü reddedilir", () => {
    expect(parseEfTariff(JSON.stringify({ ...EF_DEFAULT_TARIFF, valuationTicari: 10000 })).valuationTicari).toBe(10000);
    expect(parseEfTariff(JSON.stringify({ ...EF_DEFAULT_TARIFF, valuationTicari: 10001 }))).toEqual(EF_DEFAULT_TARIFF);
  });
  it("gidiş-dönüş ve kalem eşleme", () => {
    const t = { valuationArsa: 7, valuationKonut: 9, valuationTicari: 11 };
    expect(parseEfTariff(serializeEfTariff(t))).toEqual(t);
    expect(efUnitsFor("valuation_arsa", t)).toBe(7);
    expect(efUnitsFor("valuation_konut", t)).toBe(9);
    expect(efUnitsFor("valuation_ticari", t)).toBe(11);
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
  it("varsayılan katalog (2026-10-10): aylık 1.000/2.500/5.000 kontör x 1/3/6/12 ay = 12 paket; uzun süreye %0/%5/%10/%15 indirim; uyarı yok", () => {
    expect(EF_DEFAULT_PACKS).toHaveLength(12);
    expect(EF_DEFAULT_PACKS.map((p) => [efPackMonthlyUnits(p), p.months, p.units, p.priceNetTry])).toEqual([
      [1000, 1, 1000, 1000], [1000, 3, 3000, 2850], [1000, 6, 6000, 5400], [1000, 12, 12000, 10200],
      [2500, 1, 2500, 2500], [2500, 3, 7500, 7125], [2500, 6, 15000, 13500], [2500, 12, 30000, 25500],
      [5000, 1, 5000, 5000], [5000, 3, 15000, 14250], [5000, 6, 30000, 27000], [5000, 12, 60000, 51000],
    ]);
    expect(new Set(EF_DEFAULT_PACKS.map((p) => p.months))).toEqual(new Set(EF_PACK_MONTHS));
    expect(EF_DEFAULT_PACKS.filter((p) => p.months === 12).map((p) => efPackUnitPriceTry(p))).toEqual([0.85, 0.85, 0.85]);
    expect(efPackWarnings([...EF_DEFAULT_PACKS])).toEqual([]);
    expect(efPacksSchema.safeParse(EF_DEFAULT_PACKS).success).toBe(true);
    expect(new Set(EF_DEFAULT_PACKS.map((p) => p.id)).size).toBe(12);
    expect(EF_DEFAULT_PACKS.filter((p) => p.popular)).toHaveLength(1);
    expect(buildDefaultEfPacks()).toEqual([...EF_DEFAULT_PACKS]);
  });
  it("süre alanı olmayan eski kayıt 12 ay sayılır; geçersiz süre reddedilir", () => {
    const legacy = parseEfPacks(JSON.stringify([{ id: "eski", name: "Eski paket", units: 25, priceNetTry: 299, active: true, order: 1 }]));
    expect(legacy[0]?.months).toBe(12);
    expect(parseEfPacks(JSON.stringify([{ id: "eski", name: "Eski paket", units: 25, months: 2, priceNetTry: 299, active: true, order: 1 }]))).toEqual([]);
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
    // Aynı aylık kontörde uzun süre kısadan pahalı olamaz.
    const longer = efPackWarnings([pack({ units: 1000, months: 1, priceNetTry: 1000 }), pack({ id: "uzun", name: "Uzun", units: 3000, months: 3, priceNetTry: 3600, order: 2 })]);
    expect(longer.join(" ")).toContain("indirimli olmalı");
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
  it("hoş geldin kontörü tek başına değerleme raporunu karşılamaz ve 30 gün sonra yanar", () => {
    expect(EF_WELCOME_DEFAULT_UNITS).toBeLessThan(efEntryValuationUnits(EF_DEFAULT_TARIFF));
    expect(EF_WELCOME_VALID_DAYS).toBe(30);
  });
});
