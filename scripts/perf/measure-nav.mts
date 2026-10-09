// Canlı gezinme ölçümü (salt-okunur): demo sahip oturumu, 1440x900, menü tıklama -> iskelet / içerik, geri, sekme, palet.
// Çalıştır (Git Bash): MSYS_NO_PATHCONV=1 npx tsx scripts/perf/measure-nav.mts [tur=3] [base]
import dotenv from "dotenv";
import { createServerClient } from "@supabase/ssr";
import { chromium, type Page, type Response, type Request } from "playwright";
import { deriveDemoPassword } from "../../src/lib/demo-credentials.ts";

dotenv.config({ path: ".env.local", quiet: true });
const ROUNDS = Number(process.argv[2] || 3);
const BASE = process.argv[3] || "https://emlaksoft.vercel.app";
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

const INIT = `(() => {
  window.__lt = 0; window.__cls = 0;
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__lt += e.duration; }).observe({ type: "longtask", buffered: true }); } catch {}
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__cls += e.value; }).observe({ type: "layout-shift", buffered: true }); } catch {}
  // Süre, fare basma anından başlar (Playwright eyleminin kendi gecikmesi sayılmaz).
  document.addEventListener("pointerdown", () => { const m = window.__m; if (m && !m.down) { m.down = true; m.t0 = performance.now(); } }, true);
  window.__arm = (target) => {
    const m = { t0: performance.now(), fb: null, ready: null, target };
    window.__m = m;
    window.__base = new Set([...document.querySelectorAll('[role=status][aria-busy=true]')]);
    const check = () => {
      const now = performance.now();
      const main = document.querySelector("main") || document.body;
      const skel = [...main.querySelectorAll('[role=status][aria-busy=true]')].find((e) => e.getBoundingClientRect().height >= 400 && !window.__base.has(e));
      const pathOk = !target || location.pathname + location.search === target || location.pathname === target;
      const act = target && document.querySelector('a[href="' + target + '"][data-nav-active=true], a[href="' + target + '"][data-nav-pending=true], a[href="' + target + '"][aria-current]');
      if (m.fb == null && (skel || act || (target && pathOk))) m.fb = now - m.t0;
      const h = main.querySelector("h1, h2");
      if (m.ready == null && pathOk && !skel && h && main.innerText.trim().length > 80) { m.ready = now - m.t0; return; }
      if (now - m.t0 > 15000) { m.ready = -1; return; }
      requestAnimationFrame(check);
    };
    requestAnimationFrame(check);
  };
})();`;

type Res = { name: string; fb: number; ready: number; rscMs: number; rscKb: number; reqs: number; jsKb: number; lt: number; cls: number };
const all: Res[] = [];

