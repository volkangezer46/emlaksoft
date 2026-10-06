import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Hareket ve veri görselleştirme sözleşmesi (docs/DESIGN_SYSTEM.md "Hareket kuralları").
// Kural: süs hareketi yok; gerçek, anlamlı hareket ilk görünümde BİR kez oynar.

function files(dir: string, ext: RegExp, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) files(full, ext, out);
    else if (ext.test(name) && !/\.test\.tsx?$/.test(name)) out.push(full.split("\\").join("/"));
  }
  return out;
}
const read = (p: string) => readFileSync(p, "utf8");
const stripCss = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "");

/** `selector { ... }` kurallarını (iç içe olmayan) listeler. */
function rules(css: string): Array<{ sel: string; body: string }> {
  return [...stripCss(css).matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ sel: m[1]!.trim(), body: m[2]! }));
}

const APP_TSX = [...files("src/app/app", /\.tsx?$/), ...files("src/app/admin", /\.tsx?$/)];

/** Fare imleci veri inceleme/harita araçları ve işlevsel (süs olmayan) istisnalar. */
const FARE_IZINLI = [
  "src/app/app/portfoyler/map-view", // harita: imleçle veri inceleme
  "src/app/app/randevular/rota-map", // harita
  "src/app/app/talep-arz-map", // harita (klasör veya dosya)
  "src/app/app/pano-tv/tv-board", // TV modu: fare hareketi imleci/kontrolleri uyandırır (işlevsel, süs değil)
];

