// Gezinme sirasinda getComputedStyle cagrilari (Radix Presence vb.): hangi elemanlar, kac kez.
// Calistir: PERF_BASE=http://localhost:3217 MSYS_NO_PATHCONV=1 npx tsx scripts/perf/gcs-probe.mts /app/musteriler
import dotenv from "dotenv";
import { createServerClient } from "@supabase/ssr";
import { chromium } from "playwright";
import { deriveDemoPassword } from "../../src/lib/demo-credentials.ts";

dotenv.config({ path: ".env.local", quiet: true });
const BASE = process.env.PERF_BASE || "http://localhost:3217";
const target = process.argv[2] || "/app/musteriler";
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
const INIT = `(() => { const o = window.getComputedStyle; window.__gcs = []; window.getComputedStyle = function (el, p) { try { const c = el.className && el.className.baseVal !== undefined ? el.className.baseVal : el.className; window.__gcs.push((el.parentElement ? el.parentElement.tagName + "." + String(el.parentElement.className).slice(0, 40) + " > " : "") + (el.firstElementChild ? el.firstElementChild.tagName + "." + String(el.firstElementChild.className).slice(0, 50) + "/" + (el.firstElementChild.getAttribute("role") || "") + "/" + (el.firstElementChild.getAttribute("data-state") || "") + "/" + (el.textContent || "").slice(0, 60) : "") + "|" + el.tagName + "." + String(c).slice(0, 60) + "[" + (el.getAttribute("data-state") || el.getAttribute("role") || "") + "]"); } catch {} return o.call(this, el, p); }; })();`;
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
await page.waitForTimeout(3500);
await page.evaluate(() => ((window as unknown as { __gcs: string[] }).__gcs = []));
await page.locator(`aside a[data-nav-link][href="${target}"]`).first().click();
await page.waitForURL("**" + target);
await page.waitForTimeout(3000);
const list = await page.evaluate(() => (window as unknown as { __gcs: string[] }).__gcs);
const m = new Map<string, number>();
for (const k of list) m.set(k, (m.get(k) ?? 0) + 1);
console.log("toplam", list.length);
console.log([...m].sort((a, b) => b[1] - a[1]).slice(0, 20).map(([k, v]) => `${v}  ${k}`).join("\n"));
await browser.close();
