import path from "node:path";
import { describe, expect, it } from "vitest";
import { readCached, walkSource } from "./test-support/src-tree";

/**
 * Mobil ve tablet düzeni sözleşmesi (SK11). Statik karşılık; gerçek piksel ölçümü e2e/layout-overflow.spec.ts
 * (320 / 390 / 768 / 844x390 / 1024 genişlikte `scrollWidth === innerWidth`).
 */
const root = process.cwd();
const read = (f: string) => readCached(path.join(root, f));
const stripComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "");
const tsxFiles = () => walkSource(path.join(root, "src")).filter((f) => f.endsWith(".tsx"));

describe("B140/B139 — sr-only içerik belgeyi yana taşırmaz", () => {
  it("ham sr-only tablo yok: tablo `<div className=\"sr-only\">` içinde ya da `<Table srOnly>`", () => {
    const offenders: string[] = [];
    for (const f of tsxFiles()) {
      const src = readCached(f);
      if (/<(table|Table)\s+className="[^"]*\bsr-only\b/.test(src)) offenders.push(path.relative(root, f));
    }
    expect(offenders, "tablo width:1px'e küçülemez; sr-only bir div'e sarılmalı").toEqual([]);
  });

  it("Table srOnly kendini sr-only div'e sarar", () => {
    const src = read("src/components/ui/table.tsx");
    expect(src).toMatch(/if \(srOnly\) \{\s*return \(\s*<div className="sr-only">\s*<table/);
  });

  it(".adm-scroll ve veri gezgini kaydırıcısı konumlu; içinde sr-only olan her kaydırıcı için önleyici kural", () => {
    expect(stripComments(read("src/app/console-kit.css"))).toMatch(/\.adm-scroll \{ position: relative; overflow-x: auto;/);
    expect(read("src/app/admin/sistem/data-explorer-view.tsx")).toContain('<div className="relative overflow-x-auto">');
    expect(stripComments(read("src/app/globals.css"))).toMatch(
      /@layer base \{\s*:where\(\.overflow-x-auto, \.overflow-auto, \.overflow-x-scroll\):has\(\.sr-only\) \{ position: relative; \}/,
    );
  });
});

describe("B142 — hover'a bağlı eylemler dokunmatikte ve klavyede erişilebilir", () => {
  // SK12 paketinin dosyası (kendi paketinde düzeltilir); bayat giriş testi düşürmez.
  const PENDING = new Set(["src/app/app/asistan/advisor-chat.tsx"]);
  it("opacity-0/hidden + group-hover ile beliren etkileşimli öğe `hover-action` taşır", () => {
    const tag = /<(button|a|Link|summary)\b([^>]*?)>/g;
    const cls = /className=(?:"([^"]*)"|\{`([^`]*)`\})/;
    const offenders: string[] = [];
    for (const f of tsxFiles()) {
      const rel = path.relative(root, f).replace(/\\/g, "/");
      if (PENDING.has(rel)) continue;
      const src = readCached(f);
      for (const m of src.matchAll(tag)) {
        const c = cls.exec(m[2] ?? "");
        const value = c ? (c[1] ?? c[2] ?? "") : "";
        const hides = /(?<![\w:-])(opacity-0|hidden)(?![\w-])/.test(value);
        const reveals = /group-hover[/\w-]*:(opacity-100|grid|flex|block|inline-flex|inline-grid)|(?<![\w-])hover:opacity-100/.test(value);
        if (hides && reveals && !value.includes("hover-action") && !value.includes("@media(hover:none)")) {
          offenders.push(`${rel}:${src.slice(0, m.index).split("\n").length}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("hover-action dokunmatikte görünür, klavye odağında her cihazda görünür", () => {
    const css = stripComments(read("src/app/globals.css"));
    expect(css).toMatch(/@media \(hover: none\), \(pointer: coarse\) \{\s*\.hover-action \{ opacity: 1 !important; \}/);
    expect(css).toMatch(/\.hover-action:focus-visible,\s*\.hover-action:focus-within \{ opacity: 1 !important; \}/);
  });

  it("kayıtlı görünüm ve anlaşma notu silme düğmesi hover-action; haftalık takvimde görünmez dokunma hedefi yok", () => {
    expect(read("src/components/app/saved-views.tsx")).not.toMatch(/hidden h-4 w-4[^"]*group-hover\/chip:grid/);
    expect(read("src/app/app/anlasmalar/[id]/deal-notes-section.tsx")).toContain("hover-action focus-ring");
    // GA-03: <640 px'te 7 sütun yerine ajanda (yatay kaydırma yok); ızgara yalnız ≥640 px'te ve boş saat hedefi dokunmatikte gizli.
    const week = read("src/app/app/randevular/appointment-week-view.tsx");
    expect(week).toContain('"mt-4 sm:hidden"');
    expect(week).toContain('"mt-4 hidden sm:block"');
    expect(read("src/app/app/randevular/week-grid.tsx")).toContain("[@media(hover:none)]:hidden");
  });
});

describe("B136/B137 — kısa ekran (≤500 px yükseklik)", () => {
  it("short varyantı tanımlı; menü ve açılır panel kullanılabilir yükseklikle sınırlı", () => {
    expect(read("src/app/a11y.css")).toContain("@custom-variant short");
    expect(read("src/components/ui/dropdown-menu.tsx")).toContain("max-h-[var(--radix-dropdown-menu-content-available-height)] min-w-[11rem] overflow-y-auto");
    expect(read("src/components/ui/popover.tsx")).toContain("max-h-[var(--radix-popover-content-available-height)] overflow-y-auto");
  });

  it("filtre alt sayfası, kompakt hero ve KPI şeridi kısa ekranda da açılır; tablo iç kaydırıcısı kalkar", () => {
    const list = stripComments(read("src/app/list-page.css"));
    expect(list).toContain("@media (max-width: 639.98px), (max-height: 500px) {\n  .lk-filter > .lk-sheet { width: auto; }");
    expect(list).toMatch(/@media \(max-width: 639px\), \(max-height: 500px\) \{\s*\.lp-hero \{/);
    expect(stripComments(read("src/app/premium.css"))).toMatch(/@media \(max-width: 639px\), \(max-height: 500px\) \{\s*\.kpi-flow\.kpi-compact \{/);
    expect(stripComments(read("src/app/a11y.css"))).toMatch(/@media \(max-height: 500px\) \{\s*\.tbl-scroll \{ max-height: none !important; \}/);
    expect(read("src/components/ui/table.tsx")).toContain('"tbl-scroll relative w-full');
  });

  it("alt gezinme kısa ekranda kaydırınca çekilir, klavye açıkken gizlenir", () => {
    const css = stripComments(read("src/app/globals.css"));
    expect(css).toMatch(/@media \(max-height: 500px\) \{\s*@supports \(animation-timeline: scroll\(\)\)/);
    expect(css).toContain('html:has(.fab-bar[data-kb="1"]) nav[aria-label="Mobil hızlı gezinme"] { display: none; }');
  });
});

describe("B138 — sekmeli form mobilde", () => {
  it("yatay şeritte açıklama yer kaplamaz", () => {
    expect(stripComments(read("src/app/shared-ui.css"))).toContain('.mt-tab:not([data-orient="vertical"]) .mt-dw { display: none; }');
  });
  // Sadeleştirme 2.7 + ilke 5 (B2): mobilde altta TEK tam genişlik birincil düğme ("Kaydet", kırpılmaz); İptal artık
  // satırda değil "Daha fazla" satırında (B138b'deki "İptal ekran dışına kayar" sorunu yapısal olarak kalkar).
  it("İptal mobilde 'Daha fazla' satırında, birincil etiket kırpılmaz", () => {
    const src = read("src/components/ui/form-action-bar.tsx");
    expect(src).toContain('const CANCEL_CLS = "max-sm:hidden";');
    expect(src.match(/className=\{CANCEL_CLS\}/g)?.length).toBe(3);
    expect(src).toContain("max-sm:justify-stretch");
    expect(src).toMatch(/data-fab-more[\s\S]*?\{cancelLabel\}/);
    expect(src).not.toContain('<span className="min-w-0 truncate">');
  });
  it("odaklanan alan yapışkan çubukların altında kalmaz (scroll-padding)", () => {
    expect(stripComments(read("src/app/globals.css"))).toMatch(/scroll-padding-bottom: calc\(9rem \+ env\(safe-area-inset-bottom, 0px\)\);/);
  });
});

describe("B171 — kullanıcı menüsü klavyeyle gezilir", () => {
  it("görünüm tercihleri Radix menü öğeleri (onay kutusu + radyo grubu), Kaydet/Vazgeç yok", () => {
    const panel = read("src/components/ui/console/user-menu-panel.tsx");
    expect(panel).not.toContain("FontScalePicker");
    expect(panel).toContain("<FontScaleMenuItems initial={fontScale} />");
    const prefs = read("src/components/ui/console/view-prefs.tsx");
    expect(prefs).toContain("<DropdownMenuCheckboxItem");
    expect(prefs).toContain("<DropdownMenuRadioGroup");
    expect(prefs).not.toContain('role="switch"');
    expect(prefs).not.toMatch(/>\s*Kaydet\s*</);
  });
});

describe("B130/B134/B029 — randevular, KPI çipi, tablo satırları", () => {
  it("randevular kart ızgarası mobilde tek sütun, kartlar min-w-0", () => {
    const page = read("src/app/app/randevular/page.tsx");
    expect(page).toContain('className="cv-auto grid grid-cols-1 gap-4 md:grid-cols-2"');
    expect(page).toMatch(/<Suspense fallback=\{[^]*<BookingLinkCard/);
    expect(read("src/app/app/randevular/calendar-subscribe-card.tsx")).toMatch(/<section className="[^"]*\bmin-w-0\b/);
    expect(read("src/app/app/randevular/booking-link-form.tsx")).toMatch(/<section className="[^"]*\bmin-w-0\b/);
    expect(read("src/app/app/randevular/booking-link-form.tsx")).not.toContain("w-[92px] shrink-0");
  });

  it("TD/TR varsayılan sınıfları tablo düzeyinde (satır × hücre sınıf tekrarı yok)", () => {
    const table = read("src/components/ui/table.tsx");
    expect(table).not.toContain('"px-4 py-3",');
    expect(table).not.toContain('"hairline-b transition-colors last:border-0"');
    expect(table).toContain('"tbl w-full text-left text-sm"');
    const css = stripComments(read("src/app/globals.css"));
    expect(css).toContain(".tbl > :is(thead, tbody, tfoot) > tr { border-bottom: 1px solid var(--hairline); }");
    expect(css).toMatch(/@layer components \{[^}]*\}\s*\.tbl > :is\(tbody, tfoot\) > tr > td \{ padding: 0\.75rem 1rem; \}/);
  });
});
