/**
 * Pingdom benzeri sayim: istek sayisi, aktarilan (sikistirilmis) bayt, tur bazinda KB, CSS kullanim orani.
 * Kullanim: LIST=1 npx tsx scripts/perf/count-resources.mts http://localhost:3100 / /fiyatlar /giris
 */
import { chromium } from "playwright";

const base = process.argv[2] ?? "http://localhost:3100";
const paths = process.argv.slice(3);
if (paths.length === 0) paths.push("/");
const browser = await chromium.launch();
for (const path of paths) {
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 } });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send("Network.enable");
  await page.coverage.startCSSCoverage();
  const reqs = new Map<string, { url: string; type: string; size: number }>();
  cdp.on("Network.responseReceived", (e) => reqs.set(e.requestId, { url: e.response.url, type: e.type, size: 0 }));
  cdp.on("Network.loadingFinished", (e) => {
    const r = reqs.get(e.requestId);
    if (r) r.size = e.encodedDataLength;
  });
  await page.addInitScript(() => {
    (window as unknown as { __l: number }).__l = 0;
    new PerformanceObserver((l) => {
      const e = l.getEntries();
      (window as unknown as { __l: number }).__l = e[e.length - 1].startTime;
    }).observe({ type: "largest-contentful-paint", buffered: true });
  });
  await page.goto(base + path, { waitUntil: "networkidle" });
  // ekran alti (tembel) kaynaklar da yuklensin: sayfayi sonuna kadar kaydir (Pingdom tam sayfa gibi)
  const full = await page.evaluate(() => document.documentElement.scrollHeight);
  for (let y = 0; y < full; y += 600) {
    await page.evaluate((yy) => window.scrollTo(0, yy), y);
    await page.waitForTimeout(80);
  }
  await page.waitForTimeout(1000);
  const lcp = await page.evaluate(() => (window as unknown as { __l: number }).__l);
  const cov = await page.coverage.stopCSSCoverage();
  let cssTotal = 0;
  let cssUsed = 0;
  for (const c of cov) {
    cssTotal += c.text.length;
    for (const r of c.ranges) cssUsed += r.end - r.start;
  }
  const by: Record<string, { n: number; kb: number }> = {};
  let total = 0;
  for (const r of reqs.values()) {
    by[r.type] ??= { n: 0, kb: 0 };
    by[r.type].n++;
    by[r.type].kb += r.size / 1024;
    total += r.size;
  }
  console.log(`${path}: istek=${reqs.size} toplam=${(total / 1024).toFixed(0)}KB lcp=${lcp.toFixed(0)}ms cssKullanim=${(cssUsed / 1024).toFixed(0)}/${(cssTotal / 1024).toFixed(0)}KB ham`);
  console.log("  " + Object.entries(by).map(([k, v]) => `${k}:${v.n}/${v.kb.toFixed(0)}KB`).join("  "));
  if (process.env.LIST) for (const r of reqs.values()) console.log("   ", r.type, (r.size / 1024).toFixed(1), r.url.replace(base, ""));
  await ctx.close();
}
await browser.close();
