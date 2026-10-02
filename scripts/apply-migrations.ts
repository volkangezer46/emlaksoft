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
 *  * Checksum tutar; uygulanmış dosya değiştirildiyse devam etmeyi reddeder.
 *
 * KULLANIM
 *   npm run db:migrate                 → eksik migration'ları uygula
 *   npm run db:migrate -- --dry-run    → ne çalışacağını göster, dokunma
 *   npm run db:migrate -- --baseline --only <dosya> --confirm-schema-present
 *                                      → yalnız kanıtı doğrulanan tek dosyayı
 *                                        çalıştırmadan ledger'a işle
 *   npm run db:migrate -- --only 20260725000049_property_price_history.sql
 *
 * `--baseline` toplu çalışmaz. Her satır, built-in salt-okunur şema kanıtı ve
 * açık operatör onayıyla tek tek uzlaştırılır.
 */

import fs from "node:fs";
import path from "node:path";
import pg from "pg";
import dotenv from "dotenv";
import {
  migrationFileChecksum,
  migrationFileMatchesChecksum,
} from "../src/lib/migration-integrity.ts";
import {
  CORE_WORKFLOW_INVARIANT_MIGRATION,
  CORE_WORKFLOW_PREFLIGHT_SQL,
  CORE_WORKFLOW_SCAFFOLD_MIGRATION,
  coreWorkflowBlockerTotal,
  formatCoreWorkflowCounts,
  type CoreWorkflowPreflightRow,
} from "../src/lib/core-workflow-preflight.ts";

dotenv.config({ path: ".env.local", quiet: true });

const { Client } = pg;

const MIGRATIONS_DIR = "supabase/migrations";
const LOCK_KEY = 4_872_119; // rastgele sabit — yalnızca bu araç kullanır

/**
 * Historical production schema changes that may predate their ledger rows.
 *
 * These probes are deliberately read-only and conservative. They do not
 * auto-attest a migration: finding schema evidence only stops the runner so a
 * human can reconcile that exact ledger row after reviewing the full change.
 * This prevents both dangerous outcomes:
 *   1. replaying an already-applied, non-idempotent migration; and
 *   2. using --baseline to skip genuinely pending migrations that follow it.
 */
