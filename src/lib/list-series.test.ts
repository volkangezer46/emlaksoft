import { describe, expect, it } from "vitest";
import { WEEK_MS } from "@/components/ui/list-kit/list-logic";
import { kpiTrend } from "@/components/ui/list-kit/kpi-strip";
import { trendOf } from "@/components/ui/list-kit/list-logic";
import { loadWeeklySeries, seriesSinceIso, weeklySeriesFromRows, SERIES_WEEKS } from "./list-series";

const NOW = Date.parse("2026-10-17T12:00:00Z");
const ago = (weeks: number) => new Date(NOW - weeks * WEEK_MS - 3_600_000).toISOString();

describe("liste KPI haftalık serileri (sahte veri yok)", () => {
  it("kayıt yoksa seri YOK (undefined): boş kart sahte çubuk çizmez", () => {
    expect(weeklySeriesFromRows({ data: [], error: null }, "created_at", NOW)).toBeUndefined();
    expect(weeklySeriesFromRows({ data: [{ created_at: null }], error: null }, "created_at", NOW)).toBeUndefined();
  });

  it("sorgu hatası ya da veri null ise seri yok", () => {
    expect(weeklySeriesFromRows({ data: null, error: { code: "57014" } }, "created_at", NOW)).toBeUndefined();
    expect(weeklySeriesFromRows({ data: [{ created_at: ago(0) }], error: { code: "x" } }, "created_at", NOW)).toBeUndefined();
  });

  it("tarama tavana dayandıysa (kesilmiş olabilir) seri yok — yaklaşık sayı uydurulmaz", () => {
    const rows = Array.from({ length: 5 }, () => ({ created_at: ago(1) }));
    expect(weeklySeriesFromRows({ data: rows, error: null }, "created_at", NOW, 5)).toBeUndefined();
    expect(weeklySeriesFromRows({ data: rows, error: null }, "created_at", NOW, 6)).toHaveLength(SERIES_WEEKS);
  });

  it("gerçek tarihleri eskiden yeniye haftalara paketler (son eleman bu hafta)", () => {
    const s = weeklySeriesFromRows({ data: [{ d: ago(0) }, { d: ago(0) }, { d: ago(2) }, { d: ago(20) }], error: null }, "d", NOW)!;
    expect(s).toHaveLength(8);
    expect(s[7]).toBe(2);
    expect(s[5]).toBe(1);
    expect(s.reduce((a, b) => a + b, 0)).toBe(3); // pencere dışı (20 hafta) sayılmaz
  });

  it("loadWeeklySeries: sorgu fırlatırsa seri yok, sayfa düşmez", async () => {
    await expect(loadWeeklySeries(Promise.reject(new Error("ağ")), "d", NOW)).resolves.toBeUndefined();
    await expect(loadWeeklySeries(Promise.resolve({ data: [{ d: ago(0) }], error: null }), "d", NOW)).resolves.toHaveLength(8);
  });

  it("pencere başlangıcı 8 hafta önce", () => {
    expect(Date.parse(seriesSinceIso(NOW))).toBe(NOW - 8 * WEEK_MS);
  });
});

describe("trend rozeti mantığı", () => {
  it("önceki dönem boşsa rozet yok ('yeni' yazılmaz)", () => {
    expect(kpiTrend(trendOf([0, 0, 0, 0, 1, 2, 3, 4]))).toBeNull();
  });
  it("iki yarı da sıfırsa rozet yok", () => {
    expect(kpiTrend(trendOf([0, 0, 0, 0]))).toBeNull();
    expect(kpiTrend(null)).toBeNull();
  });
  it("artış yukarı ve iyi, düşüş aşağı; değişmeyen düz", () => {
    const up = kpiTrend(trendOf([1, 1, 1, 1, 2, 2, 2, 2]))!;
    expect(up.dir).toBe("up");
    expect(up.good).toBe(true);
    const down = kpiTrend(trendOf([2, 2, 2, 2, 1, 1, 1, 1]))!;
    expect(down.dir).toBe("down");
    expect(down.good).toBe(false);
    expect(kpiTrend(trendOf([1, 1, 1, 1]))!.dir).toBe("flat");
  });
});
