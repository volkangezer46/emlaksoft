/**
 * Gorsel regresyon: sayfa ekran goruntuleri (1440 + 390) alir, onceki klasorle piksel farki karsilastirir.
 * Kullanim: npx tsx scripts/perf/shots.mts http://localhost:3100 <cikti-klasoru> [karsilastirilacak-klasor] /yol1 /yol2 ...
 * reducedMotion + animasyonlar kapali: yalnizca CSS kaynakli farklar gorunur.
 */
import { mkdirSync, existsSync } from "node:fs";
import { chromium } from "playwright";
import sharp from "sharp";

const [base, out, cmp, ...rest] = process.argv.slice(2);
const cmpDir = cmp && cmp !== "-" ? cmp : null;
const paths = rest.length ? rest : ["/"];
mkdirSync(out, { recursive: true });
const sizes = [
  { n: "d", width: 1440, height: 900 },
  { n: "m", width: 390, height: 844 },
];
const browser = await chromium.launch();
let bad = 0;
for (const s of sizes) {
  const ctx = await browser.newContext({ viewport: { width: s.width, height: s.height }, reducedMotion: "reduce", deviceScaleFactor: 1 });
  for (const p of paths) {
    const page = await ctx.newPage();
    await page.goto(base + p, { waitUntil: "load", timeout: 90000 });
    await page.waitForTimeout(800);
    await page.addStyleTag({ content: "*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}" });
    // tembel yuklenen bolumleri tetikle
    const h = await page.evaluate(() => document.documentElement.scrollHeight);
    for (let y = 0; y < h; y += 700) {
      await page.evaluate((yy) => window.scrollTo(0, yy), y);
      await page.waitForTimeout(60);
    }
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(500);
    const name = `${p.replace(/[^a-z0-9]+/gi, "_") || "_"}-${s.n}.png`;
    await page.screenshot({ path: `${out}/${name}`, fullPage: true });
    if (cmpDir && existsSync(`${cmpDir}/${name}`)) {
      const a = await sharp(`${cmpDir}/${name}`).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      const b = await sharp(`${out}/${name}`).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      if (a.info.width !== b.info.width || a.info.height !== b.info.height) {
        console.log(`FARK ${name}: boyut ${a.info.width}x${a.info.height} -> ${b.info.width}x${b.info.height}`);
        bad++;
      } else {
        let diff = 0;
        for (let i = 0; i < a.data.length; i += 4) {
          if (Math.abs(a.data[i] - b.data[i]) + Math.abs(a.data[i + 1] - b.data[i + 1]) + Math.abs(a.data[i + 2] - b.data[i + 2]) > 12) diff++;
        }
        const pct = (diff / (a.info.width * a.info.height)) * 100;
        console.log(`${pct > 0.01 ? "FARK" : "ok  "} ${name}: ${diff}px (%${pct.toFixed(3)})`);
        if (pct > 0.01) bad++;
      }
    } else console.log(`kaydedildi ${name}`);
    await page.close();
  }
  await ctx.close();
}
await browser.close();
if (bad) process.exitCode = 1;
