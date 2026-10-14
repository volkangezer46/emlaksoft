import { createElement, type FunctionComponent, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { Eye, LayoutGrid, List as ListIcon, Map as MapIcon } from "lucide-react";
import { describe, expect, it } from "vitest";
import { BulkBar } from "./bulk-bar";
import { CategoryChips } from "./category-chips";
import { FilterDate, FilterSelect } from "./filter-field";
import { KpiStrip } from "./kpi-strip";
import { ListPager } from "./list-pager";
import { ListToolbar } from "./list-toolbar";
import { RowActionLink, RowActions } from "./row-actions";
import { ViewSwitcher } from "./view-switcher";
import { pageWindow } from "./list-logic";

/**
 * Mobil liste sözleşmesi (YD6): 390×844 telefonda liste sayfası (müşteriler / portföyler) ilk ekranda ≥4 satır
 * gösterir ve etkileşimli hiçbir öğe 44 px'ten küçük değildir.
 *
 * Bu ortamda tarayıcı yok (vitest `node`, jsdom kurulmuyor — bkz. vitest.config.ts), bu yüzden iki katman:
 *  1. ÇİZİLMİŞ ÇIKTI denetimi: liste kiti bileşenleri sunucu çıktısına çizilir; her etkileşimli öğenin sınıfı
 *     dokunmatikte 44 px güvencesi taşır (`touch:` varyantı a11y.css'te kök yazı boyutundan bağımsız 44 px'e sabitlenir).
 *  2. KAYNAK + CSS denetimi: müşteri/portföy sayfalarının mobil yerleşim kararları (alt sayfa, ertelenen bloklar,
 *     kompakt kart) ve sayfa dosyalarındaki odaklanabilir öğelerin dokunma güvencesi.
 * Gerçek ölçüm (piksel): `e2e/mobile-list.spec.ts` (oturumlu Playwright, 390×844).
 */

const html = (el: ReactElement) => renderToStaticMarkup(el);
const read = (f: string) => readFileSync(f, "utf8");
const stripComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "");

/** Yükseklik güvencesi: touch varyantlı 44 px sınıfı, satır eylemi sınıfı ya da KPI kartı (CSS'te 44 px). */
const HEIGHT_OK = /(?:^|\s)(?:touch:(?:min-)?h-11|touch:size-11|lk-row-act|pm-card)(?:\s|$)/;
/** Sabit genişlikli (ikon) öğe dokunmatikte genişliği de 44 px'e çıkarmalı. */
const FIXED_WIDTH = /(?:^|\s)(?:w-(?:4|5|6|7|8|9|10)|size-(?:4|5|6|7|8|9|10))(?:\s|$)/;
const WIDTH_OK = /(?:^|\s)(?:touch:(?:min-)?w-11|touch:size-11|lk-row-act)(?:\s|$)/;

type Offender = { tag: string; cls: string; why: string };

/** Çizilmiş HTML'deki etkileşimli öğeleri bulur ve 44 px güvencesi olmayanları döndürür. */
function touchOffenders(markup: string): Offender[] {
  const out: Offender[] = [];
  const re = /<(a|button|summary|select|input|textarea)\b([^>]*)>/g;
  for (const m of markup.matchAll(re)) {
    const tag = m[1]!;
    const attrs = m[2]!;
    const cls = /class="([^"]*)"/.exec(attrs)?.[1] ?? "";
    if (/type="hidden"/.test(attrs)) continue;
    if (/(?:^|\s)sr-only(?:\s|$)/.test(cls)) continue;
    if (tag === "input" && /type="checkbox"/.test(attrs)) {
      // Onay kutusu: 16 px görsel kutu, 44 px dokunma alanı onu saran label'da (RowCheckbox).
      const before = markup.slice(0, m.index);
      const label = before.slice(before.lastIndexOf("<label"));
      if (!/touch:size-11/.test(label)) out.push({ tag, cls, why: "onay kutusu 44 px label içinde değil" });
      continue;
    }
    if (!HEIGHT_OK.test(cls)) out.push({ tag, cls, why: "dokunmatikte 44 px yükseklik güvencesi yok" });
    else if (FIXED_WIDTH.test(cls) && !WIDTH_OK.test(cls)) out.push({ tag, cls, why: "sabit genişlikli öğe dokunmatikte 44 px genişlemiyor" });
  }
  return out;
}

