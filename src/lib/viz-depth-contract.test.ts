import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Grafik DERİNLİK dili ve TEK grafik seti sözleşmesi (docs/DESIGN_SYSTEM.md "Grafik derinlik dili").
 * - Derinlik token'ları iki temada tanımlı; ışık katmanı seri rengini kontrast eşiğinin altına itmez.
 * - Recharts yalnız ui/chart.tsx'ten içe aktarılır (sayfa başına yerel grafik kopyası yok).
 * - Derinlik SVG filtresiyle yapılmaz (maliyet); grafik bileşenlerinde ham hex yok.
 * - Elle çizilmiş halka grafikleri tek setteki bileşenlere taşındı (geri gelmez).
 */

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "");

function files(dir: string, ext: RegExp, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) files(full, ext, out);
    else if (ext.test(name) && !/\.test\.tsx?$/.test(name)) out.push(full.split("\\").join("/"));
  }
  return out;
}

type Rgb = [number, number, number];
const hexRgb = (h: string): Rgb => [0, 2, 4].map((i) => parseInt(h.replace("#", "").slice(i, i + 2), 16)) as Rgb;
function lum([r, g, b]: Rgb): number {
  const f = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
const contrast = (a: Rgb, b: Rgb) => {
  const x = lum(a);
  const y = lum(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};
/** Beyaz ışık katmanı (alfa) seri renginin üstünde. */
const overWhite = (c: Rgb, a: number): Rgb => c.map((v) => Math.round(v * (1 - a) + 255 * a)) as Rgb;

function block(css: string, head: RegExp): string {
  const m = head.exec(css);
  if (!m) throw new Error(`blok yok: ${head}`);
  return css.slice(m.index, css.indexOf("}", m.index));
}
function rgbaAlpha(body: string, token: string): number {
  const m = new RegExp(`${token}:\\s*rgba\\([^,]+,[^,]+,[^,]+,\\s*([0-9.]+)\\)`).exec(body);
  if (!m) throw new Error(`${token} rgba değil`);
  return Number(m[1]);
}
function hexToken(body: string, token: string): Rgb {
  const m = new RegExp(`${token}:\\s*(#[0-9a-fA-F]{6})`).exec(body);
  if (!m) throw new Error(`${token} yok`);
  return hexRgb(m[1]!);
}

const TOKENS = strip(read("src/app/tokens.css"));
const DARK = strip(read("src/app/theme-dark.css"));
const LIGHT_VIZ = block(TOKENS, /:root\s*\{\s*--viz-1:/);
const DARK_VIZ = block(DARK, /html\[data-theme="dark"\]\s*\{/);
// Işık katmanı yalnız çubuk/dilimlerde (CHART_COLORS = --viz-1..8); altın yalnız çizgi/alan serisidir.
const SERIES = [1, 2, 3, 4, 5, 6, 7, 8].map((i) => `--viz-${i}`);

describe("grafik derinlik token'ları", () => {
  for (const [name, body] of [["açık", LIGHT_VIZ], ["koyu", DARK_VIZ]] as const) {
    it(`${name}: --viz-sheen/shade/shadow yarı saydam, --viz-glow ölçülü`, () => {
      for (const t of ["--viz-sheen", "--viz-shade", "--viz-shadow"]) expect(rgbaAlpha(body, t), t).toBeLessThanOrEqual(0.6);
      const glow = Number(/--viz-glow:\s*([0-9.]+)/.exec(body)?.[1]);
      expect(glow).toBeGreaterThanOrEqual(0.1);
      expect(glow).toBeLessThanOrEqual(0.35);
    });
  }

  it("ışık katmanı çubuğun ortasında (degrade yarı yolu) seriyi --surface üzerinde 3:1'in altına düşürmez (açık + koyu)", () => {
    const lightSurface = hexToken(TOKENS, "--surface");
    const darkSurface = hexToken(DARK, "--surface");
    for (const [body, surface, sheenBody] of [
      [LIGHT_VIZ, lightSurface, LIGHT_VIZ],
      [DARK_VIZ, darkSurface, DARK_VIZ],
    ] as const) {
      const mid = rgbaAlpha(sheenBody, "--viz-sheen") / 2;
      for (const t of SERIES) {
        const c = overWhite(hexToken(body, t), mid);
        expect(contrast(c, surface), t).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it("viz.css console-base.css (konsol paketi)'nden yüklenir ve token kullanır (ham renk yok)", () => {
    expect(read("src/app/console-base.css")).toContain('@import "./viz.css"');
    const viz = strip(read("src/app/viz.css"));
    expect(viz).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(/);
    for (const t of ["--viz-sheen", "--viz-shade", "--viz-shadow", "--viz-glow"]) expect(viz).toContain(t);
  });
});

describe("tek grafik seti", () => {
  it("recharts yalnız src/components/ui/chart.tsx'ten içe aktarılır", () => {
    const offenders = [...files("src/app", /\.tsx?$/), ...files("src/components", /\.tsx?$/)].filter(
      (f) => f !== "src/components/ui/chart.tsx" && /^import[^;]*from\s+["']recharts["']/m.test(read(f)),
    );
    expect(offenders).toEqual([]);
  });

  it("derinlik SVG filtresiyle yapılmaz; grafik bileşenlerinde ham hex yok", () => {
    for (const f of ["src/components/ui/chart.tsx", ...files("src/components/ui/viz", /\.tsx?$/)]) {
      const src = read(f);
      expect(src, f).not.toMatch(/<filter\b|feGaussianBlur|feDropShadow/);
      expect(src.replace(/\/\*[\s\S]*?\*\//g, ""), f).not.toMatch(/["'`]#[0-9a-fA-F]{3,8}["'`]/);
    }
    const chart = read("src/components/ui/chart.tsx");
    expect(chart).toContain("viz-depth");
    expect(chart).toContain("hrefKey");
    // Halka derinliği tek bileşenden (tüp degradesi): Recharts dilimi + saf SVG halkalar.
    for (const f of ["src/components/ui/chart.tsx", "src/components/ui/viz/radial-gauge.tsx", "src/components/ui/viz/donut-ring.tsx"]) {
      expect(read(f), f).toContain("TubeGradient");
    }
  });

  it("/app, /admin ve ortak bileşen SVG'lerinde sabit renk yok (token); istisna: üçüncü taraf marka logoları, harita işaretçisi", () => {
    const allow = ["src/components/app/add-to-calendar-button.tsx", "src/app/app/portfoyler/map-view.tsx"];
    const re = /\b(fill|stroke|stopColor)=["{]"?(#[0-9a-fA-F]{3,8}\b|white\b|black\b|rgba?\()/;
    const scope = ["src/app/app", "src/app/admin", "src/components/ui", "src/components/app", "src/components/admin"].flatMap((d) => files(d, /\.tsx$/));
    expect(scope.filter((f) => !allow.includes(f) && re.test(read(f)))).toEqual([]);
  });

  it("elle çizilmiş halka grafikleri tek setten (RadialGauge / DonutRing); yerel kopya dosyaları silindi", () => {
    expect(read("src/app/app/komisyon/commission-simulator.tsx")).toContain("DonutRing");
    expect(read("src/app/app/kayip-kacak/page.tsx")).toContain("RadialGauge");
    expect(read("src/app/app/pano-tv/tv-board.tsx")).toContain("RadialGauge");
    for (const f of ["src/app/app/komisyon/commission-simulator.tsx", "src/app/app/kayip-kacak/page.tsx", "src/app/app/pano-tv/tv-board.tsx"]) {
      expect(read(f), f).not.toMatch(/strokeDasharray=\{`?\$?\{?(DONUT_C|RING_C|circ)\b/);
    }
    for (const gone of ["src/app/app/danisman-kpi/revenue-chart.tsx", "src/app/app/giderler/category-donut.tsx"]) {
      expect(() => statSync(gone), gone).toThrow();
    }
  });
});
