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
import { TD } from "../table";
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

  it("KPI şeridi: her gösterge tıklanabilir kart (pm-card); telefonda iki satırlı çip (etiket üstte, değer altta), ≥44 px", () => {
    const out = html(createElement(KpiStrip, { items: [{ label: "Toplam", value: 4, href: "/app/musteriler", icon: createElement("svg") }] }));
    expect(out).toContain("kpi-compact");
    expect(touchOffenders(out)).toEqual([]);
    const css = stripComments(read("src/app/premium.css"));
    // B134: tek satırlı düzende etiket değerin üstüne biniyordu; sütun düzeninde kesişim yapısal olarak 0.
    expect(css).toMatch(/\.kpi-compact \.pm-card \{[^}]*flex-direction: column;[^}]*min-height: 44px;/);
    expect(css).not.toMatch(/\.kpi-compact \.pm-card \{[^}]*flex-direction: row;/);
    // C05 (sadeleştirme): etiket artık tek satırda "…" ile KESİLMEZ, iki satıra kadar sarar; telefonda 2 sütun, en çok 2 kart.
    expect(css).toMatch(/\.kpi-compact \.pm-card-title \{[^}]*line-clamp: 2;[^}]*min-width: 0;[^}]*white-space: normal;/);
    expect(css).toMatch(/\.kpi-flow\.kpi-compact \{[^}]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/);
    expect(css).toMatch(/\.kpi-flow\.kpi-compact > \.kpi-more \{ display: none; \}/);
    // Kısa ekran (844x390) aynı kompakt şeridi alır.
    expect(css).toContain("@media (max-width: 639px), (max-height: 500px)");
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
    expect(out).toMatch(/<div class="mt-2 px-1 empty:hidden max-sm:hidden"><div data-saved/);
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

  it("telefon rozeti alt sayfaya taşınan hızlı süzgeçleri de sayar; masaüstü rozeti yalnız paneli", () => {
    const out = html(
      createElement(ListToolbar, {
        pathname: "/app/portfoyler",
        params: { status: "live", kategori: "daire", sirala: "eski" },
        panelParamKeys: ["status"],
        sheetParamKeys: ["kategori", "sirala", "status"],
        panel: createElement(FilterSelect, { name: "status", label: "Durum", value: "live", options: [{ value: "live", label: "Yayında" }] }),
        sheetExtras: createElement("nav", null, "çip"),
      }),
    );
    const summary = out.slice(out.indexOf("<summary"), out.indexOf("</summary>"));
    expect(summary).toMatch(/<span class="[^"]*max-sm:hidden">1<\/span>/);
    expect(summary).toMatch(/<span class="[^"]*sm:hidden">3<\/span>/);
    // Hızlı süzgeç yokken tek rozet (yinelenen sayı yok).
    expect(fullToolbar().slice(0, fullToolbar().indexOf("</summary>"))).not.toMatch(/sm:hidden">\d/);
  });

  it("panel formu aramadaki güncel metni taşır (istemci adası); Escape kapatır; açıkken arka sayfa kaymaz", () => {
    const panelForm = fullToolbar().slice(fullToolbar().lastIndexOf("<form"));
    expect(panelForm).toContain("<span hidden=\"\"></span>"); // PanelSearchCarry
    const island = read("src/components/ui/list-kit/sheet-close.tsx");
    expect(island).toMatch(/addEventListener\("formdata"/);
    expect(island).toMatch(/e\.key !== "Escape"/);
    expect(stripComments(read("src/app/list-page.css"))).toMatch(/html:has\(\.lk-filter\[open\]\) \{ overflow: hidden; \}/);
  });

  it("panel yoksa masaüstünde Filtreler düğmesi çizilmez (yalnız telefonda sıralama/görünüm için)", () => {
    const out = html(createElement(ListToolbar, { pathname: "/x", params: {}, sort: createElement("span", null, "s") }));
    expect(out).toMatch(/<details[^>]*class="lk-filter group relative sm:hidden"/);
    const bare = html(createElement(ListToolbar, { pathname: "/x", params: {} }));
    expect(bare).not.toContain("<details");
  });

  it("alt sayfa CSS: <640 px'te sabit alt yaprak + dokununca kapanan zemin; masaüstü açılır panel aynen", () => {
    const css = stripComments(read("src/app/list-page.css"));
    // Kısa ekranda (≤500 px yükseklik, 844x390) da alt yaprak (B136): masaüstü açılır paneli ekran dışına taşıyordu.
    expect(css).toMatch(
      /@media \(max-width: 639\.98px\), \(max-height: 500px\) \{\s*\.lk-filter > \.lk-sheet \{ width: auto; \}\s*\.lk-filter\[open\] > summary::before \{[^}]*position: fixed; inset: 0;/,
    );
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
    // 390 px'te seçim kutusu + kimlik + üç eylem tek satır (9rem'de müşteri kartının eylemleri alta kayıyordu).
    expect(listCss).toMatch(/\.tbl-stack td\[data-primary\] \{ flex: 1 1 0%; min-width: min\(7rem, 100%\);/);
    // globals.css `p { text-wrap: pretty }` `.truncate`'i ezer; kartta kimlik adı tek satır kırpılır.
    expect(listCss).toMatch(/\.tbl-stack td p\.truncate \{ text-wrap-mode: nowrap; \}/);
  });

  it("masaüstünde gizli sütunlar kartta da gizli: `hidden …:table-cell` TD'leri `stackHide` taşır", () => {
    // `.tbl-stack td { display: block }` katmansızdır (console-base.css → list-page.css) ve Tailwind'in `@layer utilities`
    // içindeki `.hidden`'ını EZER: işaretlenmeyen gizli sütun (konum, fiyat sağlığı, portal, tarih…) kartta görünür ve kart
    // ~95 px'ten ~143 px'e uzar (390×844'te ≥4 satır bozulur). Gizleme `data-stack-hide` ile açıkça yapılır.
    expect(listCss).not.toMatch(/@layer[^{]*\{[^@]*\.tbl-stack td \{/); // kural katmansız kalırsa bu test anlamlı
    for (const file of ["src/app/app/musteriler/customer-rows.tsx", "src/app/app/portfoyler/property-rows.tsx"]) {
      const cells = [...read(file).matchAll(/<TD\b[^>]*>/g)].map((m) => m[0]);
      const hiddenCells = cells.filter((c) => /className="[^"]*\bhidden\b[^"]*\b\w+:table-cell\b/.test(c));
      expect(hiddenCells.length, `${file}: gizli sütun bulunamadı`).toBeGreaterThan(0);
      expect(hiddenCells.filter((c) => !/\bstackHide\b/.test(c)), file).toEqual([]);
    }
    const td = html(createElement("table", null, createElement("tbody", null, createElement("tr", null, createElement(TD, { stackHide: true, className: "hidden xl:table-cell" }, "x")))));
    expect(td).toContain('data-stack-hide=""');
    expect(html(createElement("table", null, createElement("tbody", null, createElement("tr", null, createElement(TD, null, "x")))))).not.toContain("data-stack-hide");
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

/** JSX kaynağındaki etkileşimli açılış etiketleri (`<button …>`, `<Link …>` …): `{…}` ifadeleri ve dizgiler atlanarak kapanış `>` bulunur. */
function jsxInteractiveTags(src: string): { tag: string; text: string; line: number }[] {
  const out: { tag: string; text: string; line: number }[] = [];
  for (const m of src.matchAll(/<(input|select|textarea|button|summary|a|Link|IntentLink)\b/g)) {
    let i = m.index + m[0].length;
    let depth = 0;
    let quote: string | null = null;
    for (; i < src.length; i++) {
      const c = src[i]!;
      if (quote) {
        if (c === quote && src[i - 1] !== "\\") quote = null;
        continue;
      }
      if (c === '"' || ((c === "'" || c === "`") && depth > 0)) quote = c;
      else if (c === "{") depth++;
      else if (c === "}") depth--;
      else if (c === ">" && depth === 0) break;
    }
    out.push({ tag: m[1]!, text: src.slice(m.index, i + 1), line: src.slice(0, m.index).split("\n").length });
  }
  return out;
}

/** Yorumlar (belge yorumundaki "Native <select>" gibi) etiket sanılmasın; satır numaraları korunur. */
const stripSourceComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, " ")).replace(/(^|\s)\/\/[^\n]*/g, "$1");

/**
 * Etiketin sınıf metni: `className` ifadesi + ifadede ya da `{...yayılım}`da geçen ve AYNI dosyada tanımlı sabit/işlevlerin
 * gövdesi (ör. `className={PAGER_BTN}`, `cn(CONTROL, …)`, `filterChipClass(…)`, `{...trigger}`).
 */
function classTextOf(tagText: string, src: string): string {
  const exprs: string[] = [];
  const at = tagText.indexOf("className=");
  if (at >= 0) {
    const open = at + "className=".length;
    if (tagText[open] === '"') exprs.push(tagText.slice(open + 1, tagText.indexOf('"', open + 1)));
    else if (tagText[open] === "{") {
      let depth = 0;
      let j = open;
      for (; j < tagText.length; j++) {
        if (tagText[j] === "{") depth++;
        else if (tagText[j] === "}" && --depth === 0) break;
      }
      exprs.push(tagText.slice(open + 1, j));
    }
  }
  for (const s of tagText.matchAll(/\{\.\.\.(\w+)\}/g)) exprs.push(s[1]!);
  let text = exprs.join(" ");
  for (const id of new Set(exprs.join(" ").match(/\b[A-Za-z_]\w*\b/g) ?? [])) {
    const decl = new RegExp(`(?:const|let|function)\\s+${id}\\b`).exec(src);
    if (decl) text += " " + src.slice(decl.index, decl.index + 700);
  }
  return ` ${text.replace(/\$\{[^}]*\}/g, " ").replace(/[`"'{}()]/g, " ")} `;
}

/** Bilinçli muaf: satırı kaplayan bindirme bağlantısı ve kart görünümünde tüm kart (ikisi de 44 px'ten çok büyük). */
const TOUCH_EXEMPT = /(?:^|\s)(?:absolute inset-0|hover-lift)(?:\s|$)/;

describe("mobil liste sözleşmesi — sayfa dosyalarında dokunma güvencesi (kaynak)", () => {
  // Liste ekranlarının (müşteriler/portföyler) kendi yazdığı TÜM etkileşimli JSX öğeleri (input/select/textarea/button/
  // summary/a/Link/IntentLink; `focus-ring` taşısın taşımasın) dokunmatikte 44 px güvencesi taşır. Yeni öğe eklerken
  // `touch:min-h-11` (ikon düğmede `touch:size-11`) ekleyin.
  const FILES = [
    "src/app/app/musteriler/page.tsx",
    "src/app/app/musteriler/customer-rows.tsx",
    "src/app/app/musteriler/customer-row-delete.tsx",
    "src/app/app/portfoyler/page.tsx",
    "src/app/app/portfoyler/property-rows.tsx",
    "src/app/app/portfoyler/property-row-compare.tsx",
    "src/app/app/portfoyler/property-sort-select.tsx",
    "src/app/app/portfoyler/property-bulk-actions.tsx",
    "src/components/app/saved-views.tsx",
    "src/components/app/custom-field-filter-bar.tsx",
    "src/components/ui/list-kit/list-toolbar.tsx",
    "src/components/ui/list-kit/sheet-close.tsx",
    "src/components/ui/filter-chip.tsx",
  ];
  for (const file of FILES) {
    it(file, () => {
      const src = stripSourceComments(read(file));
      const bad: string[] = [];
      const tags = jsxInteractiveTags(src);
      for (const t of tags) {
        if (/type="hidden"/.test(t.text)) continue;
        const cls = classTextOf(t.text, src);
        if (/(?:^|\s)sr-only(?:\s|$)/.test(cls) || TOUCH_EXEMPT.test(cls)) continue;
        if (!HEIGHT_OK.test(cls) || (FIXED_WIDTH.test(cls) && !WIDTH_OK.test(cls))) bad.push(`${file}:${t.line} <${t.tag}>`);
      }
      expect(tags.length, `${file}: denetlenecek öğe bulunamadı`).toBeGreaterThan(0);
      expect(bad, file).toEqual([]);
    });
  }

  it("kaynak denetçisi gerçekten yakalar (focus-ring'siz ham girdi, sınıfsız bağlantı, küçük ikon düğmesi)", () => {
    const check = (src: string) =>
      jsxInteractiveTags(src).filter((t) => {
        const cls = classTextOf(t.text, src);
        return !/type="hidden"/.test(t.text) && !(HEIGHT_OK.test(cls) && !(FIXED_WIDTH.test(cls) && !WIDTH_OK.test(cls)));
      }).length;
    expect(check('<input name="from" type="date" className="min-h-9 rounded border" />')).toBe(1);
    expect(check("<Link href={x}>git</Link>")).toBe(1);
    expect(check('<button onClick={() => go(a > b)} className="grid h-8 w-8 touch:h-11">x</button>')).toBe(1);
    expect(check('const B = "touch:min-h-11 px-2";\n<Link href={x} className={B}>git</Link>')).toBe(0);
    expect(check('<input type="hidden" name="q" value={q} />')).toBe(0);
  });

  it("portföy sıralama seçicisi ve satır karşılaştırma düğmesi dokunmatikte 44 px", () => {
    expect(read("src/app/app/portfoyler/property-sort-select.tsx")).toContain("outline-none touch:min-h-11 touch:text-base");
    expect(read("src/app/app/portfoyler/property-row-compare.tsx")).toContain("touch:size-11");
  });
});
