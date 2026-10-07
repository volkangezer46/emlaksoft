import { describe, expect, it } from "vitest";
import { buildMonthGrid, isMonthKey, monthLabel } from "./month-grid";

describe("month-grid", () => {
  it("Pazartesi başlangıçlı haftalar; ayın tüm günleri tam bir kez", () => {
    const weeks = buildMonthGrid("2026-10");
    expect(weeks.every((w) => w.length === 7)).toBe(true);
    // 1 Ekim 2026 Perşembe → ilk hafta 28 Eylül Pazartesi
    expect(weeks[0]![0]!.dayKey).toBe("2026-09-28");
    const inMonth = weeks.flat().filter((d) => d.inMonth).map((d) => d.day);
    expect(inMonth).toEqual(Array.from({ length: 31 }, (_, i) => i + 1));
  });

  it("Şubat 2027 (Pazartesi başlar, 4 hafta) fazladan boş hafta çizmez", () => {
    const weeks = buildMonthGrid("2027-02");
    expect(weeks[0]![0]!.dayKey).toBe("2027-02-01");
    expect(weeks).toHaveLength(4);
  });

  it("geçersiz anahtar boş ızgara; etiket Türkçe", () => {
    expect(buildMonthGrid("2026-13")).toEqual([]);
    expect(isMonthKey("2026-1")).toBe(false);
    expect(isMonthKey("2026-01")).toBe(true);
    expect(monthLabel("2026-12")).toBe("Aralık 2026");
  });
});
