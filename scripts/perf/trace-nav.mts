// Gezinme izi: tik sonrasi 3 sn icinde ana is parcacigi olaylarinin (UpdateLayoutTree, Layout, FunctionCall...) toplam sureleri.
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
await cdp.send("Tracing.start", { traceConfig: { includedCategories: ["devtools.timeline", "disabled-by-default-devtools.timeline", "v8"], excludedCategories: ["*"] } } as never);
await page.locator(`aside a[data-nav-link][href="${target}"]`).first().click();
await page.waitForURL("**" + target);
await page.waitForTimeout(Number(process.env.PERF_AT || 700));
{
  const names = await page.evaluate(() => {
    const m: Record<string, number> = {};
    for (const a of document.getAnimations()) {
      const t = (a.effect as KeyframeEffect | null)?.target as Element | null;
      const k = ((a as CSSAnimation).animationName ?? "?") + " <" + (t?.tagName ?? "") + "." + String(typeof t?.className === "string" ? t.className : "").slice(0, 60) + ">";
      m[k] = (m[k] ?? 0) + 1;
    }
    return m;
  });
  console.log("t+700 animasyonlar", JSON.stringify(names, null, 1).slice(0, 1800));
}
await page.waitForTimeout(3000);
const done = new Promise((r) => cdp.once("Tracing.tracingComplete", r));
await cdp.send("Tracing.end");
await done;
const sum = new Map<string, { ms: number; n: number; max: number }>();
for (const e of events) {
  if (e.ph !== "X" || !e.dur) continue;
  const s = sum.get(e.name) ?? { ms: 0, n: 0, max: 0 };
  s.ms += e.dur / 1000;
  s.n++;
  s.max = Math.max(s.max, e.dur / 1000);
  sum.set(e.name, s);
}
console.log([...sum].sort((a, b) => b[1].ms - a[1].ms).slice(0, 25).map(([k, v]) => `${v.ms.toFixed(0)} ms  n=${v.n} max=${v.max.toFixed(0)}  ${k}`).join("\n"));
const t0 = Math.min(...events.filter((e) => e.ts).map((e) => e.ts));
const recalcs = events.filter((e) => e.name === "UpdateLayoutTree" && (e.dur ?? 0) > 8000);
console.log("recalc zamanlari (ms, sure):", recalcs.map((e) => `${Math.round((e.ts - t0) / 1000)}:${Math.round(e.dur! / 1000)}`).join(" "));
const anims = await page.evaluate(() => document.getAnimations().map((a) => { const t = (a.effect as KeyframeEffect | null)?.target as Element | null; return `${(a as CSSAnimation).animationName ?? (a as CSSTransition).transitionProperty ?? "?"} ${a.playState} ${t?.tagName}.${(t?.className?.toString() ?? "").slice(0, 80)}`; }));
console.log("animasyonlar", anims.length, [...new Set(anims)].slice(0, 15).join("\n"));
const late = recalcs.filter((e) => (e.ts - t0) / 1000 > 1000).slice(0, 4);
for (const r of late) {
  const near = events.filter((e) => e.ph === "X" && (e.name === "FunctionCall" || e.name === "EventDispatch" || e.name === "TimerFire" || e.name === "FireAnimationFrame" || e.name === "FireIdleCallback" || e.name === "ResourceReceiveResponse") && e.ts <= r.ts && e.ts + (e.dur ?? 0) >= r.ts - 5000);
  console.log("recalc@", Math.round((r.ts - t0) / 1000), near.map((e) => `${e.name}:${(e.args?.data as Record<string, unknown> | undefined)?.functionName ?? (e.args?.data as Record<string, unknown> | undefined)?.type ?? ""}@${String((e.args?.data as Record<string, unknown> | undefined)?.url ?? "").split("/").pop()}:${(e.args?.data as Record<string, unknown> | undefined)?.lineNumber ?? ""}`).join(" ; "));
}
await browser.close();
