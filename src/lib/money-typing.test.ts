import { describe, expect, it } from "vitest";
import { caretAfterFormat, formatMoneyTyping, formatMoneyValue, moneyTextToNumber, normalizeMoneyPaste } from "./money-typing";
import { parseMoneyInput } from "./money-input";

describe("formatMoneyTyping", () => {
  it("yazarken binlik ayraç ekler", () => {
    expect(formatMoneyTyping("4100000")).toBe("4.100.000");
    expect(formatMoneyTyping("4.800.000")).toBe("4.800.000");
    expect(formatMoneyTyping("4.800000")).toBe("4.800.000");
    expect(formatMoneyTyping("1250,5")).toBe("1.250,5");
    expect(formatMoneyTyping("1250,567")).toBe("1.250,56");
    expect(formatMoneyTyping("12,")).toBe("12,");
    expect(formatMoneyTyping(",5")).toBe("0,5");
  });
  it("harf/sembol/ikinci virgül atılır; baştaki sıfır temizlenir", () => {
    expect(formatMoneyTyping("₺ 1a2b3")).toBe("123");
    expect(formatMoneyTyping("1,2,3")).toBe("1,23");
    expect(formatMoneyTyping("0005000")).toBe("5.000");
    expect(formatMoneyTyping("")).toBe("");
    expect(formatMoneyTyping("abc")).toBe("");
  });
  it("kuruşsuz alan virgülü yok sayar", () => {
    expect(formatMoneyTyping("1500,75", 0)).toBe("1.500");
  });
  it("biçimlenen metin sunucu ayrıştırıcısıyla aynı sayıya döner (eski step=1000 hatası)", () => {
    for (const [typed, n] of [["4100000", 4_100_000], ["5200000", 5_200_000], ["4000001", 4_000_001], ["1250,5", 1250.5]] as const) {
      const r = parseMoneyInput(formatMoneyTyping(typed));
      expect(r).toEqual({ ok: true, value: n });
    }
  });
});

describe("caretAfterFormat", () => {
  it("imleçten önceki rakam sayısını korur", () => {
    // "410000|0" (7. rakamdan önce) → "4.100.00|0"
    expect(caretAfterFormat("4100000", 6, "4.100.000")).toBe(8);
    expect(caretAfterFormat("4100000", 7, "4.100.000")).toBe(9);
    expect(caretAfterFormat("4100000", 0, "4.100.000")).toBe(0);
  });
});

describe("yapıştırma ve değer", () => {
  it("İngilizce ve para birimli metni tanır", () => {
    expect(normalizeMoneyPaste("1250.50")).toBe("1.250,5");
    expect(normalizeMoneyPaste("₺4.100.000")).toBe("4.100.000");
    expect(normalizeMoneyPaste("1,250.50")).toBe("1.250,5");
  });
  it("sayıyı alan metnine çevirir", () => {
    expect(formatMoneyValue(5200000)).toBe("5.200.000");
    expect(formatMoneyValue("1250.5")).toBe("1.250,5");
    expect(formatMoneyValue(null)).toBe("");
    expect(moneyTextToNumber("4.800.000")).toBe(4_800_000);
    expect(moneyTextToNumber("")).toBeNull();
  });
});