const PARAMS = { q: "ali", status: "live", gorunum: "kart", sayfa: "2" };
const VIEWS = [
  { value: "liste", label: "Liste", icon: ListIcon, href: "/app/portfoyler" },
  { value: "kart", label: "Kart", icon: LayoutGrid, href: "/app/portfoyler?gorunum=kart" },
  { value: "harita", label: "Harita", icon: MapIcon, href: "/app/portfoyler?gorunum=harita" },
];

function fullToolbar() {
  return html(
    createElement(ListToolbar, {
      pathname: "/app/portfoyler",
      params: PARAMS,
      views: VIEWS,
      activeView: "kart",
      panelParamKeys: ["status", "eklenen"],
      panel: createElement(
        "div",
        null,
        createElement(FilterSelect, { name: "status", label: "Durum", value: "live", options: [{ value: "", label: "Tümü" }, { value: "live", label: "Yayında" }] }),
        createElement(FilterDate, { name: "eklenen", label: "Eklenme", value: "" }),
      ),
      sort: createElement("a", { href: "/app/portfoyler?sort=hot", className: "focus-ring min-h-9 touch:min-h-11" }, "Sıcak önce"),
      densityParam: "yogunluk",
      chips: [{ key: "status", text: "Durum: Yayında", clearHref: "/app/portfoyler?q=ali" }],
      resultCount: 12,
      savedViews: createElement("div", { "data-saved": "" }, "kayıtlı"),
      sheetExtras: createElement("nav", { "data-extra": "" }, "hızlı süzgeç"),
    }),
  );
}

describe("mobil liste sözleşmesi — dokunma hedefleri (çizilmiş çıktı)", () => {
  it("ListToolbar: arama, Filtreler, alt sayfa, görünüm, sıralama, yoğunluk, çipler, temizle — hepsi ≥44 px", () => {
    const out = fullToolbar();
    expect(touchOffenders(out)).toEqual([]);
  });

  it("ViewSwitcher, ListPager, CategoryChips, BulkBar, RowActions ≥44 px", () => {
    const parts = [
      html(createElement(ViewSwitcher, { options: VIEWS, active: "liste" })),
      html(createElement(ListPager, { pathname: "/app/musteriler", params: { sayfa: "2" }, window: pageWindow(2, 120, 25, 25), total: 120 })),
      html(
        createElement(CategoryChips, {
          options: [
            { value: "Alıcı", label: "Alıcı" },
            { value: "Satıcı", label: "Satıcı" },
          ],
          counts: { Alıcı: 3, Satıcı: 2 },
          total: 5,
          active: "",
          pathname: "/app/musteriler",
          params: {},
          paramName: "type",
        }),
      ),
      html(createElement(BulkBar as unknown as FunctionComponent<{ count: number; noun: string; onClear: () => void }>, { count: 2, noun: "müşteri", onClear: () => undefined }, createElement("span", null, "eylem"))),
      html(createElement(RowActions, null, createElement(RowActionLink, { href: "/app/musteriler/1", label: "Detay", icon: Eye, hideWhenStacked: true }))),
    ];
    for (const p of parts) expect(touchOffenders(p), p.slice(0, 120)).toEqual([]);
  });

  it("KPI şeridi: her gösterge tıklanabilir kart (pm-card); telefonda tek satır çip, ≥44 px", () => {
    const out = html(createElement(KpiStrip, { items: [{ label: "Toplam", value: 4, href: "/app/musteriler", icon: createElement("svg") }] }));
    expect(out).toContain("kpi-compact");
    expect(touchOffenders(out)).toEqual([]);
    const css = stripComments(read("src/app/premium.css"));
    expect(css).toMatch(/\.kpi-compact \.pm-card \{[^}]*flex-direction: row;[^}]*min-height: 44px;/);
  });

  it("denetçi gerçekten yakalar (küçük ikon düğmesi, korumasız bağlantı, çıplak onay kutusu)", () => {
    expect(touchOffenders('<button class="grid h-8 w-8 touch:h-11">x</button>')).toHaveLength(1);
    expect(touchOffenders('<a class="focus-ring px-2" href="/x">x</a>')).toHaveLength(1);
    expect(touchOffenders('<label class="inline-grid"><input type="checkbox"/></label>')).toHaveLength(1);
    expect(touchOffenders('<a class="sr-only" href="/x">x</a><input type="hidden" name="q" value="a"/>')).toEqual([]);
  });
});

