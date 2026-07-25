import { describe, expect, it } from "vitest";
import {
  buildSplits,
  calculateCommission,
  DEFAULT_COMMISSION_RATE,
  DEFAULT_VAT_RATE,
} from "./commission";

/**
 * Komisyon hesabı PARA üretiyor: fatura tutarı, danışmanın eline geçen,
 * ofisin payı. Buradaki bir kayma doğrudan yanlış ödeme demek ve kimse
 * ekranda "bozuk" bir şey görmez.
 */

describe("temel hesap", () => {
  it("KDV hariç anlaşmada matrah, KDV ve brüt", () => {
    // 5.000.000 × %3 = 150.000 matrah; %20 KDV = 30.000; brüt 180.000
    const r = calculateCommission({ amount: 5_000_000, rate: 3 });
    expect(r.net).toBe(150_000);
    expect(r.vat).toBe(30_000);
    expect(r.gross).toBe(180_000);
  });

  it("KDV DAHİL anlaşmada matrahı geri çıkarır", () => {
    /*
     * En sık yapılan hata: "KDV dahil 180.000" için 180.000 × 0,80 = 144.000
     * demek. DOĞRUSU 180.000 / 1,20 = 150.000. Aradaki 6.000 TL fark her
     * işlemde tekrarlanır.
     */
    const r = calculateCommission({ amount: 6_000_000, rate: 3, vatIncluded: true });
    expect(r.net).toBe(150_000);
    expect(r.vat).toBe(30_000);
    expect(r.gross).toBe(180_000);
    // Yanlış yöntemin sonucu bu OLMAMALI:
    expect(r.net).not.toBe(180_000 * 0.8);
  });

  it("KDV dahil ve hariç aynı brüte ulaşır", () => {
    const haric = calculateCommission({ amount: 5_000_000, rate: 3 });
    const dahil = calculateCommission({ amount: 6_000_000, rate: 3, vatIncluded: true });
    expect(dahil.gross).toBe(haric.gross);
    expect(dahil.net).toBe(haric.net);
  });

  it("net + KDV her zaman brüte eşit", () => {
    for (const amount of [1, 999, 1_234_567, 87_654_321]) {
      const r = calculateCommission({ amount, rate: 2.5 });
      expect(r.net + r.vat).toBeCloseTo(r.gross, 2);
    }
  });
});

describe("paylaşım", () => {
  it("paylar KDV HARİÇ matrah üzerinden", () => {
    // KDV devlete gidiyor; paylaşıma katmak her iki payı da şişirir.
    const r = calculateCommission({ amount: 5_000_000, rate: 3, advisorShare: 60 });
    expect(r.advisorGross).toBe(90_000); // 150.000 × %60
    expect(r.officeGross).toBe(60_000);
    expect(r.advisorGross + r.officeGross).toBe(r.net);
  });

  it("danışman + ofis toplamı her oranda matrahı tutturur", () => {
    // Yuvarlama kaybı olmamalı: ofis payı çıkarma ile hesaplanıyor.
    for (const share of [0, 33, 50, 66.67, 100]) {
      const r = calculateCommission({ amount: 1_234_567, rate: 3, advisorShare: share });
      expect(r.advisorGross + r.officeGross, `pay ${share}`).toBeCloseTo(r.net, 2);
    }
  });

  it("pay 100'ün üstüne çıkamaz", () => {
    const r = calculateCommission({ amount: 1_000_000, rate: 3, advisorShare: 250 });
    expect(r.used.advisorShare).toBe(100);
    expect(r.officeGross).toBe(0);
  });
});

describe("kesintiler", () => {
  it("stopaj yalnızca danışman payından kesilir", () => {
    const r = calculateCommission({ amount: 5_000_000, rate: 3, advisorShare: 50, withholdingRate: 20 });
    expect(r.advisorGross).toBe(75_000);
    expect(r.withholding).toBe(15_000);
    expect(r.advisorNet).toBe(60_000);
    // Ofis payına dokunulmaz.
    expect(r.officeGross).toBe(75_000);
  });

  it("stopaj varsayılanı SIFIR — uygulama vergi kararı vermiyor", () => {
    const r = calculateCommission({ amount: 1_000_000, rate: 3 });
    expect(r.withholding).toBe(0);
    expect(r.advisorNet).toBe(r.advisorGross);
  });

  it("diğer kesintiler net payı düşürür", () => {
    const r = calculateCommission({ amount: 5_000_000, rate: 3, advisorShare: 50, otherDeductions: 5_000 });
    expect(r.advisorNet).toBe(70_000);
  });

  it("kesintiler payı aşarsa net negatife düşmez", () => {
    const r = calculateCommission({ amount: 100_000, rate: 1, advisorShare: 50, otherDeductions: 999_999 });
    expect(r.advisorNet).toBe(0);
  });
});

describe("varsayılanlar ve kenar durumlar", () => {
  it("oran verilmezse varsayılan kullanılır", () => {
    const r = calculateCommission({ amount: 1_000_000 });
    expect(r.used.rate).toBe(DEFAULT_COMMISSION_RATE);
    expect(r.used.vatRate).toBe(DEFAULT_VAT_RATE);
  });

  it("negatif/NaN girdiler varsayılana düşer, patlamaz", () => {
    const r = calculateCommission({ amount: -5, rate: Number.NaN, vatRate: -1, advisorShare: -10 });
    expect(Number.isFinite(r.net)).toBe(true);
    expect(r.net).toBe(0);
    expect(r.used.vatRate).toBe(DEFAULT_VAT_RATE);
    expect(r.used.advisorShare).toBe(50);
  });

  it("sıfır tutarda her şey sıfır", () => {
    const r = calculateCommission({ amount: 0, rate: 3 });
    expect(r).toMatchObject({ net: 0, vat: 0, gross: 0, advisorGross: 0, officeGross: 0, advisorNet: 0 });
  });

  it("KDV oranı 0 verilebilir (istisna işlemler)", () => {
    const r = calculateCommission({ amount: 1_000_000, rate: 3, vatRate: 0 });
    expect(r.vat).toBe(0);
    expect(r.gross).toBe(r.net);
  });

  it("sonuçlar kuruş hassasiyetinde", () => {
    const r = calculateCommission({ amount: 333_333, rate: 3.33 });
    for (const v of [r.net, r.vat, r.gross, r.advisorGross, r.officeGross]) {
      expect(Math.round(v * 100)).toBe(v * 100);
    }
  });
});

describe("buildSplits", () => {
  it("iki satır üretir ve toplamı matrahı tutturur", () => {
    const s = buildSplits(150_000, 60);
    expect(s).toHaveLength(2);
    expect(s[0]).toMatchObject({ label: "Danışman", rate: 60, amount: 90_000 });
    expect(s[1]).toMatchObject({ label: "Ofis", rate: 40, amount: 60_000 });
    expect(s[0].amount + s[1].amount).toBe(150_000);
  });

  it("yuvarlanan oranlarda bile toplam korunur", () => {
    // %33,33 gibi bir oranda iki ayrı çarpım toplamı net'i tutturmayabilirdi.
    const net = 100_000.07;
    for (const share of [33.33, 66.67, 12.5, 87.5]) {
      const s = buildSplits(net, share);
      expect(s[0].amount + s[1].amount, `pay ${share}`).toBeCloseTo(net, 2);
    }
  });

  it("pay verilmezse 50/50", () => {
    const s = buildSplits(100_000);
    expect(s[0].amount).toBe(50_000);
    expect(s[1].amount).toBe(50_000);
  });
});
