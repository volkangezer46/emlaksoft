/* eslint-disable react/no-children-prop -- .ts test dosyası (vitest yalnız *.test.ts toplar, JSX yok); createElement tip imzası zorunlu children'ı props içinde ister. */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FadeSwap, Reveal, Stagger } from "./index";
import { EASE_OUT, MOTION_MS } from "./tokens";

/**
 * Hareket katmanı sözleşmesi (docs/DESIGN_SYSTEM.md "Hareket katmanı"):
 *  - kütüphanesiz: motion/react ve framer-motion HİÇBİR yerde içe aktarılmaz (CSS + IntersectionObserver; ilk yük JS'i);
 *  - süreler motion.css ile birebir; RiseIn/GrowBar keyframes'i yalnız hareket açıkken tanımlı;
 *  - sunucu çıktısı içeriği GÖRÜNÜR basar (opacity:0 ile gizlenmiş SSR yok).
 */
function files(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) files(full, out);
    else if (/\.(tsx?|mjs)$/.test(name) && !/\.test\.ts$/.test(name)) out.push(full.split("\\").join("/"));
  }
  return out;
}

describe("hareket katmanı", () => {
  it("motion/react ve framer-motion hiçbir yerde içe aktarılmaz (hareket katmanı kütüphanesiz)", () => {
    const bad = files("src").filter((f) => /from\s+["'](motion(\/[^"']*)?|framer-motion[^"']*)["']/.test(readFileSync(f, "utf8")));
    expect(bad).toEqual([]);
  });

  it("RiseIn/GrowBar keyframes motion.css'te ve yalnız hareket açıkken (no-preference) tanımlı", () => {
    const css = readFileSync("src/app/motion.css", "utf8");
    const block = css.slice(css.indexOf("@media (prefers-reduced-motion: no-preference) {\n  @media (hover: hover)"));
    expect(block).toMatch(/@keyframes rise-in \{ from \{ opacity: 0; transform: translateY\(12px\); \} \}/);
    expect(block).toMatch(/@keyframes grow-from-zero \{ from \{ width: 0; \} \}/);
    const grow = readFileSync("src/components/ui/motion/grow.tsx", "utf8");
    expect(grow).toContain("rise-in 320ms");
    expect(grow).toContain("grow-from-zero");
  });

  it("TS süre token'ları motion.css ile aynı", () => {
    const css = readFileSync("src/app/motion.css", "utf8");
    const ms = (t: string) => Number(css.match(new RegExp(`--motion-${t}:\\s*(\\d+)ms`))?.[1]);
    expect(MOTION_MS.fast).toBe(ms("fast"));
    expect(MOTION_MS.base).toBe(ms("base"));
    expect(MOTION_MS.slow).toBe(ms("slow"));
    expect(MOTION_MS.exitBase).toBe(ms("exit-base"));
    expect(MOTION_MS.stagger).toBe(ms("stagger"));
    expect(MOTION_MS.draw).toBe(ms("draw"));
    expect(css).toContain(`--ease-out: cubic-bezier(${EASE_OUT.join(", ")})`);
  });

  it("sunucu çıktısı içeriği görünür basar (Reveal, Stagger, FadeSwap)", () => {
    const html = renderToStaticMarkup(
      createElement("div", null,
        createElement(Reveal, { children: "Görünür A" }),
        createElement(Stagger, { children: [createElement("span", { key: 1 }, "Görünür B"), createElement("span", { key: 2 }, "Görünür C")] }),
        createElement(FadeSwap, { swapKey: 7, children: "Görünür D" }),
      ),
    );
    for (const t of ["Görünür A", "Görünür B", "Görünür C", "Görünür D"]) expect(html).toContain(t);
    // Eski motion/react `initial={false}` çıktısıyla aynı son kare.
    expect(html).toContain('style="opacity:1;transform:none"');
    expect(html).not.toMatch(/opacity:\s*0[;"]/);
  });
});
