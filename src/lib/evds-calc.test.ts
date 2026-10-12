import { describe, expect, it } from "vitest";
import {
  annualToMonthlyPct,
  latestPoint,
  normalizeEvdsDate,
  parseEvdsItems,
  tufe12mAverageChange,
} from "./evds-calc";
import { TUFE_EVDS_SOURCE, mergeEvdsTufe, builtinTufeTable } from "./tufe";

describe("EVDS ayrıştırma", () => {
  it("tarih biçimlerini normalleştirir", () => {
    expect(normalizeEvdsDate("2025-9")).toBe("2025-09");
    expect(normalizeEvdsDate("06-10-2025")).toBe("2025-10-06");
    expect(normalizeEvdsDate("2025-10-06")).toBe("2025-10-06");
    expect(normalizeEvdsDate("abc")).toBeNull();
  });

  it("seri alanını nokta→alt çizgi ile okur, boş/bozuk değerleri atar, sıralar", () => {
    const pts = parseEvdsItems(
      {
        totalCount: 4,
        items: [
          { Tarih: "13-10-2025", TP_KTF10: "38,5" },
          { Tarih: "06-10-2025", TP_KTF10: "37.9" },
          { Tarih: "20-10-2025", TP_KTF10: null },
          { Tarih: "27-10-2025", TP_KTF10: "x" },
        ],
      },
      "TP.KTF10",
    );
    expect(pts).toEqual([
      { period: "2025-10-06", value: 37.9 },
      { period: "2025-10-13", value: 38.5 },
    ]);
    expect(latestPoint(pts)?.value).toBe(38.5);
  });

  it("bozuk/boş gövde null", () => {
    expect(parseEvdsItems(null, "TP.X")).toBeNull();
    expect(parseEvdsItems({ items: [] }, "TP.X")).toBeNull();
    expect(parseEvdsItems({ items: [{ Tarih: "2025-1", TP_Y: "1" }] }, "TP.X")).toBeNull();
  });

  it("yıllık faizi aylığa çevirir", () => {
    expect(annualToMonthlyPct(36)).toBe(3);
    expect(annualToMonthlyPct(0)).toBeNull();
    expect(annualToMonthlyPct(Number.NaN)).toBeNull();
  });
});

describe("12 aylık ortalama TÜFE (TÜİK yöntemi)", () => {
  it("24 ardışık endeksten son12 ort / önceki12 ort - 1", () => {
    const idx: Record<string, number> = {};
    // 2024-01..2025-12: sabit aylık %2 artış
    let v = 100;
    for (let y = 2024; y <= 2025; y += 1) {
      for (let m = 1; m <= 12; m += 1) {
        idx[`${y}-${String(m).padStart(2, "0")}`] = v;
        v *= 1.02;
      }
    }
    const out = tufe12mAverageChange(idx);
    // Yalnız 2025-12 için 24 ay var
    expect(Object.keys(out)).toEqual(["2025-12"]);
    // sabit aylık %2 → ortalamalar oranı 1.02^12 - 1
    expect(out["2025-12"]).toBeCloseTo((1.02 ** 12 - 1) * 100, 1);
  });

  it("eksik ay varsa hesaplamaz", () => {
    const idx: Record<string, number> = {};
    for (let m = 1; m <= 12; m += 1) idx[`2024-${String(m).padStart(2, "0")}`] = 100 + m;
    for (let m = 1; m <= 12; m += 1) if (m !== 5) idx[`2025-${String(m).padStart(2, "0")}`] = 120 + m;
    expect(tufe12mAverageChange(idx)).toEqual({});
  });

  it("elle bilinen değer: ilk 12 ay 100, sonraki 12 ay 150 → %50", () => {
    const idx: Record<string, number> = {};
    for (let m = 1; m <= 12; m += 1) {
      idx[`2024-${String(m).padStart(2, "0")}`] = 100;
      idx[`2025-${String(m).padStart(2, "0")}`] = 150;
    }
    expect(tufe12mAverageChange(idx)["2025-12"]).toBe(50);
  });
});

describe("TÜFE tablosuna EVDS birleştirme", () => {
  it("resmi satırı ezmez; EVDS satırı official=false; resmi yoksa kaynak EVDS", () => {
    const base = builtinTufeTable();
    const merged = mergeEvdsTufe(base, { "2026-03": 33.1 });
    expect(merged.entries["2026-03"]).toEqual({ rate: 33.1, official: false });
    expect(merged.source).toBe(TUFE_EVDS_SOURCE);
    expect(merged.verifiedAt).toBeNull();

    const withOfficial = {
      ...base,
      entries: { ...base.entries, "2026-02": { rate: 30, official: true } },
      verifiedAt: "2026-03-05",
      source: "TÜİK bülteni",
    };
    const m2 = mergeEvdsTufe(withOfficial, { "2026-02": 99, "2026-03": 33.1 });
    expect(m2.entries["2026-02"]).toEqual({ rate: 30, official: true });
    expect(m2.entries["2026-03"].official).toBe(false);
    expect(m2.verifiedAt).toBe("2026-03-05");
    expect(m2.source).toContain("TÜİK bülteni");
    expect(m2.source).toContain(TUFE_EVDS_SOURCE);
  });
});
