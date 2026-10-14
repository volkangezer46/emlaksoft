import { describe, expect, it } from "vitest";
import { entryAmounts, LEDGER_VAT_RATES, RENT_WITHHOLDING_RATE, splitVat, withholding } from "./vat";

describe("splitVat", () => {
  it("KDV dahil: brüt sabit, net ve KDV ayrışır (%1 / %10 / %20)", () => {
    expect(splitVat(1200, 20, true)).toEqual({ net: 1000, vat: 200, gross: 1200 });
    expect(splitVat(1100, 10, true)).toEqual({ net: 1000, vat: 100, gross: 1100 });
    expect(splitVat(1010, 1, true)).toEqual({ net: 1000, vat: 10, gross: 1010 });
  });

  it("KDV hariç: net sabit, KDV eklenir", () => {
    expect(splitVat(1000, 20, false)).toEqual({ net: 1000, vat: 200, gross: 1200 });
    expect(splitVat(999.99, 10, false)).toEqual({ net: 999.99, vat: 100, gross: 1099.99 });
    expect(splitVat(4500, 1, false)).toEqual({ net: 4500, vat: 45, gross: 4545 });
  });

  it("kuruş yuvarlaması yarım yukarı ve her zaman net + KDV = brüt", () => {
    // 0,03 × 100 / 120 = 0,025 → 0,03 (yarım yukarı); KDV 0
    expect(splitVat(0.03, 20, true)).toEqual({ net: 0.03, vat: 0, gross: 0.03 });
    expect(splitVat(0.05, 10, false)).toEqual({ net: 0.05, vat: 0.01, gross: 0.06 });
    for (const rate of LEDGER_VAT_RATES) {
      for (const amount of [0.01, 1, 9.99, 117.35, 4321.07, 100000]) {
        for (const included of [true, false]) {
          const s = splitVat(amount, rate, included);
          expect(Math.round((s.net + s.vat) * 100)).toBe(Math.round(s.gross * 100));
        }
      }
    }
  });

  it("KDV'siz (%0) ve geçersiz girdi", () => {
    expect(splitVat(250, 0, true)).toEqual({ net: 250, vat: 0, gross: 250 });
    expect(splitVat(Number.NaN, 20, true)).toEqual({ net: 0, vat: 0, gross: 0 });
    expect(splitVat(100, 120, true)).toEqual({ net: 0, vat: 0, gross: 0 });
  });
});

describe("withholding", () => {
  it("kira stopajı %20: 10.000 brüt kiradan 2.000 kesilir, 8.000 ödenir", () => {
    expect(withholding(10000, RENT_WITHHOLDING_RATE)).toEqual({ withheld: 2000, net: 8000 });
    expect(withholding(333.33, 20)).toEqual({ withheld: 66.67, net: 266.66 });
  });
});

describe("entryAmounts", () => {
  it("KDV oranı yoksa KDV bilinmiyor (null) ve nakit = tutar", () => {
    expect(entryAmounts(4500, null, true, null)).toEqual({ net: 4500, vat: null, gross: 4500, withheld: null, cash: 4500 });
  });

  it("KDV hariç belge + stopaj: nakit = brüt − stopaj (stopaj net üzerinden)", () => {
    expect(entryAmounts(10000, 20, false, 20)).toEqual({ net: 10000, vat: 2000, gross: 12000, withheld: 2000, cash: 10000 });
  });

  it("KDV dahil belge", () => {
    expect(entryAmounts(1200, 20, true, null)).toEqual({ net: 1000, vat: 200, gross: 1200, withheld: null, cash: 1200 });
  });
});

/** Kuruş (tamsayı) mı: kayan nokta artığı taşımayan iki ondalıklı tutar. */
const isKurus = (n: number) => Math.abs(n * 100 - Math.round(n * 100)) < 1e-6;
const k = (n: number) => Math.round(n * 100);

