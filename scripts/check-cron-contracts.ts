/**
 * Static cron contract gate. It does not call a database or execute a job.
 *
 * It keeps four independently editable surfaces aligned:
 *   1. Vercel schedules
 *   2. route folders
 *   3. admin monitoring inventory
 *   4. authorization + heartbeat instrumentation
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { CRON_JOBS } from "../src/lib/cron-jobs.ts";

type VercelConfig = { crons?: Array<{ path?: string; schedule?: string }> };

const root = process.cwd();
const cronRoot = join(root, "src", "app", "api", "cron");
const vercel = JSON.parse(readFileSync(join(root, "vercel.json"), "utf8")) as VercelConfig;
const configured = vercel.crons ?? [];
const issues: string[] = [];

/** Sabit "ok" yazan ESKİ cronlar (taşındıkça buradan silinir; yeni giriş eklemek yasak). */
const LEGACY_CONSTANT_OK = new Set<string>([
  "billing-reconciliation",
  "direct-file-upload-cleanup",
  "dogum-gunu",
  "ef-kontor-sweep",
  "geo-sync",
  "growth-claims",
  "insight-engine",
  "operational-retention",
  "public-mutation-outbox",
  "seo-robot",
  "tcmb-kur",
  "ticket-attachment-cleanup",
  "ticket-sla",
  "vitrin-alarm",
  "vitrin-eslesme",
]);

function duplicates(values: string[]): string[] {
  return [...new Set(values.filter((value, index) => values.indexOf(value) !== index))];
}

const configuredPaths = configured.map((item) => item.path ?? "");
const monitoredPaths = CRON_JOBS.map((item) => item.path);
const monitoredJobs = CRON_JOBS.map((item) => item.job);
const routeJobs = readdirSync(cronRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && existsSync(join(cronRoot, entry.name, "route.ts")))
  .map((entry) => entry.name)
  .sort();

for (const path of duplicates(configuredPaths)) issues.push(`vercel.json içinde yinelenen cron yolu: ${path}`);
for (const job of duplicates(monitoredJobs)) issues.push(`izleme manifestinde yinelenen iş: ${job}`);
for (const path of duplicates(monitoredPaths)) issues.push(`izleme manifestinde yinelenen yol: ${path}`);

for (const item of configured) {
  if (!item.path?.startsWith("/api/cron/")) issues.push(`geçersiz cron yolu: ${item.path ?? "<eksik>"}`);
  if (!item.schedule || item.schedule.trim().split(/\s+/).length !== 5) {
    issues.push(`${item.path ?? "<eksik>"}: geçersiz 5 alanlı cron ifadesi (${item.schedule ?? "<eksik>"})`);
  }
}

const configuredSet = new Set(configuredPaths);
const monitoredSet = new Set(monitoredPaths);
const routeSet = new Set(routeJobs.map((job) => `/api/cron/${job}`));

for (const path of configuredSet) {
  if (!monitoredSet.has(path as (typeof monitoredPaths)[number])) issues.push(`${path}: admin izleme manifestinde yok`);
  if (!routeSet.has(path)) issues.push(`${path}: route.ts bulunamadı`);
}
for (const path of monitoredSet) {
  if (!configuredSet.has(path)) issues.push(`${path}: vercel.json zamanlaması yok`);
  if (!routeSet.has(path)) issues.push(`${path}: route.ts bulunamadı`);
}
for (const path of routeSet) {
  if (!configuredSet.has(path)) issues.push(`${path}: route var fakat vercel.json zamanlaması yok`);
  if (!monitoredSet.has(path as (typeof monitoredPaths)[number])) issues.push(`${path}: route var fakat admin izlemesinde yok`);
}

for (const definition of CRON_JOBS) {
  const schedule = configured.find((item) => item.path === definition.path)?.schedule;
  if (schedule && schedule !== definition.schedule) {
    issues.push(`${definition.path}: manifest (${definition.schedule}) ile vercel.json (${schedule}) farklı`);
  }

  const routePath = join(cronRoot, definition.job, "route.ts");
  if (!existsSync(routePath)) continue;
  const source = readFileSync(routePath, "utf8");
  // Yetki kapısı: ortak authorizeCron(req) (src/lib/cron-auth.ts: CRON_SECRET Bearer) veya eski doğrudan CRON_SECRET okuması.
  const usesSharedGate =
    /import\s*\{[^}]*\bauthorizeCron\b[^}]*\}\s*from\s*["']@\/lib\/cron-auth["']/.test(source) &&
    /\bauthorizeCron\(\s*\w+\s*\)/.test(source);
  if (!usesSharedGate && !/process\.env\.CRON_SECRET/.test(source)) {
    issues.push(`${definition.path}: CRON_SECRET doğrulaması (authorizeCron) görünmüyor`);
  }
  const escapedJob = definition.job.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (!new RegExp(`recordHeartbeat\\(\\s*["']${escapedJob}["']`).test(source)) {
    issues.push(`${definition.path}: recordHeartbeat iş adı eşleşmiyor`);
  }

  // Sabit "ok" yasak: durum hata sayacından hesaplanır (heartbeatFor). Yalnız "atlandı" dalı (iş bilerek atlandı) istisnadır.
  // Eski (henüz taşınmamış) cronlar LEGACY_CONSTANT_OK ile ratchet altındadır: liste yalnız KÜÇÜLEBİLİR.
  if (!LEGACY_CONSTANT_OK.has(definition.job)) {
    for (const m of source.matchAll(/recordHeartbeat\(\s*["'][^"']+["']\s*,\s*["']ok["']\s*[,)]/g)) {
      const tail = source.slice(m.index ?? 0, (m.index ?? 0) + 240);
      if (!/atland[ıi]/.test(tail)) {
        issues.push(`${definition.path}: recordHeartbeat ikinci argümanı sabit "ok" (heartbeatFor({ failed }) kullan; yalnız "atlandı" dalı istisna)`);
        break;
      }
    }
  }
}

if (issues.length > 0) {
  console.error(`Cron kontratı başarısız (${issues.length} sorun):`);
  for (const issue of issues) console.error(`  - ${issue}`);
  process.exit(1);
}

console.log(`Cron kontratı sağlıklı: ${configured.length} rota, zamanlama, yetki kapısı ve heartbeat eşleşti.`);
