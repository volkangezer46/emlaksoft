// Canlı UI/responsive tarayıcı (salt-okunur GET). Çalıştır (Git Bash):
//   MSYS_NO_PATHCONV=1 npx tsx scripts/perf/ui-scan.mts [demo-email] [çıktı.json] [yol,yol...]
// Ortam: BASE, WIDTHS="360,390,768", THEMES="light,dark", CONC=4, SHOTS=<klasör> (sorunlu sayfa ekran görüntüsü).
// Ölçer: belge/öğe yatay taşması, kesilen metin, 44px altı dokunma hedefi (<768), üst üste binen sabit öğeler,
// 2+ sekme şeridi, mobilde tablo.
import dotenv from "dotenv";
import { readdirSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "@playwright/test";
import { createServerClient } from "@supabase/ssr";
import { deriveDemoPassword } from "../../src/lib/demo-credentials.ts";

dotenv.config({ path: ".env.local", quiet: true });
const BASE = process.env.BASE || "https://emlaksoft.vercel.app";
const email = process.argv[2] || "sahip@demo.emlaksoft.test";
const outFile = process.argv[3] || "ui-scan.json";
const only = process.argv[4]?.split(",");
const WIDTHS = (process.env.WIDTHS || "360,390,768").split(",").map(Number);
const THEMES = (process.env.THEMES || "light,dark").split(",");
const CONC = Number(process.env.CONC || 4);
const SHOTS = process.env.SHOTS;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

const jar = new Map<string, string>();
const supabase = createServerClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  { cookies: { getAll: () => [...jar].map(([name, value]) => ({ name, value })), setAll: (cs) => cs.forEach(({ name, value }) => jar.set(name, value)) } },
);
const secret = process.env.DEMO_LOGIN_SECRET?.trim() || process.env.SUPABASE_SECRET_KEY?.trim() || process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || "";
const { error } = await supabase.auth.signInWithPassword({ email, password: deriveDemoPassword(secret, email) });
if (error) { console.error("giris hatasi:", error.message); process.exit(1); }
const cookies = [...jar].map(([name, value]) => ({ name, value: encodeURIComponent(value), url: BASE }));
const cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join("; ");

function walk(dir: string, out: string[] = []) {
  for (const n of readdirSync(dir)) {
    const f = join(dir, n);
    if (statSync(f).isDirectory()) { if (!n.includes("[")) walk(f, out); } else if (n === "page.tsx") out.push(f);
  }
  return out;
}
let pages = only ?? walk("src/app/app").map((f) => f.replace(/\\/g, "/").replace("src/app", "").replace(/\/page\.tsx$/, ""));
// Detay sayfaları: liste sayfasındaki ilk kaydın yolu.
if (!only || process.env.DETAILS) {
  for (const base of ["/app/musteriler", "/app/portfoyler", "/app/anlasmalar", "/app/kiralama", "/app/ekip", "/app/talepler", "/app/projeler"]) {
    const html = await (await fetch(BASE + base, { headers: { cookie: cookieHeader }, redirect: "manual" })).text();
    const hit = new RegExp(`${base}/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})`).exec(html);
    if (hit) pages.push(`${base}/${hit[1]}`);
  }
}
pages = [...new Set(pages)].sort();

