// Gezinme sırasındaki ana iş parçacığı CPU profili (özet): bir menü tıklamasında en pahalı dosyalar/işlevler.
// Çalıştır: PERF_BASE=http://localhost:3217 MSYS_NO_PATHCONV=1 npx tsx scripts/perf/profile-nav.mts /app/randevular
import dotenv from "dotenv";
import { createServerClient } from "@supabase/ssr";
import { chromium } from "playwright";
import { deriveDemoPassword } from "../../src/lib/demo-credentials.ts";

dotenv.config({ path: ".env.local", quiet: true });
const BASE = process.env.PERF_BASE || "https://emlaksoft.vercel.app";
const target = process.argv[2] || "/app/randevular";
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
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.addCookies([...jar].map(([name, value]) => ({ name, value: encodeURIComponent(value), domain: new URL(BASE).hostname, path: "/", secure: BASE.startsWith("https"), httpOnly: false, sameSite: "Lax" as const })));
if (process.env.PERF_NOVT) await ctx.addInitScript("Object.defineProperty(Document.prototype,'startViewTransition',{value:undefined,configurable:true})");
const page = await ctx.newPage();
await page.goto(BASE + "/app", { waitUntil: "load" });
await page.waitForSelector("main h1, main h2");
await page.waitForSelector("[role=dialog]", { timeout: 8000 }).catch(() => {});
if (await page.locator("[role=dialog]").count()) await page.keyboard.press("Escape");
await page.evaluate(() => document.querySelectorAll<HTMLElement>("aside button[aria-expanded=false]:not([aria-haspopup])").forEach((b) => b.click()));
await page.waitForTimeout(3000);
const cdp = await ctx.newCDPSession(page);
await cdp.send("Profiler.enable");
await cdp.send("Profiler.setSamplingInterval", { interval: 500 });
if (process.env.PERF_BACK) {
  // Geri dönüş profili: önce hedefe git, sonra geri (ana ekran).
  await page.locator(`aside a[data-nav-link][href="${target}"]`).first().click();
  await page.waitForURL("**" + target);
  await page.waitForTimeout(3000);
  await cdp.send("Profiler.start");
  await page.goBack();
  await page.waitForURL("**/app");
} else {
  await cdp.send("Profiler.start");
  await page.locator(`aside a[data-nav-link][href="${target}"]`).first().click();
  await page.waitForURL("**" + target);
}
await page.waitForTimeout(4000);
const { profile } = (await cdp.send("Profiler.stop")) as { profile: { nodes: { id: number; callFrame: { functionName: string; url: string; lineNumber: number }; }[]; samples: number[]; timeDeltas: number[] } };
const byId = new Map(profile.nodes.map((n) => [n.id, n]));
const parent = new Map<number, number>();
for (const n of profile.nodes as unknown as { id: number; children?: number[] }[]) for (const c of n.children ?? []) parent.set(c, n.id);
const callers = new Map<string, number>();
profile.samples.forEach((id, i) => {
  const n = byId.get(id)!;
  if (!/clientHeight|getBoundingClientRect|offsetHeight|offsetWidth|scrollHeight|getComputedStyle/.test(n.callFrame.functionName)) return;
  const chain: string[] = [];
  let cur = parent.get(id);
  while (cur && chain.length < 4) {
    const c = byId.get(cur)!.callFrame;
    chain.push(`${c.functionName || "(anon)"}@${c.url.split("/").slice(-1)[0]}:${c.lineNumber}:${(c as unknown as { columnNumber: number }).columnNumber}`);
    cur = parent.get(cur);
  }
  const k = `${n.callFrame.functionName} <- ${chain.join(" <- ")}`;
  callers.set(k, (callers.get(k) ?? 0) + (profile.timeDeltas[i] ?? 0) / 1000);
});
console.log("--- zorunlu düzen çağıranları ---\n" + [...callers].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => `${v.toFixed(0)} ms  ${k}`).join("\n"));
const self = new Map<string, number>();
const byUrl = new Map<string, number>();
profile.samples.forEach((id, i) => {
  const n = byId.get(id)!;
  const dt = (profile.timeDeltas[i] ?? 0) / 1000;
  const key = `${n.callFrame.functionName || "(anon)"} ${n.callFrame.url.split("/").slice(-1)[0]}:${n.callFrame.lineNumber}:${(n.callFrame as unknown as { columnNumber: number }).columnNumber}`;
  if (n.callFrame.functionName === "(idle)" || n.callFrame.functionName === "(program)") return;
  self.set(key, (self.get(key) ?? 0) + dt);
  const u = n.callFrame.url.split("/").slice(-1)[0] || "(native)";
  byUrl.set(u, (byUrl.get(u) ?? 0) + dt);
});
const top = (m: Map<string, number>, n: number) => [...m].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => `${v.toFixed(0)} ms  ${k}`).join("\n");
console.log("--- dosya bazında (öz süre) ---\n" + top(byUrl, 12));
console.log("--- işlev bazında ---\n" + top(self, 15));
await browser.close();
