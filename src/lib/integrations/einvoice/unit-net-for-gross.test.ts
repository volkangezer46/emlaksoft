import { describe, expect, it } from "vitest";
import { lineAmounts, unitNetForGross } from "./invoice-math";

const grossOf = (net: number, vatRate: number) => lineAmounts({ description: "x", quantity: 1, unitPrice: net, vatRate }).gross;

describe("unitNetForGross (gelir hareketinden serbest fatura)", () => {
  it("ulaşılabilen her brütü kuruşu kuruşuna tutturur (%0, %1, %10, %20)", () => {
    for (const rate of [0, 1, 10, 20]) {
      for (let netCents = 1; netCents <= 30000; netCents += 7) {
        const gross = grossOf(netCents / 100, rate);
        expect(grossOf(unitNetForGross(gross, rate), rate)).toBe(gross);
      }
    }
  });

  it("ulaşılamayan brütte en yakın (en çok 1 kuruş) sonucu verir", () => {
    // %20: 83,37 → 100,04; 83,38 → 100,06 — 100,05 hiçbir 2 haneli netle elde edilemez.
    const net = unitNetForGross(100.05, 20);
    expect(Math.abs(grossOf(net, 20) - 100.05)).toBeLessThanOrEqual(0.0100001);
    expect(net).toBe(83.37);
  });

  it("hareketin KDV oranını kullanır", () => {
    expect(unitNetForGross(110, 10)).toBe(100);
    expect(unitNetForGross(101, 1)).toBe(100);
    expect(unitNetForGross(120, 20)).toBe(100);
    expect(unitNetForGross(50, 0)).toBe(50);
  });
});
