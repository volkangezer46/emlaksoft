import { describe, expect, it } from "vitest";
import { evaluatePaletteInput } from "./palette-calc";

/**
 * Palet hesap makinesi hem PARA hesaplıyor (komisyon kısayolu) hem de
 * arama kutusunu paylaşıyor: yanlış pozitif bir "hesap" gerçek aramayı
 * gizler, yanlış sonuç ise panoya kopyalanıp teklife yapışır.
 */

describe("temel aritmetik", () => {
  it("işlem önceliği ve parantez doğru", () => {
    expect(evaluatePaletteInput("2+3*4")?.value).toBe(14);
    expect(evaluatePaletteInput("(2+3)*4")?.value).toBe(20);
    expect(evaluatePaletteInput("10/4")?.value).toBe(2.5);
    expect(evaluatePaletteInput("10 % 3")?.value).toBe(1); // mod
  });

  it("TR sayı biçimi: binlik nokta ve virgül ondalık", () => {
    expect(evaluatePaletteInput("5.400.000*2")?.value).toBe(10_800_000);
    expect(evaluatePaletteInput("5,5+1")?.value).toBe(6.5);
    // Geçersiz gruplamalı tek nokta ondalık kabul edilir
    expect(evaluatePaletteInput("5.5*2")?.value).toBe(11);
  });
});

describe("yüzde (komisyon kısayolu)", () => {
  it("%2 5400000 iki yönde de komisyonu verir", () => {
    expect(evaluatePaletteInput("%2 5400000")?.value).toBe(108_000);
    expect(evaluatePaletteInput("5.400.000 %2")?.value).toBe(108_000);
  });

  it("toplamaya yüzde ekleme/çıkarma (KDV mantığı)", () => {
    expect(evaluatePaletteInput("150000 + 20%")?.value).toBe(180_000);
    expect(evaluatePaletteInput("100 - 10%")?.value).toBe(90);
    expect(evaluatePaletteInput("200 * 10%")?.value).toBe(20);
  });
});

describe("reddetme — arama akışı bozulmamalı", () => {
  it("matematik olmayan girdi null döner", () => {
    expect(evaluatePaletteInput("ahmet yılmaz")).toBeNull();
    expect(evaluatePaletteInput("5400000")).toBeNull(); // yalın sayı = ilan no olabilir
    expect(evaluatePaletteInput("12 34")).toBeNull(); // yan yana iki düz sayı
    expect(evaluatePaletteInput("alert(1)")).toBeNull(); // eval yok, harf zaten elenir
    expect(evaluatePaletteInput("")).toBeNull();
  });

  it("sıfıra bölme ve bozuk ifade patlamaz, null döner", () => {
    expect(evaluatePaletteInput("5/0")).toBeNull();
    expect(evaluatePaletteInput("2++")).toBeNull();
    expect(evaluatePaletteInput("(2+3")).toBeNull();
    expect(evaluatePaletteInput("+")).toBeNull();
  });
});

describe("biçimlendirme", () => {
  it("display tr-TR gruplu, currency ₺ içerir", () => {
    const r = evaluatePaletteInput("%2 5400000");
    expect(r?.display).toBe("108.000");
    expect(r?.currency).toContain("₺");
    expect(r?.currency).toContain("108.000");
  });
});
