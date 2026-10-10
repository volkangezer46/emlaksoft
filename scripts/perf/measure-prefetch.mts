// Tam önceden yükleme + önbellekten gösterim ölçümü (salt-okunur): demo sahip oturumu.
// 1) /app'te DWELL sn bekler (boşta tam önceden yükleme çalışsın); bu sürede RSC isteği sayısı ve sunucu süresi (prefetch başına) raporlanır.
// 2) Menü öğelerine sırayla tıklar (arada 1,2 sn): tıklama -> içerik görünür süresi (ms) ve tıklama anından sonraki 300 ms'deki RSC isteği sayısı.
// 3) İkinci tur (tekrar ziyaret) aynısı.
// Çalıştır (Git Bash): MSYS_NO_PATHCONV=1 npx tsx scripts/perf/measure-prefetch.mts [dwellSn=25] [base]
import dotenv from "dotenv";
import { createServerClient } from "@supabase/ssr";
import { chromium, type Request } from "playwright";
import { deriveDemoPassword } from "../../src/lib/demo-credentials.ts";

dotenv.config({ path: ".env.local", quiet: true });
const DWELL = Number(process.argv[2] || 25) * 1000;
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
  window.__arm = (target) => {
    const t0 = performance.now();
    window.__ready = null;
    const check = () => {
      const main = document.querySelector("main") || document.body;
      const skel = [...main.querySelectorAll('[role=status][aria-busy=true]')].find((e) => e.getBoundingClientRect().height >= 400);
      const h = main.querySelector("h1, h2");
      if (location.pathname === target && !skel && h && main.innerText.trim().length > 80) { window.__ready = performance.now() - t0; return; }
      if (performance.now() - t0 > 15000) { window.__ready = -1; return; }
      requestAnimationFrame(check);
    };
    requestAnimationFrame(check);
  };
})();`;

const med = (a: number[]) => {
  const s = [...a].sort((x, y) => x - y);
  return s.length ? s[Math.floor(s.length / 2)] : 0;
};

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.addCookies([...jar].map(([name, value]) => ({ name, value: encodeURIComponent(value), domain: new URL(BASE).hostname, path: "/", secure: BASE.startsWith("https"), httpOnly: false, sameSite: "Lax" as const })));
await ctx.addInitScript(INIT);
const page = await ctx.newPage();

// Tüm RSC isteklerini süreleriyle izle.
type Rsc = { url: string; t: number; ms: number; kb: number; prefetch: boolean };
const rscLog: Rsc[] = [];
const started = new Map<Request, number>();
const t00 = Date.now();
page.on("request", (r) => {
  if (r.headers()["rsc"] === "1") started.set(r, Date.now() - t00);
});
page.on("requestfinished", async (r) => {
  const t = started.get(r);
  if (t === undefined) return;
  const resp = await r.response();
  const body = await resp?.body().catch(() => Buffer.alloc(0));
  rscLog.push({ url: new URL(r.url()).pathname + new URL(r.url()).search, t, ms: Date.now() - t00 - t, kb: (body?.length ?? 0) / 1024, prefetch: Boolean(r.headers()["next-router-prefetch"]) });
});

await page.goto(BASE + "/app", { waitUntil: "load" });
await page.waitForSelector("main h1, main h2", { timeout: 30000 });
await page.waitForSelector("[role=dialog]", { timeout: 6000 }).catch(() => {});
if (await page.locator("[role=dialog]").count()) await page.keyboard.press("Escape");
const dwellStart = Date.now() - t00;
await page.waitForTimeout(DWELL);
const dwelled = rscLog.filter((r) => r.t >= dwellStart - 2000);
for (const r of dwelled) console.log("  dwell", r.url, r.ms, Math.round(r.kb), r.prefetch);
console.log(`bekleme ${DWELL / 1000} sn: ${dwelled.length} RSC isteği (önceden yükleme), sunucu süresi med ${Math.round(med(dwelled.map((r) => r.ms)))} ms, max ${Math.round(Math.max(0, ...dwelled.map((r) => r.ms)))} ms, toplam ${Math.round(dwelled.reduce((a, r) => a + r.kb, 0))} KB`);

const hrefs = await page.$$eval("aside a[data-nav-link]", (as) => [...new Set(as.map((a) => a.getAttribute("href") ?? ""))].filter((h) => h && h !== "/app"));
console.log(`${hrefs.length} menü öğesi`);

const rows: { pass: number; href: string; ready: number; reqs: number }[] = [];
for (let pass = 1; pass <= 2; pass++) {
  for (const href of hrefs) {
    const link = page.locator(`aside a[data-nav-link][href="${href}"]`).first();
    if (!(await link.isVisible().catch(() => false))) continue;
    if (await page.locator("[role=dialog]").count()) await page.keyboard.press("Escape");
    await page.waitForTimeout(1200);
    const before = rscLog.length + started.size;
    const tClick = Date.now() - t00;
    await page.evaluate((t) => (window as unknown as { __arm: (t: string) => void }).__arm(t), href);
    await link.click();
    await page.waitForFunction(() => (window as unknown as { __ready: number | null }).__ready != null, null, { timeout: 20000 }).catch(() => {});
    const ready = await page.evaluate(() => (window as unknown as { __ready: number | null }).__ready);
    const reqs = [...rscLog, ...[...started.entries()].map(([r, t]) => ({ t, url: r.url() }))].filter((r) => r.t >= tClick && r.t <= tClick + 300).length;
    rows.push({ pass, href, ready: Math.round(ready ?? -1), reqs });
    void before;
  }
}
for (const pass of [1, 2]) {
  const r = rows.filter((x) => x.pass === pass);
  console.log(`tur ${pass} (${pass === 1 ? "ilk ziyaret" : "tekrar ziyaret"}): içerik med ${med(r.map((x) => x.ready))} ms, max ${Math.max(...r.map((x) => x.ready))} ms | tıklama anı ilk 300 ms RSC isteği toplam ${r.reduce((a, x) => a + x.reqs, 0)}`);
  console.log("  " + r.map((x) => `${x.href.replace("/app/", "")}:${x.ready}`).join("  "));
}
await browser.close();
