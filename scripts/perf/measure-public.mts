/**
 * Public sayfa ilk acilis olcumu (Playwright): HTML boyutu (ham/sikistirilmis), JS aktarimi, FCP, LCP.
 * Kullanim: npx tsx scripts/perf/measure-public.mts http://localhost:3100 / /giris /kayit /fiyatlar
 * Not: yerelde sikistirma next start tarafindan gzip ile yapilir; canlida brotli. 4G benzeri kisitlama uygulanir.
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
  await cdp.send("Network.emulateNetworkConditions", {
    offline: false,
    latency: 40,
    downloadThroughput: (10 * 1024 * 1024) / 8,
    uploadThroughput: (5 * 1024 * 1024) / 8,
  });
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  let html = 0;
  let js = 0;
  let jsCount = 0;
  let css = 0;
  let font = 0;
  let img = 0;
  page.on("response", async (res) => {
    const url = res.url();
    const type = res.headers()["content-type"] ?? "";
    const len = Number(res.headers()["content-length"] ?? 0);
    let size = len;
    try { if (!size) size = (await res.body()).length; } catch { /* yok say */ }
    if (type.includes("text/html") && url.startsWith(base)) html = Math.max(html, size);
    else if (type.includes("javascript")) { js += size; jsCount++; }
    else if (type.includes("css")) css += size;
    else if (type.includes("font")) font += size;
    else if (type.includes("image")) img += size;
  });
  // Deney: HTML'e <head> sonuna ek etiket enjekte et (ornek: INJECT='<link rel="preload" as="font" ...>').
  const inject = process.env.INJECT;
  if (inject) {
    await page.route(base + path, async (route) => {
      const res = await route.fetch();
      const body = (await res.text()).replace("</head>", inject + "</head>");
      await route.fulfill({ response: res, body });
    });
  }
  await page.addInitScript(() => {
    (window as unknown as { __m: Record<string, number> }).__m = { lcp: 0, fcp: 0, cls: 0 };
    new PerformanceObserver((l) => {
      const e = l.getEntries();
      (window as unknown as { __m: Record<string, number> }).__m.lcp = e[e.length - 1].startTime;
    }).observe({ type: "largest-contentful-paint", buffered: true });
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) if (e.name === "first-contentful-paint") (window as unknown as { __m: Record<string, number> }).__m.fcp = e.startTime;
    }).observe({ type: "paint", buffered: true });
    new PerformanceObserver((l) => {
      for (const e of l.getEntries() as unknown as { value: number; hadRecentInput: boolean }[]) if (!e.hadRecentInput) (window as unknown as { __m: Record<string, number> }).__m.cls += e.value;
    }).observe({ type: "layout-shift", buffered: true });
  });
  await page.goto(base + path, { waitUntil: "load" });
  await page.waitForTimeout(1500);
  const m = await page.evaluate(() => {
    const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming;
    return { ...(window as unknown as { __m: Record<string, number> }).__m, ttfb: nav.responseStart, dcl: nav.domContentLoadedEventEnd };
  });
  const kb = (n: number) => `${(n / 1024).toFixed(0)}KB`;
  console.log(
    `${path.padEnd(14)} html=${kb(html)} js=${kb(js)}(${jsCount}) css=${kb(css)} font=${kb(font)} img=${kb(img)} ttfb=${m.ttfb.toFixed(0)} fcp=${m.fcp.toFixed(0)} lcp=${m.lcp.toFixed(0)} cls=${m.cls.toFixed(3)} dcl=${m.dcl.toFixed(0)}`,
  );
  await ctx.close();
}
await browser.close();
