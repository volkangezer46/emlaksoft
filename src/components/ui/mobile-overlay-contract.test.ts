import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * MP4 sözleşmesi: panelde alttan sabit katmanlar (toast, "Yeni sürüm hazır", tablo toplu işlem çubuğu, PWA kartı) mobil
 * alt gezinmenin (app-sidebar `fixed bottom-0 z-40`, ~56 px + güvenli alan) ALTINDA kalmaz: konumlarını
 * `--mobile-nav-offset` belirteci verir (globals.css), masaüstünde (lg) eski köşe konumu.
 */
const read = (p: string) => readFileSync(p, "utf8");
const OVERLAYS = [
  "src/components/app/toast-provider.tsx",
  "src/components/app/sw-register.tsx",
  "src/components/ui/data-table.tsx",
  "src/components/app/pwa-prompt-card.tsx",
];

describe("bottom overlays clear the mobile bottom nav", () => {
  it("globals.css defines the offset token only where the mobile nav exists", () => {
    const css = read("src/app/globals.css");
    expect(css).toContain("--mobile-nav-offset: env(safe-area-inset-bottom, 0px)");
    expect(css).toMatch(/html:has\(nav\[aria-label="Mobil hızlı gezinme"\]\) \{ --mobile-nav-offset: calc\(3\.5rem/);
    // Mobil gezinme etiketi değişirse belirteç sessizce 0'a düşmesin.
    expect(read("src/components/app/app-sidebar.tsx")).toContain('aria-label="Mobil hızlı gezinme"');
  });

  it.each(OVERLAYS)("%s uses the offset token and no bare bottom-4 on mobile", (file) => {
    const src = read(file);
    expect(src).toContain("bottom-[calc(var(--mobile-nav-offset,0px)+0.75rem)]");
    for (const m of src.matchAll(/className="([^"]*\b(?:fixed|sticky)\b[^"]*)"/g)) {
      const cls = m[1];
      if (!/(?:^|\s)bottom-4(?:\s|$)/.test(cls)) continue;
      expect(cls, `${file}: çıplak bottom-4 (mobil alt gezinmenin altında kalır)`).toContain("--mobile-nav-offset");
    }
  });

  it("the SW update button is a ≥44px touch target", () => {
    expect(read("src/components/app/sw-register.tsx")).toContain("touch:min-h-11");
  });
});
