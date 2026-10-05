import { describe, expect, it } from "vitest";
import {
  EF_WHOLESALE_DEFAULT,
  buildEfEconomicsView,
  computeEfEconomics,
  computeEfLiability,
  grantKindOfFeature,
  groupUsageByTenant,
  isWholesaleUnknown,
  ledgerBalanceByTenant,
  packSaleOfInvoice,
  parseEfWholesale,
  sumUnusedUnits,
  summarizeEfGrants,
  weightedAvgNetUnitPriceKurus,
  parseWholesaleTl,
  serializeEfWholesale,
  wholesaleUnitCostKurus,
} from "./ef-economics";

describe("ef.wholesale ayarı", () => {
  it("yoksa / bozuksa varsayılan 0/0", () => {
    expect(parseEfWholesale(null)).toEqual(EF_WHOLESALE_DEFAULT);
    expect(parseEfWholesale("{bozuk")).toEqual(EF_WHOLESALE_DEFAULT);
    expect(parseEfWholesale(JSON.stringify({ valuationTl: -1, pdfTl: 0 }))).toEqual(EF_WHOLESALE_DEFAULT);
    expect(EF_WHOLESALE_DEFAULT).toEqual({ valuationTl: 0, pdfTl: 0 });
  });

  it("yazılıp okunur", () => {
    const raw = serializeEfWholesale({ valuationTl: 1.25, pdfTl: 0.5 });
    expect(parseEfWholesale(raw)).toEqual({ valuationTl: 1.25, pdfTl: 0.5 });
  });

  it("sıfır GEÇERLİ giriş; negatif/çok ondalık/harf geçersiz; virgül kabul", () => {
    expect(parseWholesaleTl("0")).toBe(0);
    expect(parseWholesaleTl("1,25")).toBe(1.25);
    expect(parseWholesaleTl("1.234,5")).toBe(1234.5);
    expect(parseWholesaleTl("-1")).toBeNull();
    expect(parseWholesaleTl("1,23456")).toBeNull();
    expect(parseWholesaleTl("abc")).toBeNull();
    expect(parseWholesaleTl("")).toBeNull();
  });
});

describe("computeEfEconomics", () => {
  const usage = [
    { item: "valuation_arsa", units: 5 },
    { item: "valuation_arsa", units: 5 },
    { item: "valuation_konut", units: 5 },
    { item: "pdf_first", units: 2 },
    { item: "report_detail", units: 0 },
    { item: "icat_edilmis", units: 9 },
  ];

  it("maliyet = işlem sayısı × tarife (kontör sayısı değil)", () => {
    const e = computeEfEconomics(usage, { valuationTl: 2, pdfTl: 1 }, 100000);
    expect(e.transactions).toBe(5);
    expect(e.units).toBe(17);
    // 3 değerleme × 2 TL + 1 pdf × 1 TL = 7 TL
    expect(e.costKurus).toBe(700);
    expect(e.marginKurus).toBe(100000 - 700);
    expect(e.unknownItems).toBe(1);
  });

  it("varsayılan 0/0 tarifede maliyet 0, marj = gelir", () => {
    const e = computeEfEconomics(usage, EF_WHOLESALE_DEFAULT, 50000);
    expect(e.costKurus).toBe(0);
    expect(e.marginKurus).toBe(50000);
  });

  it("harcanan kontör başına ortalama gelir; harcama yoksa null", () => {
    expect(computeEfEconomics(usage, EF_WHOLESALE_DEFAULT, 17000).revenuePerSpentUnitKurus).toBe(1000);
    expect(computeEfEconomics([], EF_WHOLESALE_DEFAULT, 17000).revenuePerSpentUnitKurus).toBeNull();
  });

  it("gelir yokken maliyet negatif marj üretir", () => {
    const e = computeEfEconomics(usage, { valuationTl: 1, pdfTl: 0 }, 0);
    expect(e.marginKurus).toBe(-300);
  });

  it("rapor detayının toptan maliyeti yok", () => {
    expect(wholesaleUnitCostKurus("report_detail", { valuationTl: 9, pdfTl: 9 })).toBe(0);
  });
});

