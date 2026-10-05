import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Veri görselleştirme paleti (--viz-*) sözleşmesi: iki temada da tanımlı, WCAG kontrastlı,
// seriler birbirinden ayırt edilebilir. Değer değişecekse önce docs/DESIGN_SYSTEM.md güncellenir.

const TOKENS = readFileSync("src/app/tokens.css", "utf8");
const DARK = readFileSync("src/app/theme-dark.css", "utf8");

function lum(hex: string): number {
  const h = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4]
    .map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a: string, b: string): number {
  const x = lum(a);
  const y = lum(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
function lab(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4]
    .map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  const X = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047;
  const Y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const Z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883;
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  return [116 * f(Y) - 16, 500 * (f(X) - f(Y)), 200 * (f(Y) - f(Z))];
}
function deltaE(a: string, b: string): number {
  const p = lab(a);
  const q = lab(b);
  return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
}

function vars(css: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of css.matchAll(/(--viz-[a-z0-9-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)) out[m[1]!] = m[2]!;
  return out;
}
function surface(css: string): string {
  return /--surface:\s*(#[0-9a-fA-F]{6})/.exec(css)![1]!;
}

const THEMES = {
  açık: { v: vars(TOKENS), surface: surface(TOKENS) },
  koyu: { v: vars(DARK), surface: surface(DARK) },
};
const CAT = [1, 2, 3, 4, 5, 6, 7, 8].map((i) => `--viz-${i}`);
const SEQ = [1, 2, 3, 4, 5].map((i) => `--viz-seq-${i}`);

describe("viz paleti (--viz-*)", () => {
  for (const [name, t] of Object.entries(THEMES)) {
    describe(`${name} tema`, () => {
      it("8 kategorik + 5 sıralı + pos/neg/neutral/gold tanımlı", () => {
        for (const k of [...CAT, ...SEQ, "--viz-pos", "--viz-neg", "--viz-neutral", "--viz-gold"]) {
          expect(t.v[k], k).toMatch(/^#[0-9a-fA-F]{6}$/);
        }
      });

      it("çizgi/dolgu serileri --surface üzerinde >=3:1 (WCAG 1.4.11)", () => {
        for (const k of [...CAT, "--viz-gold", "--viz-seq-3", "--viz-seq-4", "--viz-seq-5"]) {
          expect(contrast(t.v[k]!, t.surface), `${k} ${t.v[k]}`).toBeGreaterThanOrEqual(3);
        }
      });

      it("pos/neg/neutral metin olarak da >=4.5:1", () => {
        for (const k of ["--viz-pos", "--viz-neg", "--viz-neutral"]) {
          expect(contrast(t.v[k]!, t.surface), k).toBeGreaterThanOrEqual(4.5);
        }
      });

      it("kategorik renkler birbirinden ayırt edilir (CIE76 ΔE >= 20; mint/cyan yakınlığı yok)", () => {
        for (let i = 0; i < CAT.length; i++) {
          for (let j = i + 1; j < CAT.length; j++) {
            expect(deltaE(t.v[CAT[i]!]!, t.v[CAT[j]!]!), `${CAT[i]} / ${CAT[j]}`).toBeGreaterThanOrEqual(20);
          }
        }
      });

      it("sıralı palet tek yönde monoton ve basamaklar ayırt edilir", () => {
        const l = SEQ.map((k) => lum(t.v[k]!));
        const dir = Math.sign(l[4]! - l[0]!);
        for (let i = 1; i < l.length; i++) expect(Math.sign(l[i]! - l[i - 1]!)).toBe(dir);
        // Açık temada yüksek değer koyu, koyu temada yüksek değer açık (yüzeyden uzaklaşır).
        expect(contrast(t.v["--viz-seq-5"]!, t.surface)).toBeGreaterThan(contrast(t.v["--viz-seq-1"]!, t.surface));
        for (let i = 1; i < SEQ.length; i++) {
          expect(deltaE(t.v[SEQ[i - 1]!]!, t.v[SEQ[i]!]!)).toBeGreaterThanOrEqual(12);
        }
      });
    });
  }

  it("chart-colors.ts yalnız --viz-* tokenlarına bağlı (ham hex / brand / ink yok)", () => {
    const src = readFileSync("src/components/ui/chart-colors.ts", "utf8");
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "");
    expect(code).not.toMatch(/#[0-9a-fA-F]{3,8}/);
    expect(code).not.toMatch(/--(brand|ink|mint|cyan|amber|danger)-/);
    expect([...code.matchAll(/var\(--viz-(\d)\)/g)].length).toBe(8);
  });

  it("premium ton sınıfları ve grafik renkleri ham hex taşımaz (token'a bağlı)", () => {
    const css = readFileSync("src/app/premium.css", "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    expect(css).not.toMatch(/--pm-chart-(success|warn|danger):\s*#/);
    expect(css).not.toMatch(/\.pm-t-(success|warn|danger|gold)[^{]*\{[^}]*--t:\s*#/);
  });

  it("grafik ipucu metni token'dan (text-ink-950 yok)", () => {
    const chart = readFileSync("src/components/ui/chart.tsx", "utf8");
    expect(chart).toContain("--viz-tooltip-text");
    expect(chart).not.toContain("text-ink-950");
  });
});
