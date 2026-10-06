import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Cam yüzey bütçesi (docs/DESIGN_SYSTEM.md "Cam yüzey bütçesi").
 *
 * backdrop-filter, altındaki her piksel değişiminde yeniden hesaplanır; kaydırılan
 * listede tekrar eden öğede ya da hareketli içeriğin üstünde kullanıldığında kaydırma
 * takılır. Bu test camın yalnız izinli yüzeylerde kaldığını ve her birinin opak
 * yedeği olduğunu sabitler. Yeni cam yüzeyi eklemek = bu envanteri bilinçli güncellemek.
 */

function files(dir: string, ext: RegExp, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) files(full, ext, out);
    else if (ext.test(name) && !/\.test\.tsx?$/.test(name)) out.push(full.split("\\").join("/"));
  }
  return out;
}

const read = (p: string) => readFileSync(p, "utf8");

/** Yorumları atar: envanter yalnız gerçek bildirimleri sayar. */
const stripCssComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "");

/** `backdrop-filter: <değer>` bildirimi taşıyan (değer `none` değil) kuralların seçicileri. */
function glassSelectors(css: string): string[] {
  const out: string[] = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  for (const m of stripCssComments(css).matchAll(re)) {
    const values = [...m[2]!.matchAll(/(?<!-webkit-)backdrop-filter:\s*([^;}]+)/g)].map((v) => v[1]!.trim());
    if (values.some((v) => v !== "none")) out.push(m[1]!.trim().replace(/\s+/g, " "));
  }
  return out;
}

/** İzinli cam yüzeyleri: dosya → seçiciler (sıra dosyadaki sırayla). */
const CSS_ENVANTERI: Record<string, string[]> = {
  // .glass / .glass-dark / .glass-card / .mega-backdrop: eski yardımcılar; hiçbir bileşen kullanmıyor (aşağıda sabit).
  "src/app/globals.css": [".glass", ".glass-dark", ".mega-backdrop", ".glass-card", ".glass-bar"],
  "src/app/marketing.css": [".mk-nav::before", ".mk-portals"],
  // Mega menü paneli: yalnız panel yüzeyinin arkası hafif bulanık (2026-10-06); açıkken arkadaki demo döngüsü durur.
  "src/app/marketing-sections.css": [".mk-mega-in"],
};

/** Tailwind `backdrop-blur-*` sınıfı taşıyabilen ortak bileşenler: yalnız geçici modal örtüleri. */
const BILESEN_IZINLI = [
  "src/components/public/compare-table.tsx", // tam ekran karşılaştırma örtüsü
  "src/components/public/gallery-lightbox.tsx", // tam ekran galeri örtüsü
  "src/components/ui/dialog.tsx", // Radix diyalog örtüleri (.dialog-overlay)
];

/**
 * Sayfa/görünüm dosyalarındaki (src/app) `backdrop-blur` kullanım sayısı. Bu kullanımlar
 * içerik alanında (<main>) globals.css'teki bütçe kilidiyle etkisizdir; sayı yine de
 * ARTAMAZ. Bir dosya temizlenince bu sayı düşürülür.
 */
const SAYFA_KULLANIM_TAVANI = 48;

