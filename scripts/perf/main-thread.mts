// Gezinme ana is parcacigi maliyeti: tik -> hazir; CDP TaskDuration farki, long task listesi, ilk tepki.
// Calistir: PERF_BASE=http://localhost:3217 MSYS_NO_PATHCONV=1 npx tsx scripts/perf/main-thread.mts /app/musteriler /app/portfoy ...
import dotenv from "dotenv";
import { createServerClient } from "@supabase/ssr";
import { chromium } from "playwright";
import { deriveDemoPassword } from "../../src/lib/demo-credentials.ts";

dotenv.config({ path: ".env.local", quiet: true });
const BASE = process.env.PERF_BASE || "http://localhost:3217";
const targets = process.argv.slice(2).length ? process.argv.slice(2) : ["/app/musteriler", "/app/portfoy", "/app/talepler", "/app/randevular"];
const email = "sahip@demo.emlaksoft.test";
const jar = new Map<string, string>();
const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anon = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const secret = process.env.DEMO_LOGIN_SECRET?.trim() || process.env.SUPABASE_SECRET_KEY?.trim() || process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || "";
const sb = createServerClient(url, anon, { cookies: { getAll: () => [...jar].map(([name, value]) => ({ name, value })), setAll: (cs) => cs.forEach(({ name, value }) => jar.set(name, value)) } });
const { error } = await sb.auth.signInWithPassword({ email, password: deriveDemoPassword(secret, email) });
if (error) {
  console.error("giris:", error.message);
  process.exit(1);
}
const INIT = `(() => { window.__lts = []; window.__fb = null; window.__t0 = 0;
 try { new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__lts.push(Math.round(e.duration)); }).observe({ type: "longtask", buffered: true }); } catch {}
 document.addEventListener("pointerdown", () => { window.__t0 = performance.now(); window.__fb = null; requestAnimationFrame(() => requestAnimationFrame(() => { window.__fb = performance.now() - window.__t0; })); }, true);
})();`;
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.addCookies([...jar].map(([name, value]) => ({ name, value: encodeURIComponent(value), domain: new URL(BASE).hostname, path: "/", secure: BASE.startsWith("https"), httpOnly: false, sameSite: "Lax" as const })));
await ctx.addInitScript(INIT);
const page = await ctx.newPage();
await page.goto(BASE + "/app", { waitUntil: "load" });
await page.waitForSelector("main h1, main h2", { timeout: 30000 });
await page.waitForSelector("[role=dialog]", { timeout: 8000 }).catch(() => {});
if (await page.locator("[role=dialog]").count()) await page.keyboard.press("Escape");
await page.evaluate(() => document.querySelectorAll<HTMLElement>("aside button[aria-expanded=false]:not([aria-haspopup])").forEach((b) => b.click()));
if (process.env.PERF_CSS) await page.addStyleTag({ content: process.env.PERF_CSS });
await page.waitForTimeout(3500);
const cdp = await ctx.newCDPSession(page);
await cdp.send("Performance.enable");
const metric = async () => {
  const { metrics } = (await cdp.send("Performance.getMetrics")) as { metrics: { name: string; value: number }[] };
  const g = (n: string) => metrics.find((m) => m.name === n)?.value ?? 0;
  return { task: g("TaskDuration"), script: g("ScriptDuration"), layout: g("LayoutDuration"), style: g("RecalcStyleDuration") };
};
console.log("hedef | anaIsParcacigi ms | script | layout | style | uzun gorevler | ilk tepki ms");
{ const a = await metric(); await page.waitForTimeout(2500); const b = await metric(); console.log("bosta 2.5s:", Math.round((b.task-a.task)*1000), "style", Math.round((b.style-a.style)*1000), "script", Math.round((b.script-a.script)*1000)); }
for (const t of targets) {
  for (const dir of ["tik", "geri"] as const) {
    await page.evaluate(() => {
      (window as unknown as { __lts: number[] }).__lts = [];
    });
    const a = await metric();
    if (dir === "tik") {
      await page.locator(`aside a[data-nav-link][href="${t}"]`).first().click();
      await page.waitForURL("**" + t);
    } else {
      await page.goBack();
      await page.waitForURL("**/app");
    }
    await page.waitForTimeout(2500);
    const b = await metric();
    const r = await page.evaluate(() => ({ lts: (window as unknown as { __lts: number[] }).__lts, fb: (window as unknown as { __fb: number | null }).__fb }));
    const f = (x: number, y: number) => Math.round((y - x) * 1000);
    console.log(`${dir} ${t} | ${f(a.task, b.task)} | ${f(a.script, b.script)} | ${f(a.layout, b.layout)} | ${f(a.style, b.style)} | [${r.lts.join(",")}] | ${r.fb == null ? "-" : Math.round(r.fb)}`);
  }
}
await browser.close();