describe("mobil liste sözleşmesi — filtreler tek alt sayfada", () => {
  it("panel, görünüm, sıralama, yoğunluk, hızlı süzgeç ve kayıtlı görünümler alt sayfada; dış kopyalar telefonda gizli", () => {
    const out = fullToolbar();
    const sheet = out.slice(out.indexOf("lk-sheet"));
    expect(out).toMatch(/<details[^>]*class="lk-filter group relative"/);
    expect(sheet).toContain('aria-label="Filtreleri kapat"');
    expect(sheet).toContain("data-extra");
    expect(sheet).toContain("data-saved");
    expect(sheet).toContain("Sıcak önce");
    expect(sheet).toContain('name="status"');
    // Geniş ekran kopyaları <640 px'te gizli: görünüm anahtarı, sıralama/yoğunluk sarmalayıcısı, kayıtlı görünümler.
    const head = out.slice(0, out.indexOf("<details"));
    expect(head).toMatch(/<nav aria-label="Görünüm" class="[^"]*max-sm:hidden/);
    expect(out).toMatch(/<div class="hidden sm:contents"><a href="\/app\/portfoyler\?sort=hot"/);
    expect(out).toMatch(/<div class="mt-2\.5 max-sm:hidden"><div data-saved/);
  });

  it("iki GET formu iç içe değil; arama paneli, panel aramayı gizli alanla taşır, sayfalama sıfırlanır", () => {
    const out = fullToolbar();
    const forms = out.match(/<form\b/g) ?? [];
    expect(forms).toHaveLength(2);
    const search = out.slice(out.indexOf('role="search"'), out.indexOf("</form>"));
    expect(search).toContain('type="hidden" name="status" value="live"');
    expect(search).not.toContain('name="sayfa"');
    const panelForm = out.slice(out.lastIndexOf("<form"));
    expect(panelForm).toContain('type="hidden" name="q" value="ali"');
    expect(panelForm).not.toContain('type="hidden" name="status"');
    expect(panelForm).not.toContain('name="sayfa"');
  });

  it("panel yoksa masaüstünde Filtreler düğmesi çizilmez (yalnız telefonda sıralama/görünüm için)", () => {
    const out = html(createElement(ListToolbar, { pathname: "/x", params: {}, sort: createElement("span", null, "s") }));
    expect(out).toMatch(/<details[^>]*class="lk-filter group relative sm:hidden"/);
    const bare = html(createElement(ListToolbar, { pathname: "/x", params: {} }));
    expect(bare).not.toContain("<details");
  });

  it("alt sayfa CSS: <640 px'te sabit alt yaprak + dokununca kapanan zemin; masaüstü açılır panel aynen", () => {
    const css = stripComments(read("src/app/list-page.css"));
    expect(css).toMatch(/@media \(max-width: 639\.98px\) \{\s*\.lk-filter\[open\] > summary::before \{[^}]*position: fixed; inset: 0;/);
    expect(css).toMatch(/\.lk-filter > \.lk-sheet \{[^}]*position: fixed; inset-inline: 0; bottom: 0;[^}]*max-height: 85dvh;/);
    expect(read("src/components/ui/list-kit/list-toolbar.tsx")).toContain("sm:absolute sm:right-0 sm:z-30 sm:w-96");
  });
});

