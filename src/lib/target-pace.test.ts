import { describe, expect, it } from "vitest";
import { evaluateTargetPace, slowPaceLabels } from "./target-pace";
import { targetPeriodRange } from "./team/target-actuals";

// Ekim 2026 (31 gün), TR takvimi: 2026-09-30T21:00Z → 2026-10-31T21:00Z.
const range = targetPeriodRange("2026-10-01", "monthly");
const at = (share: number) => range.start + (range.end - range.start) * share;
const run = (actual: number, target: number, nowMs: number) =>
  evaluateTargetPace({ actual, target, startMs: range.start, endMs: range.end, nowMs });

describe("evaluateTargetPace", () => {
  it("ay başı (TR gece yarısı): geçen pay 0, uyarı yok", () => {
    const p = run(0, 10, Date.parse("2026-09-30T21:00:00Z"));
    expect(p.elapsedShare).toBe(0);
    expect(p.status).toBe("erken");
    expect(p.paceRatio).toBeNull();
  });

  it("ayın ilk 3 saati (UTC hâlâ önceki ay) dönem içinde sayılır", () => {
    const p = run(0, 10, Date.parse("2026-09-30T23:00:00Z"));
    expect(p.elapsedShare).toBeGreaterThan(0);
    expect(p.status).toBe("erken");
  });

  it("dönem başlamadıysa uyarı yok", () => {
    expect(run(0, 10, range.start - 1000).status).toBe("baslamadi");
  });

  it("%50 öncesi düşük ilerleme bile uyarı üretmez", () => {
    expect(run(0, 10, at(0.49)).status).toBe("erken");
  });

  it("%50 geçti, ilerleme beklenen tempoya göre %70 altı → yavaş", () => {
    // beklenen = 10 × 0.5 = 5; 3/5 = 0.6
    const p = run(3, 10, at(0.5));
    expect(p.expected).toBeCloseTo(5);
    expect(p.paceRatio).toBeCloseTo(0.6);
    expect(p.status).toBe("yavas");
  });

  it("tam %70 eşiği yavaş sayılmaz", () => {
    // beklenen = 10 × 0.5 = 5; 3.5/5 = 0.7
    expect(run(3.5, 10, at(0.5)).status).toBe("yolunda");
  });

  it("geç dönemde tempoda olan hedef yolunda", () => {
    expect(run(8, 10, at(0.8)).status).toBe("yolunda");
  });

  it("hedef 0 / negatif / NaN → yok", () => {
    expect(run(0, 0, at(0.8)).status).toBe("yok");
    expect(run(5, -1, at(0.8)).status).toBe("yok");
    expect(run(5, Number.NaN, at(0.8)).status).toBe("yok");
  });

  it("tamamlanmış hedef dönem içinde de sonunda da tamam", () => {
    expect(run(10, 10, at(0.6)).status).toBe("tamam");
    expect(run(12, 10, range.end + 1000).status).toBe("tamam");
  });

  it("dönem bitti ve tutmadı → bitti (tempo uyarısı yok)", () => {
    const p = run(2, 10, range.end);
    expect(p.status).toBe("bitti");
    expect(p.elapsedShare).toBe(1);
  });

  it("bozuk dönem aralığı → yok", () => {
    expect(evaluateTargetPace({ actual: 0, target: 5, startMs: 10, endMs: 10, nowMs: 10 }).status).toBe("yok");
  });
});

describe("slowPaceLabels", () => {
  it("yalnız temposu düşük ölçütleri döndürür", () => {
    const labels = slowPaceLabels(
      [
        { label: "Anlaşma", actual: 1, target: 10 },
        { label: "Randevu", actual: 20, target: 30 },
        { label: "Yeni portföy", actual: 0, target: 0 },
      ],
      range,
      at(0.6),
    );
    expect(labels).toEqual(["Anlaşma"]);
  });
});
