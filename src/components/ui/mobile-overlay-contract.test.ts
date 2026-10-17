import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { readCached, walkAll } from "@/lib/test-support/src-tree";

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
    expect(css).toMatch(/html:has\(nav\[aria-label="Mobil hızlı gezinme"\]\) \{ --mobile-nav-offset: calc\(var\(--mbar-h\) \+ env\(safe-area-inset-bottom, 0px\)\); \}/);
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

/**
 * WP1: alt gezinme çubuğunun yüksekliği TEK belirteçtir (`--mbar-h`, piksel). Eski `3.5rem + 1px` 15 px kökte 53.5 px
 * çıkıyor, gerçek çubuk 61 px ölçülüyordu: kayıt eylem çubuğu ve görüşme şeridi alt gezinmeye 7 px biniyordu.
 */
describe("--mbar-h is the only source of the bottom-bar offset", () => {
  const files = walkAll(path.join(process.cwd(), "src")).filter((f) => /\.(tsx?|css)$/.test(f) && !/\.test\.tsx?$/.test(f));

  it("defined exactly once, in pixels, in globals.css", () => {
    const defs = files.flatMap((f) => [...readCached(f).matchAll(/--mbar-h:\s*([^;]+);/g)].map((m) => `${path.relative(process.cwd(), f)}=${m[1]}`));
    expect(defs).toEqual(["src/app/globals.css=61px"]);
  });

  it("no hard-coded rem bar height (3.5rem + 1px) anywhere in src", () => {
    // Yorumlar hariç (belgeleme eski değeri anabilir).
    const code = (f: string) => readCached(f).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
    const hits = files.filter((f) => /3\.5rem\s*\+\s*1px/.test(code(f))).map((f) => path.relative(process.cwd(), f));
    expect(hits).toEqual([]);
  });

  it("record action bar replaces the bottom nav at the same height", () => {
    const bar = read("src/components/app/mobile-record-actionbar.tsx");
    expect(bar).toContain("min-h-[var(--mbar-h)]");
    expect(bar).toContain("bottom-0");
    expect(bar).toContain('data-record-actionbar=""');
    expect(bar).toContain('data-visible={visible ? "1" : undefined}');
    // "Menü" hücresi çekmeceyi ortak bağlamla açar (app-sidebar'a dokunmadan).
    expect(bar).toContain("useMobileMenu()");
    expect(bar).toContain('aria-controls="app-mobile-navigation"');
    const premium = read("src/app/premium.css");
    expect(premium).toContain('html:has([data-record-actionbar][data-visible="1"]) .mbar { display: none; }');
    expect(premium).toContain(".mbar > div { min-height: calc(var(--mbar-h) - 1px); }");
  });

  it("call-outcome strip sits on the token too", () => {
    expect(read("src/components/app/call-outcome.tsx")).toContain("bottom-[calc(var(--mbar-h)+env(safe-area-inset-bottom,0px))]");
  });

  it("form save bar sits at the very bottom (no 0.5rem gap) with safe-area inside", () => {
    const premium = read("src/app/premium.css");
    expect(premium).toMatch(/\.fab-bar\[data-sticky="1"\] \{\s*bottom: 0;\s*padding-bottom: env\(safe-area-inset-bottom, 0px\);/);
    expect(premium).not.toContain('.fab-bar[data-sticky="1"] { bottom: calc(0.5rem');
  });
});

describe("WP1 touch helpers", () => {
  it('"Yeni" sheet: grab handle and swipe-down threshold', async () => {
    const { shouldCloseSheet, SHEET_CLOSE_DISTANCE } = await import("@/components/app/mobile-new-sheet-dialog");
    expect(shouldCloseSheet(SHEET_CLOSE_DISTANCE, 1000)).toBe(true);
    expect(shouldCloseSheet(SHEET_CLOSE_DISTANCE - 1, 1000)).toBe(false);
    expect(shouldCloseSheet(40, 50)).toBe(true); // hızlı fiske
    expect(shouldCloseSheet(10, 5)).toBe(false); // titreme
    expect(shouldCloseSheet(-200, 100)).toBe(false); // yukarı
    const src = read("src/components/app/mobile-new-sheet-dialog.tsx");
    expect(src).toContain('h-1.5 w-10 rounded-full bg-line-strong');
    expect(src).toContain('className="touch-none"');
  });

  it("focused field is centred only when covered by the header or the save bar/keyboard", async () => {
    const { fieldNeedsCentering } = await import("@/components/app/use-create-form");
    const view = { top: 0, bottom: 450 };
    expect(fieldNeedsCentering({ top: 525, bottom: 570 }, view, 64, 60)).toBe(true); // klavyenin altında
    expect(fieldNeedsCentering({ top: 360, bottom: 400 }, view, 64, 60)).toBe(true); // çubuğun altında
    expect(fieldNeedsCentering({ top: 30, bottom: 70 }, view, 64, 60)).toBe(true); // başlığın altında
    expect(fieldNeedsCentering({ top: 200, bottom: 245 }, view, 64, 60)).toBe(false);
  });

  it("week view prev/next and Bugün are 44px on touch", () => {
    const src = read("src/app/app/randevular/appointment-week-view.tsx");
    expect(src).toContain("touch:size-11");
    expect(src).toContain("touch:h-11 touch:min-w-11");
  });

  it("tab rows show they scroll: PageTabs fades and centres the active tab; fade is wide enough", () => {
    const tabs = read("src/components/app/page-tabs.tsx");
    expect(tabs).toContain("strip-fade");
    expect(tabs).toContain("<MorphNavScrollActive activeId={active} levels={2} />");
    expect(read("src/components/ui/morph-tab-parts.tsx")).toContain("strip-fade");
    expect(read("src/app/shared-ui.css")).toContain("--strip-fade: 48px");
  });

  it("form stepper uses compact numbered steps below 400px", () => {
    const css = read("src/app/shared-ui.css");
    expect(css).toMatch(/@media \(max-width: 399\.98px\) \{\s*\.tfs-layout \[role="tablist"\]\[aria-orientation="horizontal"\] \{ counter-reset: mt-step; \}/);
    expect(css).toContain("content: counter(mt-step);");
  });

  it("form save bar is one row on phone: no stacked status row, progress line hidden", () => {
    const src = read("src/components/ui/form-action-bar.tsx");
    expect(src).not.toContain('"flex flex-col gap-1 px-2 py-1.5 sm:flex-row');
    expect(src).toContain("flex flex-wrap items-center gap-x-1.5 gap-y-1 px-2 py-1.5 sm:flex-nowrap");
    expect(src).toContain("rounded-t-[var(--radius-card)] max-sm:hidden");
  });
});
