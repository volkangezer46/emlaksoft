/** Kaynak zaman cizelgesi (CPU 4x): hangi dosya ne zaman istendi/bitti. Kullanim: npx tsx scripts/perf/resource-timeline.mts <url> */
import { chromium } from "playwright";

const url = process.argv[2] ?? "http://localhost:3100/";
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 } });
const page = await ctx.newPage();
const cdp = await ctx.newCDPSession(page);
await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
await page.goto(url, { waitUntil: "load" });
await page.waitForTimeout(2500);
const rows = await page.evaluate(() => {
  const paints = performance.getEntriesByType("paint").map((p) => `${p.name}=${Math.round(p.startTime)}`);
  const res = (performance.getEntriesByType("resource") as PerformanceResourceTiming[]).map((r) => ({
    n: r.name.replace(location.origin, "").slice(0, 60),
    t: r.initiatorType,
    s: Math.round(r.startTime),
    e: Math.round(r.responseEnd),
  }));
  return { paints, res };
});
console.log(rows.paints.join(" "));
for (const r of rows.res.sort((a, b) => a.s - b.s)) console.log(`${String(r.s).padStart(5)} -> ${String(r.e).padStart(5)} ${r.t.padEnd(8)} ${r.n}`);
await browser.close();
