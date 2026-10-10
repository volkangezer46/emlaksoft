/**
 * /app ana ekran "cift yuklenme" olcumu (canli, salt-okunur). Senaryolar: a dogrudan, b giris sonrasi, c menuden Bugun, d kapsam gecisi.
 * Cikti: ag istekleri (belge/RSC/action/fetch/ws) zaman cizelgesi + 50 ms icerik ornekleme (iskelet/metin/imza) + yanip sonme tespiti.
 * Calistir: MSYS_NO_PATHCONV=1 npx tsx scripts/perf/double-load.mts [email] [a|b|c|d|all]
 */
import dotenv from "dotenv";
import { createServerClient } from "@supabase/ssr";
import { chromium, type Page } from "playwright";
import { deriveDemoPassword } from "../../src/lib/demo-credentials.ts";

dotenv.config({ path: ".env.local", quiet: true });
const BASE = process.env.BASE || "https://emlaksoft.vercel.app";
const email = process.argv[2] || "sahip@demo.emlaksoft.test";
const only = process.env.PAGES ? "none" : process.argv[3] || "all";
const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anon = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const secret = process.env.DEMO_LOGIN_SECRET?.trim() || process.env.SUPABASE_SECRET_KEY?.trim() || process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || "";
const password = deriveDemoPassword(secret, email);

const jar = new Map<string, string>();
const sb = createServerClient(url, anon, {
  cookies: { getAll: () => [...jar].map(([name, value]) => ({ name, value })), setAll: (cs) => cs.forEach(({ name, value }) => jar.set(name, value)) },
});
const { error } = await sb.auth.signInWithPassword({ email, password });
if (error) {
  console.error("giris hatasi", error.message);
  process.exit(1);
}
const host = new URL(BASE).hostname;

const SAMPLER = `(() => {
  if (window.__dbl) return; window.__dbl = 1;
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput && e.value > 0.002) console.log("L|" + Math.round(e.startTime) + "|" + e.value.toFixed(4) + "|" + (e.sources && e.sources[0] && e.sources[0].node ? (e.sources[0].node.className || e.sources[0].node.nodeName).toString().slice(0, 50) : "")); }).observe({ type: "layout-shift", buffered: true }); } catch {}
  setInterval(() => {
    const m = document.querySelector('main') || document.body;
    const skel = m.querySelectorAll('.skeleton,[aria-busy="true"]').length;
    const txt = (m.innerText || '').replace(/\\s+/g,' ').trim();
    let h = 0; for (let i = 0; i < txt.length; i++) h = (h * 31 + txt.charCodeAt(i)) | 0;
    const anim = document.getAnimations().filter((a) => /list-in|motion-fade|motion-page/.test(a.animationName || '') && a.playState === 'running').length;
    console.log('S|' + Math.round(performance.now()) + '|' + skel + '|' + txt.length + '|' + h + '|' + location.pathname + location.search + '|' + anim);
  }, 50);
})();`;

type Ev = { t: number; k: string };
const STATIC = /\/_next\/static|\.(png|jpe?g|svg|webp|woff2?|ico|css|js)(\?|$)/;

