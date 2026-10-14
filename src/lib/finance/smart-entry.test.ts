import { describe, expect, it } from "vitest";
import { CASH_CATEGORIES } from "./cash/categories";
import { formatAmountInput, parseAmountShorthand } from "./amount-shorthand";
import { hasSmartSignal, parseSmartEntry, shiftDayKey, type SmartCategory } from "./smart-entry";

describe("shiftDayKey", () => {
  it("ay ve yıl sınırını aşar; geçersiz giriş aynen döner", () => {
    expect(shiftDayKey("2026-10-13", 30)).toBe("2026-11-12");
    expect(shiftDayKey("2026-12-31", 1)).toBe("2027-01-01");
    expect(shiftDayKey("2026-03-01", -1)).toBe("2026-02-28");
    expect(shiftDayKey("bozuk", 3)).toBe("bozuk");
  });
});

const SYSTEM: SmartCategory[] = CASH_CATEGORIES.map((c) => ({ value: c.value, label: c.label, direction: c.direction }));
const parse = (s: string, extra: SmartCategory[] = []) => parseSmartEntry(s, [...SYSTEM, ...extra]);

describe("parseAmountShorthand (Türkçe tutar)", () => {
  it("nokta binlik, virgül ondalık", () => {
    expect(parseAmountShorthand("1.234,56")).toBe(1234.56);
    expect(parseAmountShorthand("4.500")).toBe(4500);
    expect(parseAmountShorthand("1.200.000")).toBe(1_200_000);
    expect(parseAmountShorthand("12,5")).toBe(12.5);
    expect(parseAmountShorthand("48000")).toBe(48000);
  });
  it("kısaltmalar: k, bin, m, mn, milyon", () => {
    expect(parseAmountShorthand("48k")).toBe(48_000);
    expect(parseAmountShorthand("48 bin")).toBe(48_000);
    expect(parseAmountShorthand("1,2m")).toBe(1_200_000);
    expect(parseAmountShorthand("1,2 milyon")).toBe(1_200_000);
    expect(parseAmountShorthand("2,5 mn")).toBe(2_500_000);
  });
  it("para birimi eki ve yapıştırılan İngilizce biçim", () => {
    expect(parseAmountShorthand("1.250 TL")).toBe(1250);
    expect(parseAmountShorthand("750₺")).toBe(750);
    expect(parseAmountShorthand("1,234.50")).toBe(1234.5);
    expect(parseAmountShorthand("1.5")).toBe(1.5);
  });
  it("geçersiz, sıfır, negatif → null", () => {
    for (const bad of ["", "abc", "0", "-5", "1.2.3,4,5", "k", null, undefined]) expect(parseAmountShorthand(bad as string)).toBeNull();
  });
  it("biçimleyici: tam sayıda kuruş yazılmaz", () => {
    expect(formatAmountInput(1234.5)).toBe("1.234,50");
    expect(formatAmountInput(48000)).toBe("48.000");
  });
});

describe("parseSmartEntry (tek satır akıllı giriş)", () => {
  it("'gider 4.500 portal sahibinden' → gider, 4500, portal", () => {
    expect(parse("gider 4.500 portal sahibinden")).toMatchObject({ direction: "out", amount: 4500, category: "portal", title: "sahibinden" });
  });

  it("'+ 48000 komisyon Ahmet Yılmaz' → gelir, 48000, komisyon, cari Ahmet Yılmaz", () => {
    expect(parse("+ 48000 komisyon Ahmet Yılmaz")).toMatchObject({ direction: "in", amount: 48000, category: "komisyon", partyName: "Ahmet Yılmaz" });
  });

  it("'1,2m kira' → 1.200.000, kira (gider; yön kategoriden)", () => {
    expect(parse("1,2m kira")).toMatchObject({ direction: "out", amount: 1_200_000, category: "kira" });
  });

  it("girişte 'kira' kira tahsilatıdır; 'kira tahsilatı' ifadesi yön sözcüğü sayılmaz", () => {
    expect(parse("gelir 25k kira Ayşe Kaya")).toMatchObject({ direction: "in", amount: 25_000, category: "kira_tahsilat", partyName: "Ayşe Kaya" });
    expect(parse("kira tahsilatı 25.000")).toMatchObject({ direction: "in", amount: 25_000, category: "kira_tahsilat" });
  });

  it("KDV, vade ve gün", () => {
    expect(parse("gider 12.000 reklam %20 vade 30 Meta")).toMatchObject({ vatRate: 20, deferred: true, dueInDays: 30, partyName: "Meta", category: "reklam" });
    expect(parse("- 1000 ofis kdv hariç dün")).toMatchObject({ direction: "out", vatIncluded: false, dayOffset: -1 });
    expect(parse("gider 500 30 gün vadeli")).toMatchObject({ deferred: true, dueInDays: 30, amount: 500 });
  });

  it("transfer ve ofis kategorisi etiketi", () => {
    expect(parse("transfer 10k")).toMatchObject({ direction: "transfer", amount: 10_000, category: null });
    expect(parse("gider 300 çay ocağı", [{ value: "x_cay", label: "Çay ocağı", direction: "out" }])).toMatchObject({ category: "x_cay" });
  });

  it("yönle çelişen kategori seçilmez (uydurma yok); boş metin boş sonuç", () => {
    expect(parse("gelir 500 benzin").category).toBeNull();
    const empty = parse("   ");
    expect(empty.amount).toBeNull();
    expect(hasSmartSignal(empty)).toBe(false);
  });

  it("belirsiz eş anlamlılar yok: 'vergi' SGK değil, 'borç' vadeli değil; çipte olmayan KDV oranı alınmaz", () => {
    expect(parse("gider 2000 vergi").category).toBeNull();
    expect(parse("gider 2000 borç").deferred).toBe(false);
    expect(parse("gider 1000 ofis %18").vatRate).toBeNull();
    expect(parse("gider 1000 ofis kdv 18")).toMatchObject({ vatRate: null, amount: 1000 });
    expect(parse("gider 1000 ofis %10").vatRate).toBe(10);
  });
});
