/**
 * Konsol CSS paketine (console-base.css) tasinan dosyalardaki hangi seciciler public sayfalarda ESLESIYOR?
 * Kullanim: npx tsx scripts/perf/moved-selectors.mts http://localhost:3100 /yol1 /yol2 ...
 */
import { readFileSync } from "node:fs";
import postcss from "postcss";
import { chromium } from "playwright";

const base = process.argv[2]!;
const paths = process.argv.slice(3);
const files = ["premium", "viz", "list-page", "console-kit", "themes", "theme-dark"].map((f) => `src/app/${f}.css`);
const sels = new Map<string, string>();
for (const f of files) {
  const root = postcss.parse(readFileSync(f, "utf8"));
  root.walkRules((r) => {
    if (r.parent && r.parent.type === "atrule" && /keyframes/.test((r.parent as postcss.AtRule).name)) return;
    for (const s of r.selectors) {
      // durum/pseudo eleman ve koyu tema oznitelikleri atilir: yalnizca yapisal eslesme aranir
      if (/data-theme|data-accent|data-density/.test(s)) continue;
      const clean = s.replace(/::?[a-z-]+(\([^)]*\))?/gi, "").trim();
      if (clean && !sels.has(clean)) sels.set(clean, f);
    }
  });
}
const browser = await chromium.launch();
const hit = new Map<string, Set<string>>();
for (const p of paths) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(base + p, { waitUntil: "load", timeout: 90000 });
  await page.waitForTimeout(1500);
  const res = await page.evaluate((list) => {
    const out: string[] = [];
    for (const s of list) {
      try {
        if (document.querySelector(s)) out.push(s);
      } catch { /* gecersiz */ }
    }
    return out;
  }, [...sels.keys()]);
  for (const s of res) (hit.get(s) ?? hit.set(s, new Set()).get(s)!).add(p);
  await page.close();
}
await browser.close();
for (const [s, ps] of hit) console.log(sels.get(s)!.split("/").pop(), "|", s.slice(0, 120), "|", [...ps].join(","));
console.log("toplam secici", sels.size, "eslesen", hit.size);
