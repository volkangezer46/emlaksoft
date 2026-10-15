import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AreaTrend, AreaTrendChart, BarCompare, DonutSplit } from "./server-charts";
import { axisLabelIndices, niceDomain } from "./scale";

const html = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el);
const titles = (markup: string) => [...markup.matchAll(/<title>([^<]*)<\/title>/g)].map((m) => m[1]!);

describe("viz ölçek yardımcıları", () => {
  it("niceDomain 0'ı içerir, 1-2-5 adımlı ve uç değerleri kapsar", () => {
    expect(niceDomain(0, 87)).toEqual([0, 50, 100]); // niceTicks ile aynı 1-2-5 ölçeği
    expect(niceDomain(3, 3)).toEqual([0, 1, 2, 3]);
    const neg = niceDomain(-1200, 3400);
    expect(neg[0]).toBeLessThanOrEqual(-1200);
    expect(neg[neg.length - 1]).toBeGreaterThanOrEqual(3400);
    expect(neg).toContain(0);
    expect(niceDomain(0, 0)).toEqual([0, 1]);
    expect(niceDomain(Number.NaN, Number.NaN)).toEqual([0, 1]);
  });

  it("axisLabelIndices ilk ve sonu her zaman içerir, en çok max etiket", () => {
    expect(axisLabelIndices(0)).toEqual([]);
    expect(axisLabelIndices(4)).toEqual([0, 1, 2, 3]);
    const many = axisLabelIndices(30, 5);
    expect(many).toHaveLength(5);
    expect(many[0]).toBe(0);
    expect(many[many.length - 1]).toBe(29);
  });
});

describe("sunucu grafikleri (Recharts'sız, lazy-charts ile aynı imza)", () => {
  it("AreaTrendChart: her nokta <title> ile değer verir, son değer balonu ve sr-only tablo var", () => {
    const m = html(
      createElement(AreaTrendChart, {
        data: [
          { label: "Oca", value: 1000, href: "/app/komisyon?ay=1" },
          { label: "Şub", value: 2500 },
          { label: "Mar", value: 1800, forecast: 1800 },
          { label: "Nis", value: null, forecast: 2200 },
        ],
        tone: "gold",
        format: "money",
        name: "Komisyon",
        ariaLabel: "Aylık komisyon",
      }),
    );
    const t = titles(m);
    expect(t).toHaveLength(4);
    expect(t[0]).toMatch(/^Oca: /);
    expect(t[1]).toContain("2.500");
    expect(t[3]).toMatch(/^Nis: /); // yalnız tahmin değeri
    expect(m).toContain('href="/app/komisyon?ay=1"');
    expect(m).toContain("Tahmin"); // kesikli tahmin lejantı
    expect(m).toContain('class="sr-only"');
    expect(m).toContain("var(--viz-gold)");
    expect(m).not.toMatch(/recharts/);
  });

  it("AreaTrendChart: boş/sıfır seride anlamlı boş durum (sahte grafik yok)", () => {
    for (const data of [[], [{ label: "Oca", value: null }], [{ label: "Oca", value: 0 }, { label: "Şub", value: 0 }]]) {
      const m = html(createElement(AreaTrendChart, { data, emptyText: "Gelir eğrisi için veri yok" }));
      expect(m).toContain("Gelir eğrisi için veri yok");
      expect(m).not.toContain("<svg viewBox=\"0 0 100 100\"");
    }
  });

  it("AreaTrend: çok seri lejantı ve nokta başına iki seri değeri", () => {
    const m = html(
      createElement(AreaTrend, {
        data: [
          { hafta: "1. hf", ofis: 2, abonelik: 1 },
          { hafta: "2. hf", ofis: 5, abonelik: 3 },
        ],
        xKey: "hafta",
        series: [
          { key: "ofis", label: "Yeni ofis", color: "var(--viz-1)" },
          { key: "abonelik", label: "Yeni aktif abonelik", color: "var(--viz-2)" },
        ],
      }),
    );
    expect(titles(m)).toEqual(["1. hf: Yeni ofis 2 · Yeni aktif abonelik 1", "2. hf: Yeni ofis 5 · Yeni aktif abonelik 3"]);
    expect(m).toContain("Yeni aktif abonelik");
  });

  it("BarCompare dikey: çubuk başına <title>, çubuk üstü etiket, satır rengi ve bağlantı; negatif değer desteklenir", () => {
    const m = html(
      createElement(BarCompare, {
        data: [
          { ay: "Oca", net: 12000, renk: "var(--viz-pos)", href: "/app/komisyon" },
          { ay: "Şub", net: -3000, renk: "var(--viz-neg)", href: "/app/giderler" },
        ],
        xKey: "ay",
        series: [{ key: "net", label: "Net", color: "var(--viz-pos)" }],
        format: "money",
        colorKey: "renk",
        hrefKey: "href",
        hint: "Ayrıntı için tıklayın",
        showValues: true,
      }),
    );
    const t = titles(m);
    expect(t.some((x) => /^Oca: .*12\.000.* — Ayrıntı için tıklayın$/.test(x))).toBe(true);
    expect(t.some((x) => /^Şub: .*3\.000/.test(x))).toBe(true);
    expect(m).toContain("₺12.000");
    expect(m).toContain("var(--viz-neg)");
    expect(m).toContain('href="/app/giderler"');
  });

  it("BarCompare yatay: satır bağlantısı, değer metni ve <title>", () => {
    const m = html(
      createElement(BarCompare, {
        layout: "horizontal",
        data: [
          { ad: "Ayşe Yılmaz", deger: 7, href: "/app/anlasmalar?danisman=1" },
          { ad: "Mehmet Kaya", deger: 3, href: "/app/anlasmalar?danisman=2" },
        ],
        xKey: "ad",
        series: [{ key: "deger", label: "Adet" }],
        hrefKey: "href",
        hint: "Listeyi aç",
        showValues: true,
      }),
    );
    expect(titles(m)).toEqual(["Ayşe Yılmaz: 7 — Listeyi aç", "Mehmet Kaya: 3 — Listeyi aç"]);
    expect(m).toContain('href="/app/anlasmalar?danisman=1"');
    expect(m).toContain('aria-label="Ayşe Yılmaz: 7. Listeyi aç"');
  });

  it("BarCompare: veri yoksa ya da hepsi 0 ise boş durum", () => {
    const series = [{ key: "v", label: "Adet" }];
    expect(html(createElement(BarCompare, { data: [], xKey: "k", series }))).toContain("Bu aralıkta gösterilecek veri yok");
    expect(html(createElement(BarCompare, { data: [{ k: "A", v: 0 }], xKey: "k", series }))).toContain("Bu aralıkta gösterilecek veri yok");
  });

  it("DonutSplit: dilim <title> + yüzde lejantı; toplam 0'da boş durum", () => {
    const m = html(
      createElement(DonutSplit, {
        data: [
          { name: "Satılık", value: 3, href: "/app/portfoyler?tip=satilik" },
          { name: "Kiralık", value: 1 },
        ],
        hrefKey: "href",
        centerLabel: "Portföy",
      }),
    );
    expect(titles(m)).toEqual(["Satılık: 3 (%75)", "Kiralık: 1 (%25)"]);
    expect(m).toContain('href="/app/portfoyler?tip=satilik"');
    expect(html(createElement(DonutSplit, { data: [{ name: "A", value: 0 }] }))).toContain("Bu aralıkta gösterilecek veri yok");
  });
});
