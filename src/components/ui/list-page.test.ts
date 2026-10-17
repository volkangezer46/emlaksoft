import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { ColumnChartCard, DistributionCard, FunnelCard, ListPage, chartHasData } from "./list-page";
import { PageHeader } from "./page-header";
import { HERO_SCENE_KINDS, HeroScene } from "./illustrations/hero-scenes";

/** /app LİSTE sayfaları: hepsi ortak iskeleti (`PageHeader variant="card"` + `ListPage`) kullanır; sade başlık yok. */
const LIST_PAGES = [
  "src/app/app/musteriler/page.tsx",
  "src/app/app/talepler/demands-view.tsx",
  "src/app/app/portfoyler/page.tsx",
  "src/app/app/ilan-havuzu/page.tsx",
  "src/app/app/randevular/page.tsx",
  "src/app/app/gorevler/page.tsx",
  "src/app/app/anlasmalar/page.tsx",
  "src/app/app/teklifler/page.tsx",
  "src/app/app/sozlesmeler/page.tsx",
  "src/app/app/onaylar/page.tsx",
  "src/app/app/kiralama/page.tsx",
  "src/app/app/aidat/page.tsx",
  // Finans merkezi (WP6): ListPage + PageHeader card kabukta (layout.tsx); alt sayfalar yalnız gövde çizer.
  "src/app/app/finans/(merkez)/layout.tsx",
  "src/app/app/kampanyalar/page.tsx",
  "src/app/app/otomasyonlar/page.tsx",
  "src/app/app/ekip/page.tsx",
  "src/app/app/belgeler/page.tsx",
  "src/app/app/projeler/page.tsx",
];

const html = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el);

describe("ListPage iskeleti", () => {
  it("hero: tek başlık (h1), eyebrow, özet, sahne ve eylemler", () => {
    const out = html(
      createElement(ListPage, {
        hero: { eyebrow: "Müşteri yönetimi", title: "Müşteriler", description: "Özet", art: "musteri", actions: createElement("a", { href: "/x" }, "Yeni") },
      }),
    );
    expect(out.match(/<h1/g)?.length).toBe(1);
    expect(out).toContain("Müşteri yönetimi");
    expect(out).toContain("lp-hero-art");
    expect(out).toContain('href="/x"');
  });

  it("PageHeader card `as=h2` ile ikinci başlık düzeyi", () => {
    expect(html(createElement(PageHeader, { variant: "card", title: "T", as: "h2" }))).toContain("<h2");
  });

  it("PageHeader: iki yoğunluk tek dil (altın üst etiket, tek başlık ölçeği, tek eylem satırı)", () => {
    for (const variant of ["plain", "card"] as const) {
      const out = html(createElement(PageHeader, { variant, title: "Başlık", eyebrow: "Bağlam", actions: createElement("a", { href: "/y" }, "Yeni") }));
      expect(out, variant).toContain("ph-eyebrow");
      expect(out, variant).toContain('class="lp-hero-title"');
      expect(out.match(/ph-actions/g)?.length, variant).toBe(1);
    }
    expect(html(createElement(PageHeader, { variant: "card", title: "T" }))).toContain("lp-hero");
    expect(html(createElement(PageHeader, { title: "T" }))).not.toContain("lp-hero ");
  });

  it("veri yoksa grafik kartı HİÇ çizilmez (sahte grafik yok)", () => {
    expect(chartHasData([{ value: 0 }, { value: Number.NaN }])).toBe(false);
    expect(html(createElement(DistributionCard, { title: "D", href: "/a", slices: [{ label: "x", value: 0, href: "/a?x" }] }))).toBe("");
    expect(html(createElement(ColumnChartCard, { title: "C", bars: [{ label: "x", value: 0, href: "/a?x" }] }))).toBe("");
    expect(html(createElement(FunnelCard, { title: "F", stages: [{ label: "x", value: 0 }] }))).toBe("");
  });

  it("dağılım: her lejant satırı ve dilim filtreli listeye gider; yüzde gerçek orandan", () => {
    const out = html(
      createElement(DistributionCard, {
        title: "Durum",
        href: "/app/p",
        slices: [
          { label: "Yayında", value: 3, href: "/app/p?status=live" },
          { label: "Taslak", value: 1, href: "/app/p?status=draft" },
        ],
      }),
    );
    expect(out.match(/href="\/app\/p\?status=live"/g)?.length).toBe(2); // lejant + dilim
    expect(out).toContain("%75");
    expect(out).toContain("%25");
    expect(out).toContain('tabindex="-1"'); // dilim bağlantısı aria-hidden SVG içinde odaklanmaz
  });

  it("6'dan çok dilim 'Diğer' altında toplanır (hedefi kartın tüm listesi)", () => {
    const slices = Array.from({ length: 8 }, (_, i) => ({ label: `D${i}`, value: 8 - i, href: `/a?d=${i}` }));
    const out = html(createElement(DistributionCard, { title: "Çok", href: "/a", slices }));
    expect(out).toContain("Diğer");
    expect(out).not.toContain("D7");
  });

  it("sütun: her sütun bağlantı, değer yazılı", () => {
    const out = html(
      createElement(ColumnChartCard, {
        title: "Hafta",
        bars: [
          { label: "Pzt", value: 2, href: "/a?gun=1" },
          { label: "Sal", value: 0, href: "/a?gun=2" },
        ],
      }),
    );
    expect(out).toContain('href="/a?gun=1"');
    expect(out).toContain('href="/a?gun=2"');
    expect(out).toContain(">2<");
  });
});

