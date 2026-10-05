import { describe, expect, it } from "vitest";
import {
  EF_DEFAULT_TARIFF,
  EF_WELCOME_DEFAULT_UNITS,
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
  it("gidiş-dönüş ve kalem eşleme", () => {
    const t = { valuationArsa: 7, valuationKonut: 9, pdfFirst: 2, reportDetail: 0 };
    expect(parseEfTariff(serializeEfTariff(t))).toEqual(t);
    expect(efUnitsFor("valuation_arsa", t)).toBe(7);
    expect(efUnitsFor("valuation_konut", t)).toBe(9);
    expect(efUnitsFor("pdf_first", t)).toBe(2);
    expect(efUnitsFor("report_detail", t)).toBe(0);
  });
});

describe("ef-credits config: paketler", () => {
  it("varsayılan BOŞ (fiyatlar sahibin kararı); bozuk veri boş döner", () => {
    expect(parseEfPacks(null)).toEqual([]);
    expect(parseEfPacks("[")).toEqual([]);
    expect(parseEfPacks(JSON.stringify([{ id: "X", name: "a", units: 0 }]))).toEqual([]);
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
  it("varsayılan 10; geçersiz değer varsayılana düşer; 0 kapalı demektir", () => {
    expect(parseEfWelcomeUnits(null)).toBe(EF_WELCOME_DEFAULT_UNITS);
    expect(parseEfWelcomeUnits("")).toBe(10);
    expect(parseEfWelcomeUnits("25")).toBe(25);
    expect(parseEfWelcomeUnits("0")).toBe(0);
    expect(parseEfWelcomeUnits("-3")).toBe(10);
    expect(parseEfWelcomeUnits("1.5")).toBe(10);
    expect(parseEfWelcomeUnits("abc")).toBe(10);
    expect(parseEfWelcomeUnits("5000")).toBe(10);
  });
  it("varsayılan tarife: değerleme 5, ilk PDF 2 (EmlakFiyati PRO = 20 değerleme + 10 PDF = 120 kontör)", () => {
    expect(EF_DEFAULT_TARIFF.valuationArsa * 20 + EF_DEFAULT_TARIFF.pdfFirst * 10).toBe(120);
  });
});
