import { describe, expect, it } from "vitest";
import { dailyCounts, dayLabel } from "./trend";

const NOW = Date.UTC(2026, 9, 6, 9, 0, 0); // 6 Ekim 2026 12:00 TRT

describe("dailyCounts", () => {
  it("hiç kayıt yoksa null (düz sıfır çizgisi çizilmez)", () => {
    expect(dailyCounts([], NOW)).toBeNull();
    expect(dailyCounts(["2025-01-01T10:00:00Z"], NOW)).toBeNull();
  });
  it("30 gün, bugün son nokta, TR gününe düşürür", () => {
    const pts = dailyCounts(["2026-10-06T08:00:00Z", "2026-10-05T22:30:00Z", "2026-10-05T10:00:00Z"], NOW)!;
    expect(pts).toHaveLength(30);
    expect(pts.at(-1)).toMatchObject({ key: "2026-10-06", value: 2 }); // 22:30Z = 01:30 TRT ertesi gün
    expect(pts.at(-2)).toMatchObject({ key: "2026-10-05", value: 1 });
    expect(pts[0]!.key).toBe("2026-09-07");
  });
  it("Türkçe gün etiketi", () => {
    expect(dayLabel("2026-10-06")).toBe("6 Eki");
  });
});