describe("hero sahneleri", () => {
  it("her sahne dekoratif, yalnız token renkli ve < 6 KB (gzip'siz de küçük)", () => {
    expect(HERO_SCENE_KINDS.length).toBeGreaterThanOrEqual(19);
    for (const kind of HERO_SCENE_KINDS) {
      const out = html(createElement(HeroScene, { kind }));
      expect(out).toContain('aria-hidden="true"');
      expect(out.length, kind).toBeLessThan(6 * 1024);
      expect(gzipSync(out).length, kind).toBeLessThan(1500);
      expect(out, kind).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(|<img|<filter/);
    }
  });
});

describe("liste sayfaları sözleşmesi", () => {
  it("18 liste sayfası ortak iskeleti kullanır, sade başlık kalmadı", () => {
    for (const f of LIST_PAGES) {
      const src = readFileSync(f, "utf8");
      expect(src, f).toMatch(/<PageHeader\s+variant="card"|hero=\{\{/);
      expect(src, f).toContain("<ListPage");
      expect(src, f).not.toMatch(/<PageHeader\b(?!\s+variant="card")/);
    }
  });

  it("liste sayfalarında eski koyu KPI kutusu (theme-dark + grad-ink) yok", () => {
    for (const f of LIST_PAGES) expect(readFileSync(f, "utf8"), f).not.toContain("bg-[image:var(--grad-ink)]");
  });

  it("list-page.css console-base.css (konsol paketi)'ten yüklenir; ham renk yok", () => {
    expect(readFileSync("src/app/console-base.css", "utf8")).toContain('@import "./list-page.css"');
    expect(readFileSync("src/app/list-page.css", "utf8").replace(/\/\*[\s\S]*?\*\//g, "")).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(/);
  });

  it("list-page sunucu bileşenidir (istemci JS eklemez)", () => {
    expect(readFileSync("src/components/ui/list-page.tsx", "utf8")).not.toMatch(/^["']use client["']/m);
    expect(readFileSync("src/components/ui/illustrations/hero-scenes.tsx", "utf8")).not.toMatch(/^["']use client["']/m);
  });

  it("mobil sıra: kök flex sütunu (gap), grafikler <768 px'te listenin altına iner (katlama yok)", () => {
    const out = html(createElement(ListPage, { kpis: createElement("div", { className: "k" }), charts: createElement("div", null, "g") }));
    expect(out).toMatch(/class="lp flex flex-col gap-3"/);
    expect(out).not.toContain("space-y-4");
    const css = readFileSync("src/app/list-page.css", "utf8");
    expect(css).toMatch(/@media \(max-width: 767\.98px\) \{\s*\.lp > \.lp-charts \{ order: 10; \}/);
  });

  it("toplu seçim satır kutuları ortak RowCheckbox'tır: 44 px label dokunma alanı, görsel kutu 16 px", () => {
    const code = readFileSync("src/components/app/bulk-selection.tsx", "utf8");
    expect(code).toMatch(/<label[\s\S]*?stopPropagation[\s\S]*?relative z-10[^"]*touch:-m-\[14px\] touch:size-11/);
    expect(code).toContain('className="h-4 w-4 cursor-pointer accent-brand-600"');
    for (const f of ["src/app/app/musteriler/customer-bulk-actions.tsx", "src/app/app/portfoyler/property-bulk-actions.tsx", "src/app/app/talepler/demand-bulk.tsx"]) {
      const src = readFileSync(f, "utf8");
      expect(src, f).toContain("<RowCheckbox ");
      // Başlıktaki "tümünü seç" de RowCheckbox olabilir (müşteri/portföy: YD6) → ham kutu en çok bir tane.
      expect(src.match(/type="checkbox"/g)?.length ?? 0, f).toBeLessThanOrEqual(1);
    }
  });
});
