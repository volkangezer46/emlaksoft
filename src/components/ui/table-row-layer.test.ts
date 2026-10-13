import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Etkileşimli satır katman sözleşmesi (RSC sınıf diyeti, `.tbl-row-link`).
 * `.tbl-row-link` `@layer components` içinde; zemin veren çağıranlar (data-table seçili satır
 * `bg-surface-selected`, randevular `target:bg-…`, lig "kendi satırım") yardımcı katmanda. Hover zemini
 * bileşen katmanına taşınırsa bu zeminler hover'ı ezer — o yüzden `hover:bg-surface-hover` TR'de kalır.
 */
const read = (f: string) => readFileSync(path.join(process.cwd(), f), "utf8");

describe("TR interactive hover zemini katmanı", () => {
  it("hover zemini TR'de yardımcı sınıf olarak verilir", () => {
    expect(read("src/components/ui/table.tsx")).toMatch(/interactive && "[^"]*\btbl-row-link\b[^"]*\bhover:bg-surface-hover\b/);
  });

  it(".tbl-row-link hover zemini içermez (yalnız gölge/cursor/relative)", () => {
    const rule = read("src/app/console-kit.css").match(/\.tbl-row-link\s*\{([^}]*)\}/);
    expect(rule, ".tbl-row-link kuralı yok").not.toBeNull();
    expect(rule![1]).not.toMatch(/\bbg-/);
    expect(rule![1]).toMatch(/hover:shadow-\[inset_2px_0_0_0_var\(--brand-500\)\]/);
  });
});
