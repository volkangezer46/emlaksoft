import { describe, expect, it } from "vitest";
import { formatAmountEdit, formatAmountInput, parseAmountShorthand } from "./amount-shorthand";

/**
 * Kayıt sayfasında tutar YAZARKEN (tuş tuş) ve yapıştırırken ayrıştırıcı ne döner? Sahibin "tutar bile yazamıyorum"
 * şikâyetinin tutar tarafı: biçimlenmiş "1.500" metnine rakam eklenince sessizce 1,5 ₺ oluyordu; yarım ayraçta
 * ("1500,") tutar kayboluyordu. Hiçbir giriş istisna fırlatmamalı.
 */
describe("parseAmountShorthand: tuş tuş yazma", () => {
  it("rakam rakam yazılan tutar her adımda anlamlı", () => {
    const steps: [string, number | null][] = [
      ["1", 1],
      ["15", 15],
      ["150", 150],
      ["1500", 1500],
      ["1500,", 1500],
      ["1500,5", 1500.5],
      ["1500,50", 1500.5],
    ];
    for (const [text, want] of steps) expect(parseAmountShorthand(text), text).toBe(want);
  });

  it("binlik ayraçla yazılan tutar", () => {
    const steps: [string, number | null][] = [
      ["1.", 1],
      ["1.5", 1.5],
      ["1.50", 1.5],
      ["1.500", 1500],
      ["1.500,", 1500],
      ["1.500,5", 1500.5],
      ["1.500,50", 1500.5],
    ];
    for (const [text, want] of steps) expect(parseAmountShorthand(text), text).toBe(want);
  });

  it("biçimlenmiş metnin sonuna rakam eklemek sessizce yanlış tutar üretmez", () => {
    expect(parseAmountShorthand("1.5000")).toBeNull();
    expect(parseAmountShorthand("1500.123")).toBeNull();
    expect(parseAmountShorthand("1.2.3")).toBeNull();
  });

  it("para birimi ve kısaltmalar", () => {
    expect(parseAmountShorthand("1500 tl")).toBe(1500);
    expect(parseAmountShorthand("1500 TL")).toBe(1500);
    expect(parseAmountShorthand("₺1.500,00")).toBe(1500);
    expect(parseAmountShorthand("TL 1.500")).toBe(1500);
    expect(parseAmountShorthand("1.500,00 ₺")).toBe(1500);
    expect(parseAmountShorthand("2,5m")).toBe(2_500_000);
    expect(parseAmountShorthand("2,5")).toBe(2.5);
    expect(parseAmountShorthand("48k")).toBe(48_000);
  });

  it("yapıştırılan biçimler (Excel, banka, İngilizce)", () => {
    expect(parseAmountShorthand("  1 500,00  ")).toBe(1500);
    expect(parseAmountShorthand("1 500,00")).toBe(1500);
    expect(parseAmountShorthand("1,234.50")).toBe(1234.5);
    expect(parseAmountShorthand("12.345.678,90")).toBe(12_345_678.9);
  });

  it("boş, silinmiş ya da anlamsız giriş null döner, istisna fırlatmaz", () => {
    for (const bad of ["", " ", ",", ".", "abc", "-1500", "0", "0,00", "k", "tl", "₺", "1,5,5", "99999999999999"]) {
      expect(() => parseAmountShorthand(bad)).not.toThrow();
      expect(parseAmountShorthand(bad), bad).toBeNull();
    }
  });
});

describe("formatAmountEdit / formatAmountInput gidiş-dönüş", () => {
  it("odakta binliksiz biçim, bulanıkta binlikli biçim; ikisi de aynı tutara döner", () => {
    for (const v of [1, 15, 1500, 1500.5, 1234567.89, 0.5]) {
      expect(parseAmountShorthand(formatAmountEdit(v))).toBe(v);
      expect(parseAmountShorthand(formatAmountInput(v))).toBe(v);
    }
    expect(formatAmountEdit(1500)).toBe("1500");
    expect(formatAmountEdit(1500.5)).toBe("1500,5");
    expect(formatAmountInput(1500.5)).toBe("1.500,50");
  });

  it("odakta düzenleme biçimine dönülüp rakam eklenince tutar doğru büyür", () => {
    const edit = formatAmountEdit(1500);
    expect(parseAmountShorthand(`${edit}0`)).toBe(15000);
  });
});
