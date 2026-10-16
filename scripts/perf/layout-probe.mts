// Mobil/tablet düzen ölçümü (SK11; salt-okunur GET, demo kimlikleri). Yayından önce ve sonra canlıda koşulur.
// Kullanım: npx tsx scripts/perf/layout-probe.mts [BASE=https://emlaksoft.com.tr] [bölüm,bölüm]
// Bölümler: overflow (320/390/768/844x390/1024 scrollWidth), kpi (çip etiket/değer kesişimi), targets (<24 px hedef,
// görev kartı metin genişliği), lcp (Fast 3G + 4x CPU, 390 px; LCP ve TBT), html (çözülmüş HTML boyutu).
// Ortam: ENV_FILE (varsayılan .env.production) → NEXT_PUBLIC_SUPABASE_URL/ANON_KEY + DEMO_LOGIN_SECRET.
import dotenv from "dotenv";
import { createServerClient } from "@supabase/ssr";
import { chromium, type BrowserContext } from "playwright";
import { deriveDemoPassword } from "../../src/lib/demo-credentials.ts";

dotenv.config({ path: process.env.ENV_FILE || ".env.production", quiet: true });
const BASE = (process.argv[2] || "https://emlaksoft.com.tr").replace(/\/$/, "");
const PARTS = new Set((process.argv[3] || "overflow,kpi,targets,lcp,html").split(","));
const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const secret = process.env.DEMO_LOGIN_SECRET?.trim() || process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || "";
const pw = (email: string) => deriveDemoPassword(secret, email);

async function login(email: string) {
  const jar = new Map<string, string>();
  const sb = createServerClient(url, anon, {
    cookies: { getAll: () => [...jar].map(([name, value]) => ({ name, value })), setAll: (cs) => cs.forEach(({ name, value }) => jar.set(name, value)) },
  });
  const { error } = await sb.auth.signInWithPassword({ email, password: pw(email) });
  if (error) throw new Error(`giriş ${email}: ${error.message}`);
  return jar;
}
const host = new URL(BASE).hostname;
function cookiesFor(jar: Map<string, string>) {
  return [...jar].map(([name, value]) => ({ name, value: encodeURIComponent(value), domain: host, path: "/", sameSite: "Lax" as const, secure: BASE.startsWith("https") }));
}
const owner = await login("sahip@demo.emlaksoft.test");
const admin = await login("admin@demo.emlaksoft.test");
const browser = await chromium.launch();

const APP = ["/app", "/app/musteriler", "/app/portfoyler", "/app/randevular", "/app/raporlar", "/app/anlasmalar", "/app/gorevler", "/app/ekip", "/app/finans"];
const ADM = ["/admin", "/admin/tenants"];
const VPS = [
  { width: 320, height: 700 },
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 844, height: 390 },
  { width: 1024, height: 768 },
];

async function ctxFor(jar: Map<string, string>, vp: { width: number; height: number }, touch: boolean): Promise<BrowserContext> {
  const ctx = await browser.newContext({ viewport: vp, hasTouch: touch, isMobile: touch, deviceScaleFactor: touch ? 2 : 1, locale: "tr-TR" });
  await ctx.addCookies(cookiesFor(jar));
  return ctx;
}
async function settle(page: import("playwright").Page, path: string) {
  await page.goto(BASE + path, { waitUntil: "load", timeout: 60_000 });
  await page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => undefined);
  await page.waitForTimeout(600);
}

if (PARTS.has("overflow") || PARTS.has("kpi")) {
  for (const vp of VPS) {
    const touch = vp.width < 1024;
    for (const [jar, routes] of [[owner, APP], [admin, ADM]] as const) {
      const ctx = await ctxFor(jar, vp, touch);
      const page = await ctx.newPage();
      for (const r of routes) {
        try {
          await settle(page, r);
          const res = await page.evaluate((vpw: number) => {
            // Mobil öykünmede layout viewport içeriğe göre genişler (innerWidth 347 olur): ölçüt yapılandırılan genişlik.
            const iw = Math.min(vpw, document.documentElement.clientWidth || vpw);
            const sw = document.documentElement.scrollWidth;
            const off: string[] = [];
            if (sw > iw) {
              const all = [...document.querySelectorAll<HTMLElement>("body *")];
              const cands = all
                .map((el) => ({ el, r: el.getBoundingClientRect() }))
                .filter((x) => x.r.right > iw + 1 && x.r.width > 0)
                .sort((a, b) => b.r.right - a.r.right)
                .slice(0, 3);
              for (const c of cands) off.push(`${c.el.tagName.toLowerCase()}.${String(c.el.className).slice(0, 50)}@${Math.round(c.r.right)}`);
            }
            const kpi = [...document.querySelectorAll<HTMLElement>(".kpi-compact .pm-card")].filter((c) => c.getBoundingClientRect().width > 0);
            let overlaps = 0;
            for (const c of kpi) {
              const t = c.querySelector(".pm-card-title")?.getBoundingClientRect();
              const v = c.querySelector(".pm-value")?.getBoundingClientRect();
              if (!t || !v || !t.width || !v.width) continue;
              const vert = Math.min(t.bottom, v.bottom) - Math.max(t.top, v.top);
              const horiz = Math.min(t.right, v.right) - Math.max(t.left, v.left);
              if (vert > 0 && horiz > 0) overlaps++;
            }
            return { iw, sw, off, kpi: kpi.length, overlaps, url: location.pathname };
          }, vp.width);
          console.log(`${vp.width}x${vp.height} ${r} -> ${res.url} | sw=${res.sw} iw=${res.iw} ${res.sw > res.iw ? "TAŞMA " + res.off.join(" ; ") : "ok"} | kpi ${res.kpi} çakışan ${res.overlaps}`);
        } catch (e) {
          console.log(`${vp.width}x${vp.height} ${r} HATA ${(e as Error).message.slice(0, 80)}`);
        }
      }
      await ctx.close();
    }
  }
}

