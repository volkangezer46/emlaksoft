import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ACCENTS, THEME_BOOT_SCRIPT } from "./theme";

// Tasarım sistemi v3 kuralları. Bu test, codemod ile temizlenen sapmaların
// geri gelmesini engeller. Kural değişecekse önce docs/ROADMAP.md'de karar verilir.

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) sourceFiles(full, out);
    else if (/\.(tsx|ts|css)$/.test(name) && !/\.test\.ts$/.test(name)) out.push(full);
  }
  return out;
}

const FILES = sourceFiles("src");

function offenders(pattern: RegExp): string[] {
  return FILES.filter((f) => pattern.test(readFileSync(f, "utf8")));
}

describe("tasarım token sözleşmesi", () => {
  it("12 px altı metin yok (okunabilirlik tabanı: text-xs)", () => {
    expect(offenders(/text-\[(?:[0-9]|1[01])px\]/)).toEqual([]);
  });

  it("dağınık köşe yarıçapı yok: 8–28 px arası arbitrary radius token'dan gelir", () => {
    expect(offenders(/rounded(?:-[a-z]{1,2})?-\[(?:[89]|1\d|2[0-8])px\]/)).toEqual([]);
  });

  it("src/components: rounded-[Npx], text-[Npx] ve text-zinc-* yok (token/semantik sınıf kullan)", () => {
    const comps = FILES.filter((f) => f.split("\\").join("/").startsWith("src/components/"));
    const bad = (re: RegExp) => comps.filter((f) => re.test(readFileSync(f, "utf8")));
    expect(bad(/rounded(?:-[a-z]{1,2})?-\[\d+px\]/)).toEqual([]);
    expect(bad(/text-\[\d+px\]/)).toEqual([]);
    expect(bad(/text-zinc-/)).toEqual([]);
  });

  it("src/components/ui: dağınık hover/seçili zemin sınıfı yok (rol token'ları: surface-hover/pressed/selected)", () => {
    const ui = FILES.filter((f) => f.split("\\").join("/").startsWith("src/components/ui/"));
    const bad = (re: RegExp) => ui.filter((f) => re.test(readFileSync(f, "utf8"))).map((f) => f.split("\\").join("/"));
    // Saydam zeminde hover: bg-surface-hover; opak zeminde: surface-interactive.
    expect(bad(/hover:bg-(?:canvas|surface-2)(?![\w-])/)).toEqual([]);
    // Menü/seçenek vurgusu ve seçili satır: bg-surface-selected.
    expect(bad(/data-\[highlighted\]:bg-brand-/)).toEqual([]);
    // Birincil düğme hover'ı: bg-accent-hover (koyuda --brand-700 açık metin tonudur; beyaz yazı okunmaz).
    expect(bad(/hover:bg-brand-700(?![\w-])/)).toEqual([]);
  });

  it("koyu tema yalnız /app ve /admin için tanımlı ve kök layout'ta açılış script'i var", () => {
    const layout = readFileSync("src/app/layout.tsx", "utf8");
    expect(layout).toContain("THEME_BOOT_SCRIPT");
    expect(layout).toContain("suppressHydrationWarning");
    // Koyu tema yalnız konsol (/app, /admin) CSS paketindedir; public sayfalara yüklenmez (console-base.css).
    const css = readFileSync("src/app/console-base.css", "utf8");
    expect(css).toContain('@import "./theme-dark.css"');
    expect(readFileSync("src/app/globals.css", "utf8")).not.toContain("theme-dark.css");
  });

  it("Türkçe karakterler için Inter ve Manrope kendi sunucumuzdan, Ğ ğ İ Ş ş alt kümesiyle yüklenir", () => {
    // Eski yol next/font latin-ext (Inter 84 KB) idi; bütçe için latin + yalnız Türkçe'ye özgü harflerin alt kümesi (src/app/fonts).
    const css = readFileSync("src/app/globals.css", "utf8");
    for (const family of ["Inter", "Manrope"]) {
      const lower = family.toLowerCase();
      const faces = css.match(new RegExp(`@font-face\\s*\\{[^}]*font-family:\\s*"${family}"[^}]*\\}`, "g")) ?? [];
      expect(faces.length, family).toBeGreaterThanOrEqual(2);
      const latin = faces.find((f) => f.includes(`${lower}-latin.woff2`));
      const tr = faces.find((f) => f.includes(`${lower}-tr.woff2`));
      expect(latin, `${family} latin`).toBeTruthy();
      expect(tr, `${family} tr`).toBeTruthy();
      // ç ö ü ı latin aralığında; Ğ ğ İ Ş ş (U+011E-011F, U+0130, U+015E-015F) tr alt kümesinde.
      expect(latin).toContain("U+0000-00FF");
      expect(latin).toContain("U+0131");
      expect(tr).toMatch(/U\+011E-011F,\s*U\+0130,\s*U\+015E-015F,\s*U\+20BA/); // + ₺ (latin-ext aralığındaydı)
      expect(existsSync(`src/app/fonts/${lower}-latin.woff2`)).toBe(true);
      expect(existsSync(`src/app/fonts/${lower}-tr.woff2`)).toBe(true);
    }
  });
});

