/**
 * Migration cift/grup/pencere denetimi (SALT-OKUNUR, DB'ye BAGLANMAZ, dosya yazmaz).
 *
 *   npm run check:migration-pairs            → rapor; hata varsa cikis kodu 1
 *   npm run check:migration-pairs -- --json  → makine okunur cikti
 *
 * `check:migrations` (validate-migrations.ts) ile BIRLESTIRILMEZ; onun sozlesmesi degismez ve bu komut CI'ya bagli
 * degildir. Amac: sahibin yayin penceresinden once numara cakismalarini, birlikte uygulanmasi gereken
 * gruplari ve etki siniflarini gormesi. Mantik: src/lib/migration-pairs.ts · veri: scripts/migration-pairs-data.ts.
 */
import fs from "node:fs";
import path from "node:path";
import {
  IMPACT_LABELS,
  findVersionCollisions,
  impactTable,
  summarizeFindings,
  validateGroups,
  type Finding,
} from "../src/lib/migration-pairs.ts";
import { LEGACY_MIGRATION_VERSIONS, MIGRATION_GROUP_SPEC } from "./migration-pairs-data.ts";

const root = path.join(process.cwd(), "supabase");

function list(dir: string): string[] {
  const full = path.join(root, dir);
  return fs.existsSync(full) ? fs.readdirSync(full).filter((f) => f.endsWith(".sql")).sort() : [];
}

const migrations = list("migrations");
const proposed = list("proposed");
const rollbacks = list("rollbacks");

const collisions = findVersionCollisions(migrations, proposed, {
  legacyMigrationVersions: LEGACY_MIGRATION_VERSIONS,
});
const groups = validateGroups(migrations, MIGRATION_GROUP_SPEC);
const table = impactTable(migrations, rollbacks, MIGRATION_GROUP_SPEC);
const all: Finding[] = [...collisions, ...groups];
const counts = summarizeFindings(all);

if (process.argv.includes("--json")) {
  console.log(JSON.stringify({ counts, findings: all, impact: table }, null, 2));
  process.exit(counts.error > 0 ? 1 : 0);
}

const mark = { error: "HATA ", warn: "UYARI", info: "bilgi" } as const;
function print(title: string, findings: Finding[]) {
  console.log(`\n== ${title} (${findings.length}) ==`);
  if (findings.length === 0) console.log("  temiz");
  for (const f of findings) console.log(`  [${mark[f.level]}] ${f.code}: ${f.message}`);
}

console.log(`Migration ciftleri: ${migrations.length} dosya migrations/, ${proposed.length} proposed/, ${rollbacks.length} rollbacks/.`);
print("Surum numarasi cakismalari (migrations/ ve proposed/)", collisions);
print("Birlikte uygulanacak gruplar, pencere ve bagimlilik sirasi", groups);

console.log(`\n== Etki sinifi ve rollback (uygulanmamis ${table.length} dosya) ==`);
for (const row of table) {
  const impact = row.impact ? IMPACT_LABELS[row.impact] : "ETIKETSIZ";
  console.log(`  ${row.window ?? "PENCERESIZ"}  ${row.file}  [${impact}]  rollback:${row.hasRollback ? "var" : "YOK"}`);
}
const noRollback = table.filter((r) => !r.hasRollback).map((r) => r.file);
if (noRollback.length > 0) {
  console.log(`\n  Rollback dosyasi OLMAYAN (${noRollback.length}): ${noRollback.join(", ")}`);
}

console.log(`\nOzet: ${counts.error} hata, ${counts.warn} uyari, ${counts.info} bilgi.`);
if (counts.error > 0) {
  console.log("Cikis kodu 1: bu komut CI'ya bagli degildir; hatalar yayin penceresi oncesi sahibe/ayri goreve raporlanir.");
  process.exit(1);
}