/** Tarayıcı içinde çalışır: sorun listesi döndürür. */
const PROBE = `(() => {
  const vw = innerWidth, mobile = vw < 768, out = [];
  const vis = (e) => { const r = e.getBoundingClientRect(); const s = getComputedStyle(e); return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none" && +s.opacity > 0.01; };
  const desc = (e) => { const t = (e.getAttribute("aria-label") || e.textContent || "").trim().replace(/\\s+/g, " ").slice(0, 40); return e.tagName.toLowerCase() + (e.id ? "#" + e.id : "") + (typeof e.className === "string" && e.className ? "." + e.className.split(/\\s+/).slice(0, 3).join(".") : "") + (t ? ' "' + t + '"' : ""); };
  const inScroller = (e) => { for (let p = e.parentElement; p && p !== document.body; p = p.parentElement) { const s = getComputedStyle(p); if (/(auto|scroll|hidden|clip)/.test(s.overflowX) && p.scrollWidth > p.clientWidth + 1) return true; if (/(auto|scroll|hidden|clip)/.test(s.overflowX) && p.getBoundingClientRect().width <= vw) return true; } return false; };
  const root = document.documentElement;
  if (root.scrollWidth > vw + 1) out.push({ k: "doc-yatay", d: root.scrollWidth + ">" + vw });
  const seen = new Set();
  for (const e of document.querySelectorAll("main *, header *, nav *")) {
    if (!vis(e)) continue;
    const r = e.getBoundingClientRect();
    if ((r.right > vw + 1 || r.left < -1) && !inScroller(e) && getComputedStyle(e).position !== "fixed") { const d = desc(e); if (!seen.has(d)) { seen.add(d); out.push({ k: "tasma", d }); } }
    const s = getComputedStyle(e);
    if (!e.classList.contains("sr-only") && !e.closest(".sr-only") && /^(BUTTON|A|H1|H2|H3|LABEL|SPAN|P)$/.test(e.tagName) && e.children.length === 0 && e.scrollWidth > e.clientWidth + 1 && /(hidden|clip)/.test(s.overflowX) && s.textOverflow !== "ellipsis" && e.clientWidth > 0) out.push({ k: "kesik-metin", d: desc(e) });
    if (/^H[12]$/.test(e.tagName) && e.scrollHeight > e.clientHeight + 2 && /(hidden|clip)/.test(s.overflowY)) out.push({ k: "kesik-baslik", d: desc(e) });
  }
  if (mobile) {
    const n = new Set();
    for (const e of document.querySelectorAll("a[href],button,[role=button],[role=tab],[role=menuitem],select,input:not([type=hidden]),textarea,summary")) {
      if (!vis(e)) continue;
      if (e.closest("[aria-hidden=true],[hidden],.sr-only,.skip-link")) continue;
      const r = e.getBoundingClientRect();
      if (r.width >= 43.5 && r.height >= 43.5) continue;
      if (e.tagName === "A" && getComputedStyle(e).display === "inline" && e.closest("p,li,td,dd,span")) continue; // metin içi bağlantı
      if (e.tagName === "INPUT" && /(checkbox|radio)/.test(e.type) && (e.closest("label") || e.labels?.length)) { const l = e.closest("label"); if (l) { const lr = l.getBoundingClientRect(); if (lr.height >= 43.5) continue; } }
      if (e.tagName === "A" && /^(\\/|#)/.test(e.getAttribute("href") || "x") === false && !e.textContent.trim()) continue;
      const d = desc(e) + " " + Math.round(r.width) + "x" + Math.round(r.height); if (!n.has(d)) { n.add(d); out.push({ k: "kucuk-hedef", d }); }
    }
  }
  const fixed = [...document.querySelectorAll("body *")].filter((e) => { const s = getComputedStyle(e); return s.position === "fixed" && vis(e) && e.getBoundingClientRect().width > 20; }).filter((e, _, a) => !a.some((o) => o !== e && o.contains(e)));
  for (let i = 0; i < fixed.length; i++) for (let j = i + 1; j < fixed.length; j++) {
    const a = fixed[i].getBoundingClientRect(), b = fixed[j].getBoundingClientRect();
    const ix = Math.min(a.right, b.right) - Math.max(a.left, b.left), iy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
    if (ix > 4 && iy > 4 && !fixed[i].contains(fixed[j]) && !fixed[j].contains(fixed[i])) out.push({ k: "ust-uste", d: desc(fixed[i]) + " <> " + desc(fixed[j]) });
  }
  const strips = [...document.querySelectorAll("main [role=tablist], header [role=tablist]")].filter(vis);
  if (strips.length >= 2) out.push({ k: "cok-serit", d: strips.length + " sekme seridi" });
  if (mobile) for (const t of document.querySelectorAll("main table")) if (vis(t) && t.getBoundingClientRect().width > vw) out.push({ k: "tablo-mobil", d: "tablo " + Math.round(t.getBoundingClientRect().width) + "px" });
  return out;
})()`;

type Issue = { k: string; d: string };
const results: Record<string, Issue[]> = {};
const browser = await chromium.launch();
const combos: Array<[number, string]> = [];
for (const w of WIDTHS) for (const t of THEMES) combos.push([w, t]);
let done = 0;
const total = combos.length * pages.length;
/** Genişlik+tema başına TEK bağlam; sayfalar sırayla gezilir (bağlam açma maliyeti yok), sonuçlar artımlı yazılır. */
async function runCombo([w, t]: [number, string]) {
  const ctx = await browser.newContext({ viewport: { width: w, height: 800 }, hasTouch: w < 768, isMobile: w < 768 });
  await ctx.addCookies(cookies);
  await ctx.addInitScript((th) => { try { localStorage.setItem("es-theme", th); } catch {} }, t);
  const page = await ctx.newPage();
  for (const p of pages) {
    const key = `${p} | ${w} | ${t}`;
    try {
      const res = await page.goto(BASE + p, { waitUntil: "domcontentloaded", timeout: 120000 });
      await page.waitForLoadState("networkidle", { timeout: 4000 }).catch(() => {});
      await page.waitForTimeout(900);
      const status = res?.status() ?? 0;
      const found: Issue[] = status >= 400 ? [{ k: "http", d: String(status) }] : ((await page.evaluate(PROBE)) as Issue[]);
      results[key] = found;
      if (SHOTS && found.length && w !== 768) await page.screenshot({ path: join(SHOTS, `${p.replace(/\W+/g, "_")}_${w}_${t}.png`), fullPage: false }).catch(() => {});
    } catch (e) {
      results[key] = [{ k: "hata", d: (e as Error).message.slice(0, 80) }];
    }
    if (++done % 25 === 0) { writeFileSync(outFile, JSON.stringify(results, null, 1)); console.log("ilerleme", done, "/", total); }
  }
  await ctx.close();
}
let ci = 0;
await Promise.all(Array.from({ length: CONC }, async () => { while (ci < combos.length) await runCombo(combos[ci++]); }));
await browser.close();
writeFileSync(outFile, JSON.stringify(results, null, 1));
const tot: Record<string, number> = {};
for (const v of Object.values(results)) for (const i of v) tot[i.k] = (tot[i.k] || 0) + 1;
console.log("sayfa-ölçüm:", total, "| sorun türü sayıları:", JSON.stringify(tot));
