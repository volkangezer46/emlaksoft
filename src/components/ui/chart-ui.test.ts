import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

/**
 * Grafik katmanı izole render testleri. Projede jsdom/Testing Library yok (vitest ortamı "node", yeni bağımlılık
 * eklenmez); bileşenler react-dom/server ile sunucu anlık görüntüsüne çizilir: hidrasyon öncesi tam HTML'i
 * (özet, hazır aralık hapları, mini harita tutamaçları, lejant, sr-only tablo, boş durum) doğrularız.
 */
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => undefined }) }));

import { ChartLegend } from "./chart-legend";
import { ChartRangePanel } from "./chart-range";
import { ChartTooltip } from "./chart-tooltip";
import { AreaTrend, AreaTrendChart, BarCompare, DonutSplit } from "./chart";
import { InteractiveChart } from "../app/interactive-chart";

const labels = ["Oca", "Şub", "Mar", "Nis", "May", "Haz", "Tem", "Ağu"];
const values = [100, 120, 90, 150, 180, 160, 200, 240];
const money = (n: number) => `${n} TL`;

function panel(range: readonly [number, number], mode: "total" | "last" = "total") {
  return renderToStaticMarkup(
    h(
      ChartRangePanel,
      {
        labels,
        values,
        range,
        onRangeChange: () => undefined,
        onReset: () => undefined,
        summaryMode: mode,
        formatValue: money,
        color: "var(--viz-1)",
        summaryLabel: "Gelir",
      },
      h("div", { "data-testid": "plot" }, "plot"),
    ),
  );
}

describe("ChartRangePanel", () => {
  it("seçili aralığın toplamını, önceki aynı süreye göre değişimi ve etiketlerini gösterir", () => {
    const html = panel([4, 7]);
    // 180+160+200+240 = 780; önceki pencere (0..3) = 460 → +%69,6
    expect(html).toContain("780 TL");
    expect(html).toContain("+%69,6");
    expect(html).toContain("May – Ağu");
    expect(html).toContain("önceki aynı süreye göre");
    expect(html).toContain('data-testid="plot"');
  });

  it("tam aralıkta önceki pencere yoksa değişim ROZETİ uydurulmaz", () => {
    const html = panel([0, 7]);
    expect(html).toContain("1240 TL");
    expect(html).not.toContain("önceki aynı süreye göre");
  });

  it("son değer modunda aralık başına göre değişimi gösterir", () => {
    const html = panel([2, 7], "last");
    expect(html).toContain("240 TL");
    expect(html).toContain("aralık başına göre");
  });

  it("veri yettiği kadar hazır aralık hapı + Tümü; mini harita iki tutamaç ve pencere taşır", () => {
    const html = panel([0, 7]);
    expect(html).toContain(">3A<");
    expect(html).toContain(">6A<");
    expect(html).not.toContain(">1Y<"); // 8 noktadan fazla yıl yok
    expect(html).toContain(">Tümü<");
    expect(html.match(/role="slider"/g)?.length).toBe(2);
    expect(html).toContain("Aralık başlangıcı");
    expect(html).toContain("Aralık bitişi");
    expect(html).toContain('aria-pressed="true"'); // Tümü etkin
  });
});

describe("ChartLegend", () => {
  const items = [
    { key: "a", label: "Gelir", color: "var(--viz-1)" },
    { key: "b", label: "Gider", color: "var(--viz-3)", suffix: "%40" },
  ];
  it("gizli öğeyi üstü çizili ve aria-pressed=false ile işaretler", () => {
    const html = renderToStaticMarkup(h(ChartLegend, { items, hidden: new Set(["b"]), onToggle: () => undefined }));
    expect(html).toContain("Gelir");
    expect(html).toContain("%40");
    expect(html).toContain("line-through");
    expect(html.match(/aria-pressed="false"/g)?.length).toBe(1);
    expect(html.match(/aria-pressed="true"/g)?.length).toBe(1);
  });
});

describe("ChartTooltip", () => {
  const rows = [{ ay: "Oca", v: 100 }, { ay: "Şub", v: 150 }, { ay: "Mar", v: 0 }];
  it("önceki döneme göre fark satırı gösterir; tabanı 0 olan noktada göstermez", () => {
    const up = renderToStaticMarkup(
      h(ChartTooltip, { active: true, label: "Şub", payload: [{ name: "Gelir", value: 150, dataKey: "v", payload: rows[1] }], deltaRows: rows }),
    );
    expect(up).toContain("+%50");
    expect(up).toContain("önceki döneme göre");
    const first = renderToStaticMarkup(
      h(ChartTooltip, { active: true, label: "Oca", payload: [{ name: "Gelir", value: 100, dataKey: "v", payload: rows[0] }], deltaRows: rows }),
    );
    expect(first).not.toContain("önceki döneme göre");
    const afterZero = [{ v: 0 }, { v: 40 }];
    const none = renderToStaticMarkup(
      h(ChartTooltip, { active: true, payload: [{ name: "G", value: 40, dataKey: "v", payload: afterZero[1] }], deltaRows: afterZero }),
    );
    expect(none).not.toContain("önceki döneme göre");
  });

  it("dekoratif (type=none) ve mükerrer dataKey serilerini listelemez", () => {
    const html = renderToStaticMarkup(
      h(ChartTooltip, {
        active: true,
        payload: [
          { name: "gölge", value: 5, dataKey: "v", type: "none" },
          { name: "Gelir", value: 5, dataKey: "v" },
          { name: "Gelir", value: 5, dataKey: "v" },
        ],
      }),
    );
    expect(html.match(/Gelir/g)?.length).toBe(1);
    expect(html).not.toContain("gölge");
  });
});

