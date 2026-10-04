import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ACCENTS, type AccentPref } from "./theme";

/**
 * 9 vurgu temasının WCAG 2.1 kontrast sözleşmesi.
 *
 * Değerler ACCENTS tablosundan DEĞİL, doğrudan CSS'ten okunur (tokens.css,
 * theme-dark.css, themes.css): tarayıcının gördüğü token neyse o ölçülür. Koyu
 * blokta yeniden tanımlanmayan token açık temadaki değerini miras alır (kaskad).
 *
 * Eşikler:
 *   - dolgu (--brand-600) üstünde beyaz yazı (--accent-fg)      ≥ 4.5:1  (açık + koyu)
 *   - vurgu metni (--brand-700) tüm yüzeylerde                  ≥ 4.5:1  (açık + koyu)
 *   - vurgu metni kendi yumuşak zemininde (--brand-50)          ≥ 4.5:1  (açık + koyu)
 *   - UI bileşen kenarı: dolgu, üzerinde durduğu yüzeye karşı   ≥ 3:1    (açık + koyu)
 *   - odak halkası (--ring) yüzeye karşı                        ≥ 3:1    (açık + koyu)
 *
 * Alttaki ORANLAR tablosu hesaplanan değerleri sabitler: palet değişirse test
 * kırılır ve tablo bilinçli olarak güncellenir (docs/DESIGN_SYSTEM.md ile birlikte).
 */

type Rgb = [number, number, number];

function parseHex(hex: string): Rgb {
  const h = hex.replace("#", "");
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as Rgb;
}

