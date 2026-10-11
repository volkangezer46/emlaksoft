// Liste sayfalarında DOM düğüm sayısı + satır sayısı (tek kullanıcı, istekler arası ≥1 sn).
// Çalıştır: PERF_BASE=http://localhost:3217 MSYS_NO_PATHCONV=1 npx tsx scripts/perf/dom-count.mts /app/musteriler /app/portfoyler
import dotenv from "dotenv";
import { createServerClient } from "@supabase/ssr";
import { chromium } from "playwright";
import { deriveDemoPassword } from "../../src/lib/demo-credentials.ts";

dotenv.config({ path: ".env.local", quiet: true });
const BASE = process.env.PERF_BASE || "http://localhost:3217";
const targets = process.argv.slice(2);
const email = "sahip@demo.emlaksoft.test";
const jar = new Map<string, string>();
const secret = process.env.DEMO_LOGIN_SECRET?.trim() || process.env.SUPABASE_SECRET_KEY?.trim() || process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || "";
const sb = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
  cookies: { getAll: () => [...jar].map(([name, value]) => ({ name, value })), setAll: (cs) => cs.forEach(({ name, value }) => jar.set(name, value)) },
});
const { error } = await sb.auth.signInWithPassword({ email, password: deriveDemoPassword(secret, email) });
if (error) {
  console.error("giris:", error.message);
  process.exit(1);
}
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.addCookies([...jar].map(([name, value]) => ({ name, value: encodeURIComponent(value), domain: new URL(BASE).hostname, path: "/", secure: BASE.startsWith("https"), httpOnly: false, sameSite: "Lax" as const })));
const page = await ctx.newPage();
console.log("sayfa | DOM düğümü | tr | li | HTML KB | liste-hazır ms | yükleme-bitti ms");
for (const t of targets) {
  await page.waitForTimeout(1000);
  // Akış ölçümü: ilk liste satırı (tablo/kart) ne zaman DOM'a girdi, belge ne zaman tamamen yüklendi.
  const t0 = performance.now();
  const res = await page.goto(BASE + t, { waitUntil: "commit" });
  await page.waitForSelector("main tbody tr, main li a[href*='/app/']", { state: "attached", timeout: 30000 }).catch(() => {});
  const tList = Math.round(performance.now() - t0);
  await page.waitForLoadState("load");
  const tLoad = Math.round(performance.now() - t0);
  await page.waitForTimeout(1500);
  const n = await page.evaluate(() => ({ all: document.querySelectorAll("*").length, tr: document.querySelectorAll("main tbody tr").length, li: document.querySelectorAll("main li").length }));
  const kb = Math.round(((await res?.body())?.byteLength ?? 0) / 1024);
  console.log(`${t} | ${n.all} | ${n.tr} | ${n.li} | ${kb} | ${tList} | ${tLoad}`);
}
await browser.close();
