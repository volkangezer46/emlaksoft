import { describe, expect, it } from "vitest";
import { countBy, weekBuckets, weekBucketsOf, withParams } from "./list-charts";

const NOW = Date.parse("2026-10-07T15:30:00.000Z"); // Çarşamba

describe("weekBuckets (liste grafiği haftalık kovaları)", () => {
  it("bugünle biten 7 tam UTC günlük kovalar, eskiden yeniye; son kova 'Bu hafta'", () => {
    const b = weekBuckets([], NOW, 8);
    expect(b).toHaveLength(8);
    expect(b[7]).toMatchObject({ from: "2026-10-01", to: "2026-10-07", label: "Bu hafta", count: 0 });
    expect(b[6]).toMatchObject({ from: "2026-09-24", to: "2026-09-30" });
    expect(b[0]!.from).toBe("2026-08-13");
    // Kovalar boşluksuz ardışık: her kovanın başı öncekinin bitişinden bir gün sonra.
    for (let i = 1; i < b.length; i++) {
      expect(Date.parse(`${b[i]!.from}T00:00:00Z`) - Date.parse(`${b[i - 1]!.to}T00:00:00Z`)).toBe(86_400_000);
    }
  });

  it("sayım liste filtresiyle aynı kural: kayıt UTC gününe göre kovaya düşer (from/to dahil)", () => {
    const b = weekBuckets(
      [
        "2026-10-07T23:59:59.000Z", // bugün → son kova
        "2026-10-01T00:00:00.000Z", // son kovanın ilk anı
        "2026-09-30T23:59:59.999Z", // bir önceki kova
        "2026-08-12T23:00:00.000Z", // pencere dışı (ilk kovadan önce)
        "2026-10-08T00:00:01.000Z", // gelecek → dışarıda
        null,
        "bozuk",
      ],
      NOW,
      8,
    );
    expect(b[7]!.count).toBe(2);
    expect(b[6]!.count).toBe(1);
    expect(b.reduce((a, x) => a + x.count, 0)).toBe(3);
  });

  it("tarama tavanına dayanan seri güvenilmez → null (grafik çizilmez)", () => {
    expect(weekBucketsOf(Array.from({ length: 1000 }, () => "2026-10-05T10:00:00Z"), NOW, 1000)).toBeNull();
    expect(weekBucketsOf(["2026-10-05T10:00:00Z"], NOW, 1000)?.[7]?.count).toBe(1);
  });
});

describe("yardımcılar", () => {
  it("countBy boş anahtarı ayrı toplar", () => {
    const m = countBy([{ k: "a" }, { k: "a" }, { k: null }], (r) => r.k, "yok");
    expect(m.get("a")).toBe(2);
    expect(m.get("yok")).toBe(1);
  });

  it("withParams sayfayı düşürür, boş değeri yazmaz", () => {
    expect(withParams("/app/x", { q: "ev", sayfa: "3" }, { durum: "acik", q: undefined })).toBe("/app/x?durum=acik");
    expect(withParams("/app/x", {}, {})).toBe("/app/x");
  });
});
