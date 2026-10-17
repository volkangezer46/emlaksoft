import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Yüzen "Zeka'ya sor" düğmesi sözleşmesi (paket bütçesi: /app ≤201 KB gz, /admin ≤191, statik ana sayfa HTML ≤80 KB gz):
 *  - Düğme KÜÇÜK ADADIR: sohbet penceresi (zeka-panel) yalnız dinamik `import()` ile iner; statik içe aktarma yalnız tip.
 *  - İkon kütüphanesi ilk yüke girmez (satır içi SVG); arama parametresi okunmaz (usePathname; layout'ta Suspense sınırı
 *    gerektiren useSearchParams YASAK).
 *  - Ctrl+J kısayolu ve erişilebilir ad "Zeka'ya sor".
 *  - /app, /admin ve public yerleşimleri aynı adayı çizer; ikinci bir sohbet uygulaması yoktur (pencere zeka-panel'dedir).
 */

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const FAB = "src/components/zeka/zeka-fab.tsx";

describe("Zeka yüzen düğme: tembel yükleme sözleşmesi", () => {
  const src = read(FAB);
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  it("pencere yalnız dinamik import ile iner; statik içe aktarma yalnız tip", () => {
    expect(code).toMatch(/import\(\s*["']\.\/zeka-panel["']\s*\)/);
    const staticImports = [...code.matchAll(/^import\s+(type\s+)?[^;]*from\s+["']([^"']+)["']/gm)];
    for (const m of staticImports) {
      if (/zeka-panel|zeka\.css|lucide-react|@\/lib\/ai\/zeka\/(client|starters|context|tools)/.test(m[2]!)) {
        expect(m[1], `${m[2]} yalnız tip olarak içe aktarılabilir`).toBe("type ");
      }
    }
    expect(code).not.toMatch(/from\s+["']lucide-react["']/);
    expect(code).not.toMatch(/runWhenIdle/);
  });

  it("arama parametresi okunmaz; Ctrl+J ve erişilebilir ad", () => {
    expect(code).not.toMatch(/useSearchParams/);
    expect(code).toMatch(/usePathname/);
    expect(code).toMatch(/ctrlKey \|\| e\.metaKey/);
    expect(code).toMatch(/aria-label="Zeka'ya sor"/);
    expect(code).toMatch(/aria-keyshortcuts="Control\+J"/);
  });

  it("ada küçük kalır (kaynak ve CSS)", () => {
    expect(Buffer.byteLength(src)).toBeLessThan(6_000);
    expect(Buffer.byteLength(read("src/components/zeka/zeka-fab.css"))).toBeLessThan(5_000);
  });

  it("çakışma kuralları alt gezinme belirteçlerini kullanır", () => {
    const css = read("src/components/zeka/zeka-fab.css");
    expect(css).toMatch(/--mobile-nav-offset/);
    expect(css).toMatch(/\.fab-bar/);
    expect(css).toMatch(/role="status"/);
  });

  it("/app, /admin ve public yerleşimleri aynı adayı çizer", () => {
    expect(read("src/app/app/layout.tsx")).toMatch(/<ZekaFabSlot surface="app"/);
    expect(read("src/app/admin/layout.tsx")).toMatch(/<ZekaFabSlot surface="admin"/);
    const launcher = read("src/components/zeka/public-launcher.tsx");
    expect(launcher).toMatch(/<ZekaFab surface="public"/);
    expect(launcher).toMatch(/<ZekaFab surface="vitrin"/);
    expect(read("src/components/site-footer.tsx")).toMatch(/<ZekaPublicLauncher \/>/);
    expect(read("src/components/pricing-page/page-shell.tsx")).toMatch(/<ZekaPublicLauncher \/>/);
    expect(read("src/components/zeka/zeka-fab-slot.tsx")).toMatch(/from "\.\/zeka-fab"/);
  });

  it("tek sohbet uygulaması: pencere zeka-panel içinde, ortak yanıt gövdesiyle", () => {
    const panel = read("src/components/zeka/zeka-panel.tsx");
    expect(panel).toMatch(/export function ZekaDock/);
    expect((panel.match(/<AnswerBody/g) ?? []).length).toBe(2);
    expect(panel.match(/fetchZeka\(/g)?.length).toBe(3);
  });
});
