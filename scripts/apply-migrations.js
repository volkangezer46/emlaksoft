#!/usr/bin/env node
/**
 * Premium Plus migrations otomatik uygulama
 */

const { readFileSync } = require('fs');
const { join } = require('path');

async function applyMigrations() {
  console.log('🚀 Premium Plus migrations uygulanıyor...\n');

  // .env.local oku
  const envPath = join(__dirname, '..', '.env.local');
  let envContent;
  try {
    envContent = readFileSync(envPath, 'utf-8');
  } catch (e) {
    console.error('❌ .env.local dosyası okunamadı');
    process.exit(1);
  }
  
  const getEnv = (key) => {
    const match = envContent.match(new RegExp(`${key}=(.+)`));
    return match ? match[1].trim() : null;
  };

  const SUPABASE_URL = getEnv('NEXT_PUBLIC_SUPABASE_URL');
  const SERVICE_KEY = getEnv('SUPABASE_SERVICE_ROLE_KEY');

  if (!SUPABASE_URL || !SERVICE_KEY) {
    console.error('❌ Hata: .env.local dosyasında Supabase bilgileri bulunamadı');
    console.log('\n📋 Manuel uygulama için MIGRATION_GUIDE.md dosyasına bakın\n');
    process.exit(1);
  }

  console.log(`📍 Supabase: ${SUPABASE_URL.replace(/https?:\/\/([^.]+).*/, '$1...')}`);

  // Migration SQL oku
  const sqlPath = join(__dirname, '..', 'supabase', 'apply_premium_plus.sql');
  const sql = readFileSync(sqlPath, 'utf-8');

  console.log(`📝 Migration SQL hazır (${sql.length} karakter)\n`);

  // Supabase pg-meta API kullan (SQL execution)
  try {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/exec_sql`, {
      method: 'POST',
      headers: {
        'apikey': SERVICE_KEY,
        'Authorization': `Bearer ${SERVICE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query: sql }),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${await response.text()}`);
    }

    console.log('✅ Migrations başarıyla uygulandı!\n');
    
  } catch (error) {
    console.error('❌ Otomatik uygulama başarısız:', error.message);
    console.log('\n📋 Manuel uygulama adımları:');
    console.log('   1. Supabase Dashboard → SQL Editor');
    console.log('   2. supabase/apply_premium_plus.sql içeriğini yapıştır');
    console.log('   3. Run');
    console.log('\n   Detay: MIGRATION_GUIDE.md\n');
    process.exit(1);
  }

  console.log('📦 Storage bucket (manuel):');
  console.log('   Dashboard → Storage → Create bucket: customer-files (private)');
  console.log('   Policy ekle (MIGRATION_GUIDE.md)\n');
  console.log('🎉 Tamamlandı!\n');
}

applyMigrations().catch(err => {
  console.error('❌ Beklenmeyen hata:', err);
  process.exit(1);
});
