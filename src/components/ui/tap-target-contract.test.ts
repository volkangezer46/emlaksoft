import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { LayoutGrid, List as ListIcon, CalendarDays } from "lucide-react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Tek görünüm KİT sözleşmesi + dokunma hedefi (sadeleştirme planı C05, C06, 2.1, 2.5, 2.7; sahip kararı 2026-10-16:
 * "Sade / Dengeli görünüm" anahtarı yok, herkes aynı ayarlı yerleşimi görür).
 *
 * Tarayıcısız (vitest `node`): bileşenler sunucu çıktısına çizilir (`/app` yolu taklit edilir), CSS ve kaynak kuralları
 * okunur. Gerçek piksel ölçümü: `e2e/mobile-simple.spec.ts` (APP_URL ile).
 *
 *  - C06: kanonik Button her boyda dokunmatikte ≥44 px (`touch:h-11` + taban `touch:min-h-11`); premium.css dokunmatik
 *    tabanı panel düğmelerini 44 px'e çıkarır; `.hover-action` dokunmatikte görünür + dolu + 44 px.
 *  - C05 + WP3: KpiStrip görünür; telefonda tüm kartlar yatay süzgeç şeridi, masaüstünde en çok 6.
 *  - Başlık: tek birincil + "Diğer" (…) menüsü; ViewSwitcher telefonda menüde; ListPage "Seç" modu.
 *  - FormActionBar: mobilde tek kelimelik "Kaydet", etiket kırpılmaz, "N eksik" düğmenin içinde değil.
 */

const nav = vi.hoisted(() => ({ path: "/app/musteriler" as string | null }));
vi.mock("next/navigation", async (importOriginal) => {
  const mod = await importOriginal<typeof import("next/navigation")>();
  return { ...mod, usePathname: () => nav.path };
});

const { KpiStrip, mobilePrimary } = await import("./list-kit/kpi-strip");
const { ViewSwitcher } = await import("./list-kit/view-switcher");
const { PageHeader } = await import("./page-header");
const { ListPage } = await import("./list-page");
const { Button } = await import("./button");
const { HelperText } = await import("./simple-kit");
const { mobileSubmitLabel } = await import("./form-action-label");

const read = (f: string) => readFileSync(f, "utf8");
const stripComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "");

function render(el: ReactElement): string {
  return renderToStaticMarkup(el);
}

const KPIS = [
  { label: "Toplam müşteri", value: 0, href: "/app/musteriler", icon: createElement("svg") },
  { label: "Bu ay yeni", value: 4, href: "/app/musteriler?d=ay", icon: createElement("svg") },
  { label: "Sıcak", value: 2, href: "/app/musteriler?s=sicak", icon: createElement("svg") },
  { label: "Aranacak", value: 7, href: "/app/arama-listesi", icon: createElement("svg") },
];

const VIEWS = [
  { value: "liste", label: "Liste", icon: ListIcon, href: "/app/gorevler" },
  { value: "pano", label: "Pano", icon: LayoutGrid, href: "/app/gorevler?gorunum=pano" },
  { value: "takvim", label: "Takvim", icon: CalendarDays, href: "/app/gorevler?gorunum=takvim" },
];

beforeEach(() => {
  nav.path = "/app/musteriler";
});

