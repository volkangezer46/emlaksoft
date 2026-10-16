import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { readCached, walkSource } from "./test-support/src-tree";

/**
 * Dokunma hedefi sözleşmesi (WCAG 2.5.5 / 2.5.8): kanonik etkileşim bileşenleri dokunmatikte
 * (`touch:` varyantı, `src/app/a11y.css`: kaba imleç VEYA <768px) en az 44px basma alanı verir.
 * Bileşenin kendisinde olduğu için onu kullanan tüm ekranlar otomatik kazanır; ekranlar ayrıca
 * `touch:` yazmak zorunda kalmaz. Masaüstü yoğunluğu değişmez.
 */

// Dizgi: birebir alt dizgi. RegExp: biçimden (satır sonu/boşluk) bağımsız denetim — CSS @apply kuralları için.
const REQUIRED: [file: string, needles: (string | RegExp)[]][] = [
  // button.tsx A ajanınca genişletiliyor: yalnız varyantın varlığı denetlenir.
  ["src/components/ui/button.tsx", ["touch:h-11"]],
  ["src/components/ui/input.tsx", ["touch:min-h-11"]],
  ["src/components/ui/form-controls.tsx", ["touch:min-h-11"]],
  ["src/components/ui/select.tsx", ["text-left text-sm text-ink-950 outline-none transition touch:min-h-11", "pr-8 text-sm text-ink-950 outline-none transition touch:min-h-11"]],
  ["src/components/ui/dropdown-menu.tsx", ["px-3 py-2 text-sm outline-none transition touch:min-h-11", "pl-8 pr-3 text-sm text-ink-950 outline-none transition touch:min-h-11"]],
  ["src/components/ui/tabs.tsx", ["touch:min-h-11"]],
  ["src/components/ui/inline-dialog.tsx", ["touch:h-11 touch:w-11"]],
  ["src/components/ui/dialog.tsx", ["touch:h-11 touch:w-11"]],
  ["src/components/ui/switch.tsx", ["touch:before:absolute touch:before:-inset-y-2.5"]],
  ["src/components/ui/checkbox.tsx", ["touch:h-6 touch:w-6"]],
  ["src/components/ui/filter-bar.tsx", ["touch:min-h-11"]],
  ["src/components/ui/data-table.tsx", ["touch:min-h-11", "touch:h-11"]],
  // Satır eylemi RSC sınıf diyeti: kurallar `.lk-row-act` (console-kit.css, @apply) içinde.
  ["src/components/ui/list-kit/row-actions.tsx", ["lk-row-act"]],
  ["src/app/console-kit.css", [/\.lk-row-act\s*\{[^}]*\btouch:h-11\s+touch:w-11\b/]],
  ["src/components/ui/list-kit/list-pager.tsx", ["touch:min-h-11"]],
  ["src/components/ui/list-kit/view-switcher.tsx", ["touch:h-11"]],
  ["src/components/ui/route-error.tsx", ["touch:min-h-11"]],
  // Yan menü (2026-10 merkez yapısı): sabitleme düğmesi ve daraltılabilir başlık kalktı; kalan denetimler: satır, vitrin düğmesi, 56 px mobil alt çubuk.
  // Masaüstü satırı 32 px (1366×768 sığma hesabı); dokunmatikte 44 px.
  ["src/components/app/app-sidebar.tsx", ["lg:min-h-8 touch:min-h-11", "touch:h-11 touch:w-11", "min-h-14"]],
  // Mobil hamburger üst çubuğun içinde (app + admin ortak düğme).
  ["src/components/app/mobile-menu-trigger.tsx", ["h-11 w-11"]],
  // SK11 / B131-B133: anlaşma hunisi lejantı (tam satır bağlantı), görev kartı eylemleri ve seçim kutusu, kayıtlı görünüm silme.
  ["src/app/app/anlasmalar/page.tsx", ["focus-ring flex min-h-8 items-center gap-2 rounded-[var(--radius-control)] px-1.5 text-xs transition hover:bg-surface-hover touch:min-h-11"]],
  // Görev kartı: Tamamla geniş + 44 px; Düzenle/Sil/… kanonik `Button size="icon"` (touch:h-11 touch:w-11).
  ["src/app/app/gorevler/task-card.tsx", ["max-sm:flex-1 touch:min-h-11", "<Button size=\"icon\" variant=\"secondary\" icon={MoreHorizontal}"]],
  ["src/app/app/gorevler/task-bulk-list.tsx", ["justify-center px-1 touch:min-w-11", "hover:border-brand-300 touch:min-h-11"]],
  ["src/components/app/saved-views.tsx", ["touch:min-h-11 touch:min-w-11"]],
  ["src/components/ui/chart-range.tsx", ["touch:w-[24px]"]],
  // SP10: mobil "sonraki eylem" çubuğu (birincil eylem + Ara/WhatsApp ikonları 44 px) ve kanban sütun çipleri.
  ["src/components/ui/mobile-action-bar.tsx", ["grid h-11 w-11 shrink-0", "flex min-h-11 min-w-0 flex-1"]],
  ["src/app/app/anlasmalar/deal-board.tsx", ["inline-flex min-h-11 shrink-0 snap-start"]],
];