describe("kontör ekonomisi (ofis, yükümlülük, hak dağılımı)", () => {
  const allTime = { fromIso: null, toIso: null };

  it("toptan maliyet bilinmiyor: iki tarife de 0", () => {
    expect(isWholesaleUnknown(EF_WHOLESALE_DEFAULT)).toBe(true);
    expect(isWholesaleUnknown({ valuationTl: 0, pdfTl: 1 })).toBe(false);
  });

  it("kullanım ofise göre toplanır; ofissiz satır untagged", () => {
    const usage = [
      { item: "valuation_arsa", units: 5, tenantId: "a" },
      { item: "pdf_first", units: 2, tenantId: "a" },
      { item: "valuation_konut", units: 5, tenantId: "b" },
      { item: "valuation_konut", units: 5, tenantId: null },
      { item: "bilinmeyen", units: 9, tenantId: "a" },
    ];
    const g = groupUsageByTenant(usage, { valuationTl: 2, pdfTl: 1 });
    expect(g.untagged).toBe(1);
    expect(g.rows[0]).toEqual({ tenantId: "a", transactions: 2, units: 7, costKurus: 300 });
    expect(g.rows[1]).toEqual({ tenantId: "b", transactions: 1, units: 5, costKurus: 200 });
  });

  it("defter bakiyesi ve kullanılmamış toplam: eksi bakiye sayılmaz", () => {
    const entries = [
      { tenantId: "a", amount: 100, feature: "ef_grant:purchase", createdAt: "2026-10-01T00:00:00Z" },
      { tenantId: "a", amount: -30, feature: "valuation_arsa", createdAt: "2026-10-02T00:00:00Z" },
      { tenantId: "b", amount: 10, feature: "ef_grant:bonus", createdAt: "2026-10-02T00:00:00Z" },
      { tenantId: "b", amount: -15, feature: "x", createdAt: "2026-10-03T00:00:00Z" },
    ];
    const bal = ledgerBalanceByTenant(entries);
    expect(bal.get("a")).toBe(70);
    expect(bal.get("b")).toBe(-5);
    expect(sumUnusedUnits(bal)).toEqual({ units: 70, tenantCount: 1 });
  });

  it("ağırlıklı ortalama net fiyat = Σnet ÷ Σkontör; satış yoksa null", () => {
    expect(weightedAvgNetUnitPriceKurus([])).toBeNull();
    // 100 kontör 10.000 kuruş (1,00) + 400 kontör 20.000 kuruş (0,50) -> 30.000 / 500 = 60
    expect(weightedAvgNetUnitPriceKurus([{ units: 100, netKurus: 10000 }, { units: 400, netKurus: 20000 }])).toBe(60);
    expect(weightedAvgNetUnitPriceKurus([{ units: 0, netKurus: 500 }])).toBeNull();
  });

  it("yükümlülük = kullanılmamış kontör × ortalama; fiyat yoksa tutar null", () => {
    expect(computeEfLiability(500, 60)).toEqual({ unusedUnits: 500, avgUnitPriceKurus: 60, liabilityKurus: 30000 });
    expect(computeEfLiability(500, null).liabilityKurus).toBeNull();
    expect(computeEfLiability(0, 60).liabilityKurus).toBe(0);
  });

  it("hak dağılımı türe göre; harcama satırları ve bilinmeyen tür", () => {
    expect(grantKindOfFeature("ef_grant:plan_monthly")).toBe("plan_monthly");
    expect(grantKindOfFeature("ef_grant:uydurma")).toBe("other");
    expect(grantKindOfFeature(null)).toBe("other");
    const rows = summarizeEfGrants([
      { amount: 40, feature: "ef_grant:plan_monthly" },
      { amount: 40, feature: "ef_grant:plan_monthly" },
      { amount: 10, feature: "ef_grant:bonus" },
      { amount: -5, feature: "valuation_arsa" },
    ]);
    expect(rows.map((r) => [r.kind, r.units, r.count])).toEqual([
      ["plan_monthly", 80, 2],
      ["bonus", 10, 1],
    ]);
  });

  it("paket faturası: meta.units + net tutar; iade/başka tür/geçersiz null", () => {
    expect(packSaleOfInvoice({ amount_try: "250.50", meta: { kind: "credit_pack", units: 100 } })).toEqual({ units: 100, netKurus: 25050 });
    expect(packSaleOfInvoice({ amount_try: 100, meta: { kind: "credit_pack", units: 100, refund: { amount_try: 120 } } })).toBeNull();
    expect(packSaleOfInvoice({ amount_try: 100, meta: { kind: "extra_seats", units: 100 } })).toBeNull();
    expect(packSaleOfInvoice({ amount_try: 100, meta: { kind: "credit_pack" } })).toBeNull();
  });

  it("buildEfEconomicsView: gelir dönemle süzülür, ortalama fiyat tüm satışlardan, ofis birleşir", () => {
    const view = buildEfEconomicsView({
      usage: [
        { item: "valuation_arsa", units: 5, tenantId: "a" },
        { item: "pdf_first", units: 2, tenantId: "a" },
      ],
      ledger: [
        { tenantId: "a", amount: 100, feature: "ef_grant:purchase", createdAt: "2026-10-01T00:00:00Z" },
        { tenantId: "a", amount: -7, feature: "valuation_arsa", createdAt: "2026-10-02T00:00:00Z" },
        { tenantId: "c", amount: 20, feature: "ef_grant:plan_monthly", createdAt: "2026-09-01T00:00:00Z" },
      ],
      sales: [
        { units: 100, netKurus: 10000, paidAt: "2026-10-01T00:00:00Z" },
        { units: 100, netKurus: 20000, paidAt: "2026-09-01T00:00:00Z" },
      ],
      wholesale: { valuationTl: 1, pdfTl: 0 },
      period: { fromIso: "2026-10-01T00:00:00Z", toIso: "2026-11-01T00:00:00Z" },
    });
    expect(view.packRevenueNetKurus).toBe(10000);
    expect(view.packCount).toBe(1);
    expect(view.econ.costKurus).toBe(100);
    expect(view.econ.marginKurus).toBe(9900);
    expect(view.wholesaleUnknown).toBe(false);
    // kullanılmamış: a=93, c=20 -> 113 kontör × (30000/200=150) = 16950
    expect(view.liability).toEqual({ unusedUnits: 113, avgUnitPriceKurus: 150, liabilityKurus: 16950 });
    expect(view.grants.map((g) => g.kind)).toEqual(["purchase"]); // c'nin yüklemesi dönem dışı
    expect(view.offices.map((o) => o.tenantId)).toEqual(["a", "c"]);
    expect(view.offices[0]).toMatchObject({ units: 7, balance: 93 });
  });

  it("tüm zamanlar: sınırsız dönemde her satış ve yükleme sayılır; varsayılan maliyet bilinmiyor", () => {
    const view = buildEfEconomicsView({
      usage: [],
      ledger: [{ tenantId: "a", amount: 5, feature: "ef_grant:bonus", createdAt: "2020-01-01T00:00:00Z" }],
      sales: [{ units: 10, netKurus: 1000, paidAt: null }],
      wholesale: EF_WHOLESALE_DEFAULT,
      period: allTime,
    });
    expect(view.packRevenueNetKurus).toBe(1000);
    expect(view.grants).toHaveLength(1);
    expect(view.wholesaleUnknown).toBe(true);
    expect(view.econ.marginKurus).toBe(1000);
  });
});
