// Canlı oturumlu hız ölçümü ve yayın sonrası bekçi (SK1/B179-B181).
//
// Serbest ölçüm (salt-okunur GET):
//   npx tsx scripts/perf/measure-live.mts [demo-email] ["/app,/app/lig"]
// Bekçi / bütçe modu (scripts/sunucu/deploy.sh yayından sonra koşar):
//   npx tsx scripts/perf/measure-live.mts --watchdog [--json <dosya>] [--no-quiet-check]
//   - TTFB: /app (sahip) ve /admin (süper yönetici demo kimliği), 20'şer örnek → p50 bütçesi (scripts/perf/live-budget.ts);
//   - DCL: Playwright Chromium kuruluysa /app ve /admin tam açılışı, 5'er örnek (kurulu değilse "ölçülemedi");
//   - Realtime: RT_PROBE_EMAIL / RT_PROBE_PASSWORD (e2e-test iç kiracısının kullanıcısı) verilmişse o kiracıda
//     20 görev satırı eklenir, abone sokette INSERT olayının gelişi ölçülür, satırlar sonra silinir. Verilmemişse atlanır.
//   - "Sakin sunucu" (load1 <4 ve kapı koşmuyor) değilse en çok QUIET_WAIT_SEC (varsayılan 90) sn beklenir; yine
//     sakin değilse ölçülmez (çıkış 3).
// Çıkış: 0 bütçe içinde · 1 bütçe aşımı · 2 hata (giriş/ağ) · 3 sakin sunucu değil (ölçülmedi).
// Ortam: BASE (varsayılan https://emlaksoft.com.tr), REPS (serbest modda tur sayısı, varsayılan 3), .env.local ve
// .env.production (NEXT_PUBLIC_SUPABASE_URL, anon/publishable anahtar, DEMO_LOGIN_SECRET).
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import dotenv from "dotenv";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { deriveDemoPassword } from "../../src/lib/demo-credentials.ts";
import { LIVE_BUDGETS, evaluateBudgets, quietServerReason, type LiveMeasurement } from "./live-budget.ts";

dotenv.config({ path: ".env.local", quiet: true });
dotenv.config({ path: ".env.production", quiet: true });

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const flagValue = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const positional = args.filter((a, i) => !a.startsWith("--") && args[i - 1] !== "--json");
const WATCHDOG = flag("--watchdog");
const JSON_OUT = flagValue("--json");
const BASE = (process.env.BASE || "https://emlaksoft.com.tr").replace(/\/$/, "");
const REPS = Number(process.env.REPS || 3);
const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const anon = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
const secret =
  process.env.DEMO_LOGIN_SECRET?.trim() || process.env.SUPABASE_SECRET_KEY?.trim() || process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || "";
const UA = "emlaksoft-perf-probe";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function fail(code: number, message: string): never {
  console.error(message);
  if (JSON_OUT) writeFileSync(JSON_OUT, JSON.stringify({ ok: false, code, message, at: new Date().toISOString() }, null, 2));
  process.exit(code);
}

if (!url || !anon) fail(2, "NEXT_PUBLIC_SUPABASE_URL / anon anahtarı yok (.env.local / .env.production)");

/** Demo kimliğiyle giriş; Next'in okuyacağı çerez başlığı ve Playwright çerezleri. */
async function login(email: string) {
  const jar = new Map<string, string>();
  const supabase = createServerClient(url, anon, {
    cookies: {
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll: (cs) => cs.forEach(({ name, value }) => jar.set(name, value)),
    },
  });
  const { error } = await supabase.auth.signInWithPassword({ email, password: deriveDemoPassword(secret, email) });
  if (error) fail(2, `giriş hatası (${email}): ${error.message}`);
  const header = [...jar].map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("; ");
  return { header, cookies: [...jar].map(([name, value]) => ({ name, value: encodeURIComponent(value) })) };
}

async function ttfbSamples(path: string, cookie: string, n: number, gapMs: number) {
  const ttfb: number[] = [];
  const total: number[] = [];
  let status = 0;
  let serverTiming = "";
  for (let i = 0; i < n; i++) {
    await sleep(gapMs);
    const t0 = performance.now();
    const res = await fetch(BASE + path, { headers: { cookie, "user-agent": UA }, redirect: "manual" });
    const t1 = performance.now();
    await res.arrayBuffer();
    total.push(Math.round(performance.now() - t0));
    ttfb.push(Math.round(t1 - t0));
    status = res.status;
    serverTiming = res.headers.get("server-timing") ?? "";
  }
  return { ttfb, total, status, serverTiming };
}