async function measure(page: Page, name: string, act: () => Promise<void>, target: string | null): Promise<Res> {
  const rsc: { ms: number; kb: number }[] = [];
  let js = 0;
  const onResp = async (r: Response) => {
    try {
      const req = r.request();
      const h = req.headers();
      if (h["rsc"] === "1" && !h["next-router-prefetch"]) {
        const t = req.timing();
        const body = await r.body().catch(() => Buffer.alloc(0));
        rsc.push({ ms: Math.max(0, t.responseEnd), kb: body.length / 1024 });
      } else if (req.resourceType() === "script") {
        js += Number(r.headers()["content-length"] || 0) / 1024;
      }
    } catch {}
  };
  page.on("response", onResp);
  await page.evaluate(() => {
    const w = window as unknown as { __lt: number; __cls: number };
    w.__lt = 0;
    w.__cls = 0;
  });
  await page.evaluate((t) => (window as unknown as { __arm: (t: string | null) => void }).__arm(t), target);
  await act();
  await page.waitForFunction(() => (window as unknown as { __m?: { ready: number | null } }).__m?.ready != null, null, { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(400);
  const m = await page.evaluate(() => {
    const w = window as unknown as { __m: { fb: number | null; ready: number | null }; __lt: number; __cls: number };
    return { fb: w.__m.fb, ready: w.__m.ready, lt: w.__lt, cls: w.__cls };
  });
  page.off("response", onResp);
  if (m.ready == null || m.ready < 0) console.log(`  ! ${name}: hazır olmadı, son adres ${new URL(page.url()).pathname}`);
  const r: Res = {
    name,
    fb: Math.round(m.fb ?? -1),
    ready: Math.round(m.ready ?? -1),
    rscMs: Math.round(rsc.reduce((a, x) => a + x.ms, 0)),
    rscKb: Math.round(rsc.reduce((a, x) => a + x.kb, 0)),
    reqs: rsc.length,
    jsKb: Math.round(js),
    lt: Math.round(m.lt),
    cls: Math.round(m.cls * 1000) / 1000,
  };
  all.push(r);
  return r;
}

const browser = await chromium.launch();
for (let round = 1; round <= ROUNDS; round++) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addCookies([...jar].map(([name, value]) => ({ name, value: encodeURIComponent(value), domain: new URL(BASE).hostname, path: "/", secure: BASE.startsWith("https"), httpOnly: false, sameSite: "Lax" as const })));
  await ctx.addInitScript(INIT);
  if (process.env.PERF_NOVT) await ctx.addInitScript("Object.defineProperty(Document.prototype,'startViewTransition',{value:undefined,configurable:true})");
  const page = await ctx.newPage();
  await page.goto(BASE + "/app", { waitUntil: "load" });
  await page.waitForSelector("main h1, main h2", { timeout: 30000 });
  await page.waitForSelector("[role=dialog]", { timeout: 8000 }).catch(() => {});
  if (await page.locator("[role=dialog]").count()) await page.keyboard.press("Escape");
  await page.evaluate(() => document.querySelectorAll<HTMLElement>("aside button[aria-expanded=false]:not([aria-haspopup])").forEach((b) => b.click()));
  await page.waitForTimeout(3000); // boşta prefetch
  const hrefs = await page.$$eval("aside a[data-nav-link]", (as) => [...new Set(as.map((a) => a.getAttribute("href") ?? ""))].filter((h) => h && h !== "/app")).then((l) => l.slice(0, Number(process.env.PERF_MAX || 99)));
  console.log(`tur ${round}: ${hrefs.length} menü öğesi`);
  for (const href of hrefs) {
    const link = page.locator(`aside a[data-nav-link][href="${href}"]`).first();
    if (!(await link.isVisible())) continue;
    if (await page.locator("[role=dialog]").count()) {
      console.log("  diyalog kapatıldı:", ((await page.locator("[role=dialog]").first().innerText()) || "").slice(0, 60).replace(/\n/g, " "));
      await page.keyboard.press("Escape");
      await page.waitForTimeout(300);
    }
    await measure(page, `tık ${href}`, () => link.click(), href);
    await measure(page, `geri ${href}`, () => page.goBack().then(() => {}), "/app");
  }
  // sekmeler
  for (const base of ["/app/lig", "/app/aidat", "/app/musteriler"]) {
    await page.goto(BASE + base, { waitUntil: "load" });
    await page.waitForSelector("main h1, main h2");
    await page.waitForTimeout(1500);
    if (base === "/app/musteriler") {
      const first = await page.$eval("main a[href^='/app/musteriler/']", (a) => a.getAttribute("href")).catch(() => null);
      if (!first) continue;
      await page.goto(BASE + first, { waitUntil: "load" });
      await page.waitForSelector("main h1, main h2");
      await page.waitForTimeout(1500);
    }
    const tabs = await page.$$eval("main a[href*='sekme=']", (as) => [...new Set(as.map((a) => a.getAttribute("href") ?? ""))].slice(0, 5));
    for (const t of tabs.slice(0, 4)) {
      const l = page.locator(`main a[href="${t}"]`).first();
      if (!(await l.isVisible().catch(() => false))) continue;
      await measure(page, `sekme ${base === "/app/musteriler" ? "musteri-detay" : base} ${t.split("?")[1]}`, () => l.click(), t);
    }
  }
  // palet + menü grup aç/kapa
  await page.goto(BASE + "/app", { waitUntil: "load" });
  await page.waitForSelector("main h1, main h2");
  await page.waitForSelector("[role=dialog]", { timeout: 6000 }).catch(() => {});
  if (await page.locator("[role=dialog]").count()) await page.keyboard.press("Escape");
  await page.waitForTimeout(2000);
  await page.evaluate(() => (window as unknown as { __arm: (t: null) => void }).__arm(null));
  await page.keyboard.press("Control+k");
  const pal = await page.waitForSelector("#app-command-results", { state: "visible", timeout: 8000 }).then(() => true).catch(() => false);
  const palMs = await page.evaluate(() => performance.now() - (window as unknown as { __m: { t0: number } }).__m.t0);
  all.push({ name: "palet Ctrl+K", fb: pal ? Math.round(palMs) : -1, ready: pal ? Math.round(palMs) : -1, rscMs: 0, rscKb: 0, reqs: 0, jsKb: 0, lt: 0, cls: 0 });
  await page.keyboard.press("Escape");
  if (await page.locator("aside button[aria-expanded]").count()) {
    const seen: string[] = [];
    const h = (r: Request) => {
      if (r.headers()["rsc"] === "1") seen.push(r.url());
    };
    page.on("request", h);
    const ms = await page.evaluate(async () => {
      const b = document.querySelector("aside button[aria-expanded]") as HTMLElement;
      const t = performance.now();
      b.click();
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      return performance.now() - t;
    });
    await page.waitForTimeout(500);
    page.off("request", h);
    all.push({ name: "menü grup aç/kapa", fb: Math.round(ms), ready: Math.round(ms), rscMs: 0, rscKb: 0, reqs: seen.length, jsKb: 0, lt: 0, cls: 0 });
  }
  await ctx.close();
}
await browser.close();

const by = new Map<string, Res[]>();
for (const r of all) by.set(r.name, [...(by.get(r.name) ?? []), r]);
const med = (a: number[]) => {
  const s = [...a].sort((x, y) => x - y);
  return s[Math.floor(s.length / 2)];
};
const p95 = (a: number[]) => {
  const s = [...a].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.ceil(s.length * 0.95) - 1)];
};
console.log("\nad | geri bildirim ms (med) | içerik ms (med/max) | rsc ms | rsc KB | rsc # | JS KB | long task ms | CLS");
for (const [n, rs] of by) {
  console.log([n, med(rs.map((r) => r.fb)), `${med(rs.map((r) => r.ready))}/${Math.max(...rs.map((r) => r.ready))}`, med(rs.map((r) => r.rscMs)), med(rs.map((r) => r.rscKb)), med(rs.map((r) => r.reqs)), med(rs.map((r) => r.jsKb)), med(rs.map((r) => r.lt)), med(rs.map((r) => r.cls))].join(" | "));
}
const clicks = all.filter((r) => r.name.startsWith("tık"));
const tabs = all.filter((r) => r.name.startsWith("sekme"));
const backs = all.filter((r) => r.name.startsWith("geri"));
console.log(`\nÖZET tık: geri bildirim p95 ${p95(clicks.map((r) => r.fb))} ms, içerik p95 ${p95(clicks.map((r) => r.ready))} ms | geri içerik p95 ${p95(backs.map((r) => r.ready))} | sekme içerik p95 ${p95(tabs.map((r) => r.ready))} ms`);
