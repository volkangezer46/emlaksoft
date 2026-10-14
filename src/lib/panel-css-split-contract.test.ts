import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import postcss from "postcss";
import { describe, expect, it } from "vitest";

/**
 * YD8 sözleşmesi: herkese açık sayfalar panel CSS'ini indirmez.
 *  - console-effects.css (yalnız /app ve /admin layout'larının yüklediği console-base.css zincirinin İLK dosyası) yalnız
 *    panel bileşenlerinde kullanılan sınıfları tanımlar; aynı sınıf herkese açık bir dosyada kullanılırsa kural kök
 *    globals.css'e geri taşınmalıdır (aksi halde o sayfada stil kaybolur).
 *  - Kök globals.css bu sınıfları ve kaldırılan ölü sınıfları yeniden tanımlamaz.
 */
const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

const PANEL_DIRS = ["src/app/app/", "src/app/admin/", "src/app/(admin-parola)/", "src/components/app/", "src/components/admin/"];

function sourceFiles(dir: string): string[] {
  return readdirSync(join(ROOT, dir), { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return sourceFiles(p);
    return /\.(tsx?|mjs)$/.test(e.name) && !/\.test\./.test(e.name) ? [relative(ROOT, join(ROOT, p)).replaceAll("\\", "/")] : [];
  });
}

function classSelectors(css: string): Set<string> {
  const out = new Set<string>();
  postcss.parse(css).walkRules((r) => {
    if (r.parent?.type === "atrule" && /keyframes/.test((r.parent as postcss.AtRule).name)) return;
    for (const m of r.selector.matchAll(/\.(-?[a-zA-Z_][\w-]*)/g)) out.add(m[1]!);
  });
  return out;
}

const PANEL_ONLY = classSelectors(read("src/app/console-effects.css"));

describe("panel CSS ayrımı", () => {
  it("console-base.css zincirinin ilk dosyası console-effects.css (eski kaskad sırası: globals → konsol)", () => {
    const imports = [...read("src/app/console-base.css").matchAll(/@import\s+"([^"]+)"/g)].map((m) => m[1]);
    expect(imports[0]).toBe("./console-effects.css");
  });

  it("panel efekt sınıfları yalnız panel dosyalarında kullanılır", () => {
    expect(PANEL_ONLY.size).toBeGreaterThan(5);
    const files = sourceFiles("src").filter((f) => !PANEL_DIRS.some((d) => f.startsWith(d)));
    const leaks: string[] = [];
    for (const f of files) {
      const text = read(f);
      for (const cls of PANEL_ONLY) {
        if (new RegExp(`(?<![\\w-])${cls}(?![\\w-])`).test(text)) leaks.push(`${f}: .${cls}`);
      }
    }
    expect(leaks).toEqual([]);
  });

  it("kök globals.css panel efektlerini ve kaldırılan ölü sınıfları yeniden tanımlamaz", () => {
    const globals = classSelectors(read("src/app/globals.css"));
    for (const cls of PANEL_ONLY) expect(globals.has(cls), `.${cls}`).toBe(false);
    const dead = [
      "grad-hairline", "text-gradient", "grad-border", "marquee", "reveal-scale", "path-draw", "premium-shadow", "glow-conic",
      "noise", "window-chrome", "lift-lg", "ring-anim", "dropdown-in", "photo-stage", "hero-lux", "hero-aurora", "premium-ring",
      "property-card", "workflow-card", "faq-card", "footer-premium", "kpi-glow", "kpi-chip-shine", "sda-title", "cq-panel",
      "surface-mesh", "ring-glow-brand", "anim-pop", "anim-d1", "type-display", "hero-gradient-text",
    ];
    for (const cls of dead) expect(globals.has(cls), `.${cls}`).toBe(false);
  });
});
