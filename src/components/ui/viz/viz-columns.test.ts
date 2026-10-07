import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BarColumns, niceTicks } from "./bar-columns";
import { DonutBreakdown, percentShares } from "./donut-breakdown";

describe("BarColumns", () => {
  it("eksen adımları 0'dan başlar, 1-2-5 ölçeğinde ve en büyük değeri kapsar", () => {
    expect(niceTicks(3)).toEqual([0, 1, 2, 3]);
    expect(niceTicks(4)).toEqual([0, 1, 2, 3, 4]);
    expect(niceTicks(0)).toEqual([0, 1]);
    const t = niceTicks(137);
    expect(t[0]).toBe(0);
    expect(t[t.length - 1]).toBeGreaterThanOrEqual(137);
    expect(t.length).toBeLessThanOrEqual(6);
  });

  it("href verilen sütun bağlantıdır (sıfır çıkmaz metrik), seçili sütun aria-current taşır", () => {
    const html = renderToStaticMarkup(
      createElement(BarColumns, {
        ariaLabel: "Paket dağılımı",
        data: [
          { label: "Ofis", value: 2, href: "/admin/tenants?plan=office", active: true },
          { label: "Kurumsal", value: 0, href: "/admin/tenants?plan=enterprise" },
        ],
      }),
    );
    expect(html).toContain('href="/admin/tenants?plan=office"');
    expect(html).toContain('aria-current="true"');
    expect(html).toContain('aria-label="Kurumsal: 0"');
    expect(html).not.toMatch(/#[0-9a-f]{6}/i);
  });

  it("kategori yoksa çizmez", () => {
    expect(renderToStaticMarkup(createElement(BarColumns, { ariaLabel: "x", data: [] }))).toBe("");
  });
});

describe("DonutBreakdown", () => {
  it("yüzdeler toplamı tam 100, sıfır dilim %0", () => {
    expect(percentShares([3, 1, 0, 1, 0])).toEqual([60, 20, 0, 20, 0]);
    const s = percentShares([1, 1, 1]);
    expect(s.reduce((a, b) => a + b, 0)).toBe(100);
    expect(percentShares([0, 0])).toEqual([0, 0]);
  });

  it("lejant satırları filtreli hedefe gider; toplam 0'da halka yerine boş durum", () => {
    const html = renderToStaticMarkup(
      createElement(DonutBreakdown, {
        ariaLabel: "Ofis durumu",
        items: [
          { key: "active", label: "Aktif", value: 3, href: "/admin/tenants?durum=active" },
          { key: "trial", label: "Deneme", value: 0, href: "/admin/tenants?durum=trial" },
        ],
      }),
    );
    expect(html).toContain('href="/admin/tenants?durum=active"');
    expect(html).toContain("%100");
    const empty = renderToStaticMarkup(createElement(DonutBreakdown, { ariaLabel: "x", items: [{ key: "a", label: "A", value: 0 }], empty: "Ofis yok" }));
    expect(empty).toContain("Ofis yok");
    expect(empty).not.toContain("<svg");
  });
});
