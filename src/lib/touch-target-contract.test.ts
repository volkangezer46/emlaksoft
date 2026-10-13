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
  ["src/components/app/app-sidebar.tsx", ["lg:min-h-9 touch:min-h-11", "touch:h-11 touch:w-11", "min-h-14", "h-11 w-11"]],
];

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