const SCHEMA_EVIDENCE_PROBES: Readonly<Record<string, string>> = {
  "20260802000146_security_and_support_lifecycle_hardening.sql": `
    select to_regprocedure('public.support_ticket_metrics_v2(uuid)') is not null
       and to_regprocedure('public.check_rate_limit(text,integer,integer)') is not null as present
  `,
  "20260802000147_webhook_compliance_hardening.sql": `
    select to_regclass('public.public_lead_consent_events') is not null
       and to_regclass('public.iys_consent_events') is not null
       and to_regclass('public.storage_deletion_outbox') is not null as present
  `,
  "20260802000300_identity_session_authorization_hardening.sql": `
    select to_regclass('public.two_factor_verified_sessions') is not null
       and to_regclass('public.platform_impersonation_sessions') is not null
       and to_regprocedure('public.current_active_tenant_id()') is not null as present
  `,
  "20260802000320_plan_entitlements.sql": `
    select to_regclass('public.plan_entitlements') is not null
       and to_regprocedure('public.enforce_plan_capacity()') is not null as present
  `,
  "20260802000340_reporting_aggregates.sql": `
    select to_regprocedure('public.tenant_reporting_aggregates(timestamp with time zone)') is not null
       and to_regprocedure('public.platform_reporting_aggregates(date,date,timestamp with time zone)') is not null as present
  `,
  "20260802000360_observability_privacy_hardening.sql": `
    select to_regclass('public.uq_error_logs_fingerprint') is not null
       and to_regprocedure('public.record_error_occurrence(uuid,uuid,text,text,text,text,text,text,text)') is not null as present
  `,
  "20260802000380_public_schema_security_boundary.sql": `
    select not has_schema_privilege('anon', 'public', 'CREATE')
       and not has_schema_privilege('authenticated', 'public', 'CREATE')
       and not has_schema_privilege('service_role', 'public', 'CREATE')
       and coalesce(obj_description('public'::regnamespace, 'pg_namespace'), '') like 'Application schema.%'
       as present
  `,
  "20260802000400_atomic_demo_conversion.sql": `
    select to_regprocedure('public.convert_demo_request_to_tenant(uuid,uuid,uuid,text)') is not null as present
  `,
  "20260802000420_customer_document_security_boundary.sql": `
    select count(*) = 4 as present
    from pg_constraint
    where conname in (
      'customer_files_customer_tenant_fkey',
      'customer_files_uploader_tenant_fkey',
      'property_media_property_tenant_fkey',
      'property_media_uploader_tenant_fkey'
    )
  `,
  "20260802000440_tenant_expense_aggregates.sql": `
    select to_regprocedure('public.tenant_expense_aggregates(date,date,timestamp with time zone)') is not null as present
  `,
  "20260802000460_permission_defaults_read_policy.sql": `
    select exists (
      select 1 from pg_policies
      where schemaname = 'public'
        and tablename = 'permission_defaults'
        and policyname = 'permission_defaults_read'
    ) as present
  `,
  "20260802000480_invoices_conversation_id_unique_index.sql": `
    select to_regclass('public.uq_invoices_conversation_id') is not null as present
  `,
  "20260802000520_service_role_only_rls_policies.sql": `
    select count(*) = 4 as present
    from pg_policies
    where schemaname = 'public'
      and policyname in (
        'iys_consent_events_service_role_only',
        'lead_capture_token_revocations_service_role_only',
        'public_lead_consent_events_service_role_only',
        'storage_deletion_outbox_service_role_only'
      )
  `,
  "20260802000540_support_ticket_optimistic_concurrency.sql": `
    select to_regprocedure('public.reply_support_ticket_v2(uuid,uuid,uuid,text,text,text,uuid,bigint)') is not null
       and to_regprocedure('public.admin_update_support_ticket_v2(uuid,uuid,text,text,bigint)') is not null as present
  `,
  "20260803000010_comparables_correction_factors.sql": `
    select to_regprocedure('public.find_comparables(uuid,uuid,text,text,numeric,uuid,integer,integer,integer,integer,text,text)') is not null
       and to_regprocedure('public.estimate_property_value(uuid,uuid,text,text,numeric,uuid,integer,integer,text,text)') is not null as present
  `,
  [CORE_WORKFLOW_SCAFFOLD_MIGRATION]: `
    select (
      select count(*) = 4
      from information_schema.columns c
      join (values
        ('deals', 'prev_property_status'),
        ('deals', 'project_unit_id'),
        ('deals', 'closure_active'),
        ('rentals', 'deal_id')
      ) expected(table_name, column_name)
        on expected.table_name = c.table_name
       and expected.column_name = c.column_name
      where c.table_schema = 'public'
    ) and exists (
      select 1 from pg_constraint c
      where c.conrelid = 'public.deals'::regclass
        and c.confrelid = 'public.project_units'::regclass
        and c.conname = 'deals_project_unit_tenant_fkey'
        and c.contype = 'f' and c.convalidated
        and pg_get_constraintdef(c.oid) =
          'FOREIGN KEY (project_unit_id, tenant_id) REFERENCES project_units(id, tenant_id) ON DELETE RESTRICT'
    ) and exists (
      select 1 from pg_constraint c
      where c.conrelid = 'public.rentals'::regclass
        and c.confrelid = 'public.deals'::regclass
        and c.conname = 'rentals_deal_tenant_fkey'
        and c.contype = 'f' and c.convalidated
        and pg_get_constraintdef(c.oid) =
          'FOREIGN KEY (deal_id, tenant_id) REFERENCES deals(id, tenant_id) ON DELETE RESTRICT'
    ) as present
  `,
};

const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const BASELINE = args.includes("--baseline");
const CONFIRM_SCHEMA_PRESENT = args.includes("--confirm-schema-present");
const onlyIndex = args.indexOf("--only");
const ONLY = onlyIndex >= 0 ? args[onlyIndex + 1] : null;