function luminance([r, g, b]: Rgb): number {
  const [x, y, z] = [r, g, b]
    .map((v) => v / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * x! + 0.7152 * y! + 0.0722 * z!;
}

function contrast(a: Rgb, b: Rgb): number {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/** Yarı saydam rengi opak zeminin üstüne bindirir (sRGB alfa birleştirme). */
function over(fg: Rgb, alpha: number, bg: Rgb): Rgb {
  return fg.map((v, i) => Math.round(v * alpha + bg[i]! * (1 - alpha))) as Rgb;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** `selector { ... }` bloğunun gövdesi (iç içe süslü parantez yok). */
function block(css: string, selector: string): string {
  const start = css.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`blok yok: ${selector}`);
  return css.slice(start, css.indexOf("}", start));
}

function rawToken(body: string, token: string): string | null {
  const m = body.match(new RegExp(`${token}:\\s*([^;]+);`));
  return m ? m[1]!.trim() : null;
}

function hexToken(body: string, token: string): Rgb | null {
  const raw = rawToken(body, token);
  return raw && /^#[0-9a-fA-F]{6}$/.test(raw) ? parseHex(raw) : null;
}

function mustHex(body: string, token: string, where: string): Rgb {
  const v = hexToken(body, token);
  if (!v) throw new Error(`hex token yok: ${token} (${where})`);
  return v;
}

/** `#rrggbb` → opak; `rgba(r, g, b, a)` → verilen zeminin üstünde birleştirilmiş renk. */
function resolveColor(raw: string, bg: Rgb): Rgb {
  if (/^#[0-9a-fA-F]{6}$/.test(raw)) return parseHex(raw);
  const m = raw.match(/^rgba\(\s*(\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\s*\)$/);
  if (!m) throw new Error(`çözülemeyen renk: ${raw}`);
  return over([Number(m[1]), Number(m[2]), Number(m[3])], Number(m[4]), bg);
}

const read = (p: string) => readFileSync(p, "utf8");
const tokensCss = read("src/app/tokens.css");
const darkCss = read("src/app/theme-dark.css");
const themesCss = read("src/app/themes.css");

const LIGHT = block(tokensCss, ":root");
const DARK = block(darkCss, 'html[data-theme="dark"]');
const WHITE = parseHex(rawToken(tokensCss, "--accent-fg") ?? "");

const LIGHT_SURFACES = ["--surface", "--canvas", "--surface-sunken", "--surface-2"].map((t) => mustHex(LIGHT, t, "açık"));
const DARK_SURFACES = ["--surface", "--canvas", "--surface-raised", "--surface-2", "--surface-sunken"].map((t) =>
  mustHex(DARK, t, "koyu"),
);
/** Dolgulu denetimin (düğme, aktif çip) üzerinde durduğu yüzeyler: sayfa, panel, kart/açılır katman. */
const LIGHT_CONTROL_SURFACES = ["--surface", "--canvas", "--surface-sunken"].map((t) => mustHex(LIGHT, t, "açık"));
const DARK_CONTROL_SURFACES = ["--surface", "--canvas", "--surface-raised"].map((t) => mustHex(DARK, t, "koyu"));

type Palette = { fill: Rgb; text: Rgb; hover: Rgb; soft: string };

/** Bir temanın tarayıcıdaki etkin marka token'ları (kaskad: tokens → theme-dark → themes açık → themes koyu). */
function palette(accent: AccentPref, mode: "light" | "dark"): Palette {
  const layers: string[] = [LIGHT];
  if (mode === "dark") layers.push(DARK);
  if (accent !== "ocean") {
    layers.push(block(themesCss, `html[data-accent="${accent}"]`));
    if (mode === "dark") layers.push(block(themesCss, `html[data-theme="dark"][data-accent="${accent}"]`));
  }
  const last = (token: string): string => {
    for (let i = layers.length - 1; i >= 0; i--) {
      const raw = rawToken(layers[i]!, token);
      if (raw) return raw;
    }
    throw new Error(`token yok: ${token} (${accent}/${mode})`);
  };
  const hex = (token: string): Rgb => {
    const raw = last(token);
    if (!/^#[0-9a-fA-F]{6}$/.test(raw)) throw new Error(`hex değil: ${token}=${raw} (${accent}/${mode})`);
    return parseHex(raw);
  };
  return {
    fill: hex("--brand-600"),
    text: hex("--brand-700"),
    // --accent-hover: açıkta --brand-700, koyuda --brand-500 (tokens.css / theme-dark.css).
    hover: mode === "light" ? hex("--brand-700") : hex("--brand-500"),
    soft: last("--brand-50"),
  };
}

type Row = {
  /** Beyaz yazı / dolgu */
  whiteOnFill: number;
  /** Vurgu metni / en zor yüzey */
  textOnSurface: number;
  /** Vurgu metni / kendi yumuşak zemini (en zor yüzeyde) */
  textOnSoft: number;
  /** Dolgu / --surface */
  fillOnSurface: number;
  /** Dolgu / en zor denetim yüzeyi (UI bileşen kenarı) */
  fillEdge: number;
};

function measure(accent: AccentPref, mode: "light" | "dark"): Row {
  const p = palette(accent, mode);
  const surfaces = mode === "light" ? LIGHT_SURFACES : DARK_SURFACES;
  const control = mode === "light" ? LIGHT_CONTROL_SURFACES : DARK_CONTROL_SURFACES;
  return {
    whiteOnFill: round2(contrast(WHITE, p.fill)),
    textOnSurface: round2(Math.min(...surfaces.map((s) => contrast(p.text, s)))),
    textOnSoft: round2(Math.min(...surfaces.map((s) => contrast(p.text, resolveColor(p.soft, s))))),
    fillOnSurface: round2(contrast(p.fill, surfaces[0]!)),
    fillEdge: round2(Math.min(...control.map((s) => contrast(p.fill, s)))),
  };
}

/**
 * Hesaplanan oranlar (2 ondalık). Sıra: beyaz/dolgu, metin/en zor yüzey, metin/yumuşak zemin,
 * dolgu/--surface, dolgu/en zor denetim yüzeyi.
 */
const oran = (whiteOnFill: number, textOnSurface: number, textOnSoft: number, fillOnSurface: number, fillEdge: number): Row => ({
  whiteOnFill,
  textOnSurface,
  textOnSoft,
  fillOnSurface,
  fillEdge,
});

const ORANLAR: Record<AccentPref, { light: Row; dark: Row }> = {
  //                    beyaz/dolgu  metin/yüzey  metin/yumuşak  dolgu/surface  dolgu/kenar
  ocean: { light: oran(4.93, 6.14, 6.13, 4.93, 4.48), dark: oran(4.93, 6.83, 5.77, 3.52, 3.25) },
  emerald: { light: oran(5.48, 6.97, 7.29, 5.48, 4.98), dark: oran(5.07, 8.34, 6.66, 3.42, 3.16) },
  indigo: { light: oran(6.26, 6.77, 6.58, 6.26, 5.68), dark: oran(5.1, 8.04, 6.74, 3.41, 3.14) },
  amber: { light: oran(5.02, 6.44, 6.84, 5.02, 4.56), dark: oran(5.02, 9.6, 7.54, 3.46, 3.19) },
  graphite: { light: oran(10.35, 13.28, 13.35, 10.35, 9.4), dark: oran(4.76, 10.79, 8.5, 3.65, 3.37) },
  gold: { light: oran(4.87, 6.28, 6.42, 4.87, 4.42), dark: oran(4.87, 9.71, 7.31, 3.57, 3.29) },
  burgundy: { light: oran(8.01, 9.29, 9.18, 8.01, 7.27), dark: oran(4.99, 6.8, 6.16, 3.48, 3.21) },
  petrol: { light: oran(5.47, 7.11, 7.35, 5.47, 4.97), dark: oran(4.99, 10.83, 8.57, 3.48, 3.21) },
  olive: { light: oran(5.97, 7.48, 7.64, 5.97, 5.42), dark: oran(5.01, 10.11, 7.89, 3.47, 3.2) },
};

const YENI_TEMALAR: AccentPref[] = ["burgundy", "petrol", "olive"];

describe("tema kontrastı (9 vurgu, CSS'ten ölçülür)", () => {
  it("tablo 9 temanın tamamını kapsar", () => {
    expect(Object.keys(ORANLAR).sort()).toEqual(ACCENTS.map((a) => a.value).sort());
    expect(ACCENTS).toHaveLength(9);
  });

  it("--accent-fg beyazdır (dolgu tonları beyaz yazıya göre seçildi)", () => {
    expect(WHITE).toEqual([255, 255, 255]);
  });

  for (const a of ACCENTS) {
    for (const mode of ["light", "dark"] as const) {
      const ad = `${a.label} (${mode === "light" ? "açık" : "koyu"})`;

      it(`${ad}: dolgu üstünde beyaz yazı ≥ 4.5:1`, () => {
        expect(measure(a.value, mode).whiteOnFill).toBeGreaterThanOrEqual(4.5);
      });

      it(`${ad}: vurgu metni tüm yüzeylerde ve kendi yumuşak zemininde ≥ 4.5:1`, () => {
        const m = measure(a.value, mode);
        expect(m.textOnSurface).toBeGreaterThanOrEqual(4.5);
        expect(m.textOnSoft).toBeGreaterThanOrEqual(4.5);
      });

      it(`${ad}: UI bileşen kenarı (dolgu / yüzey) ≥ 3:1`, () => {
        const m = measure(a.value, mode);
        expect(m.fillOnSurface).toBeGreaterThanOrEqual(3);
        expect(m.fillEdge).toBeGreaterThanOrEqual(3);
      });

      it(`${ad}: odak halkası (--ring) yüzeylere karşı ≥ 3:1`, () => {
        const p = palette(a.value, mode);
        // --ring: açıkta --accent (dolgu), koyuda --accent-text (metin tonu).
        const ring = mode === "light" ? p.fill : p.text;
        const surfaces = mode === "light" ? LIGHT_SURFACES : DARK_SURFACES;
        for (const s of surfaces) expect(contrast(ring, s)).toBeGreaterThanOrEqual(3);
      });

      it(`${ad}: hesaplanan oranlar sabitlenmiş tabloyla aynı`, () => {
        expect(measure(a.value, mode)).toEqual(ORANLAR[a.value][mode]);
      });

      it(`${ad}: ACCENTS tablosu CSS'teki etkin dolgu/metin değerleriyle aynı`, () => {
        const p = palette(a.value, mode);
        expect(p.fill).toEqual(parseHex(mode === "light" ? a.fill : a.fillDark));
        expect(p.text).toEqual(parseHex(mode === "light" ? a.text : a.textDark));
      });
    }

    it(`${a.label}: açık temada hover dolgusu (--brand-700) üstünde beyaz yazı ≥ 4.5:1`, () => {
      expect(contrast(WHITE, palette(a.value, "light").hover)).toBeGreaterThanOrEqual(4.5);
    });
  }

  for (const accent of YENI_TEMALAR) {
    it(`${accent}: koyuda güvenli marj (beyaz/dolgu ≥ 4.8, dolgu/yüzey ≥ 3.3, hover dolgusu ≥ 4.5)`, () => {
      const m = measure(accent, "dark");
      expect(m.whiteOnFill).toBeGreaterThanOrEqual(4.8);
      expect(m.fillOnSurface).toBeGreaterThanOrEqual(3.3);
      expect(contrast(WHITE, palette(accent, "dark").hover)).toBeGreaterThanOrEqual(4.5);
    });
  }
});

// ---- Rol adlı etkileşim token'ları (tokens.css + theme-dark.css) ----------------

const ROL_TOKENLARI = ["--surface-hover", "--surface-pressed", "--surface-selected", "--border-interactive", "--border-strong"];
const SUPPORTS = "(color: color-mix(in oklch, #000 50%, transparent))";

/** `@supports <koşul> { ... }` bloğunun gövdesi (iç içe bir düzey süslü parantez). */
function supportsBlock(css: string, head: string): string {
  const start = css.indexOf(head);
  if (start < 0) throw new Error(`@supports yok: ${head}`);
  let depth = 0;
  for (let i = css.indexOf("{", start); i < css.length; i++) {
    if (css[i] === "{") depth++;
    else if (css[i] === "}" && --depth === 0) return css.slice(start, i);
  }
  throw new Error(`@supports kapanmıyor: ${head}`);
}

/** `color-mix(in oklch, var(--x) N%, transparent)` → { kaynak: "--x", alfa: N/100 } */
function mixOf(body: string, token: string): { source: string; alpha: number } {
  const raw = rawToken(body, token);
  const m = raw?.match(/^color-mix\(in oklch, var\((--[a-z0-9-]+)\) (\d+)%, transparent\)$/);
  if (!m) throw new Error(`tek formül değil: ${token}=${raw}`);
  return { source: m[1]!, alpha: Number(m[2]) / 100 };
}

describe("rol adlı etkileşim token'ları", () => {
  const formula = supportsBlock(tokensCss, `@supports ${SUPPORTS}`);
  const darkFallback = supportsBlock(darkCss, `@supports not ${SUPPORTS}`);

  it("beş token: düz renk yedeği + @supports içinde color-mix(in oklch) tek formülü", () => {
    const fallback = tokensCss.slice(0, tokensCss.indexOf(`@supports ${SUPPORTS}`));
    for (const t of ROL_TOKENLARI) {
      expect(rawToken(fallback, t), `${t} yedek`).toBeTruthy();
      expect(rawToken(fallback, t), `${t} yedek düz renk`).not.toContain("color-mix");
      expect(mixOf(formula, t).alpha, `${t} formül`).toBeGreaterThan(0);
    }
    // Zemin tonları metinden, seçili zemin vurgudan türer; hepsi bulunduğu yüzeyin üstüne biner.
    expect(mixOf(formula, "--surface-hover").source).toBe("--text");
    expect(mixOf(formula, "--surface-pressed").source).toBe("--text");
    expect(mixOf(formula, "--surface-selected").source).toBe("--brand-600");
    expect(mixOf(formula, "--border-interactive").source).toBe("--text");
    expect(mixOf(formula, "--border-strong").source).toBe("--text");
    // Koyu hero ve beyaz etiket kapsamı kendi --text / --brand-600 değeriyle yeniden çözer.
    expect(formula).toContain(".theme-dark");
    expect(formula).toContain(".brand-scope");
  });

  it("kademe sırası: hover < basılı, etkileşimli kenar < belirgin kenar", () => {
    expect(mixOf(formula, "--surface-hover").alpha).toBeLessThan(mixOf(formula, "--surface-pressed").alpha);
    expect(mixOf(formula, "--border-interactive").alpha).toBeLessThan(mixOf(formula, "--border-strong").alpha);
  });

  it("koyu tema: formül yeniden yazılmaz; yalnız @supports not içinde düz renk yedeği vardır", () => {
    for (const t of ["--surface-hover", "--surface-pressed", "--border-interactive", "--border-strong"]) {
      expect(rawToken(darkFallback, t), `${t} koyu yedek`).toMatch(/^rgba\(/);
    }
    // Ana koyu blok rol token'ı tanımlamaz (tanımlasaydı :root'taki formülü ezerdi).
    for (const t of ROL_TOKENLARI) expect(rawToken(DARK, t), `${t} ana koyu blok`).toBeNull();
  });

  it("Tailwind sınıfları üretilir (bg-surface-hover, border-border-interactive ...)", () => {
    for (const t of ROL_TOKENLARI) expect(tokensCss).toContain(`--color-${t.slice(2)}: var(${t});`);
  });

  for (const a of ACCENTS) {
    for (const mode of ["light", "dark"] as const) {
      it(`${a.label} (${mode === "light" ? "açık" : "koyu"}): seçili zeminde vurgu metni ve gövde metni ≥ 4.5:1`, () => {
        const p = palette(a.value, mode);
        const { alpha } = mixOf(formula, "--surface-selected");
        const body = mustHex(mode === "light" ? LIGHT : DARK, "--text", mode);
        for (const s of mode === "light" ? LIGHT_SURFACES : DARK_SURFACES) {
          const selected = over(p.fill, alpha, s);
          expect(contrast(p.text, selected), "vurgu metni").toBeGreaterThanOrEqual(4.5);
          expect(contrast(body, selected), "gövde metni").toBeGreaterThanOrEqual(4.5);
        }
      });
    }
  }

  it("hover ve basılı zeminde gövde ve soluk metin ≥ 4.5:1 (açık + koyu, tüm yüzeyler)", () => {
    for (const [mode, body, surfaces] of [
      ["açık", LIGHT, LIGHT_SURFACES],
      ["koyu", DARK, DARK_SURFACES],
    ] as const) {
      const text = mustHex(body, "--text", mode);
      for (const token of ["--surface-hover", "--surface-pressed"]) {
        const { alpha } = mixOf(formula, token);
        for (const s of surfaces) {
          const bg = over(text, alpha, s);
          for (const t of ["--text", "--text-muted"]) {
            expect(contrast(mustHex(body, t, mode), bg), `${mode} ${t} / ${token}`).toBeGreaterThanOrEqual(4.5);
          }
        }
      }
      // Soluk metin (--text-faint) durağan yüzeyde tam eşikte kalibre edildi; hover tonu ana panel
      // yüzeyinde (--surface) onu AA'nın altına itmemeli. Diğer yüzeylerde garanti yoktur.
      const hover = over(text, mixOf(formula, "--surface-hover").alpha, surfaces[0]!);
      expect(contrast(mustHex(body, "--text-faint", mode), hover), `${mode} --text-faint / hover`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("formül ve düz renk yedeği aynı yüzdeyi taşır (iki liste ayrışmaz)", () => {
    const fallback = tokensCss.slice(0, tokensCss.indexOf(`@supports ${SUPPORTS}`));
    const alphaOf = (body: string, token: string) => Number(rawToken(body, token)?.match(/,\s*([\d.]+)\)$/)?.[1]);
    for (const t of ["--surface-hover", "--surface-pressed", "--border-interactive", "--border-strong"]) {
      expect(alphaOf(fallback, t), `${t} açık yedek`).toBe(mixOf(formula, t).alpha);
      expect(alphaOf(darkFallback, t), `${t} koyu yedek`).toBe(mixOf(formula, t).alpha);
    }
    // Yedek renk, temanın --text değeridir (açık #172033, koyu #e8edf7).
    const rgb = (body: string, token: string) => rawToken(body, token)?.match(/^rgba\((\d+), (\d+), (\d+),/)?.slice(1).map(Number);
    expect(rgb(fallback, "--surface-hover")).toEqual(mustHex(LIGHT, "--text", "açık"));
    expect(rgb(darkFallback, "--surface-hover")).toEqual(mustHex(DARK, "--text", "koyu"));
  });
});

// ---- Yüksek kontrast (a11y.css, prefers-contrast: more) ---------------------------

describe("yüksek kontrast tercihi (prefers-contrast: more)", () => {
  const a11yCss = read("src/app/a11y.css");
  const hc = supportsBlock(a11yCss, "@media (prefers-contrast: more)");
  const hcLight = block(hc, ":root");
  const hcDark = block(hc, 'html[data-theme="dark"]');

  it("blok a11y.css'te tanımlı; saydamlığı azalt tercihi de karşılanır", () => {
    expect(a11yCss).toContain("@media (prefers-contrast: more)");
    expect(a11yCss).toContain("@media (prefers-reduced-transparency: reduce), (prefers-contrast: more)");
  });

  it("soluk metin tonları koyulaşır: her yüzeyde ≥ 7:1 (AAA), açık + koyu", () => {
    for (const t of ["--text-muted", "--text-faint"]) {
      for (const s of LIGHT_SURFACES) expect(contrast(mustHex(hcLight, t, "yk açık"), s), `açık ${t}`).toBeGreaterThanOrEqual(7);
      for (const s of DARK_SURFACES) expect(contrast(mustHex(hcDark, t, "yk koyu"), s), `koyu ${t}`).toBeGreaterThanOrEqual(7);
    }
  });

  it("kenarlık tam renk: çizgi her yüzeyde ≥ 3:1, belirgin çizgi ≥ 4.5:1", () => {
    for (const [body, surfaces, mode] of [
      [hcLight, LIGHT_SURFACES, "açık"],
      [hcDark, DARK_SURFACES, "koyu"],
    ] as const) {
      for (const s of surfaces) {
        expect(contrast(mustHex(body, "--line", mode), s), `${mode} --line`).toBeGreaterThanOrEqual(3);
        expect(contrast(mustHex(body, "--line-strong", mode), s), `${mode} --line-strong`).toBeGreaterThanOrEqual(4.5);
      }
      // Saç teli artık yarı saydam değil: çizgi rengine bağlanır.
      expect(rawToken(body, "--hairline")).toBe("var(--line)");
      expect(rawToken(body, "--hairline-strong")).toBe("var(--line-strong)");
      expect(rawToken(body, "--border-interactive")).toBe("var(--line-strong)");
    }
  });

  it("odak halkası kalınlaşır ve tam renk olur", () => {
    expect(rawToken(hcLight, "--focus-ring")).toBe("0 0 0 5px var(--ring)");
    expect(hc).toMatch(/:root :focus-visible \{\s*outline-width: 3px;/);
  });
});