describe("C06 — 44 px dokunma hedefi (kanonik Button + premium.css)", () => {
  const src = read("src/components/ui/button.tsx");

  it("Button tabanı ve HER boy dokunmatikte 44 px", () => {
    expect(src).toMatch(/const BASE =[\s\S]*?touch:min-h-11";/);
    const sizes = src.match(/const SIZES = \{([\s\S]*?)\} as const;/)?.[1] ?? "";
    const rows = sizes.split("\n").filter((l) => /^\s*\w+:/.test(l));
    expect(rows.length).toBeGreaterThanOrEqual(5);
    for (const r of rows) expect(r, r).toContain("touch:h-11");
    expect(sizes).toMatch(/icon:.*touch:w-11 touch:min-w-11/);
  });

  it("çizilmiş Button: en küçük boy (xs) bile 44 px güvencesi taşır", () => {
    const out = renderToStaticMarkup(createElement(Button, { size: "xs", className: "h-6" }, "Bitti"));
    expect(out).toMatch(/class="[^"]*touch:min-h-11/);
  });

  const css = stripComments(read("src/app/premium.css"));

  it("premium.css: dokunmatik/dar ekranda panel düğmeleri ≥44 px (onay kutusu/anahtar hariç)", () => {
    expect(css).toMatch(
      /@media \(max-width: 767\.98px\), \(pointer: coarse\) \{\s*main :is\(button, a\.btn, \[role="button"\], \[role="tab"\], summary\):not\([^)]*\[role="checkbox"\][^)]*\[role="switch"\][^)]*\) \{\s*min-height: 44px;/,
    );
  });

  it(".hover-action dokunmatikte dolu ve 44 px (components katmanı: kendi zemini olan yardımcı sınıf önce gelir)", () => {
    expect(css).toMatch(
      /@layer components \{\s*@media \(hover: none\), \(pointer: coarse\) \{\s*:is\(a, button, \[role="button"\]\)\.hover-action \{\s*min-height: 44px;\s*min-width: 44px;\s*background-color: var\(--surface-hover\);/,
    );
    // Görünürlük (opacity 1) globals.css'te aynı ortamda.
    expect(stripComments(read("src/app/globals.css"))).toMatch(/@media \(hover: none\), \(pointer: coarse\) \{\s*\.hover-action \{ opacity: 1 !important; \}/);
  });

  it("form sayfası: yapışkan çubuk varken mobil alt gezinme gizli (plan 2.7)", () => {
    expect(css).toMatch(/html:has\(\.fab-bar\[data-sticky="1"\]\) nav\[aria-label="Mobil hızlı gezinme"\] \{ display: none; \}/);
    expect(read("src/components/ui/form-action-bar.tsx")).toContain('data-sticky={mode === "sticky" ? "1" : undefined}');
  });
});

describe("C05 — KPI şeridi", () => {
  it("tek görünümde GÖRÜNÜR: katlanmaz; telefonda tüm kartlar yatay süzgeç şeridi (anahtar yok), masaüstünde en çok 6", () => {
    const out = render(createElement(KpiStrip, { items: KPIS }));
    expect(out).toContain("kpi-flow");
    expect(out).not.toContain("Özeti göster");
    // WP3: telefon sınırı yok (yatay kayan şerit) → 4 kartta anahtar da yok.
    expect(out).not.toContain("data-cap-phone");
    expect(out).not.toContain("Tüm göstergeler (4)");
    expect(out).not.toMatch(/class="[^"]*\bkpi-more\b/);
    expect(out).not.toContain("kpi-more-d");
    expect(out).not.toContain("data-cap-desk");
    const css = stripComments(read("src/app/premium.css"));
    expect(css).toContain(".app-frame .kpi-cap[data-cap-phone] > :is(.kpi-cap-toggle, .kpi-cap-input) { display: inline-flex; }");
    expect(css).not.toContain("data-ui-dengeli");
    expect(read("src/app/app/layout.tsx")).not.toContain("data-ui-dengeli");
    expect(read("src/components/ui/kpi-cap.tsx")).not.toContain('"use client"');
    expect(stripComments(read("src/app/list-page.css"))).toMatch(/\.kpi-flow\.kpi-compact\.lk-kpi-thin \{[^}]*flex-wrap: nowrap;[^}]*overflow-x: auto;/);
    // Masaüstü sınırı (6) aynen: 8 kartta 2 kart "Tüm göstergeler" arkasında.
    const eight = Array.from({ length: 8 }, (_, i) => ({ ...KPIS[i % 4]!, label: `K${i}`, href: `/app/x?${i}` }));
    const big = render(createElement(KpiStrip, { items: eight }));
    expect(big.match(/kpi-more-d/g)?.length).toBe(2);
    expect(big).toContain("kpi-capped");
    expect(big).toContain("data-cap-desk");
  });

  it("süzgeç kartı: etkin kart aria-current + pm-card-on", () => {
    const out = render(createElement(KpiStrip, { items: KPIS.map((k, i) => ({ ...k, active: i === 1 })) }));
    expect(out.match(/aria-current="true"/g)?.length).toBe(1);
    expect(out.match(/pm-card-on/g)?.length).toBe(1);
  });

  it("telefonda öncelikli 2 kart: sıfır olmayanlar önce", () => {
    expect([...mobilePrimary(KPIS)]).toEqual([1, 2]);
    expect([...mobilePrimary([{ value: 0 }, { value: 0 }, { value: 0 }])]).toEqual([0, 1]);
    expect([...mobilePrimary([{ value: 0, attention: true }, { value: 3 }])]).toEqual([0, 1]);
  });

  it("/admin'de de KPI katlanmaz", () => {
    nav.path = "/admin/tenants";
    expect(render(createElement(KpiStrip, { items: KPIS }))).toContain("kpi-flow");
  });

  it("CSS: telefonda 2 sütun, etiket sarar (kesilmez), değer tek satır ve kırpılmaz", () => {
    const css = stripComments(read("src/app/premium.css"));
    expect(css).toMatch(/\.kpi-flow\.kpi-compact \{[^}]*display: grid;[^}]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/);
    expect(css).toMatch(/\.kpi-compact \.pm-card-title \{[^}]*white-space: normal;/);
    expect(css).not.toMatch(/\.kpi-compact \.pm-card-title \{[^}]*white-space: nowrap;/);
    expect(css).toMatch(/\.kpi-compact \.pm-value \{[^}]*white-space: nowrap; overflow: visible; text-overflow: clip;/);
  });
});