describe("mobil liste sözleşmesi — 390×844'te ilk ekranda ≥4 satır (yerleşim kararları)", () => {
  const listCss = stripComments(read("src/app/list-page.css"));

  it("kart listesi kompakt: kimlik + eylemler tek satır, kalan hücreler ikinci satır; iç kaydırma kabı kesmez", () => {
    expect(listCss).toMatch(/\.tbl-stack tr:has\(td\[data-primary\]\) td\[data-actions\] \{ order: 1; flex: 0 0 auto; margin-left: auto; \}/);
    expect(listCss).toMatch(/\.tbl-stack tr:has\(td\[data-primary\]\)::after \{ content: ""; order: 2; flex-basis: 100%; height: 0; \}/);
    expect(listCss).toMatch(/\.tbl-stack td\[data-primary\] \{ flex: 1 1 0%;/);
    expect(listCss).toMatch(/\.tbl-stack > div, \.tbl-stack > div > div \{[^}]*max-height: none !important;/);
    expect(listCss).toMatch(/\.tbl-stack \[data-stack-hide\] \{ display: none; \}/);
  });

  it("hero eylemleri tek satır, ikincil bloklar (.lp-defer) telefonda listenin altına", () => {
    expect(listCss).toMatch(/\.lp-hero-actions \{ flex-wrap: nowrap; overflow-x: auto;/);
    expect(listCss).toMatch(/@media \(max-width: 639\.98px\) \{\s*\.lp > \.lp-defer \{ order: 9; \}/);
  });

  it("müşteriler: hızlı çipler + özel alan süzgeci telefonda alt sayfada; özel günler ertelenir; kart satırı sade", () => {
    const page = read("src/app/app/musteriler/page.tsx");
    expect(page).toMatch(/sheetExtras=\{[\s\S]*?\{quickChips\(\)\}[\s\S]*?<CustomFieldFilterBar/);
    expect(page).toContain('state={customFilter} className="max-sm:hidden"');
    expect(page).toContain('{quickChips("max-sm:hidden")}');
    expect(page).toContain('<Card className="lp-defer p-4">');
    const rows = read("src/app/app/musteriler/customer-rows.tsx");
    expect(rows).toContain("icon={Eye} hideWhenStacked");
    expect(rows).toMatch(/truncate text-xs text-text-faint max-md:hidden/); // e-posta satırı kartta yok
  });

  it("portföyler: ilgili ekran bağlantıları ertelenir; tip/sağlık çipleri + özel alan telefonda alt sayfada", () => {
    const page = read("src/app/app/portfoyler/page.tsx");
    expect(page).toMatch(/<div className="lp-defer -mt-2 [^"]*max-sm:mt-0">/);
    expect(page).toMatch(/sheetExtras=\{[\s\S]*?\{quickChips\("grid gap-3"\)\}[\s\S]*?<CustomFieldFilterBar/);
    expect(page).toContain('state={customFilter} className="max-sm:hidden"');
    expect(page).toMatch(/\{quickChips\("[^"]*max-sm:hidden"\)\}/);
    const rows = read("src/app/app/portfoyler/property-rows.tsx");
    expect(rows).toContain("icon={Eye} hideWhenStacked");
    expect(rows).toContain('className="font-medium text-text max-md:inline"');
  });
});

describe("mobil liste sözleşmesi — sayfa dosyalarında dokunma güvencesi (kaynak)", () => {
  // Liste ekranlarının (müşteriler/portföyler) kendi yazdığı odaklanabilir öğeler: her `focus-ring` sınıf dizgisi
  // dokunmatikte 44 px güvencesi taşır. Yeni öğe eklerken `touch:min-h-11` (ikon düğmede `touch:size-11`) ekleyin.
  const FILES = [
    "src/app/app/musteriler/page.tsx",
    "src/app/app/musteriler/customer-row-delete.tsx",
    "src/app/app/portfoyler/page.tsx",
    "src/app/app/portfoyler/property-row-compare.tsx",
    "src/components/app/saved-views.tsx",
    "src/components/app/custom-field-filter-bar.tsx",
    "src/components/ui/list-kit/list-toolbar.tsx",
    "src/components/ui/list-kit/sheet-close.tsx",
    "src/components/ui/filter-chip.tsx",
  ];
  for (const file of FILES) {
    it(file, () => {
      const src = read(file);
      const found: string[] = [];
      // Düz dizgiler ("…focus-ring…") ve className şablonları (className={`…`}); `cn(CONTROL, "…")` güvenceyi CONTROL'den alır.
      for (const m of src.matchAll(/"([^"\n]*\bfocus-ring\b[^"\n]*)"/g)) {
        if (/cn\(\s*CONTROL,\s*$/.test(src.slice(Math.max(0, m.index - 80), m.index))) continue;
        found.push(m[1]!);
      }
      for (const m of src.matchAll(/className=\{`([^`]*)`\}/g)) if (/\bfocus-ring\b/.test(m[1]!)) found.push(m[1]!);
      const bad = found.filter((s) => {
        const cls = ` ${s.replace(/\$\{[^}]*\}/g, " ")} `;
        return !HEIGHT_OK.test(cls) || (FIXED_WIDTH.test(cls) && !WIDTH_OK.test(cls));
      });
      expect(found.length, `${file}: denetlenecek öğe bulunamadı`).toBeGreaterThan(0);
      expect(bad, file).toEqual([]);
    });
  }

  it("portföy sıralama seçicisi ve satır karşılaştırma düğmesi dokunmatikte 44 px", () => {
    expect(read("src/app/app/portfoyler/property-sort-select.tsx")).toContain("outline-none touch:min-h-11 touch:text-base");
    expect(read("src/app/app/portfoyler/property-row-compare.tsx")).toContain("touch:size-11");
  });
});
