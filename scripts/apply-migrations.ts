/**
 * Migration uygulayıcı.
 *
 * ÖNCEKİ SÜRÜMÜN SORUNU: dosya listesi elle sabitlenmişti ve yalnızca ilk 9
 * migration'ı içeriyordu. Diskte 54 migration varken `npm run db:migrate`
 * 10–54'ü sessizce atlıyordu — yani komut "başarılı" diyip işini yapmıyordu.
 * Ayrıca neyin uygulandığını izleyen hiçbir kayıt yoktu.
 *
 * BU SÜRÜM:
 *  * `supabase/migrations` dizinini tarar, dosya adına göre sıralar (adlar
 *    tarih önekli olduğu için sıralama = kronoloji).
 *  * Uygulananları `public.schema_migrations` tablosunda izler; yalnızca
 *    eksikleri çalıştırır.
 *  * Her migration tek transaction içinde koşar — yarısı uygulanmış migration
 *    kalmaz.
 *  * Advisory lock ile aynı anda iki çalıştırma engellenir.
 *  * Checksum tutar; uygulandıktan sonra değiştirilen dosyayı uyarır.
 *
 * KULLANIM
 *   npm run db:migrate                 → eksik migration'ları uygula
 *   npm run db:migrate -- --dry-run    → ne çalışacağını göster, dokunma
 *   npm run db:migrate -- --baseline   → mevcut TÜM dosyaları "uygulanmış"
 *                                        işaretle, HİÇBİRİNİ çalıştırma
 *   npm run db:migrate -- --only 20260725000049_property_price_history.sql
 *
 * `--baseline` NE ZAMAN: izleyiciyi zaten migrate edilmiş bir veritabanına ilk
 * kez tanıtırken. Aksi halde araç 54 migration'ı yeniden çalıştırmayı dener.
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import pg from "pg";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

const { Client } = pg;

const MIGRATIONS_DIR = "supabase/migrations";
const LOCK_KEY = 4_872_119; // rastgele sabit — yalnızca bu araç kullanır

const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const BASELINE = args.includes("--baseline");
const onlyIndex = args.indexOf("--only");
const ONLY = onlyIndex >= 0 ? args[onlyIndex + 1] : null;

const urls = [process.env.DATABASE_POOLER_URL, process.env.DATABASE_URL].filter(
  Boolean,
) as string[];

if (urls.length === 0) {
  throw new Error("DATABASE_POOLER_URL veya DATABASE_URL tanımlı değil (.env.local)");
}

function listMigrations(): string[] {
  if (!fs.existsSync(MIGRATIONS_DIR)) {
    throw new Error(`${MIGRATIONS_DIR} bulunamadı`);
  }
  return fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort((a, b) => a.localeCompare(b, "en"));
}

function checksum(filePath: string): string {
  return crypto
    .createHash("sha256")
    .update(fs.readFileSync(filePath))
    .digest("hex")
    .slice(0, 16);
}

function redact(url: string): string {
  return url.replace(/:[^:@]+@/, ":****@");
}

async function connect() {
  for (const url of urls) {
    const client = new Client({
      connectionString: url,
      ssl: { rejectUnauthorized: false },
      connectionTimeoutMillis: 20_000,
    });
    try {
      await client.connect();
      console.log("bağlandı:", redact(url));
      return client;
    } catch (err) {
      console.log("başarısız:", redact(url), "→", String(err).slice(0, 120));
      try {
        await client.end();
      } catch {
        /* yoksay */
      }
    }
  }
  return null;
}

async function main() {
  const client = await connect();
  if (!client) throw new Error("Hiçbir veritabanı bağlantısı çalışmadı");

  try {
    // Aynı anda iki migrate çalışmasın
    const { rows: lock } = await client.query<{ ok: boolean }>(
      "select pg_try_advisory_lock($1) as ok",
      [LOCK_KEY],
    );
    if (!lock[0].ok) {
      throw new Error("Başka bir migration çalışması sürüyor (advisory lock alınamadı)");
    }

    await client.query(`
      create table if not exists public.schema_migrations (
        version     text        primary key,
        checksum    text        not null,
        applied_at  timestamptz not null default now()
      )
    `);
    await client.query(
      `comment on table public.schema_migrations is
       'Uygulanmış migration kaydı — scripts/apply-migrations.ts tarafından yönetilir'`,
    );

    const files = ONLY ? [ONLY] : listMigrations();
    const { rows: appliedRows } = await client.query<{ version: string; checksum: string }>(
      "select version, checksum from public.schema_migrations",
    );
    const applied = new Map(appliedRows.map((r) => [r.version, r.checksum]));

    console.log(`\ndiskte ${files.length} migration · veritabanında ${applied.size} kayıtlı`);

    // Uygulandıktan sonra değiştirilmiş dosyalar
    for (const file of files) {
      const known = applied.get(file);
      if (!known) continue;
      const current = checksum(path.join(MIGRATIONS_DIR, file));
      if (known !== current) {
        console.warn(`⚠ UYARI  ${file} uygulandıktan sonra değiştirilmiş (checksum farklı)`);
      }
    }

    const pending = files.filter((f) => ONLY !== null || !applied.has(f));

    if (BASELINE) {
      const toMark = files.filter((f) => !applied.has(f));
      console.log(`\n--baseline: ${toMark.length} dosya ÇALIŞTIRILMADAN uygulanmış işaretlenecek`);
      if (DRY_RUN) {
        for (const f of toMark) console.log("  işaretlenecek:", f);
      } else {
        for (const f of toMark) {
          await client.query(
            "insert into public.schema_migrations(version, checksum) values ($1,$2) on conflict (version) do nothing",
            [f, checksum(path.join(MIGRATIONS_DIR, f))],
          );
          console.log("  işaretlendi:", f);
        }
      }
      console.log("\nbaseline tamam. Bundan sonra yalnızca yeni migration'lar çalışır.");
      return;
    }

    if (pending.length === 0) {
      console.log("\nEksik migration yok — veritabanı güncel.");
      return;
    }

    console.log(`\n${pending.length} migration uygulanacak:`);
    for (const f of pending) console.log("  •", f);

    if (DRY_RUN) {
      console.log("\n--dry-run: hiçbir şey uygulanmadı.");
      return;
    }

    for (const file of pending) {
      const full = path.join(MIGRATIONS_DIR, file);
      if (!fs.existsSync(full)) throw new Error(`dosya yok: ${full}`);
      const sql = fs.readFileSync(full, "utf8");

      process.stdout.write(`→ ${file} ... `);
      // Tek transaction: hata olursa yarım uygulanmış migration kalmaz
      await client.query("begin");
      try {
        await client.query(sql);
        await client.query(
          "insert into public.schema_migrations(version, checksum) values ($1,$2) on conflict (version) do update set checksum = excluded.checksum, applied_at = now()",
          [file, checksum(full)],
        );
        await client.query("commit");
        console.log("tamam");
      } catch (err) {
        await client.query("rollback");
        console.log("HATA");
        throw new Error(`${file} uygulanamadı (geri alındı): ${String(err).slice(0, 400)}`);
      }
    }

    console.log(`\n${pending.length} migration uygulandı.`);
  } finally {
    try {
      await client.query("select pg_advisory_unlock($1)", [LOCK_KEY]);
    } catch {
      /* yoksay */
    }
    await client.end();
  }
}

main().catch((err) => {
  console.error("\n" + String(err instanceof Error ? err.message : err));
  process.exit(1);
});
