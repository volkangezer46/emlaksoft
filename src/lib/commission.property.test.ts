import { describe, expect, it } from "vitest";
import { buildSplits, calculateCommission } from "./commission";

/** Deterministik PRNG (mulberry32) — testler tekrarlanabilir. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const cents = (n: number) => Math.round(n * 100);

describe("komisyon özellik testleri", () => {
  it("rastgele girdilerde pay toplamı net'e eşit, negatif yok, kuruş kaybı yok", () => {
    const r = rng(20260101);
    for (let i = 0; i < 1000; i++) {
      const amount = Math.round(r() * 50_000_000 * 100) / 100;
      const out = calculateCommission({
        amount,
        rate: r() * 10,
        vatRate: [0, 1, 10, 20][Math.floor(r() * 4)]!,
        advisorShare: r() * 100,
        withholdingRate: r() < 0.5 ? 0 : r() * 30,
        vatIncluded: r() < 0.5,
        otherDeductions: r() < 0.5 ? 0 : r() * 1000,
      });

      expect(cents(out.advisorGross) + cents(out.officeGross)).toBe(cents(out.net));
      expect(cents(out.net) + cents(out.vat)).toBe(cents(out.gross));
      for (const v of [
        out.net,
        out.vat,
        out.gross,
        out.advisorGross,
        out.officeGross,
        out.withholding,
        out.advisorNet,
      ]) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(Number.isFinite(v)).toBe(true);
        expect(cents(v) / 100).toBe(v);
      }
      expect(out.advisorNet).toBeLessThanOrEqual(out.advisorGross);
    }
  });

  it("geçersiz girdiler (NaN, negatif) negatif/NaN üretmez", () => {
    const bad = [NaN, -5, Infinity, -Infinity];
    for (const amount of bad) {
      for (const rate of bad) {
        const out = calculateCommission({ amount, rate, advisorShare: rate, vatRate: rate });
        for (const v of [out.net, out.vat, out.gross, out.advisorGross, out.officeGross, out.advisorNet]) {
          expect(Number.isFinite(v)).toBe(true);
          expect(v).toBeGreaterThanOrEqual(0);
        }
      }
    }
  });

  it("buildSplits: danışman + ofis tutarı net'i kuruşu kuruşuna tutar", () => {
    const r = rng(7);
    for (let i = 0; i < 1000; i++) {
      const net = Math.round(r() * 10_000_000 * 100) / 100;
      const [advisor, office] = buildSplits(net, r() * 100);
      expect(cents(advisor!.amount) + cents(office!.amount)).toBe(cents(net));
      expect(advisor!.amount).toBeGreaterThanOrEqual(0);
      expect(office!.amount).toBeGreaterThanOrEqual(0);
    }
  });
});
