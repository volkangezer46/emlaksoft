import { describe, expect, it } from "vitest";
import type { ComparableDetail } from "@/lib/comparables";
import {
  EMPTY_SELECTION,
  comparableKey,
  estimateFromSelection,
  inferMarketIndexLevel,
  percentileCont,
  readComparablesEntry,
  recomputeValuation,
  reportComparables,
  resolveTargetSqm,
  type ComparableSelection,
} from "./comparable-selection";
import { COMPARABLE_SOURCE_LABEL, valuationEvidenceConfidence } from "./combine";

const row = (id: string, ppsqm: number, source: "won_deal" | "active_listing" = "active_listing"): ComparableDetail => ({
  source,
  property_id: id,
  title: null,
  price: ppsqm * 100,
  sqm: 100,
  price_per_sqm: ppsqm,
  adjusted_price_per_sqm: ppsqm,
  rooms: "3+1",
  happened_at: "2026-09-01",
  property_code: `P-${id}`,
  district_name: "Kadıköy",
});

const ROWS = [
  row("a", 40_000, "won_deal"),
  row("b", 42_000, "won_deal"),
  row("c", 44_000),
  row("d", 46_000),
  row("e", 48_000),
  row("f", 50_000),
  row("g", 52_000),
  row("h", 54_000),
];

const sel = (over: Partial<ComparableSelection> = {}): ComparableSelection => ({ ...EMPTY_SELECTION, ...over });

describe("percentileCont", () => {
  it("SQL percentile_cont ile aynı doğrusal ara değer", () => {
    expect(percentileCont([1, 2, 3, 4], 0.5)).toBe(2.5);
    expect(percentileCont([10], 0.25)).toBe(10);
    expect(percentileCont([], 0.5)).toBeNull();
  });
});

describe("estimateFromSelection", () => {
  it("kapanış iki kez sayılır; 8 emsal + 2 kapanış + dar yayılım = yüksek", () => {
    const est = estimateFromSelection(ROWS, sel(), 100);
    expect(est.compCount).toBe(8);
    expect(est.wonCount).toBe(2);
    expect(est.confidence).toBe("yüksek");
    // ağırlıklı küme: 40,40,42,42,44,46,48,50,52,54 (bin) → medyan 45.000
    expect(est.medianSqmPrice).toBe(45_000);
    expect(est.estimatedValue).toBe(4_500_000);
  });

  it("çıkarılan emsal hesaba girmez ve güven düşer", () => {
    const est = estimateFromSelection(ROWS, sel({ excluded: [comparableKey(ROWS[0]!)] }), 100);
    expect(est.compCount).toBe(7);
    expect(est.excludedCount).toBe(1);
    expect(est.confidence).toBe("orta");
  });

  it("tüm emsaller çıkarılınca güven yetersiz ve rakam uydurulmaz", () => {
    const est = estimateFromSelection(ROWS, sel({ excluded: ROWS.map(comparableKey) }), 100);
    expect(est.confidence).toBe("yetersiz");
    expect(est.estimatedValue).toBeNull();
    expect(est.lowValue).toBeNull();
  });

  it("elle emsal güveni yüksek'e çıkaramaz", () => {
    const manual = Array.from({ length: 4 }, (_, i) => ({
      id: `m${i}`, title: null, source_url: null, price: 4_500_000, sqm: 100, rooms: null, floor: null, added_at: "",
    }));
    const est = estimateFromSelection(ROWS, sel({ manual }), 100);
    expect(est.manualCount).toBe(4);
    expect(est.confidence).toBe("orta");
  });

  it("hedef m² yoksa değer üretilmez", () => {
    expect(estimateFromSelection(ROWS, sel(), null).estimatedValue).toBeNull();
  });
});

describe("resolveTargetSqm / inferMarketIndexLevel", () => {
  it("m²: seçim > portföy > eski kaynak notu", () => {
    const src = { name: COMPARABLE_SOURCE_LABEL, weight: 0.5, value: 4_500_000, note: "8 emsal (2 kapanmış satış) · medyan 45.000 ₺/m² · güven: yüksek" };
    expect(resolveTargetSqm(sel({ target_sqm: 90 }), 120, src)).toBe(90);
    expect(resolveTargetSqm(sel(), 120, src)).toBe(120);
    expect(resolveTargetSqm(sel(), null, src)).toBe(100);
    expect(resolveTargetSqm(sel(), null, null)).toBeNull();
  });

  it("kayıtlı güveni üreten endeks kademesi bulunur; bulunamazsa en düşük", () => {
    const stored = valuationEvidenceConfidence({ hasListPrice: true, comparableConfidence: "orta", marketIndex: "medium" });
    expect(inferMarketIndexLevel({ hasMarketIndex: true, hasListPrice: true, previousComparableConfidence: "orta", storedConfidence: stored })).toBe("medium");
    expect(inferMarketIndexLevel({ hasMarketIndex: true, hasListPrice: true, previousComparableConfidence: "orta", storedConfidence: 0.11 })).toBe("low");
    expect(inferMarketIndexLevel({ hasMarketIndex: false, hasListPrice: true, previousComparableConfidence: null, storedConfidence: 0.5 })).toBe("none");
  });
});

