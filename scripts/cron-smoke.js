#!/usr/bin/env node
/**
 * Post-deploy cron smoke.
 *
 * Routes are read from vercel.json so a newly scheduled job cannot silently
 * fall outside the smoke set. The authorization-only mode is non-mutating;
 * the default authorized mode executes real production jobs and must be run
 * deliberately after deployment.
 *
 *   APP_URL=https://app.example.com npm run cron:smoke -- --auth-only
 *   APP_URL=https://app.example.com CRON_SECRET=... npm run cron:smoke
 *   npm run cron:smoke -- --list
 */

const { crons = [] } = require("../vercel.json");

const routes = crons.map((cron) => cron.path);
const args = new Set(process.argv.slice(2));
const authOnly = args.has("--auth-only");
const listOnly = args.has("--list");
const requestTimeoutMs = 120_000;

function safeBody(value) {
  const text = JSON.stringify(value);
  return text.length > 500 ? `${text.slice(0, 500)}...` : text;
}

async function request(url, headers = {}) {
  const response = await fetch(url, {
    headers,
    redirect: "manual",
    signal: AbortSignal.timeout(requestTimeoutMs),
  });
  const body = await response.json().catch(() => ({}));
  return { response, body };
}

async function main() {
  if (routes.length === 0 || routes.some((path) => typeof path !== "string")) {
    throw new Error("vercel.json içinde geçerli cron yolu bulunamadı");
  }
  if (new Set(routes).size !== routes.length) {
    throw new Error("vercel.json içinde yinelenen cron yolu var");
  }

  if (listOnly) {
    routes.forEach((path) => console.log(path));
    return;
  }

  const appUrlValue = process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL;
  if (!appUrlValue) throw new Error("APP_URL (veya NEXT_PUBLIC_APP_URL) tanımlı değil");

  let baseUrl;
  try {
    const parsed = new URL(appUrlValue);
    if (!/^https?:$/.test(parsed.protocol)) throw new Error("protokol");
    baseUrl = parsed.toString().replace(/\/$/, "");
  } catch {
    throw new Error("APP_URL geçerli bir http(s) adresi değil");
  }

  console.log(`Cron smoke: ${routes.length} rota · ${authOnly ? "yalnız yetki kapısı" : "yetki + gerçek çalıştırma"}`);
  let failed = 0;

  // Run the non-mutating negative test first. A broken guard stops the smoke
  // before an authorized request can perform any work.
  for (const path of routes) {
    try {
      const { response } = await request(`${baseUrl}${path}`);
      if (response.status === 401) console.log(`✓ ${path} · yetkisiz 401`);
      else {
        console.error(`✗ ${path} · yetkisiz istek HTTP ${response.status}`);
        failed++;
      }
    } catch (error) {
      console.error(`✗ ${path} · yetki kontrolü: ${error instanceof Error ? error.message : "bilinmeyen hata"}`);
      failed++;
    }
  }

  if (failed > 0 || authOnly) {
    if (failed > 0) process.exitCode = 1;
    else console.log("Tüm cron yetki kapıları sağlıklı.");
    return;
  }

  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) throw new Error("CRON_SECRET tanımlı değil; gerçek cron çalıştırması için zorunlu");

  for (const path of routes) {
    try {
      const { response, body } = await request(`${baseUrl}${path}`, {
        Authorization: `Bearer ${secret}`,
      });
      if (response.ok && body?.ok !== false) {
        console.log(`✓ ${path} · HTTP ${response.status} ${safeBody(body)}`);
      } else {
        console.error(`✗ ${path} · HTTP ${response.status} ${safeBody(body)}`);
        failed++;
      }
    } catch (error) {
      console.error(`✗ ${path} · ${error instanceof Error ? error.message : "bilinmeyen hata"}`);
      failed++;
    }
  }

  if (failed > 0) {
    console.error(`${failed} cron kontrolü başarısız.`);
    process.exitCode = 1;
    return;
  }
  console.log("Tüm zamanlanmış işler ve heartbeat akışları sağlıklı.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