// ---------------------------------------------------------------------------------------------------------------
// Serbest ölçüm (eski davranış)
// ---------------------------------------------------------------------------------------------------------------
async function freeMode() {
  const email = positional[0] || "sahip@demo.emlaksoft.test";
  const { header: cookie } = await login(email);
  const pages = (
    positional[1] ||
    "/app,/app/musteriler,/app/portfoyler,/app/talepler,/app/anlasmalar,/app/randevular,/app/gorevler,/app/finans/komisyon,/app/raporlar,/app/lig,/app/finans,/app/kiralama,/app/aidat,/app/ilan-kontrol,/app/performansim,/app/ekip"
  ).split(",");
  // "@ilk:/app/portfoyler" gibi girdi: liste sayfasındaki İLK kaydın detay yolu (kimlik gerektiren detay sayfaları için).
  for (let i = 0; i < pages.length; i++) {
    const m = /^@ilk:(\/app\/[a-z-]+)$/.exec(pages[i]!);
    if (!m) continue;
    const html = await (await fetch(BASE + m[1], { headers: { cookie, "user-agent": UA }, redirect: "manual" })).text();
    const hit = new RegExp(`${m[1]}/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})`).exec(html);
    pages[i] = hit ? `${m[1]}/${hit[1]}` : m[1]!;
  }
  console.log(`sayfa | durum | ttfb ms (${REPS} tur) | toplam ms | server-timing (son tur)`);
  for (const p of pages) {
    const r = await ttfbSamples(p, cookie, REPS, 1000);
    const sorted = [...r.total].sort((a, b) => a - b);
    const p95 = sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)];
    console.log(`${p} | ${r.status} | ttfb ${r.ttfb.join("/")} | toplam ${r.total.join("/")} | p95 ${p95} max ${sorted.at(-1)} | ${r.serverTiming}`);
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Bekçi / bütçe modu
// ---------------------------------------------------------------------------------------------------------------
function load1(): number | null {
  try {
    return Number(readFileSync("/proc/loadavg", "utf8").split(" ")[0]);
  } catch {
    return null;
  }
}

function gateRunning(): boolean {
  const lock = `${process.env.GATE_DIR || "/tmp/emlaksoft-gate"}/gate.running`;
  if (!existsSync(lock)) return false;
  const pid = Number(readFileSync(lock, "utf8").trim());
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitQuiet(): Promise<string | null> {
  if (flag("--no-quiet-check")) return null;
  const deadline = Date.now() + Number(process.env.QUIET_WAIT_SEC || 90) * 1000;
  for (;;) {
    const reason = quietServerReason({ load1: load1(), gateRunning: gateRunning() });
    if (!reason || Date.now() > deadline) return reason;
    await sleep(5000);
  }
}

async function dclSamples(paths: Array<{ path: string; cookies: Array<{ name: string; value: string }> }>) {
  const out: LiveMeasurement[] = [];
  let chromium: typeof import("@playwright/test").chromium;
  try {
    ({ chromium } = await import("@playwright/test"));
  } catch {
    console.log("DCL: @playwright/test yok — ölçülemedi");
    return out;
  }
  let browser: Awaited<ReturnType<typeof chromium.launch>>;
  try {
    browser = await chromium.launch();
  } catch (e) {
    console.log(`DCL: Chromium başlatılamadı (npx playwright install chromium) — ölçülemedi: ${String(e).split("\n")[0]}`);
    return out;
  }
  try {
    const host = new URL(BASE).hostname;
    for (const { path, cookies } of paths) {
      const values: number[] = [];
      for (let i = 0; i < LIVE_BUDGETS.dclSamples; i++) {
        const context = await browser.newContext({ userAgent: UA });
        await context.addCookies(
          cookies.map((c) => ({ ...c, domain: host, path: "/", secure: BASE.startsWith("https"), sameSite: "Lax" as const })),
        );
        const page = await context.newPage();
        await page.goto(BASE + path, { waitUntil: "domcontentloaded" });
        const dcl = await page.evaluate(() => {
          const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
          return nav ? nav.domContentLoadedEventEnd - nav.startTime : null;
        });
        if (dcl !== null) values.push(Math.round(dcl));
        await context.close();
      }
      out.push({ kind: "dcl", path, values });
    }
  } finally {
    await browser.close();
  }
  return out;
}

/** e2e-test iç kiracısında görev satırı ekleyip abone soketteki INSERT olayının ms'sini ölçer; satırları siler. */
async function realtimeSamples(): Promise<LiveMeasurement | null> {
  const email = process.env.RT_PROBE_EMAIL?.trim();
  const password = process.env.RT_PROBE_PASSWORD ?? "";
  if (!email || !password) {
    console.log("REALTIME: RT_PROBE_EMAIL / RT_PROBE_PASSWORD yok — atlandı (e2e-test iç kiracısı kullanıcısı gerekir)");
    return null;
  }
  const client = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error || !data.session) fail(2, `realtime prob girişi başarısız: ${error?.message ?? "oturum yok"}`);
  const tenantId = (data.session.user.app_metadata as { tenant_id?: string } | undefined)?.tenant_id;
  if (!tenantId) fail(2, "realtime prob kullanıcısının tenant_id claim'i yok");
  await client.realtime.setAuth(data.session.access_token);
  const waiters = new Map<string, (at: number) => void>();
  const early = new Map<string, number>();
  const channel = client.channel(`es-perf-probe:${tenantId}:${Date.now()}`).on(
    "postgres_changes",
    { event: "INSERT", schema: "public", table: "tasks", filter: `tenant_id=eq.${tenantId}` },
    (payload) => {
      const at = performance.now();
      const id = String((payload.new as { id?: string }).id ?? "");
      const w = waiters.get(id);
      if (w) w(at);
      else early.set(id, at);
    },
  );
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("abonelik 15 sn içinde kurulmadı")), 15_000);
    channel.subscribe((status) => {
      if (status === "SUBSCRIBED") {
        clearTimeout(timer);
        resolve();
      } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        clearTimeout(timer);
        reject(new Error(`abonelik durumu ${status}`));
      }
    });
  }).catch((e) => fail(2, `realtime: ${String(e)}`));

  const values: number[] = [];
  const ids: string[] = [];
  try {
    for (let i = 0; i < LIVE_BUDGETS.realtimeSamples; i++) {
      await sleep(300);
      const t0 = performance.now();
      const ins = await client
        .from("tasks")
        .insert({ tenant_id: tenantId, title: `[bekçi] realtime ölçümü ${new Date().toISOString()} #${i + 1}` })
        .select("id")
        .single();
      if (ins.error || !ins.data) fail(2, `realtime: görev eklenemedi: ${ins.error?.message ?? "satır yok"}`);
      const id = String(ins.data.id);
      ids.push(id);
      const at =
        early.get(id) ??
        (await new Promise<number>((resolve) => {
          const timer = setTimeout(() => resolve(Number.POSITIVE_INFINITY), LIVE_BUDGETS.realtimeEventTimeoutMs);
          waiters.set(id, (t) => {
            clearTimeout(timer);
            resolve(t);
          });
        }));
      values.push(Number.isFinite(at) ? Math.max(0, Math.round(at - t0)) : Number.POSITIVE_INFINITY);
    }
  } finally {
    await client.removeChannel(channel);
    if (ids.length > 0) {
      const del = await client.from("tasks").delete().in("id", ids);
      if (del.error) console.log(`[uyari] ölçüm görevleri silinemedi (${ids.length}): ${del.error.message}`);
    }
    await client.auth.signOut();
  }
  return { kind: "realtime", values };
}

