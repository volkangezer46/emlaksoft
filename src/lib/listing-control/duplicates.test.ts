import { describe, expect, it } from "vitest";
import { duplicateAnomalies, duplicateDedupeKey, featureFacts, findDuplicatePairs, type DupProperty } from "./duplicates";

const base: DupProperty = {
  id: "a",
  code: "P-1",
  createdAt: "2026-01-01T00:00:00.000Z",
  districtId: "d1",
  propertyType: "daire",
  transactionType: "satilik",
  title: "Moda 3+1 deniz manzaralı",
  address: "Moda Caddesi No 12 Kadıköy",
  price: 5_000_000,
  sqm: 120,
  rooms: "3+1",
  floor: "3",
  block: "101",
  lot: "7",
  lat: 40.98,
  lng: 29.03,
};

describe("kopya portföy kuralı", () => {
  it("aynı gayrimenkul iki kez: yüksek skor + kimlik sinyali → çift; yeni portföyde anomali", () => {
    const b = { ...base, id: "b", code: "P-2", createdAt: "2026-03-01T00:00:00.000Z", price: 5_050_000 };
    const pairs = findDuplicatePairs([base, b], 90);
    expect(pairs).toHaveLength(1);
    expect(pairs[0]).toMatchObject({ newerId: "b", olderId: "a", olderCode: "P-1" });
    expect(pairs[0].score).toBeGreaterThanOrEqual(90);
    const m = duplicateAnomalies(pairs);
    const [anomaly] = m.get("b") ?? [];
    expect(anomaly).toMatchObject({ type: "duplicate", dedupeKey: duplicateDedupeKey("a", "b"), slaDueAt: null });
    expect(String(anomaly?.details.label)).toMatch(/^%\d+ aynı gayrimenkul$/);
    expect(m.has("a")).toBe(false);
  });
  it("aynı binada farklı kat → kopya değil", () => {
    expect(findDuplicatePairs([base, { ...base, id: "b", floor: "5" }], 90)).toEqual([]);
  });
  it("kimlik sinyali yoksa (yalnız fiyat/m²/oda/başlık) kopya sayılmaz", () => {
    const strip = { address: null, block: null, lot: null, lat: null, lng: null };
    expect(findDuplicatePairs([{ ...base, ...strip }, { ...base, ...strip, id: "b" }], 50)).toEqual([]);
  });
  it("farklı ilçe/tür ya da %10'dan uzak fiyat karşılaştırılmaz (ölçek bloklaması)", () => {
    expect(findDuplicatePairs([base, { ...base, id: "b", districtId: "d2" }], 50)).toEqual([]);
    expect(findDuplicatePairs([base, { ...base, id: "b", price: 6_000_000 }], 50)).toEqual([]);
  });
  it("anahtar sırası bağımsız; features'tan m²/oda/kat", () => {
    expect(duplicateDedupeKey("b", "a")).toBe(duplicateDedupeKey("a", "b"));
    expect(featureFacts({ net_sqm: "95", rooms: "2+1", floor: 4 })).toEqual({ sqm: 95, rooms: "2+1", floor: "4" });
    expect(featureFacts(null)).toEqual({ sqm: null, rooms: null, floor: null });
  });
});
