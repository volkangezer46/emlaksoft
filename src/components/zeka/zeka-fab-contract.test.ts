import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Yüzen "Zeka'ya sor" düğmesi sözleşmesi (paket bütçesi: /app ≤201 KB gz, /admin ≤191, statik ana sayfa HTML ≤80 KB gz):
 *  - Düğme KÜÇÜK ADADIR: sohbet penceresi (zeka-dock) yalnız dinamik `import()` ile iner; statik içe aktarma yalnız tip.
 *  - İkon kütüphanesi ilk yüke girmez (satır içi SVG); arama parametresi okunmaz (usePathname; layout'ta Suspense sınırı
 *    gerektiren useSearchParams YASAK).
 *  - Ctrl+J kısayolu ve erişilebilir ad "Zeka'ya sor".
 *  - /app, /admin ve public yerleşimleri aynı adayı çizer; ikinci bir sohbet uygulaması yoktur: pencere (zeka-dock) ve
 *    komut çubuğu paneli (zeka-panel) mesaj bileşenlerini zeka-message'dan ortak kullanır.
 *  - Başlatıcı sağ altta yuvarlak küre (56-60 px), ipucu etiketi, açıkken kapatma (×) simgesi, azaltılmış harekete saygı.
 */

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const FAB = "src/components/zeka/zeka-fab.tsx";

