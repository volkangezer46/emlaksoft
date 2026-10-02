/**
 * Migration integrity gate.
 *
 * Offline mode validates naming, ordering identifiers, duplicate contents and
 * checksums. `--database` additionally compares the immutable files with the
 * read-only `schema_migrations` ledger and fails if production is behind.
 * Nothing in this script writes to the database.
 */
import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
import pg from "pg";
import {
  migrationFileChecksum,
  migrationFileMatchesChecksum,
} from "../src/lib/migration-integrity.ts";

dotenv.config({ path: ".env.local", quiet: true });

const migrationsDir = path.join(process.cwd(), "supabase", "migrations");
const filenamePattern = /^(\d{14})([a-z]?)_[a-z0-9_]+\.sql$/;
const args = new Set(process.argv.slice(2));
const checkDatabase = args.has("--database");
const releaseFormat = args.has("--release");

// Historical collisions predate this gate and may already exist in deployed
// ledgers. Renaming them would make an applied database look incomplete. New
// collisions fail; these exact sets are frozen compatibility exceptions.
const legacySequenceCollisions = new Map<string, readonly string[]>([
  ["20260726000058", ["20260726000058_error_logs_grants.sql", "20260726000058_kvkk_lifecycle.sql"]],
  ["20260726000087", ["20260726000087_contract_types.sql", "20260726000087b_contract_types_usage.sql"]],
  ["20260727000108", ["20260727000108_permission_defaults_backfill.sql", "20260727000108_property_keys.sql"]],
]);

function sameMembers(left: readonly string[], right: readonly string[]): boolean {
  return [...left].sort().join("\0") === [...right].sort().join("\0");
}

function validDatePrefix(value: string): boolean {
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(4, 6));
  const day = Number(value.slice(6, 8));
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
}

function migrationFiles(): string[] {
  if (!fs.existsSync(migrationsDir)) throw new Error(`migration dizini bulunamadı: ${migrationsDir}`);
  return fs.readdirSync(migrationsDir).filter((name) => name.endsWith(".sql")).sort((a, b) => a.localeCompare(b, "en"));
}

async function main() {
  const files = migrationFiles();
  const issues: string[] = [];
  const hashes = new Map<string, string[]>();
  const sequences = new Map<string, string[]>();
  const lowerNames = new Map<string, string[]>();

  for (const file of files) {
    const match = filenamePattern.exec(file);
    if (!match) {
      issues.push(`${file}: ad biçimi YYYYMMDDNNNNNN[_harf]_aciklama.sql olmalı`);
      continue;
    }
    if (!validDatePrefix(match[1])) issues.push(`${file}: ilk 8 hane geçerli bir UTC tarihi değil`);
    const fullPath = path.join(migrationsDir, file);
    if (fs.readFileSync(fullPath, "utf8").trim().length === 0) issues.push(`${file}: dosya boş`);

    const hash = migrationFileChecksum(fullPath);
    hashes.set(hash, [...(hashes.get(hash) ?? []), file]);
    sequences.set(match[1], [...(sequences.get(match[1]) ?? []), file]);
    lowerNames.set(file.toLowerCase(), [...(lowerNames.get(file.toLowerCase()) ?? []), file]);
  }

  for (const [name, matches] of lowerNames) {
    if (matches.length > 1) issues.push(`büyük/küçük harf duyarsız yinelenen dosya adı (${name}): ${matches.join(", ")}`);
  }
  for (const [hash, matches] of hashes) {
    if (matches.length > 1) issues.push(`aynı SQL içeriği (${hash}): ${matches.join(", ")}`);
  }
  for (const [sequence, matches] of sequences) {
    if (matches.length < 2) continue;
    const allowed = legacySequenceCollisions.get(sequence);
    if (!allowed || !sameMembers(matches, allowed)) {
      issues.push(`yinelenen 14 haneli migration sırası ${sequence}: ${matches.join(", ")}`);
    }
  }
  for (const [sequence, allowed] of legacySequenceCollisions) {
    const current = sequences.get(sequence) ?? [];
    if (!sameMembers(current, allowed)) {
      issues.push(`eski çakışma allowlist'i artık eşleşmiyor (${sequence}); allowlist'i gözden geçirin`);
    }
  }

  const latest = files.at(-1);
  if (!latest) issues.push("migration dosyası yok");
  const latestChecksum = latest ? migrationFileChecksum(path.join(migrationsDir, latest)) : null;

  if (checkDatabase && issues.length === 0) {
    const databaseUrl = process.env.DATABASE_POOLER_URL || process.env.DATABASE_URL;
    if (!databaseUrl) throw new Error("--database için DATABASE_POOLER_URL veya DATABASE_URL gerekli");

    const client = new pg.Client({
      connectionString: databaseUrl,
      ssl: { rejectUnauthorized: false },
      connectionTimeoutMillis: 20_000,
    });
    try {
      await client.connect();
      const tracker = await client.query<{ table_name: string | null }>(
        "select to_regclass('public.schema_migrations')::text as table_name",
      );
      if (!tracker.rows[0]?.table_name) {
        issues.push("public.schema_migrations yok; önce kontrollü baseline gerekli");
      } else {
        const appliedResult = await client.query<{ version: string; checksum: string }>(
          "select version, checksum from public.schema_migrations order by version",
        );
        const applied = new Map(appliedResult.rows.map((row) => [row.version, row.checksum]));
        const fileSet = new Set(files);

        for (const row of appliedResult.rows) {
          if (!fileSet.has(row.version)) {
            issues.push(`ledger kaydı diskte yok: ${row.version}`);
            continue;
          }
          const fullPath = path.join(migrationsDir, row.version);
          const current = migrationFileChecksum(fullPath);
          if (!migrationFileMatchesChecksum(fullPath, row.checksum)) {
            issues.push(`checksum drift: ${row.version} (DB ${row.checksum}, disk ${current})`);
          }
        }
        for (const file of files) {
          if (!applied.has(file)) issues.push(`veritabanında bekleyen migration: ${file}`);
        }
      }
    } finally {
      await client.end().catch(() => undefined);
    }
  }

  if (issues.length > 0) {
    console.error(`Migration kontratı başarısız (${issues.length} sorun):`);
    for (const issue of issues) console.error(`  - ${issue}`);
    process.exit(1);
  }

  if (releaseFormat && latest && latestChecksum) {
    console.log(`RELEASE_MIGRATION=${latest}`);
    console.log(`RELEASE_MIGRATION_CHECKSUM=${latestChecksum}`);
    return;
  }
  console.log(`Migration kontratı sağlıklı: ${files.length} dosya · son ${latest} · sha256 ${latestChecksum}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