async function watchdogMode() {
  const notQuiet = await waitQuiet();
  if (notQuiet) fail(3, `Sakin sunucu değil (${notQuiet}) — ölçülmedi`);
  const office = await login(process.env.PERF_OFFICE_EMAIL || "sahip@demo.emlaksoft.test");
  const admin = await login(process.env.PERF_ADMIN_EMAIL || "admin@demo.emlaksoft.test");
  const measurements: LiveMeasurement[] = [];
  for (const [path, cookie] of [
    ["/app", office.header],
    ["/admin", admin.header],
  ] as const) {
    // İlk istek ısıtma (yeni sürümün ilk derlemesi/bağlantısı ölçüme girmez).
    const warm = await ttfbSamples(path, cookie, 1, 0);
    // /admin demo kimliği MFA/adım-yükseltme isteyebilir (3xx): yayın hatası değil, "ölçülemedi".
    if (path === "/admin" && warm.status >= 300 && warm.status < 400) {
      console.log(`TTFB /admin — HTTP ${warm.status} (MFA/kapı yönlendirmesi); ölçülemedi`);
      continue;
    }
    const r = await ttfbSamples(path, cookie, LIVE_BUDGETS.ttfbSamples, 250);
    if (r.status !== 200) fail(2, `${path} HTTP ${r.status} (beklenen 200; oturum/kapı?)`);
    measurements.push({ kind: "ttfb", path, values: r.ttfb });
  }
  measurements.push(
    ...(await dclSamples([
      { path: "/app", cookies: office.cookies },
      { path: "/admin", cookies: admin.cookies },
    ])),
  );
  const rt = await realtimeSamples();
  if (rt) measurements.push(rt);
  const report = evaluateBudgets(measurements);
  for (const line of report.lines) console.log(line);
  console.log(report.ok ? "BÜTÇE: içinde" : `BÜTÇE: AŞIM — ${report.violations.join("; ")}`);
  if (JSON_OUT) {
    writeFileSync(
      JSON_OUT,
      JSON.stringify({ ok: report.ok, base: BASE, at: new Date().toISOString(), lines: report.lines, violations: report.violations, measurements }, null, 2),
    );
  }
  process.exit(report.ok ? 0 : 1);
}

if (WATCHDOG) await watchdogMode();
else await freeMode();