// ---- Tema paleti: tanım bütünlüğü + WCAG AA kontrast --------------------------

function luminance(hex: string): number {
  const h = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4]
    .map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/** `selector { ... }` bloğunun gövdesi (iç içe süslü parantez yok varsayımıyla). */
function block(css: string, selector: string): string {
  const start = css.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`blok yok: ${selector}`);
  return css.slice(start, css.indexOf("}", start));
}

function hex(body: string, token: string): string {
  const m = body.match(new RegExp(`${token}:\\s*(#[0-9a-fA-F]{6})`));
  if (!m) throw new Error(`hex token yok: ${token}`);
  return m[1];
}

const read = (p: string) => readFileSync(p, "utf8");
const tokensCss = read("src/app/tokens.css");
const darkCss = read("src/app/theme-dark.css");
const themesCss = read("src/app/themes.css");

const LIGHT = block(tokensCss, ":root");
const DARK = block(darkCss, 'html[data-theme="dark"]');
const LIGHT_SURFACES = ["--surface", "--canvas", "--surface-sunken", "--surface-2"].map((t) => hex(LIGHT, t));
const DARK_SURFACES = ["--surface", "--canvas", "--surface-raised", "--surface-2", "--surface-sunken"].map((t) =>
  hex(DARK, t),
);