describe("AreaTrendChart / InteractiveChart (sunucu anlık görüntüsü)", () => {
  const points = labels.map((label, i) => ({ label, value: values[i]! }));
  it("yeterli veride aralık paneli ve sr-only veri tablosu çıkar", () => {
    const html = renderToStaticMarkup(h(AreaTrendChart, { data: points, format: "number", name: "Aktivite", summary: "total" }));
    expect(html).toContain("Hazır zaman aralıkları");
    expect(html).toContain("role=\"slider\"");
    expect(html).toContain("<table");
    expect(html).toContain("Aktivite");
  });

  it("az veride (rangeable otomatik kapalı) aralık paneli çıkmaz", () => {
    const html = renderToStaticMarkup(h(AreaTrendChart, { data: points.slice(0, 3), format: "number" }));
    expect(html).not.toContain("Hazır zaman aralıkları");
  });

  it("rangeable=false aralık panelini kapatır; tahmin varsa tıklanabilir lejant çıkar", () => {
    const withForecast = points.map((p, i) => ({ ...p, forecast: i === points.length - 1 ? p.value : null }));
    const html = renderToStaticMarkup(h(AreaTrendChart, { data: withForecast, rangeable: false, forecastName: "Tahmin" }));
    expect(html).not.toContain("Hazır zaman aralıkları");
    expect(html).toContain("Tahmin");
    expect(html).toContain("aria-pressed");
  });

  it("InteractiveChart yeterli noktada canlı özet ve aralık paneli ekler", () => {
    const html = renderToStaticMarkup(
      h(InteractiveChart, { data: points, name: "Gelir", format: "money", height: 120 }),
    );
    expect(html).toContain("Hazır zaman aralıkları");
    expect(html).toContain("Gelir");
    expect(html).toContain("1.240 ₺");
  });

  it("InteractiveChart rangeable=false iken eski görünümü korur", () => {
    const html = renderToStaticMarkup(h(InteractiveChart, { data: points, name: "Gelir", rangeable: false, height: 120 }));
    expect(html).not.toContain("Hazır zaman aralıkları");
  });

  it("BarCompare / DonutSplit boş veride çökmez; çoklu seride lejant çıkar", () => {
    expect(() => renderToStaticMarkup(h(BarCompare, { data: [], xKey: "k", series: [{ key: "v", label: "V" }] }))).not.toThrow();
    const donut = renderToStaticMarkup(
      h(DonutSplit, { data: [{ name: "Daire", value: 30 }, { name: "Villa", value: 10 }], format: "number", centerLabel: "Toplam" }),
    );
    expect(donut).toContain("Daire");
    expect(donut).toContain("%75");
    expect(donut).toContain("Toplam");
  });

  it("BarCompare colorKey ile işaretli (kâr/zarar) tek seride çökmeden çizilir", () => {
    const html = renderToStaticMarkup(
      h(BarCompare, {
        data: [
          { ay: "Eki", net: 100, renk: "var(--viz-pos)", href: "/app/komisyon" },
          { ay: "Kas", net: -40, renk: "var(--viz-neg)", href: "/app/giderler" },
        ],
        xKey: "ay",
        series: [{ key: "net", label: "Net" }],
        colorKey: "renk",
        hrefKey: "href",
        format: "money",
      }),
    );
    expect(html.length).toBeGreaterThan(0);
  });

  it("AreaTrend çoklu seride lejant ve (>= 8 nokta) aralık paneli çıkarır", () => {
    const rows = Array.from({ length: 8 }, (_, i) => ({ hafta: `H${i + 1}`, ofis: i, abonelik: i * 2 }));
    const html = renderToStaticMarkup(
      h(AreaTrend, {
        data: rows,
        xKey: "hafta",
        series: [
          { key: "ofis", label: "Yeni ofis" },
          { key: "abonelik", label: "Yeni aktif abonelik" },
        ],
        granularity: "week",
        summary: "total",
      }),
    );
    expect(html).toContain("Yeni ofis");
    expect(html).toContain("Yeni aktif abonelik");
    expect(html).toContain("Hazır zaman aralıkları");
  });
});

describe("/app/raporlar çubuk grafikleri (RankBars / NetBars)", () => {
  it("RankBars sr-only tam değer listesini verir ve boş listede çökmez", async () => {
    const { RankBars } = await import("../../app/app/raporlar/rank-bars");
    const html = renderToStaticMarkup(
      h(RankBars, {
        ariaLabel: "Kayıp nedenleri",
        items: [{ key: "a", label: "Fiyat", href: "/app/anlasmalar", value: 3, valueText: "3 · %60" }],
      }),
    );
    expect(html).toContain("Fiyat: 3 · %60");
    expect(html).toContain('aria-label="Kayıp nedenleri"');
    expect(() => renderToStaticMarkup(h(RankBars, { ariaLabel: "x", items: [] }))).not.toThrow();
  });

  it("NetBars sr-only gelir/gider/net tablosunu verir", async () => {
    const { NetBars } = await import("../../app/app/raporlar/net-bars");
    const html = renderToStaticMarkup(h(NetBars, { points: [{ label: "Eki", income: 1000, expense: 400, net: 600 }] }));
    expect(html).toContain("Aylık gelir, gider ve net fark");
    expect(html).toContain("Eki");
    expect(html).toContain("600");
  });
});
