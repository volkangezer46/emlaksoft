import { describe, expect, it } from "vitest";
import { breachHeadline, forecastInsights, shortDayTr, weeklyForecast, type ForecastDayPoint } from "./forecast";

function series(start: number, flows: [number, number][], actualDays = 2): ForecastDayPoint[] {
  const out: ForecastDayPoint[] = [];
  for (let i = 0; i < actualDays; i++) out.push({ date: `2026-09-${String(28 + i).padStart(2, "0")}`, inflow: 5, outflow: 5, balance: start, isActual: true });
  let bal = start;
  flows.forEach(([inn, outt], i) => {
    bal += inn - outt;
    const d = new Date(Date.UTC(2026, 9, 1 + i));
    out.push({ date: d.toISOString().slice(0, 10), inflow: inn, outflow: outt, balance: bal, isActual: false });
  });
  return out;
}

describe("weeklyForecast", () => {
  it("tahmin günlerini 7'şer günlük kovalara böler, gerçekleşen günleri atar", () => {
    const flows: [number, number][] = Array.from({ length: 15 }, (_, i) => [i === 0 ? 100 : 0, 10]);
    const w = weeklyForecast(series(1000, flows), { weeks: 13 });
    expect(w).toHaveLength(3);
    expect(w[0]).toMatchObject({ index: 0, start: "2026-10-01", end: "2026-10-07", inflow: 100, outflow: 70, net: 30, endBalance: 1030 });
    expect(w[1]!.endBalance).toBe(960);
    expect(w[2]).toMatchObject({ start: "2026-10-15", end: "2026-10-15", outflow: 10 });
  });

  it("hafta sayısını sınırlar ve eşik aşımını işaretler", () => {
    const flows: [number, number][] = Array.from({ length: 30 }, () => [0, 50]);
    const w = weeklyForecast(series(1000, flows), { weeks: 2, threshold: 400 });
    expect(w).toHaveLength(2);
    expect(w[0]!.breach).toBe(false);
    expect(w[1]!.breach).toBe(true);
    expect(w[1]!.minDay).toBe("2026-10-14");
    expect(w[1]!.minBalance).toBe(300);
  });

  it("tahmin yoksa boş liste", () => {
    expect(weeklyForecast(series(10, []))).toEqual([]);
  });
});

describe("forecastInsights", () => {
  it("ilk eksiye düşüş gününü ve en düşük noktayı bulur", () => {
    const flows: [number, number][] = [
      [0, 100],
      [0, 950],
      [500, 0],
      [0, 600],
    ];
    const ins = forecastInsights(series(1000, flows), null)!;
    expect(ins.startBalance).toBe(1000);
    expect(ins.firstBreach).toEqual({ date: "2026-10-02", balance: -50 });
    expect(ins.daysUntilBreach).toBe(1);
    expect(ins.lowest).toEqual({ date: "2026-10-04", balance: -150 });
    expect(ins.netChange).toBe(-1150);
    expect(ins.totalIn).toBe(500);
    expect(ins.totalOut).toBe(1650);
    expect(breachHeadline(ins, false)).toBe("02.10 tarihinde kasa eksiye düşebilir");
  });

  it("eşik varsa eşiğe göre değerlendirir; bugün aşılırsa 'Bugün' der", () => {
    const ins = forecastInsights(series(1000, [[0, 600], [0, 0]]), 500)!;
    expect(ins.firstBreach?.date).toBe("2026-10-01");
    expect(ins.daysUntilBreach).toBe(0);
    expect(breachHeadline(ins, true)).toBe("Bugün bakiye en düşük eşiğin altına inebilir");
  });

  it("aşım yoksa null başlık; tahmin yoksa null", () => {
    const ins = forecastInsights(series(1000, [[10, 0]]), 0)!;
    expect(ins.firstBreach).toBeNull();
    expect(breachHeadline(ins, false)).toBeNull();
    expect(forecastInsights(series(1000, []), 0)).toBeNull();
  });

  it("sıralı olmayan girdiyi tarihe göre sıralar ve NaN'ı sıfır sayar", () => {
    const pts: ForecastDayPoint[] = [
      { date: "2026-10-02", inflow: 0, outflow: 10, balance: 80, isActual: false },
      { date: "2026-10-01", inflow: Number.NaN, outflow: 10, balance: 90, isActual: false },
    ];
    const ins = forecastInsights(pts, 0)!;
    expect(ins.startBalance).toBe(100);
    expect(ins.endBalance).toBe(80);
  });
});

describe("shortDayTr", () => {
  it("GG.AA biçimi", () => expect(shortDayTr("2026-03-09")).toBe("09.03"));
});
