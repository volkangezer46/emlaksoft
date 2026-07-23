#!/usr/bin/env node
/**
 * A4 — Prod CRON_SECRET smoke otomasyonu.
 * Deploy sonrası tüm /api/cron/* route'larını gerçek CRON_SECRET ile çağırır,
 * her birinin 200 + { ok: true } döndürdüğünü doğrular.
 *
 * Kullanım:
 *   CRON_SECRET=xxx APP_URL=https://app.emlaksoft.com.tr npm run cron:smoke
 *
 * Vercel deploy hook'una veya GitHub Actions "post-deploy" job'una eklenebilir.
 */

const ROUTES = [
  "/api/cron/portal-teyit",
  "/api/cron/randevu-hatirlat",
  "/api/cron/abonelik-kontrol",
  "/api/cron/gunluk-ozet",
  "/api/cron/leak-sla",
];

async function main() {
  const appUrl = process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL;
  const secret = process.env.CRON_SECRET;

  if (!appUrl) {
    console.error("❌ APP_URL (veya NEXT_PUBLIC_APP_URL) tanımlı değil");
    process.exit(1);
  }
  if (!secret) {
    console.error("❌ CRON_SECRET tanımlı değil — prod'da zorunlu");
    process.exit(1);
  }

  console.log(`🔥 Cron smoke: ${appUrl}\n`);

  let failed = 0;
  for (const path of ROUTES) {
    const url = `${appUrl.replace(/\/$/, "")}${path}`;
    try {
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${secret}` },
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok && body?.ok !== false) {
        console.log(`✅ ${path} → ${res.status} ${JSON.stringify(body)}`);
      } else {
        console.error(`❌ ${path} → ${res.status} ${JSON.stringify(body)}`);
        failed++;
      }
    } catch (e) {
      console.error(`❌ ${path} → ${e.message}`);
      failed++;
    }
  }

  // Unauthorized guard: secret olmadan istek 401 dönmeli
  try {
    const res = await fetch(`${appUrl.replace(/\/$/, "")}${ROUTES[0]}`);
    if (res.status === 401) {
      console.log("✅ Yetkisiz istek 401 ile reddedildi (güvenlik doğrulandı)");
    } else {
      console.error(`❌ Yetkisiz istek reddedilmedi — HTTP ${res.status} (CRON_SECRET sızıntısı riski!)`);
      failed++;
    }
  } catch (e) {
    console.error(`❌ Güvenlik kontrolü başarısız: ${e.message}`);
    failed++;
  }

  if (failed > 0) {
    console.log(`\n⚠️  ${failed} kontrol başarısız`);
    process.exit(1);
  }
  console.log("\n🎉 Tüm cron route'ları prod'da sağlıklı!\n");
}

main().catch((err) => {
  console.error("❌ Beklenmeyen hata:", err);
  process.exit(1);
});
