// Secici istatistigi: stil yeniden hesabinda en pahalı CSS secicileri (tik sonrasi). Calistir: PERF_BASE=... npx tsx scripts/perf/selector-stats.mts /app/talepler
// (eski aciklama) Gezinme izi: tik sonrasi 3 sn icinde ana is parcacigi olaylarinin (UpdateLayoutTree, Layout, FunctionCall...) toplam sureleri.
// Calistir: PERF_BASE=http://localhost:3217 MSYS_NO_PATHCONV=1 npx tsx scripts/perf/trace-nav.mts /app/talepler
import dotenv from "dotenv";
import { createServerClient } from "@supabase/ssr";
import { chromium } from "playwright";
import { deriveDemoPassword } from "../../src/lib/demo-credentials.ts";

dotenv.config({ path: ".env.local", quiet: true });
const BASE = process.env.PERF_BASE || "http://localhost:3217";
const target = process.argv[2] || "/app/talepler";
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
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: process.env.PERF_RM ? "reduce" : "no-preference" });
await ctx.addCookies([...jar].map(([name, value]) => ({ name, value: encodeURIComponent(value), domain: new URL(BASE).hostname, path: "/", secure: BASE.startsWith("https"), httpOnly: false, sameSite: "Lax" as const })));
const page = await ctx.newPage();
await page.goto(BASE + "/app", { waitUntil: "load" });
await page.waitForSelector("main h1, main h2", { timeout: 30000 });
await page.waitForSelector("[role=dialog]", { timeout: 8000 }).catch(() => {});
if (await page.locator("[role=dialog]").count()) await page.keyboard.press("Escape");
await page.evaluate(() => document.querySelectorAll<HTMLElement>("aside button[aria-expanded=false]:not([aria-haspopup])").forEach((b) => b.click()));
if (process.env.PERF_CSS) await page.addStyleTag({ content: process.env.PERF_CSS });
await page.waitForTimeout(3500);
const cdp = await ctx.newCDPSession(page);
type Ev = { name: string; ph: string; dur?: number; ts: number; args?: Record<string, unknown> };
const events: Ev[] = [];
cdp.on("Tracing.dataCollected", (d: { value: Ev[] }) => events.push(...d.value));
await cdp.send("Tracing.start", { traceConfig: { includedCategories: ["devtools.timeline", "disabled-by-default-blink.debug"], excludedCategories: ["*"] } } as never);
await page.locator(`aside a[data-nav-link][href="${target}"]`).first().click();
await page.waitForURL("**" + target);
await page.waitForTimeout(Number(process.env.PERF_AT || 4500));
const done = new Promise((r) => cdp.once("Tracing.tracingComplete", r));
await cdp.send("Tracing.end");
await done;
type Sel = { selector: string; style_sheet_id?: string; elapsed?: number; "elapsed(us)"?: number; fast_reject_count: number; match_attempts: number; match_count: number };
const agg = new Map<string, { ms: number; attempts: number; matches: number }>();
for (const e of events) {
  const st = (e.args as { selector_stats?: { selector_timings?: Sel[] } } | undefined)?.selector_stats?.selector_timings;
  if (!st) continue;
  for (const t of st) {
    const a = agg.get(t.selector) ?? { ms: 0, attempts: 0, matches: 0 };
    a.ms += (t.elapsed ?? (t as Record<string, number>)["elapsed(us)"] ?? (t as Record<string, number>)["elapsed (us)"] ?? 0) / 1e3; a.attempts += t.match_attempts; a.matches += t.match_count;
    agg.set(t.selector, a);
  }
}
console.log("UpdateLayoutTree toplam:", Math.round(events.filter((e) => e.name === "UpdateLayoutTree").reduce((a, e) => a + (e.dur ?? 0), 0) / 1000), "ms; secici kaydi:", agg.size);
console.log([...agg].sort((a, b) => b[1].ms - a[1].ms).slice(0, 25).map(([k, v]) => `${v.ms.toFixed(1)} ms  deneme=${v.attempts} eslesme=${v.matches}  ${k.slice(0, 140)}`).join(String.fromCharCode(10)));
await browser.close();