if (PARTS.has("targets")) {
  const ctx = await ctxFor(owner, { width: 390, height: 844 }, true);
  const page = await ctx.newPage();
  for (const r of ["/app/anlasmalar", "/app/gorevler"]) {
    await settle(page, r);
    const small = await page.evaluate(() => {
      const out: string[] = [];
      const els = document.querySelectorAll<HTMLElement>('main a[href], main button, main summary, main select, main input:not([type="hidden"]), main [role="button"], main [tabindex]:not([tabindex="-1"])');
      for (const el of els) {
        let t: HTMLElement = el;
        if (el instanceof HTMLInputElement && (el.type === "checkbox" || el.type === "radio")) t = el.closest("label") ?? el;
        const rc = t.getBoundingClientRect();
        if (rc.width <= 1 || rc.height <= 1) continue;
        const st = getComputedStyle(t);
        if (st.visibility === "hidden" || st.display === "none" || st.opacity === "0") continue;
        if (rc.width < 24 || rc.height < 24) out.push(`${t.tagName.toLowerCase()}:${(t.getAttribute("aria-label") ?? t.textContent ?? "").trim().slice(0, 24)}:${Math.round(rc.width)}x${Math.round(rc.height)}`);
      }
      return out;
    });
    console.log(`hedef<24 ${r}: ${small.length} ${(process.env.FULL ? small : small.slice(0, 8)).join(" | ")}`);
  }
  // Görev kartı metin sütunu genişliği + belge yüksekliği
  await settle(page, "/app/gorevler");
  const g = await page.evaluate(() => {
    const cards = [...document.querySelectorAll<HTMLElement>("[data-task-card]")];
    const w = cards.slice(0, 5).map((c) => Math.round(c.querySelector<HTMLElement>("[data-task-text]")?.getBoundingClientRect().width ?? -1));
    return { n: cards.length, w, h: document.documentElement.scrollHeight };
  });
  console.log(`gorevler kart=${g.n} metin genişliği=${g.w.join(",")} belge yüksekliği=${g.h}`);
  await ctx.close();
}

if (PARTS.has("lcp")) {
  for (const r of ["/app/randevular", "/app/musteriler"]) {
    const lcps: number[] = [];
    const tbts: number[] = [];
    for (let i = 0; i < 3; i++) {
      const ctx = await ctxFor(owner, { width: 390, height: 844 }, true);
      const page = await ctx.newPage();
      const cdp = await ctx.newCDPSession(page);
      await cdp.send("Network.enable");
      await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 562.5, downloadThroughput: (1.6 * 1024 * 1024 * 0.9) / 8, uploadThroughput: (750 * 1024 * 0.9) / 8 });
      await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
      await page.addInitScript(() => {
        (window as unknown as { __lcp: number; __lt: { s: number; d: number }[] }).__lcp = 0;
        (window as unknown as { __lt: { s: number; d: number }[] }).__lt = [];
        new PerformanceObserver((l) => {
          for (const e of l.getEntries()) (window as unknown as { __lcp: number }).__lcp = e.startTime;
        }).observe({ type: "largest-contentful-paint", buffered: true });
        new PerformanceObserver((l) => {
          for (const e of l.getEntries()) (window as unknown as { __lt: { s: number; d: number }[] }).__lt.push({ s: e.startTime, d: e.duration });
        }).observe({ type: "longtask", buffered: true });
      });
      await page.goto(BASE + r, { waitUntil: "load", timeout: 120_000 });
      await page.waitForTimeout(5000);
      const m = await page.evaluate(() => {
        const w = window as unknown as { __lcp: number; __lt: { s: number; d: number }[] };
        const fcp = performance.getEntriesByName("first-contentful-paint")[0]?.startTime ?? 0;
        const tbt = w.__lt.filter((t) => t.s >= fcp).reduce((a, t) => a + Math.max(0, t.d - 50), 0);
        return { lcp: Math.round(w.__lcp), tbt: Math.round(tbt) };
      });
      lcps.push(m.lcp);
      tbts.push(m.tbt);
      await ctx.close();
    }
    const med = (a: number[]) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
    console.log(`LCP Fast3G+4xCPU ${r}: ${lcps.join("/")} medyan ${med(lcps)} | TBT ${tbts.join("/")} medyan ${med(tbts)}`);
  }
}

if (PARTS.has("html")) {
  const cookie = [...owner].map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("; ");
  for (const r of ["/app/musteriler", "/app/randevular", "/app/portfoyler"]) {
    const sizes: number[] = [];
    for (let i = 0; i < 2; i++) {
      const res = await fetch(BASE + r, { headers: { cookie, "user-agent": "emlaksoft-perf-probe" }, redirect: "manual" });
      sizes.push(Buffer.byteLength(await res.text()));
    }
    console.log(`HTML ${r}: ${sizes.join("/")} bayt`);
  }
}
await browser.close();