/**
 * Dokunmatik 24 px TABANI (WCAG 2.5.8, B131): a11y.css panel içeriğindeki blok/flex bağlantı ve düğmeleri 24 px'in altına
 * indirmez; dokunmatik tablette `h-11 sm:h-10` kalıbı 44 px'te kalır. Gerçek piksel ölçümü: e2e/layout-overflow.spec.ts.
 */
describe("dokunma hedefi sözleşmesi — 24 px tabanı ve dokunmatik tablet", () => {
  const css = readFileSync(path.join(process.cwd(), "src/app/a11y.css"), "utf8");
  it("panel içeriğinde 24 px tabanı (sr-only / süs / odak dışı hariç)", () => {
    expect(css).toMatch(
      /main :is\(a\[href\], button, summary, \[role="button"\], \[role="slider"\]\):not\(\.sr-only, \[aria-hidden="true"\], \[tabindex="-1"\]\) \{\s*min-height: 24px;\s*min-width: 24px;/,
    );
  });
  it("dokunmatik tablette h-11 / w-11 etkileşimli öğeler 44 px (sm:h-10 ezilir)", () => {
    expect(css).toMatch(/@media \(pointer: coarse\) \{\s*:is\(a, button, summary, label, \[role="button"\]\):is\(\.h-11\) \{ height: 44px; \}/);
  });
  it("anlaşma hunisi dilimleri süs: bağlantı değil, aria-hidden kap içinde", () => {
    const src = readFileSync(path.join(process.cwd(), "src/app/app/anlasmalar/page.tsx"), "utf8");
    expect(src).not.toContain("sütununa git");
    expect(src).toMatch(/flex h-4 gap-0\.5 overflow-hidden rounded-\[var\(--radius-control\)\]" aria-hidden="true"/);
  });
});

describe("dokunma hedefi sözleşmesi", () => {
  for (const [file, needles] of REQUIRED) {
    it(file, () => {
      const src = readFileSync(path.join(process.cwd(), file), "utf8");
      for (const n of needles) {
        if (typeof n === "string") expect(src, `${file} → ${n}`).toContain(n);
        else expect(src, `${file} → ${n}`).toMatch(n);
      }
    });
  }

  it("segment denetimleri (SegmentedControl / ScopeSwitch) CSS ile 44px", () => {
    const css = readFileSync(path.join(process.cwd(), "src/app/premium.css"), "utf8");
    expect(css).toMatch(/@media \(pointer: coarse\) \{ \.ds-seg-opt \{ min-height: 44px; \} \}/);
    expect(css).toMatch(/@media \(max-width: 767\.98px\) \{ \.ds-seg-opt \{ min-height: 44px; \} \}/);
  });

  it("touch varyantı tanımlı", () => {
    const css = readFileSync(path.join(process.cwd(), "src/app/a11y.css"), "utf8");
    expect(css).toContain("@custom-variant touch");
  });

  it("ratchet: touch: sınıfı olmayan ham <select>/<input> satırları artmaz (src/app/app)", () => {
    // Sayı yalnız AZALABİLİR: yeni ham kontrol yazarken className'e touch:h-11 / touch:min-h-11 ekle (ya da kanonik Input/Select kullan).
    // Azaltınca sabiti de düşür.
    const RAW_CONTROL_BUDGET = 619;
    const re = /<(select|input)\b/;
    let count = 0;
    for (const file of walkSource(path.join(process.cwd(), "src/app/app")).filter((f) => f.endsWith(".tsx"))) {
      for (const line of readCached(file).split("\n")) if (re.test(line) && !line.includes("touch:")) count += 1;
    }
    expect(count, "touch: olmayan ham kontrol satırı bütçeyi aştı").toBeLessThanOrEqual(RAW_CONTROL_BUDGET);
  });
});