describe("tek birincil düğme + '…' menüsü", () => {
  const header = () =>
    render(
      createElement(PageHeader, {
        title: "Müşteriler",
        actions: createElement(Button, { variant: "primary" }, "Yeni müşteri"),
        more: [createElement(Button, { key: "a", variant: "outline" }, "İçe aktar"), createElement(Button, { key: "b", variant: "outline" }, "Aynı kişiler")],
      }),
    );

  it("PageHeader: masaüstünde ilk 2 ikincil satır içi, telefonda hepsi 'Diğer' menüsünde (panel kapalı ama bağlı)", () => {
    const out = header();
    expect(out).toContain('aria-label="Diğer işlemler"');
    expect(out).toMatch(/ovf-inline contents max-sm:hidden[\s\S]*İçe aktar/);
    // 2 ikincil eylem sınırı aşmıyor: menü yalnız telefonda.
    expect(out).toMatch(/class="ovf relative inline-flex sm:hidden"/);
    expect(out).toMatch(/<div[^>]*role="group"[^>]*hidden=""[^>]*>[\s\S]*İçe aktar/);
    expect(out.match(/btn-primary/g)?.length).toBe(1);
  });

  it("ViewSwitcher: masaüstünde anahtar, telefonda 'Görünüm' menüsü (Liste / Pano / Takvim içinde)", () => {
    const simple = render(createElement(ViewSwitcher, { options: VIEWS, active: "liste" }));
    // Masaüstünde anahtar satır içi (telefonda gizli), telefonda "Görünüm" menüsü (masaüstünde gizli).
    expect(simple).toMatch(/<span class="contents max-sm:hidden"><nav aria-label="Görünüm"/);
    expect(simple).toMatch(/class="ovf relative inline-flex sm:hidden/);
    expect(simple).toContain('aria-label="Görünüm: Liste"');
    for (const l of ["Liste", "Pano", "Takvim"]) expect(simple).toContain(`${l}</a>`);
  });

  it("ListPage: 'Seç' modu kapalı, KPI görünür, yalnız grafik katlı (tek satır özetle)", () => {
    const page = () =>
      render(
        createElement(
          ListPage,
          { kpis: createElement(KpiStrip, { items: KPIS }), charts: createElement("div", null, "grafik"), chartsHint: "Tür dağılımı", toolbar: createElement("div", null, "araç") },
          "liste",
        ),
      );
    const s = page();
    expect(s).toContain('data-select-mode="off"');
    expect(s).toMatch(/>Seç<\/span><\/button>/);
    expect(s).toContain("kpi-flow");
    expect(s.match(/Özeti göster/g)?.length).toBe(1);
    expect(s).toMatch(/simple-fold-hint">·(?: |<!-- -->)*Tür dağılımı/);
    expect(s).not.toContain(">grafik<");
  });

  it("CSS: 'Seç' modu kapalıyken yalnız SEÇİM kutuları gizli, 'Seç' satırı yalnız kutu varsa görünür", () => {
    const css = stripComments(read("src/app/premium.css"));
    expect(css).toMatch(/\[data-select-mode="off"\] :is\(td, th\):has\(> label > input\[type="checkbox"\]:is\(\[aria-label\$=" seç"\]/);
    expect(css).toMatch(/\.sel-toggle-row \{ display: none;/);
    expect(css).toMatch(/\[data-select-mode\]:has\([\s\S]*?\)\s*> \.sel-toggle-row \{\s*display: flex;/);
  });

  it("HelperText: kısa metin görünür, uzun paragraf katlı", () => {
    expect(render(createElement(HelperText, null, "İpucu metni"))).toContain("İpucu metni");
    expect(render(createElement(HelperText, null, "Uzun yardım ".repeat(12)))).toBe("");
  });
});

describe("FormActionBar — mobilde kırpılmayan tek 'Kaydet'", () => {
  it("mobileSubmitLabel: kayıt fiilleri 'Kaydet', diğerleri olduğu gibi", () => {
    expect(mobileSubmitLabel("Portföyü oluştur")).toBe("Kaydet");
    expect(mobileSubmitLabel("Müşteriyi kaydet")).toBe("Kaydet");
    expect(mobileSubmitLabel("Görevi ekle")).toBe("Kaydet");
    expect(mobileSubmitLabel("Değişiklikleri kaydet")).toBe("Kaydet");
    expect(mobileSubmitLabel("Kaydet")).toBe("Kaydet");
    expect(mobileSubmitLabel("Onaya gönder")).toBe("Onaya gönder");
    expect(mobileSubmitLabel("Kodu doğrula ve kaydet")).toBe("Kodu doğrula ve kaydet");
    expect(mobileSubmitLabel("Geri al")).toBe("Geri al");
  });

  it("kaynak: birincil etiket kırpılmaz, 'N eksik' düğmenin içinde değil, İptal mobilde 'Daha fazla'da", () => {
    const src = read("src/components/ui/form-action-bar.tsx");
    const body = src.slice(src.indexOf("export function FormActionBar("));
    expect(body).not.toMatch(/className="[^"]*\btruncate\b[^"]*">\{(?:submitLabel|primaryAction\.label|mobileLabel)/);
    expect(body).not.toContain("<MissingCountBadge");
    expect(body).toContain("{mobileLabel}");
    expect(body).toMatch(/data-fab-more[\s\S]*?\{cancelLabel\}/);
    expect(src).toContain('const CANCEL_CLS = "max-sm:hidden";');
  });
});