describe("recomputeValuation", () => {
  const engineSource = { name: COMPARABLE_SOURCE_LABEL, weight: 0.5, value: 4_500_000, note: "8 emsal (2 kapanmış satış) · medyan 45.000 ₺/m² · güven: yüksek" };
  const listSource = { name: "Ofis liste fiyatı", weight: 0.25, value: 5_000_000, note: "Portföy" };
  const entry = { name: "__emsal_dokumu", weight: 0, value: 8, note: "x", comparables: ROWS };
  const base = {
    sources: [listSource, engineSource, entry],
    storedConfidence: 0.8,
    stored: { low: 4_000_000, mid: 4_666_667, high: 5_100_000 },
    fallbackSqm: 100,
    editedAt: "2026-10-15T10:00:00.000Z",
  };

  it("çıkarma emsal kaynağını yeniden üretir, liste fiyatı kalır, motor anlık görüntüsü saklanır", () => {
    const res = recomputeValuation({ ...base, selection: sel({ excluded: [comparableKey(ROWS[7]!)] }) });
    if ("error" in res) throw new Error(res.error);
    const names = (res.sources as Array<{ name: string }>).map((s) => s.name);
    expect(names).toEqual(["Ofis liste fiyatı", COMPARABLE_SOURCE_LABEL, "__emsal_dokumu"]);
    const comp = (res.sources as Array<{ name: string; note: string }>).find((s) => s.name === COMPARABLE_SOURCE_LABEL)!;
    expect(comp.note).toContain("danışman seçimi");
    expect(res.estimate.compCount).toBe(7);
    const { entry: stored, selection } = readComparablesEntry(res.sources);
    expect(stored?.engine_snapshot?.mid).toBe(4_666_667);
    expect(selection.target_sqm).toBe(100);
  });

  it("tüm emsaller çıkarılınca orta değer yalnız liste fiyatı, bant yok", () => {
    const res = recomputeValuation({ ...base, selection: sel({ excluded: ROWS.map(comparableKey) }) });
    if ("error" in res) throw new Error(res.error);
    expect(res.mid).toBe(5_000_000);
    expect(res.low).toBeNull();
    expect(res.estimate.confidence).toBe("yetersiz");
    expect((res.sources as Array<{ name: string }>).some((s) => s.name === COMPARABLE_SOURCE_LABEL)).toBe(false);
  });

  it("fiyat kaynağı kalmazsa rakam üretilmez", () => {
    const res = recomputeValuation({ ...base, sources: [engineSource, entry], selection: sel({ excluded: ROWS.map(comparableKey) }) });
    if ("error" in res) throw new Error(res.error);
    expect(res.mid).toBeNull();
    expect(res.confidence).toBe(0);
  });

  it("seçim sıfırlanınca motorun ilk sonucuna döner", () => {
    const edited = recomputeValuation({ ...base, selection: sel({ excluded: [comparableKey(ROWS[0]!)] }) });
    if ("error" in edited) throw new Error(edited.error);
    const reset = recomputeValuation({ ...base, sources: edited.sources, stored: { low: edited.low, mid: edited.mid, high: edited.high }, storedConfidence: edited.confidence, selection: sel() });
    if ("error" in reset) throw new Error(reset.error);
    expect(reset.mid).toBe(4_666_667);
    expect(reset.confidence).toBe(0.8);
    const comp = (reset.sources as Array<{ name: string; note: string }>).find((s) => s.name === COMPARABLE_SOURCE_LABEL)!;
    expect(comp.note).toBe(engineSource.note);
  });

  it("m² bilinmiyorsa hata döner", () => {
    const res = recomputeValuation({ ...base, sources: [listSource, entry], fallbackSqm: null, selection: sel({ excluded: ["x"] }) });
    expect("error" in res).toBe(true);
  });
});

describe("reportComparables", () => {
  it("motor satırları dahil/çıkarıldı bilgisiyle, elle girilenler sonda", () => {
    const manual = [{ id: "m1", title: "Aynı site", source_url: null, price: 4_000_000, sqm: 100, rooms: "3+1", floor: 2, added_at: "" }];
    const list = reportComparables(ROWS.slice(0, 2), sel({ excluded: [comparableKey(ROWS[1]!)], manual }));
    expect(list.map((r) => [r.kind, r.included])).toEqual([
      ["engine", true],
      ["engine", false],
      ["manual", true],
    ]);
  });
});
