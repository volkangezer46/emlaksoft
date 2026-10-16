import { describe, expect, it } from "vitest";
import { AVG_DAYS_EMPTY_NOTE, averageDays, trendOf } from "./trend";

describe("trendOf — tek değişim kuralı", () => {
  it("önceki 0: yüzde yok, 'yeni'; ikisi 0: rozet yok", () => {
    expect(trendOf(5, 0)).toMatchObject({ kind: "new", text: "yeni", dir: "up" });
    expect(trendOf(0, 0)).toBeNull();
    expect(trendOf(NaN, 3)).toBeNull();
  });
  it("ihmal edilebilir taban (50 kat üstü) da 'yeni' — asla '%6300'", () => {
    const t = trendOf(64, 1)!;
    expect(t.kind).toBe("new");
    expect(t.text).not.toMatch(/%/);
  });
  it("3 kat ve üstü 'x kat'", () => {
    expect(trendOf(1542, 249)!.text).toBe("6,1 kat");
    expect(trendOf(30, 10)!.text).toBe("3 kat");
    expect(trendOf(450, 10)!.text).toBe("45 kat");
  });
  it("olağan değişim yüzde; invert iyi/kötüyü çevirir", () => {
    expect(trendOf(12, 10)).toMatchObject({ kind: "pct", text: "%20", dir: "up", good: true });
    expect(trendOf(29, 10)!.text).toBe("%190");
    expect(trendOf(0, 4)).toMatchObject({ text: "%100", dir: "down", good: false });
    expect(trendOf(8, 10, { invert: true })).toMatchObject({ dir: "down", good: true });
    expect(trendOf(5, 5)).toMatchObject({ dir: "flat", good: true });
  });
});

describe("averageDays", () => {
  const d = (day: number) => new Date(Date.UTC(2026, 9, day, 10)).toISOString();
  it("aynı gün açılıp kapanan kayıtlar '0 gün' üretmez → null", () => {
    expect(averageDays([{ start: d(7), end: d(7) }])).toBeNull();
    expect(averageDays([])).toBeNull();
    expect(AVG_DAYS_EMPTY_NOTE.length).toBeGreaterThan(10);
  });
  it("geçerli süreleri yuvarlayarak ortalar, ters/eksik tarihleri atar", () => {
    expect(averageDays([{ start: d(1), end: d(11) }, { start: d(1), end: d(5) }, { start: d(9), end: d(3) }, { start: null, end: d(3) }])).toBe(7);
  });
});