if (BASELINE && (!ONLY || !CONFIRM_SCHEMA_PRESENT)) {
  throw new Error(
    "--baseline yalnız --only <dosya> --confirm-schema-present ile tek satırlık şema attestation'ı olarak kullanılabilir.",
  );
}
if (CONFIRM_SCHEMA_PRESENT && !BASELINE) {
  throw new Error("--confirm-schema-present yalnız --baseline ile kullanılabilir.");
}

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

function redact(url: string): string {
  return url.replace(/:[^:@]+@/, ":****@");
}

async function pendingMigrationsWithSchemaEvidence(
  client: InstanceType<typeof Client>,
  pending: readonly string[],
): Promise<string[]> {
  const found: string[] = [];
  for (const version of pending) {
    const probe = SCHEMA_EVIDENCE_PROBES[version];
    if (!probe) continue;
    const { rows } = await client.query<{ present: boolean }>(probe);
    if (rows[0]?.present === true) found.push(version);
  }
  return found;
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

    const { rows: ledgerRows } = await client.query<{ ledger: string | null }>(
      "select to_regclass('public.schema_migrations')::text as ledger",
    );
    const ledgerExists = Boolean(ledgerRows[0]?.ledger);

    const allFiles = listMigrations();
    if (ONLY && !allFiles.includes(ONLY)) {
      throw new Error(`--only migration dosyası bulunamadı: ${ONLY}`);
    }
    const files = ONLY ? [ONLY] : allFiles;
    const { rows: appliedRows } = ledgerExists
      ? await client.query<{ version: string; checksum: string }>(
          "select version, checksum from public.schema_migrations",
        )
      : { rows: [] as Array<{ version: string; checksum: string }> };
    const applied = new Map(appliedRows.map((r) => [r.version, r.checksum]));

    console.log(`\ndiskte ${files.length} migration · veritabanında ${applied.size} kayıtlı`);

    // Uygulandıktan sonra değiştirilmiş dosya forward-only sözleşmesini
    // bozar. Uyarıyla devam etmek ledger'ı sessizce yeniden yazabiliyordu.
    for (const file of allFiles) {
      const known = applied.get(file);
      if (!known) continue;
      const fullPath = path.join(MIGRATIONS_DIR, file);
      const current = migrationFileChecksum(fullPath);
      if (!migrationFileMatchesChecksum(fullPath, known)) {
        throw new Error(
          `${file} uygulandıktan sonra değiştirilmiş (DB ${known}, disk ${current}). ` +
          "Geçmiş dosyayı düzeltmek yerine yeni forward migration ekleyin.",
        );
      }
    }

    // Reconciliation safety is always evaluated against the complete disk
    // inventory. `--only` must never bypass an earlier schema/ledger split.
    const allPending = allFiles.filter((f) => !applied.has(f));
    let pending = files.filter((f) => !applied.has(f));
    let stoppedAtCoreWorkflowScaffold = false;

    // A missing ledger row is not proof that its SQL is missing. Refuse before
    // either replaying SQL or baselining later migrations when reviewed schema
    // evidence says an exact historical row needs selective reconciliation.
    const reconciliationRequired = await pendingMigrationsWithSchemaEvidence(
      client,
      allPending,
    );
    if (!BASELINE && reconciliationRequired.length > 0) {
      throw new Error(
        "Ledger/şema ayrışması bulundu; otomatik migrate/baseline reddedildi. " +
          "Aşağıdaki migration'ları kanıt sorgularıyla inceleyip yalnız doğrulanan " +
          "satırları schema_migrations ledger'ına seçici olarak uzlaştırın:\n  - " +
          reconciliationRequired.join("\n  - "),
      );
    }

    if (BASELINE && (!ONLY || !reconciliationRequired.includes(ONLY))) {
      throw new Error(
        `${ONLY ?? "Seçilen migration"} için built-in salt-okunur şema kanıtı doğrulanmadı; baseline reddedildi.`,
      );
    }

    // The core workflow cut-over is intentionally two-stage.  Never let a
    // broad migrate install the scaffold and immediately enforce invariants
    // against unreconciled historical ledgers in the same run.
    if (allPending.includes(CORE_WORKFLOW_INVARIANT_MIGRATION)) {
      if (allPending.includes(CORE_WORKFLOW_SCAFFOLD_MIGRATION)) {
        const earlierPending = allPending.filter((file) => file < CORE_WORKFLOW_SCAFFOLD_MIGRATION);
        if (ONLY === CORE_WORKFLOW_INVARIANT_MIGRATION) {
          throw new Error(
            `Core workflow cut-over iki aşamalıdır. Önce ${CORE_WORKFLOW_SCAFFOLD_MIGRATION} ` +
            "uygulanmalı; ardından npm run check:workflow-data çalıştırılıp runbook ile uzlaştırılmalıdır.",
          );
        }
        if (ONLY === CORE_WORKFLOW_SCAFFOLD_MIGRATION && earlierPending.length > 0) {
          throw new Error(
            `Scaffold önkoşulları henüz bekliyor (${earlierPending.length} migration). ` +
            "Önce normal migrate ile scaffold dahil birinci fazı tamamlayın.",
          );
        }
        if (!ONLY) {
          pending = pending.filter((file) => file <= CORE_WORKFLOW_SCAFFOLD_MIGRATION);
          stoppedAtCoreWorkflowScaffold = true;
        }
      } else if (ONLY !== CORE_WORKFLOW_SCAFFOLD_MIGRATION) {
        const result = await client.query<CoreWorkflowPreflightRow>(CORE_WORKFLOW_PREFLIGHT_SQL);
        const row = result.rows[0] ?? {};
        const blockers = coreWorkflowBlockerTotal(row);
        console.log(`\ncore workflow preflight: ${formatCoreWorkflowCounts(row)}`);
        if (blockers > 0) {
          throw new Error(
            `Core workflow reconciliation gerekli (${blockers} blocker). ` +
            "docs/runbooks/CORE_WORKFLOW_RECONCILIATION.md tamamlanmadan invariant migration uygulanamaz.",
          );
        }
      }
    }

    // No persistent write is allowed until BOTH safety gates above have
    // passed: historical checksums and schema/ledger reconciliation evidence.
    // This also makes a rejected normal run observationally read-only.
    if (!DRY_RUN && (BASELINE || pending.length > 0)) {
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
      // Health readiness service-role ile ledger'ı salt okunur gözlemler. Anon ve
      // authenticated rolleri migration envanterini doğrudan okuyamaz.
      await client.query(`
        revoke all on table public.schema_migrations from anon, authenticated;
        grant select on table public.schema_migrations to service_role
      `);
    }

    if (BASELINE) {
      const toMark = files.filter((f) => !applied.has(f));
      console.log(`\n--baseline attestation: ${ONLY} SQL ÇALIŞTIRILMADAN ledger'a işaretlenecek`);
      if (DRY_RUN) {
        for (const f of toMark) console.log("  işaretlenecek:", f);
      } else {
        for (const f of toMark) {
          await client.query(
            "insert into public.schema_migrations(version, checksum) values ($1,$2) on conflict (version) do nothing",
            [f, migrationFileChecksum(path.join(MIGRATIONS_DIR, f))],
          );
          console.log("  işaretlendi:", f);
        }
      }
      console.log(
        DRY_RUN
          ? "\nseçici baseline önizlemesi tamam; ledger değişmedi."
          : `\nseçici baseline tamam: ${ONLY} ledger'a işlendi.`,
      );
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
          [file, migrationFileChecksum(full)],
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
    if (stoppedAtCoreWorkflowScaffold) {
      console.log(
        `Core workflow birinci fazı ${CORE_WORKFLOW_SCAFFOLD_MIGRATION} noktasında güvenle durdu. ` +
        "Şimdi npm run check:workflow-data ve docs/runbooks/CORE_WORKFLOW_RECONCILIATION.md adımlarını tamamlayın.",
      );
    }
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