describe("tema paleti", () => {
  it("semantik token katmanı tokens.css'te tanımlı", () => {
    for (const t of ["--bg", "--border", "--accent-fg", "--accent-text", "--ring", "--heading", "--success", "--warning", "--danger", "--info", "--selection-bg", "--scrollbar-thumb", "--fs-display", "--fs-caption"]) {
      expect(tokensCss, t).toContain(`${t}:`);
    }
  });

  it("koyu tema yüzey, metin, çizgi, odak ve başlık token'larını tanımlar", () => {
    for (const t of ["--canvas", "--surface", "--surface-2", "--surface-raised", "--surface-sunken", "--text", "--text-muted", "--text-faint", "--line", "--accent", "--accent-text", "--ring", "--heading", "--selection-bg", "--scrollbar-thumb", "--elev-1", "--elev-5"]) {
      expect(DARK, t).toContain(`${t}:`);
    }
  });

  it("metin tokenları iki temada tüm yüzeylerde AA (≥4.5:1)", () => {
    for (const t of ["--text", "--text-muted", "--text-faint"]) {
      for (const s of LIGHT_SURFACES) expect(contrast(hex(LIGHT, t), s), `açık ${t} / ${s}`).toBeGreaterThanOrEqual(4.5);
      for (const s of DARK_SURFACES) expect(contrast(hex(DARK, t), s), `koyu ${t} / ${s}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("9 vurgu teması var ve varsayılan dışındakilerin CSS bloğu iki temada tanımlı", () => {
    expect(ACCENTS.map((a) => a.value)).toEqual([
      "ocean",
      "emerald",
      "indigo",
      "amber",
      "graphite",
      "gold",
      "burgundy",
      "petrol",
      "olive",
    ]);
    for (const a of ACCENTS.filter((x) => x.value !== "ocean")) {
      const light = block(themesCss, `html[data-accent="${a.value}"]`);
      const dark = block(themesCss, `html[data-theme="dark"][data-accent="${a.value}"]`);
      expect(hex(light, "--brand-600")).toBe(a.fill);
      expect(hex(light, "--brand-700")).toBe(a.text);
      expect(hex(dark, "--brand-700")).toBe(a.textDark);
      // Koyuda dolgu açıkta ile aynıysa ayrıca yazılmaz; farklıysa yazılmıştır.
      if (a.fillDark !== a.fill) expect(hex(dark, "--brand-600")).toBe(a.fillDark);
      for (const t of ["--brand-500", "--brand-400", "--brand-300", "--brand-50"]) expect(light, t).toContain(`${t}:`);
      expect(dark).toContain("--brand-50:");
    }
  });

  it("varsayılan (Okyanus) değerleri tablo ile aynı", () => {
    const ocean = ACCENTS[0];
    expect(hex(LIGHT, "--brand-600")).toBe(ocean.fill);
    expect(hex(LIGHT, "--brand-700")).toBe(ocean.text);
    expect(hex(DARK, "--brand-700")).toBe(ocean.textDark);
  });

  for (const a of ACCENTS) {
    it(`${a.label}: dolgu üstünde beyaz yazı ve metin tonu AA (açık + koyu)`, () => {
      expect(contrast("#ffffff", a.fill), "açık dolgu/beyaz").toBeGreaterThanOrEqual(4.5);
      expect(contrast("#ffffff", a.fillDark), "koyu dolgu/beyaz").toBeGreaterThanOrEqual(4.5);
      for (const s of LIGHT_SURFACES) expect(contrast(a.text, s), `açık metin/${s}`).toBeGreaterThanOrEqual(4.5);
      for (const s of DARK_SURFACES) expect(contrast(a.textDark, s), `koyu metin/${s}`).toBeGreaterThanOrEqual(4.5);
    });
  }

  it("--accent-fg beyaz (dolgu tonları beyaz yazıya göre seçildi)", () => {
    expect(hex(tokensCss, "--accent-fg").toLowerCase()).toBe("#ffffff");
  });

  it("açılış script'i vurgu anahtarını okur, yalnız bilinen vurguları uygular", () => {
    expect(THEME_BOOT_SCRIPT).toContain("es-accent");
    // Varsayılan (ocean) öznitelik gerektirmez; diğer 8 vurgu ACCENTS'ten üretilir.
    expect(THEME_BOOT_SCRIPT).toContain("/^(emerald|indigo|amber|graphite|gold|burgundy|petrol|olive)$/");
    expect(THEME_BOOT_SCRIPT).not.toContain("ocean");
    expect(() => new Function(THEME_BOOT_SCRIPT)).not.toThrow();
  });

  it("themes.css ve theme-dark.css public sayfaya uygulanmaz: öznitelik yalnız tema script'iyle gelir", () => {
    // Öznitelikleri yalnız boot script (yol kuralı korumalı) ve ThemeController yazar.
    const writers = FILES.filter((f) => /setAttribute\("data-(theme|accent)"/.test(read(f))).map((f) => f.split("\\").join("/"));
    expect(writers.sort()).toEqual(["src/lib/theme.ts"]);
  }, 60000);

  it("hareket azaltma ve forced-colors desteği globals.css'te var", () => {
    const css = read("src/app/globals.css");
    expect(css).toContain("@media (forced-colors: active)");
    expect(css).toContain("prefers-reduced-motion: no-preference");
  });
});

// ---- Premium konsol (premium.css): hero, cam kutu, ton metinleri, hareket -----

function mix(fg: string, bg: string, alpha: number): string {
  const f = fg.replace("#", "");
  const b = bg.replace("#", "");
  const c = [0, 2, 4].map((i) => {
    const v = Math.round(parseInt(f.slice(i, i + 2), 16) * alpha + parseInt(b.slice(i, i + 2), 16) * (1 - alpha));
    return v.toString(16).padStart(2, "0");
  });
  return `#${c.join("")}`;
}

describe("premium konsol paleti", () => {
  const premiumCss = read("src/app/premium.css");
  const NAVY = ["#0a2247", "#071a38", "#050f24"];

  it("premium.css console-base.css (konsol paketi)'e bağlı ve hareket azaltmaya saygılı", () => {
    expect(read("src/app/console-base.css")).toContain('@import "./premium.css"');
    expect(premiumCss).toContain("prefers-reduced-motion: no-preference");
  });

  it("hero: beyaz ve altın metin lacivert zeminde AA; cam kutu üstünde de", () => {
    for (const bg of NAVY) {
      expect(contrast("#ffffff", bg), `beyaz/${bg}`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(hex(tokensCss, "--gold-300"), bg), `altın/${bg}`).toBeGreaterThanOrEqual(4.5);
      // Cam kutu: en açık uçta %11 beyaz katman; soluk yazı (%80 beyaz) bu zeminde
      const glass = mix("#ffffff", bg, 0.11);
      expect(contrast(mix("#ffffff", glass, 0.8), glass), `soluk beyaz/${glass}`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(hex(tokensCss, "--gold-300"), glass), `altın/${glass}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("altın aktif segment ve düğme: koyu yazı altın dolguda AA", () => {
    for (const g of ["--gold-300", "--gold-400"]) expect(contrast(hex(tokensCss, "--gold-ink"), hex(tokensCss, g))).toBeGreaterThanOrEqual(4.5);
  });

  it("yan menü aktif öğe: beyaz yazı altın-lacivert degrade zeminde AA", () => {
    // gradient uçları: altın %30 / koyu altın %26, lacivert #071a38 üstünde
    expect(contrast("#ffffff", mix("#f0c36a", "#071a38", 0.3))).toBeGreaterThanOrEqual(4.5);
    expect(contrast("#ffffff", mix("#9a6700", "#071a38", 0.26))).toBeGreaterThanOrEqual(4.5);
  });

  it("ton metinleri (trend rozeti/ikon) açık ve koyu yüzeyde kendi yumuşak zeminlerinde AA", () => {
    const lightSurface = hex(LIGHT, "--surface");
    const darkSurface = hex(DARK, "--surface-raised");
    const toneFill: Record<string, [string, string]> = {
      success: ["#0d9373", "#34d3bd"],
      warn: ["#c27803", "#fbbf24"],
      danger: ["#dc3b3b", "#f87171"],
    };
    const alpha: Record<string, number> = { success: 0.13, warn: 0.14, danger: 0.12 };
    // Durum metin tonları TEK KAYNAK: tokens.css (:root) + theme-dark.css (koyu blok).
    const light = LIGHT;
    const dark = DARK;
    for (const [name, [lf, df]] of Object.entries(toneFill)) {
      const t = hex(light, `--pm-${name}-text`);
      const td = hex(dark, `--pm-${name}-text`);
      expect(contrast(t, mix(lf, lightSurface, alpha[name])), `açık ${name}`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(td, mix(df, darkSurface, alpha[name])), `koyu ${name}`).toBeGreaterThanOrEqual(4.5);
    }
    // Altın metin tonu
    expect(contrast(hex(light, "--pm-gold-text"), mix("#d4a24c", lightSurface, 0.18))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(hex(dark, "--pm-gold-text"), mix("#f0c36a", darkSurface, 0.18))).toBeGreaterThanOrEqual(4.5);
  });

  it("ana ekran grafikleri: seri renkleri UI/grafik çizgisi eşiğini (≥3:1) iki temada geçer", () => {
    const light = block(premiumCss, ":root");
    const dark = block(premiumCss, 'html[data-theme="dark"]');
    const lightSurface = hex(LIGHT, "--surface");
    const darkSurface = hex(DARK, "--surface-raised");
    // Seri renkleri ortak viz paletine takma ad olabilir (var(--viz-*)): gerçek hex'e çözülür, eşik aynı kalır.
    const resolve = (body: string, themeCss: string, t: string): string => {
      const alias = (body.includes(`${t}:`) ? body : light).match(new RegExp(`${t}:\\s*var\\((--[a-z0-9-]+)\\)`));
      return alias ? hex(themeCss, alias[1]) : hex(body, t);
    };
    for (const t of ["--pm-chart-success", "--pm-chart-warn", "--pm-chart-danger"]) {
      expect(contrast(resolve(light, tokensCss, t), lightSurface), `açık ${t}`).toBeGreaterThanOrEqual(3);
      expect(contrast(resolve(dark, darkCss, t), darkSurface), `koyu ${t}`).toBeGreaterThanOrEqual(3);
    }
    // Altın dolgu/halka (grafik işareti) iki temada
    expect(contrast(hex(tokensCss, "--gold-500"), lightSurface)).toBeGreaterThanOrEqual(2.1); // dekoratif dolgu; değer metni ayrıca AA (--pm-gold-text)
    expect(contrast(hex(tokensCss, "--gold-300"), darkSurface)).toBeGreaterThanOrEqual(3);
  });

  it("ana ekran kart dili: radius 16, hover hareketsiz, gölge iki katmanlı", () => {
    expect(premiumCss).toContain("--pm-r: 16px");
    const bx = block(premiumCss, ".pm-bx");
    expect(bx).toContain("border: 1px solid");
    expect(bx).toContain("var(--pm-shadow)");
    const hover = block(premiumCss, ".pm-bx:hover");
    expect(hover).not.toContain("transform");
    expect(block(premiumCss, ".pm-card:hover")).not.toContain("transform");
  });

  for (const a of ACCENTS) {
    it(`${a.label}: vurgu metni ana ekran yumuşak vurgu zemininde (%10) AA`, () => {
      for (const s of LIGHT_SURFACES) expect(contrast(a.text, mix(a.fill, s, 0.1)), `açık/${s}`).toBeGreaterThanOrEqual(4.5);
      for (const s of DARK_SURFACES) expect(contrast(a.textDark, mix(a.fillDark, s, 0.1)), `koyu/${s}`).toBeGreaterThanOrEqual(4.5);
    });
  }
});

// ---- Token tek kaynak (tokens.css): lacivert/altın/boşluk/rozet --------------------
describe("token tek kaynak", () => {
  const premiumCss = read("src/app/premium.css");
  const strip = (c: string) => c.replace(/\/\*[\s\S]*?\*\//g, "");

  it("lacivert, altın, boşluk ve gösterge tipografisi tokens.css'te tanımlı", () => {
    for (const t of ["--navy-950", "--navy-900", "--navy-800", "--navy-700", "--navy-600", "--gold-300", "--gold-500", "--gold-ink", "--sb-bg-top", "--sb-bg-bottom", "--fs-kpi", "--fs-eyebrow", "--card-shadow", "--card-shadow-hover"]) {
      expect(LIGHT, t).toContain(`${t}:`);
    }
    for (let i = 1; i <= 12; i++) expect(LIGHT, `--space-${i}`).toContain(`--space-${i}:`);
  });

  it("altın/lacivert ölçeği premium.css'te yeniden tanımlanmaz (tek tanım)", () => {
    expect(strip(premiumCss)).not.toMatch(/--(gold|navy)-\d+\s*:/);
    expect(strip(premiumCss)).not.toMatch(/--pm-(success|warn|danger|gold)-text\s*:/);
  });

  it("lacivert ham hex yalnız tokens.css'te (kabuk CSS'leri token kullanır)", () => {
    for (const f of ["src/app/console.css", "src/app/premium.css", "src/app/a11y.css", "src/app/globals.css", "src/app/theme-dark.css"]) {
      expect(strip(read(f)), f).not.toMatch(/#(071a38|0a2247|0a2147|050f24)/i);
    }
  });

  it("yan menü zemini ve rozetleri: beyaz yazı AA (açık + koyu)", () => {
    const navy = (body: string, t: string): string => {
      const raw = body.match(new RegExp(`${t}:\s*([^;]+);`))?.[1]?.trim() ?? "";
      const ref = raw.match(/^var\((--[a-z0-9-]+)\)$/);
      return ref ? hex(LIGHT, ref[1]) : raw;
    };
    for (const body of [LIGHT, DARK]) {
      for (const t of ["--sb-bg-top", "--sb-bg-mid", "--sb-bg-bottom"]) {
        expect(contrast("#ffffff", navy(body, t)), t).toBeGreaterThanOrEqual(7);
      }
    }
    for (const t of ["--nav-badge-danger", "--nav-badge-warn", "--nav-badge-ok"]) {
      expect(contrast("#ffffff", hex(LIGHT, t)), t).toBeGreaterThanOrEqual(4.5);
    }
  });
});

// ---- Tasarım sistemi v4: mikro etkileşim ve hero hareketi bütçesi --------------------
describe("tasarım sistemi v4 hareket bütçesi", () => {
  const css = read("src/app/premium.css").replace(/\/\*[\s\S]*?\*\//g, "");

  it("kart yükselmesi en çok 2px ve yalnız no-preference + hover:hover içinde", () => {
    const lifts = [...css.matchAll(/translate:\s*0\s+-(\d+)px/g)];
    expect(lifts.length).toBeGreaterThan(0);
    for (const m of lifts) {
      expect(Number(m[1])).toBeLessThanOrEqual(2);
      const before = css.slice(0, m.index);
      const lastMedia = before.lastIndexOf("@media");
      expect(before.slice(lastMedia, lastMedia + 80)).toContain("prefers-reduced-motion: no-preference) and (hover: hover)");
    }
  });

  it("hero degradesi: sonsuz döngü yalnız no-preference içinde, varsayılan duraklatılmış", () => {
    const at = css.indexOf(".ds-hero-ambient { animation:");
    expect(at).toBeGreaterThan(0);
    const media = css.lastIndexOf("@media", at);
    expect(css.slice(media, media + 60)).toContain("prefers-reduced-motion: no-preference");
    expect(css.slice(at, css.indexOf("}", at))).toContain("animation-play-state: paused");
    expect(css).toMatch(/\.ds-hero\[data-play="1"\] \.ds-hero-ambient \{ animation-play-state: running; \}/);
    expect(css).not.toMatch(/\.ds-hero[^{]*\{[^}]*(backdrop-filter|filter:\s*blur)/);
  });

  it("segment seçici: hap altındaki seçenek --accent-fg (dolgu üstünde AA)", () => {
    expect(css).toMatch(/\.ds-seg-opt\[data-on="1"\] \{ color: var\(--accent-fg\); \}/);
    expect(css).toMatch(/\.ds-seg-thumb \{[^}]*background: var\(--accent\)/);
  });
});