describe("hareket sözleşmesi: fare süsü yok", () => {
  it("/app ve /admin'de onMouseMove/mousemove/tilt/parallax yok (izinli: haritalar, TV modu)", () => {
    const bad = APP_TSX.filter((f) => {
      if (FARE_IZINLI.some((ok) => f.includes(ok))) return false;
      return /onMouseMove|["']mousemove["']|\btilt\b|parallax/i.test(read(f));
    });
    expect(bad).toEqual([]);
  });
});

describe("hareket sözleşmesi: süs sonsuz animasyon yok", () => {
  const CSS = ["globals", "premium", "console", "motion"].map((n) => ({ n, css: read(`src/app/${n}.css`) }));
  const SUS = ["glow-halo", "flow-line", "conic-spin", "pm-twinkle", "bar-live", "bar-bob"];

  it("süs sınıflarının hiçbir CSS kuralında sonsuz animasyon yok", () => {
    const bad: string[] = [];
    for (const { n, css } of CSS) {
      for (const r of rules(css)) {
        if (SUS.some((c) => r.sel.includes(`.${c}`)) && /infinite/.test(r.body)) bad.push(`${n}.css: ${r.sel}`);
      }
      expect(stripCss(css), `${n}.css`).not.toMatch(/@keyframes\s+bar-bob/);
    }
    expect(bad).toEqual([]);
  });

  it("silinen ölü sınıflar geri gelmedi", () => {
    const dead = ["tilt-card", "tilt-3d", "hero-tilt", "particle", "grid-scan", "comet", "danger-pulse", "area-sheen", "legend-blink", "trace-flow", "shield-ring"];
    const all = CSS.map((c) => stripCss(c.css)).join("\n");
    for (const d of dead) expect(all, d).not.toMatch(new RegExp(`\\.${d}(?![\\w-])`));
    expect(all).not.toMatch(/\.perspective\s*[{:]/);
  });

  it(".status-pulse (sonsuz) yalnız gerçek canlı göstergede; durağan seçenek tanımlı", () => {
    expect(stripCss(read("src/app/globals.css"))).toContain(".status-pulse-static");
  });
});

describe("hareket sözleşmesi: süre tokenları ve reduced-motion", () => {
  it("--motion-draw (600ms) ve --motion-count (700ms) tanımlı; çizilme animasyonları buna bağlı", () => {
    const motion = read("src/app/motion.css");
    expect(motion).toMatch(/--motion-draw:\s*600ms/);
    expect(motion).toMatch(/--motion-count:\s*700ms/);
    const g = stripCss(read("src/app/globals.css"));
    for (const cls of [".chart-draw", ".ring-sweep", ".dashboard-chart-line", ".bar-live"]) {
      const r = rules(g).find((x) => x.sel === cls);
      expect(r, cls).toBeDefined();
      expect(r!.body, cls).toContain("var(--motion-draw)");
    }
  });

  it("genel reduced-motion kuralı TEK yerde (a11y.css); globals.css tekrar etmez", () => {
    const a11y = read("src/app/a11y.css");
    const globals = read("src/app/globals.css");
    expect(a11y).toMatch(/prefers-reduced-motion: reduce[\s\S]*animation-duration:\s*0\.001ms/);
    expect(globals).not.toMatch(/animation-duration:\s*0\.01ms/);
    expect(globals).not.toMatch(/\*,\s*\*::before,\s*\*::after\s*\{[^}]*animation-duration/);
  });

  it("viz hareket sınıfları yalnız no-preference içinde (reduce'ta bitiş durumu)", () => {
    const motion = read("src/app/motion.css");
    const start = motion.indexOf("@media (prefers-reduced-motion: no-preference) {");
    for (const cls of [".viz-reveal", ".viz-fade", ".viz-grow-x", ".viz-sweep", ".ill-grow-x"]) {
      expect(motion.indexOf(`${cls} {`), cls).toBeGreaterThan(start);
    }
  });
});

describe("viz kiti: eski dışa aktarımlar ve cam bütçesi", () => {
  it("viz bileşenleri yeni cam yüzey (backdrop-filter / backdrop-blur) eklemez", () => {
    for (const f of files("src/components/ui/viz", /\.tsx?$/)) {
      expect(read(f), f).not.toMatch(/backdrop-(filter|blur)/);
    }
  });

  it("viz bileşenleri Date.now / new Date kullanmaz (clock.ts kuralı)", () => {
    for (const f of files("src/components/ui/viz", /\.tsx?$/)) {
      expect(read(f), f).not.toMatch(/Date\.now\(|new Date\(/);
    }
  });

  it("eski adlar yeni kite yönlenir", () => {
    // Tek sayaç ui/count-up: eski admin CountUp ve OdometerNumber sarmalayıcıları silindi (2026-10).
    expect(existsSync(join(process.cwd(), "src/components/admin/count-up.tsx"))).toBe(false);
    expect(existsSync(join(process.cwd(), "src/app/app/odometer-number.tsx"))).toBe(false);
    expect(read("src/components/ui/console/ring.tsx")).toContain("RadialGauge");
    expect(read("src/components/ui/premium/charts.tsx")).toContain("RadialGauge");
    expect(read("src/components/ui/console/area-chart.tsx")).toContain("viz/area-chart");
    expect(read("src/components/ui/premium/charts.tsx")).toContain("viz/area-chart");
    // Tembel grafik kapısı tek yerde (components/ui/lazy-charts); eski yol yalnız yeniden dışa aktarır.
    expect(read("src/app/app/_ui/lazy-chart.tsx")).toContain("@/components/ui/lazy-charts");
    expect(read("src/components/ui/lazy-charts.tsx")).toContain("SkeletonCard");
    expect(read("src/components/ui/lazy-charts.tsx")).not.toContain("animate-pulse");
  });

  it("Recharts grafikleri reduced-motion'da animasyonu kapatır", () => {
    // Recharts'ı doğrudan import eden HER dosyada, her seri bileşeni (Area/Bar/Pie/Line/Radar/Scatter)
    // isAnimationActive={!reduce} taşımalı (CSS reduced-motion kuralı Recharts'ın JS animasyonunu kapatmaz).
    const rechartsFiles = files("src", /\.tsx?$/).filter((f) => /from "recharts"/.test(read(f)));
    expect(rechartsFiles.length).toBeGreaterThanOrEqual(4);
    for (const file of rechartsFiles) {
      const src = read(file);
      const series = (src.match(/<(Area|Bar|Pie|Line|Radar|RadialBar|Scatter)\b/g) ?? []).length;
      const guarded = (src.match(/isAnimationActive=\{!reduce\}/g) ?? []).length;
      expect({ file, guarded }).toEqual({ file, guarded: series });
    }
  });
});
