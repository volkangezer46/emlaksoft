/** LCP ogesi + uzun gorevler (CPU 4x kisitli). Kullanim: npx tsx scripts/perf/lcp-element.mts <url> */
import { chromium } from "playwright";

const url = process.argv[2] ?? "http://localhost:3100/";
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 } });
const page = await ctx.newPage();
const cdp = await ctx.newCDPSession(page);
await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
await page.addInitScript(() => {
  const w = window as unknown as { __l: unknown[]; __t: unknown[] };
  w.__l = [];
  w.__t = [];
  new PerformanceObserver((l) => {
    for (const e of l.getEntries() as unknown as { startTime: number; element?: Element; url: string; size: number }[]) {
      w.__l.push({ t: Math.round(e.startTime), el: e.element ? `${e.element.tagName}.${(e.element as HTMLElement).className}`.slice(0, 80) : "?", url: e.url, size: e.size });
    }
  }).observe({ type: "largest-contentful-paint", buffered: true });
  new PerformanceObserver((l) => {
    for (const e of l.getEntries()) w.__t.push({ s: Math.round(e.startTime), d: Math.round(e.duration) });
  }).observe({ type: "longtask", buffered: true });
});
await page.goto(url, { waitUntil: "load" });
await page.waitForTimeout(2000);
const r = await page.evaluate(() => {
  const w = window as unknown as { __l: unknown[]; __t: { d: number }[] };
  return { lcp: w.__l, long: w.__t, blocking: w.__t.reduce((a, b) => a + Math.max(0, b.d - 50), 0) };
});
console.log(JSON.stringify(r, null, 1));
await browser.close();
