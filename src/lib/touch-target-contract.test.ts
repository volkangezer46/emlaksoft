import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Dokunma hedefi sözleşmesi (WCAG 2.5.5 / 2.5.8): kanonik etkileşim bileşenleri dokunmatikte
 * (`touch:` varyantı, `src/app/a11y.css`: kaba imleç VEYA <768px) en az 44px basma alanı verir.
 * Bileşenin kendisinde olduğu için onu kullanan tüm ekranlar otomatik kazanır; ekranlar ayrıca
 * `touch:` yazmak zorunda kalmaz. Masaüstü yoğunluğu değişmez.
 */

const REQUIRED: [file: string, needles: string[]][] = [
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
  ["src/components/ui/list-kit/row-actions.tsx", ["touch:h-11 touch:w-11"]],
  ["src/components/ui/list-kit/list-pager.tsx", ["touch:min-h-11"]],
  ["src/components/ui/list-kit/view-switcher.tsx", ["touch:h-11"]],
  ["src/components/ui/route-error.tsx", ["touch:min-h-11"]],
  ["src/components/app/app-sidebar.tsx", ["lg:min-h-9 touch:min-h-11", "h-7 w-7 touch:h-11 touch:w-11", "min-h-8 touch:min-h-11"]],
];

describe("dokunma hedefi sözleşmesi", () => {
  for (const [file, needles] of REQUIRED) {
    it(file, () => {
      const src = readFileSync(path.join(process.cwd(), file), "utf8");
      for (const n of needles) expect(src, `${file} → ${n}`).toContain(n);
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
});