/** Belirlenimci tutar ızgarası (LCG): 0,01 TL – 10.000.000 TL arası kuruşlu tutarlar + bilinen kayan nokta tuzakları. */
function amountGrid(): number[] {
  const out = [0.01, 0.03, 0.05, 0.15, 0.25, 0.35, 1.005, 2.675, 8.345, 99.995, 117.35, 333.33, 1234.56, 10_000_000];
  let seed = 20261014;
  for (let i = 0; i < 400; i++) {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    out.push((seed % 1_000_000_000) / 100 + 0.01);
  }
  return out;
}

describe("kuruş yuvarlama tutarlılığı (KDV / stopaj, GP1)", () => {
  const RATES = [0, 1, 8, 10, 18, 20];
  const WH = [15, 17, 20];

  it("her çıktı kuruştur; net + KDV = brüt ve nakit + stopaj = brüt kuruşu kuruşuna", () => {
    for (const amount of amountGrid()) {
      for (const rate of RATES) {
        for (const included of [true, false]) {
          for (const wh of WH) {
            const e = entryAmounts(amount, rate, included, wh);
            for (const v of [e.net, e.vat!, e.gross, e.withheld!, e.cash]) expect(isKurus(v), `${amount} %${rate} ${included} stopaj %${wh}: ${v}`).toBe(true);
            expect(k(e.net) + k(e.vat!)).toBe(k(e.gross));
            expect(k(e.cash) + k(e.withheld!)).toBe(k(e.gross));
            expect(e.vat!).toBeGreaterThanOrEqual(0);
            expect(e.withheld!).toBeGreaterThanOrEqual(0);
          }
        }
      }
    }
  });

  it("yuvarlama hatası yarım kuruşu aşmaz: hariçte KDV ≤ 0,005, dahilde ≤ (1 + oran) × 0,005; stopaj ≤ 0,005", () => {
    for (const amount of amountGrid()) {
      for (const rate of RATES) {
        const ex = splitVat(amount, rate, false);
        expect(Math.abs(k(ex.vat) - (k(ex.net) * rate) / 100)).toBeLessThanOrEqual(0.5 + 1e-6);
        const inc = splitVat(amount, rate, true);
        expect(Math.abs(k(inc.vat) - (k(inc.net) * rate) / 100)).toBeLessThanOrEqual(0.5 * (1 + rate / 100) + 1e-6);
        for (const wh of WH) expect(Math.abs(k(withholding(inc.net, wh).withheld) - (k(inc.net) * wh) / 100)).toBeLessThanOrEqual(0.5 + 1e-6);
      }
    }
  });

  it("kayan nokta tuzakları yarım yukarı kuruşa yuvarlanır (DB round ile aynı)", () => {
    // 1,005 × 100 = 100,49999… (ikili gösterim) → yine 1,01; 2,675 → 2,68.
    expect(splitVat(1.005, 0, true).gross).toBe(1.01);
    expect(splitVat(2.675, 0, true).gross).toBe(2.68);
    // 0,15 × %10 = 0,015 (kayan noktada 0,01499…) → 0,02
    expect(withholding(0.15, 10)).toEqual({ withheld: 0.02, net: 0.13 });
    expect(splitVat(0.15, 10, false)).toEqual({ net: 0.15, vat: 0.02, gross: 0.17 });
    // Eski %18 oranı: 100 TL dahil → 84,75 + 15,25
    expect(splitVat(100, 18, true)).toEqual({ net: 84.75, vat: 15.25, gross: 100 });
    expect(entryAmounts(1.005, 18, false, 17)).toEqual({ net: 1.01, vat: 0.18, gross: 1.19, withheld: 0.17, cash: 1.02 });
  });

  it("satır satır yuvarlanan toplam ile kuruş toplamı aynı (toplamda kayan nokta sapması yok)", () => {
    const lines = amountGrid().slice(0, 200).map((a) => entryAmounts(a, 20, true, 20));
    const sumK = lines.reduce((s, l) => s + k(l.cash), 0);
    const sumF = lines.reduce((s, l) => s + l.cash, 0);
    expect(Math.round(sumF * 100)).toBe(sumK);
    expect(lines.reduce((s, l) => s + k(l.net) + k(l.vat!), 0)).toBe(lines.reduce((s, l) => s + k(l.gross), 0));
  });
});
