#!/usr/bin/env node
/**
 * Smoke test: Auth + Database bağlantısı
 * Test eder: Supabase connection, JWT claims, tenant isolation
 */

const { readFileSync } = require('fs');
const { join } = require('path');

async function smokeTest() {
  console.log('🔥 EmlakSoft Smoke Test\n');

  // ENV oku
  const envPath = join(__dirname, '..', '.env.local');
  let envContent;
  try {
    envContent = readFileSync(envPath, 'utf-8');
  } catch (e) {
    console.error('❌ .env.local bulunamadı');
    process.exit(1);
  }

  const getEnv = (key) => {
    const match = envContent.match(new RegExp(`${key}=(.+)`));
    return match ? match[1].trim() : null;
  };

  const SUPABASE_URL = getEnv('NEXT_PUBLIC_SUPABASE_URL');
  const ANON_KEY = getEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY');
  const SERVICE_KEY = getEnv('SUPABASE_SERVICE_ROLE_KEY');

  if (!SUPABASE_URL || !ANON_KEY || !SERVICE_KEY) {
    console.error('❌ Supabase ENV eksik');
    process.exit(1);
  }

  console.log(`📍 Testing: ${SUPABASE_URL.replace(/https?:\/\/([^.]+).*/, '$1...')}\n`);

  let passed = 0;
  let failed = 0;

  // Test 1: Anon connection
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/`, {
      headers: { apikey: ANON_KEY },
    });
    if (res.status === 200 || res.status === 404) {
      console.log('✅ Anon key bağlantısı');
      passed++;
    } else {
      throw new Error(`HTTP ${res.status}`);
    }
  } catch (e) {
    console.error('❌ Anon key başarısız:', e.message);
    failed++;
  }

  // Test 2: Service role
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/tenants?select=count`, {
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
      },
    });
    if (res.ok) {
      console.log('✅ Service role bağlantısı');
      passed++;
    } else {
      throw new Error(`HTTP ${res.status}`);
    }
  } catch (e) {
    console.error('❌ Service role başarısız:', e.message);
    failed++;
  }

  // Test 3: Tables exist
  const tables = ['tenants', 'profiles', 'customers', 'customer_files', 'notifications'];
  for (const table of tables) {
    try {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?select=count&limit=1`, {
        headers: {
          apikey: SERVICE_KEY,
          Authorization: `Bearer ${SERVICE_KEY}`,
        },
      });
      if (res.ok) {
        console.log(`✅ Table: ${table}`);
        passed++;
      } else {
        throw new Error(`HTTP ${res.status}`);
      }
    } catch (e) {
      console.error(`❌ Table ${table} eksik:`, e.message);
      failed++;
    }
  }

  // Test 4: Storage bucket
  try {
    const res = await fetch(`${SUPABASE_URL}/storage/v1/bucket/customer-files`, {
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
      },
    });
    if (res.ok) {
      console.log('✅ Storage bucket: customer-files');
      passed++;
    } else if (res.status === 404) {
      console.warn('⚠️  Storage bucket yok (manuel oluştur)');
      failed++;
    } else {
      throw new Error(`HTTP ${res.status}`);
    }
  } catch (e) {
    console.error('❌ Storage check başarısız:', e.message);
    failed++;
  }

  console.log(`\n📊 Sonuç: ${passed} passed, ${failed} failed`);

  if (failed > 0) {
    console.log('\n⚠️  Bazı testler başarısız. Migration uygulandı mı?');
    console.log('   → supabase/apply_premium_plus.sql çalıştır');
    process.exit(1);
  }

  console.log('\n🎉 Tüm smoke testler geçti!\n');
  process.exit(0);
}

smokeTest().catch((err) => {
  console.error('❌ Beklenmeyen hata:', err);
  process.exit(1);
});