async function run(name: string, fn: (page: Page) => Promise<void>, withCookie = true) {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  if (withCookie) await ctx.addCookies([...jar].map(([n, v]) => ({ name: n, value: encodeURIComponent(v), domain: host, path: "/", secure: true, httpOnly: false })));
  await ctx.addInitScript(SAMPLER);
  const page = await ctx.newPage();
  const evs: Ev[] = [];
  let prevAnim = 0;
  const samples: { t: number; skel: number; len: number; h: number; p: string }[] = [];
  const T0 = performance.now();
  const rel = () => Math.round(performance.now() - T0);
  page.on("request", (r) => {
    const u = r.url();
    if (STATIC.test(u) || (!u.startsWith(BASE) && !u.includes("supabase"))) return;
    const h = r.headers();
    const rt = r.resourceType();
    const kind = rt === "document" ? "DOC" : h["rsc"] ? (h["next-router-prefetch"] ? "RSC-prefetch" : "RSC") : h["next-action"] ? "ACTION" : rt;
    const extra = Object.keys(h).filter((x) => /^(rsc|next-|purpose|x-nextjs)/.test(x)).map((x) => `${x}=${String(h[x]).slice(0, 16)}`).join(",");
    evs.push({ t: rel(), k: `${kind} ${r.method()} ${u.replace(BASE, "").slice(0, 110)} [${extra}]` });
  });
  page.on("response", (r) => {
    const u = r.url();
    if (STATIC.test(u) || (!u.startsWith(BASE) && !u.includes("supabase"))) return;
    evs.push({ t: rel(), k: `  <- ${r.status()} ${u.replace(BASE, "").slice(0, 90)}` });
  });
  page.on("websocket", (w) => evs.push({ t: rel(), k: `WS ${w.url().slice(0, 80)}` }));
  page.on("framenavigated", (f) => {
    if (f === page.mainFrame()) evs.push({ t: rel(), k: `NAV ${f.url().replace(BASE, "")}` });
  });
  page.on("console", (m) => {
    const x = m.text();
    if (x.startsWith("S|")) {
      const [, t, s, l, h, p, an] = x.split("|");
      if (Number(an) > 0 && prevAnim === 0) evs.push({ t: rel(), k: `ANIM giris animasyonu basladi (${an} oge)` });
      prevAnim = Number(an);
      samples.push({ t: Number(t), skel: Number(s), len: Number(l), h: Number(h), p });
    } else if (x.startsWith("L|")) evs.push({ t: rel(), k: `LAYOUT-SHIFT ${x.slice(2)}` });
    else evs.push({ t: rel(), k: `CONSOLE ${m.type()} ${x.slice(0, 140)}` });
  });
  const film = process.env.FILM;
  let fi = 0;
  let cdp: Awaited<ReturnType<typeof ctx.newCDPSession>> | null = null;
  if (film) {
    const { mkdirSync, writeFileSync } = await import("node:fs");
    mkdirSync(film, { recursive: true });
    cdp = await ctx.newCDPSession(page);
    cdp.on("Page.screencastFrame", (f: { data: string; sessionId: number }) => {
      writeFileSync(`${film}/${name[0]}-${String(fi++).padStart(3, "0")}-${rel()}ms.jpg`, Buffer.from(f.data, "base64"));
      void cdp!.send("Page.screencastFrameAck", { sessionId: f.sessionId }).catch(() => {});
    });
    await cdp.send("Page.startScreencast", { format: "jpeg", quality: 35, maxWidth: 720, maxHeight: 450, everyNthFrame: 1 });
  }
  // Belge/RSC akis parcalari: sunucu bloklari ne zaman gonderiyor (istemci hidrasyonundan bagimsiz)?
  const net = await ctx.newCDPSession(page);
  await net.send("Network.enable");
  const docIds = new Map<string, string>();
  const chunks: string[] = [];
  net.on("Network.requestWillBeSent", (e: { requestId: string; type?: string; request: { url: string } }) => {
    if (e.type === "Document" || e.request.url.includes("_rsc=")) docIds.set(e.requestId, `${e.type} ${e.request.url.replace(BASE, "").slice(0, 40)}`);
  });
  net.on("Network.dataReceived", (e: { requestId: string; dataLength: number }) => {
    const n = docIds.get(e.requestId);
    if (n && !n.includes("prefetch")) chunks.push(`    ${String(rel()).padStart(5)}ms +${e.dataLength}B ${n}`);
  });
  await fn(page);
  await page.waitForTimeout(6000);
  if (process.env.CHUNKS) {
    console.log("AKIS PARCALARI:");
    for (const c of chunks.slice(0, 80)) console.log(c);
  }
  if (cdp) await cdp.send("Page.stopScreencast").catch(() => {});
  const out: string[] = [];
  let prev: (typeof samples)[number] | null = null;
  let changes = 0;
  let skelReappear = 0;
  let seenContent = false;
  for (const s of samples) {
    if (prev && s.t < prev.t) {
      out.push("  --- yeni belge (sayfa zamani sifirlandi) ---");
      prev = null;
      seenContent = false;
    }
    const contentful = s.len > 200 && s.skel === 0;
    if (prev) {
      if (s.h !== prev.h || s.skel !== prev.skel) {
        out.push(`  t=${s.t}ms skel ${prev.skel}->${s.skel} metin ${prev.len}->${s.len} ${s.p}`);
        changes++;
        if (seenContent && s.skel > prev.skel) skelReappear++;
      }
    } else out.push(`  t=${s.t}ms ILK skel=${s.skel} metin=${s.len} ${s.p}`);
    if (contentful) seenContent = true;
    prev = s;
  }
  console.log(`\n===== ${name} (${email}) =====`);
  console.log("AG:");
  for (const e of evs) console.log(`  ${String(e.t).padStart(5)}ms ${e.k}`);
  console.log("ICERIK DEGISIMLERI:");
  console.log(out.join("\n"));
  const reqCount = evs.filter((e) => !e.k.startsWith("  <-") && !e.k.startsWith("CONSOLE") && !e.k.startsWith("NAV")).length;
  console.log(`OZET: degisim=${changes} icerik-sonrasi-iskelet-geri-geldi=${skelReappear} istek=${reqCount}`);
  await browser.close();
}

if (only === "all" || only === "a") await run("A: dogrudan /app", async (p) => { await p.goto(BASE + "/app", { waitUntil: "commit" }); });
if (only === "all" || only === "b")
  await run(
    "B: giris formu -> /app",
    async (p) => {
      await p.goto(BASE + "/giris", { waitUntil: "load" });
      await p.fill('input[type="email"], input[name="email"]', email);
      await p.fill('input[type="password"]', password);
      await p.waitForTimeout(500);
      await p.click('button[type="submit"]');
      await p.waitForURL(/\/app/, { timeout: 30000 });
    },
    false,
  );
if (only === "all" || only === "c")
  await run("C: menuden Bugun'e donus", async (p) => {
    await p.goto(BASE + "/app/musteriler", { waitUntil: "load" });
    await p.waitForTimeout(3000);
    await p.click('nav a[href="/app"], aside a[href="/app"]');
  });
if (only === "all" || only === "d")
  await run("D: kapsam gecisi", async (p) => {
    await p.goto(BASE + "/app", { waitUntil: "load" });
    await p.waitForTimeout(4000);
    await p.getByRole("button", { name: "Geç" }).click({ timeout: 3000 }).catch(() => {});
    await p.locator("a.scope-opt", { hasText: "Benim işlerim" }).first().click();
    await p.waitForTimeout(3000);
    await p.locator("a.scope-opt", { hasText: "Ofis geneli" }).first().click();
  });
// PAGES=/app/musteriler,/app/portfoyler ...: her sayfa dogrudan acilir; yuk sonrasi ek RSC/refresh istegi var mi?
if (process.env.PAGES) {
  for (const path of process.env.PAGES.split(",")) await run(`P: dogrudan ${path}`, async (p) => { await p.goto(BASE + path, { waitUntil: "commit" }); });
}