describe("cam yüzey bütçesi", () => {
  const cssFiles = files("src/app", /\.css$/);
  const componentFiles = files("src/components", /\.tsx$/);
  const appFiles = files("src/app", /\.tsx$/);

  it("CSS: backdrop-filter yalnız envanterdeki seçicilerde", () => {
    const found: Record<string, string[]> = {};
    for (const f of cssFiles) {
      const sel = glassSelectors(read(f));
      if (sel.length > 0) found[f] = sel;
    }
    expect(found).toEqual(CSS_ENVANTERI);
  });

  it("tekrar eden / hareketli öğelerde cam yok (ana sayfa rozetleri, vitrin kartı, liste öğesi, alt çubuk)", () => {
    const marketing = stripCssComments(read("src/app/marketing.css") + read("src/app/marketing-sections.css"));
    for (const sel of [".mk-float", ".mk-showcase-card", ".mk-sec-items li", ".mk-sticky-cta"]) {
      const start = marketing.indexOf(`${sel} {`);
      expect(start, sel).toBeGreaterThanOrEqual(0);
      expect(marketing.slice(start, marketing.indexOf("}", start)), sel).not.toContain("backdrop-filter");
    }
  });

  it("ortak bileşenler: backdrop-blur sınıfı yalnız geçici modal örtülerinde", () => {
    const using = componentFiles.filter((f) => /backdrop-blur/.test(read(f)));
    expect(using.sort()).toEqual([...BILESEN_IZINLI].sort());
  });

  it("eski cam yardımcıları (.glass, .glass-dark, .glass-card) hiçbir bileşen/sayfada kullanılmaz", () => {
    const re = /(?:className|class)=[^>]*?(?<![\w-])glass(?:-dark|-card)?(?![\w-])/;
    expect([...componentFiles, ...appFiles].filter((f) => re.test(read(f)))).toEqual([]);
  });

  it("sayfa dosyalarında backdrop-blur kullanımı artmaz ve <main> içinde bütçe kilidiyle etkisizdir", () => {
    const count = appFiles.reduce((n, f) => n + (read(f).match(/backdrop-blur/g)?.length ?? 0), 0);
    expect(count).toBeLessThanOrEqual(SAYFA_KULLANIM_TAVANI);
    const globals = stripCssComments(read("src/app/globals.css"));
    const lock = globals.slice(globals.indexOf('main [class*="backdrop-blur"] {'));
    expect(lock.slice(0, lock.indexOf("}"))).toContain("backdrop-filter: none");
  });

  it("her izinli cam yüzeyinin opak yedeği var (@supports not + saydamlığı azalt + yüksek kontrast)", () => {
    const a11y = stripCssComments(read("src/app/a11y.css"));
    const supports = "@supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px)))";
    const media = "@media (prefers-reduced-transparency: reduce), (prefers-contrast: more)";
    const body = (css: string, head: string) => {
      const start = css.indexOf(head);
      if (start < 0) throw new Error(`blok yok: ${head}`);
      let depth = 0;
      for (let i = css.indexOf("{", start); i < css.length; i++) {
        if (css[i] === "{") depth++;
        else if (css[i] === "}" && --depth === 0) return css.slice(start, i);
      }
      throw new Error(`blok kapanmıyor: ${head}`);
    };
    const supportsBody = body(a11y, supports);
    const mediaBody = body(a11y, media);
    for (const sel of [...CSS_ENVANTERI["src/app/globals.css"]!, ...(CSS_ENVANTERI["src/app/premium.css"] ?? [])] /* .pm-glass GlassKpi ile silindi (2026-10-06) */) {
      expect(supportsBody, `@supports not: ${sel}`).toMatch(new RegExp(`:root \\${sel}[,\\s{]`));
      expect(mediaBody, `media: ${sel}`).toMatch(new RegExp(`:root \\${sel}[,\\s{]`));
    }
    // Saydamlığı azalt / yüksek kontrast: bulanıklık kapanır (Tailwind sınıflı modal örtüleri dahil).
    expect(mediaBody).toContain("backdrop-filter: none");
    expect(mediaBody).toContain(':root [class*="backdrop-blur"]');
    expect(mediaBody).toContain(":root .dialog-overlay");

    // Ana sayfa yüzeyleri kendi dosyasında (marketing.css, a11y.css'ten sonra yüklenir).
    const marketing = stripCssComments(read("src/app/marketing.css"));
    for (const head of [supports, media]) {
      const b = body(marketing, head);
      for (const sel of CSS_ENVANTERI["src/app/marketing.css"]!) expect(b, `${head}: ${sel}`).toContain(sel);
    }
    const sections = stripCssComments(read("src/app/marketing-sections.css"));
    for (const head of [supports, media]) {
      const b = body(sections, head);
      for (const sel of CSS_ENVANTERI["src/app/marketing-sections.css"]!) expect(b, `${head}: ${sel}`).toContain(`${sel} { background: #ffffff`);
    }
    // Panel açıkken arkadaki sonsuz demo döngüsü durur (bulanıklık her karede yeniden hesaplanmaz).
    expect(sections).toMatch(/html:has\(\.mk-nav\[data-menu\]\) \.mk-demo[^{]*\{[^}]*animation-play-state:\s*paused/);
  });
});