describe("Zeka yüzen düğme: tembel yükleme sözleşmesi", () => {
  const src = read(FAB);
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  it("pencere yalnız dinamik import ile iner; statik içe aktarma yalnız tip", () => {
    expect(code).toMatch(/import\(\s*["']\.\/zeka-dock["']\s*\)/);
    const staticImports = [...code.matchAll(/^import\s+(type\s+)?[^;]*from\s+["']([^"']+)["']/gm)];
    for (const m of staticImports) {
      if (/zeka-panel|zeka-dock|zeka-message|zeka\.css|lucide-react|@\/lib\/ai\/zeka\/(client|starters|context|tools|conversation|markdown|stream-protocol)/.test(m[2]!)) {
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

  it("başlatıcı: yuvarlak küre, ipucu (Ctrl+J), açıkken × simgesi, yeni noktası, azaltılmış hareket", () => {
    const css = read("src/components/zeka/zeka-fab.css");
    expect(css).toMatch(/\.zk-fab \{[^}]*width: 58px; height: 58px;[^}]*border-radius: 50%/);
    expect(css).toMatch(/content: attr\(data-tip\)/);
    expect(code).toMatch(/data-tip="Zeka'ya sor · Ctrl\+J"/);
    expect(css).toMatch(/\.zk-fab\[data-open\] \.zk-fab-x \{ opacity: 1/);
    expect(code).toMatch(/className="zk-fab-x"/);
    expect(code).toMatch(/className="zk-fab-dot"/);
    // Animasyonlar yalnız hareket tercihi izin verirse.
    const motion = css.slice(css.indexOf("@media (prefers-reduced-motion: no-preference)"));
    expect(motion).toMatch(/zk-spin/);
    expect(css.slice(0, css.indexOf("@media (prefers-reduced-motion: no-preference)"))).not.toMatch(/animation:/);
    // Pencere düğmenin üstüne oturur (aynı alt pay değişkeni).
    expect(css).toMatch(/--zk-fab-b:/);
    expect(read("src/components/zeka/zeka-dock.css")).toMatch(/bottom: calc\(var\(--zk-fab-b, 20px\) \+ 72px\)/);
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

  it("public düğme JS'siz çalışan bağlantıdır (/sor?from=); /app, /admin ve vitrin gerçek <button>", () => {
    // Statik ana sayfa Next betiği taşımaz: düğme hidrate olmadan da /sor tam sayfa sohbetine götürmeli.
    expect(code).toMatch(/surface === "public" \? \(\s*<a\b/);
    expect(code).toMatch(/href=\{`\/sor\?from=\$\{encodeURIComponent\(pathname\)\}`\}/);
    expect(code).toMatch(/e\.preventDefault\(\);\s*toggle\(\);/);
    // Hidrasyondan önce düz bağlantı: aria-haspopup/aria-expanded/rol yalnız hidrasyonla gelir.
    expect(code).toMatch(/aria-haspopup=\{hydrated \? "dialog" : undefined\}/);
    expect(code).toMatch(/aria-expanded=\{hydrated \? open : undefined\}/);
    expect(code).toMatch(/role=\{hydrated \? "button" : undefined\}/);
    expect(code).toMatch(/useSyncExternalStore\(noopSub, \(\) => true, \(\) => false\)/);
    expect((code.match(/aria-label="Zeka'ya sor"/g) ?? []).length).toBe(2);
    expect(code).toMatch(/<button\s+ref=\{btn\}\s+type="button"/);
    expect(read("src/components/zeka/zeka-fab.css")).toMatch(/text-decoration: none/);
  });

  it("kahraman soru kutusu JS'siz GET formudur (/sor?q=); hidrate olunca yerinde yanıtlar", () => {
    const ask = read("src/components/zeka/public-ask.tsx");
    expect(ask).toMatch(/action=\{action\}/);
    expect(ask).toMatch(/method=\{action \? "get" : undefined\}/);
    expect(ask).toMatch(/name=\{action \? "q" : undefined\}/);
    expect(ask).toMatch(/<AskForm surface="public" action="\/sor"/);
    expect(ask).toMatch(/e\.preventDefault\(\);\s*submit\(q\);/);
  });

  it("/sor tam sayfa sohbeti aynı pencereyi kullanır; yüzen düğme orada basılmaz", () => {
    const page = read("src/app/sor/page.tsx");
    expect(page).toMatch(/<ZekaDock\b[^>]*layout="page"/);
    expect(page).toMatch(/initialQuestion=\{params\.q\}/);
    expect(page).toMatch(/page=\{params\.from\}/);
    expect(page).toMatch(/<SiteFooter zeka=\{false\} \/>/);
    expect(page).toMatch(/zekaSurfaceEnabled\("public"\)/);
    expect(page).toMatch(/buildMetadata\("\/sor"/);
    const pageCode = page.replace(/\/\*[\s\S]*?\*\//g, "");
    expect(pageCode).not.toMatch(/useSearchParams|"use client"/);
    expect(read("src/components/site-footer.tsx")).toMatch(/\{zeka \? <ZekaPublicLauncher \/> : null\}/);
  });

  it("tek sohbet uygulaması: pencere ve komut çubuğu paneli ortak mesaj bileşenleri ve akışlı istemciyle", () => {
    const panel = read("src/components/zeka/zeka-panel.tsx");
    const dockSrc = read("src/components/zeka/zeka-dock.tsx");
    const msg = read("src/components/zeka/zeka-message.tsx");
    expect(dockSrc).toMatch(/export function ZekaDock/);
    expect(panel).not.toMatch(/export function ZekaDock/);
    expect(msg).toMatch(/export function AnswerBody/);
    for (const src of [panel, dockSrc]) {
      expect(src).toMatch(/from "\.\/zeka-message"/);
      expect(src).toMatch(/<AnswerBody\b/);
      expect(src).toMatch(/<MessageTools\b/);
      expect(src).toMatch(/streamZeka\(/);
      expect(src).not.toMatch(/function (CardView|ActionView|AnswerBody)\b/);
    }
    // Öneri kipi akışsız (yalnız yerel, hızlı) kalır.
    expect(panel.match(/fetchZeka\(/g)?.length).toBe(1);
    // Markdown HTML üretmez.
    expect(msg + dockSrc + panel).not.toMatch(/dangerouslySetInnerHTML/);
  });

  it("sohbet penceresi: diyalog, odak tuzağı, Esc, aria-live, durdur, genişlet, dipnot, oturum deposu", () => {
    const dockSrc = read("src/components/zeka/zeka-dock.tsx");
    expect(dockSrc).toMatch(/role=\{inPage \? "region" : "dialog"\}/);
    expect(dockSrc).toMatch(/onKeyDown=\{trap\}/);
    expect(dockSrc).toMatch(/e\.key !== "Escape"/);
    expect(dockSrc).toMatch(/role="log" aria-live="polite"/);
    expect(dockSrc).toMatch(/aria-label="Yanıtı durdur"/);
    expect(dockSrc).toMatch(/ctlRef\.current\?\.abort\(\)/);
    expect(dockSrc).toMatch(/"Pencereyi genişlet"/);
    expect(dockSrc).toMatch(/Zeka hata yapabilir; önemli bilgileri kontrol edin\./);
    expect(dockSrc).toMatch(/saveConversation\(sessionStore\(\)/);
    expect(dockSrc).toMatch(/data-zeka-dock=""/);
    expect(dockSrc).toMatch(/e\.key === "Enter" && !e\.shiftKey/);
    expect(dockSrc).not.toMatch(/useSearchParams/);
  });
});
