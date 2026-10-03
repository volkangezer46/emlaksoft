import { readdirSync, readFileSync, statSync } from "node:fs";
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

  it("koyu tema yalnız /app ve /admin için tanımlı ve kök layout'ta açılış script'i var", () => {
    const layout = readFileSync("src/app/layout.tsx", "utf8");
    expect(layout).toContain("THEME_BOOT_SCRIPT");
    expect(layout).toContain("suppressHydrationWarning");
    const css = readFileSync("src/app/globals.css", "utf8");
    expect(css).toContain('@import "./theme-dark.css"');
  });

  it("Türkçe karakterler için fontlar latin-ext alt kümesiyle yüklenir", () => {
    const layout = readFileSync("src/app/layout.tsx", "utf8");
    const subsets = layout.match(/subsets:\s*\[[^\]]*\]/g) ?? [];
    const fontSubsets = subsets.filter((s) => s.includes('"latin"'));
    expect(fontSubsets.length).toBeGreaterThanOrEqual(2);
    // Geist Mono yalnız kod/sayı için; Manrope ve Inter latin-ext içermeli.
    expect(fontSubsets.filter((s) => s.includes("latin-ext")).length).toBeGreaterThanOrEqual(2);
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

  it("6 vurgu teması var ve varsayılan dışındakilerin CSS bloğu iki temada tanımlı", () => {
    expect(ACCENTS.map((a) => a.value)).toEqual(["ocean", "emerald", "indigo", "amber", "graphite", "gold"]);
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
    expect(THEME_BOOT_SCRIPT).toContain("emerald|indigo|amber|graphite|gold");
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

  it("premium.css globals.css'e bağlı ve hareket azaltmaya saygılı", () => {
    expect(read("src/app/globals.css")).toContain('@import "./premium.css"');
    expect(premiumCss).toContain("prefers-reduced-motion: no-preference");
  });

  it("hero: beyaz ve altın metin lacivert zeminde AA; cam kutu üstünde de", () => {
    for (const bg of NAVY) {
      expect(contrast("#ffffff", bg), `beyaz/${bg}`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(hex(premiumCss, "--gold-300"), bg), `altın/${bg}`).toBeGreaterThanOrEqual(4.5);
      // Cam kutu: %7 beyaz katman; soluk yazı (%78 beyaz) bu zeminde
      const glass = mix("#ffffff", bg, 0.07);
      expect(contrast(mix("#ffffff", glass, 0.78), glass), `soluk beyaz/${glass}`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(hex(premiumCss, "--gold-300"), glass), `altın/${glass}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("altın aktif segment ve düğme: koyu yazı altın dolguda AA", () => {
    for (const g of ["--gold-300", "--gold-400"]) expect(contrast("#1a1200", hex(premiumCss, g))).toBeGreaterThanOrEqual(4.5);
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
    const light = block(premiumCss, ":root");
    const dark = block(premiumCss, 'html[data-theme="dark"]');
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
});
