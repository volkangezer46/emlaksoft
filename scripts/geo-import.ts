/**
 * Coğrafya toplu içe aktarma (CLI) — /admin/geo/ice-aktar ile AYNI çekirdek mantık
 * (src/lib/geo/import-plan.ts + import-apply.ts): ayrıştırma, doğrulama, fark planı, partili uygulama,
 * sürüm kaydı (geri alınabilir). Büyük kaynaklar (3 MB üstü) için bu yol kullanılır.
 *
 * Kullanım:
 *   npm run geo:import -- --file veri.csv --dry-run                      # salt okunur fark özeti
 *   npm run geo:import -- --file veri.json --dry-run --mode full         # tam kaynak (81 il şart)
 *   npm run geo:import -- --file veri.csv --dry-run --against snap.json   # DB'ye bağlanmadan, anlık görüntüyle
 *   npm run geo:import -- --file veri.csv --apply --source turkiyeapi-v2 --version 2025 --date 2026-05-21
 *
 * Biçim: CSV/JSON düz satırlar (plate_code,province,district,neighborhood,source_id,postal_code,lat,lng,population).
 * Şablon ve alan açıklaması: src/lib/geo/DATA_SOURCES.md ve import-plan.ts başlığı.
 *
 * --apply canlı DB'ye yazar: yalnız restore edilebilir backup/PITR doğrulandıktan sonra, geo yönetim migration'ı
 * (geo_data_versions) uygulanmışken çalışır; yerel olmayan hostta GEO_IMPORT_CONFIRM=1 ister. Silme YOKTUR.
 */
import { readFileSync } from "node:fs";
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { buildImportPlan, parseImport, type ExistingGeo } from "../src/lib/geo/import-plan";
import { applyImportPlan, loadExistingGeo } from "../src/lib/geo/import-apply";

dotenv.config({ path: ".env.local" });

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const flag = (name: string) => process.argv.includes(`--${name}`);

async function main() {
  const file = arg("file");
  const apply = flag("apply");
  const dry = flag("dry-run") || !apply;
  const mode = arg("mode") === "full" ? "full" : "merge";
  if (!file) {
    console.error("--file <csv|json> gerekli. Örnek: npm run geo:import -- --file veri.csv --dry-run");
    process.exit(1);
  }
  if (apply && flag("dry-run")) {
    console.error("--apply ile --dry-run birlikte kullanılamaz.");
    process.exit(1);
  }

  const parsed = parseImport(readFileSync(file, "utf8"));
  if (parsed.errors.length) {
    console.error("Dosya okunamadı:\n - " + parsed.errors.join("\n - "));
    process.exit(1);
  }
  console.log(`Dosya: ${file} · ${parsed.rows.length.toLocaleString("tr-TR")} satır · kip: ${mode}`);

  const against = arg("against");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (apply && against) {
    console.error("--against yalnız kuru çalıştırma içindir.");
    process.exit(1);
  }
  const client = !against && url && key ? createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } }) : null;

  let existing: ExistingGeo;
  if (against) {
    existing = JSON.parse(readFileSync(against, "utf8")) as ExistingGeo;
    console.log(`Anlık görüntü: ${against} (DB'ye bağlanılmadı)`);
  } else if (client) {
    console.log(`Hedef DB: ${new URL(url as string).hostname}`);
    existing = await loadExistingGeo(client);
  } else {
    console.error("DB bilgisi yok (NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SECRET_KEY) ve --against verilmedi.");
    process.exit(1);
  }
  console.log(`Mevcut: ${existing.provinces.length} il · ${existing.districts.length} ilçe · ${existing.neighborhoods.length} mahalle`);

  const plan = buildImportPlan(parsed.rows, existing, { mode });
  for (const w of plan.warnings.slice(0, 10)) console.warn("UYARI:", w);
  if (plan.errors.length) {
    console.error(`\n${plan.errors.length} HATA (ilk 20):\n - ` + plan.errors.slice(0, 20).join("\n - "));
    process.exit(1);
  }
  const s = plan.summary;
  const tot = (c: Record<string, number>) => c.province + c.district + c.neighborhood;
  console.log("\nFARK ÖZETİ");
  console.log(`  eklenecek   : ${tot(s.add)}  (il ${s.add.province} · ilçe ${s.add.district} · mahalle ${s.add.neighborhood})`);
  console.log(`  değişecek   : ${tot(s.change)}  (il ${s.change.province} · ilçe ${s.change.district} · mahalle ${s.change.neighborhood})`);
  console.log(`  pasife alın.: ${tot(s.deactivate)}  (ilçe ${s.deactivate.district} · mahalle ${s.deactivate.neighborhood})`);
  console.log(`  değişmeyen  : ${s.unchanged} · atlanan pasif kayıt: ${s.skippedInactive}`);
  for (const op of plan.ops.filter((o) => o.op !== "insert").slice(0, 15)) {
    console.log(`  - ${op.op === "update" ? "değişecek" : "pasife"}: ${op.path}`);
  }

  if (dry) {
    console.log("\nKURU ÇALIŞTIRMA: hiçbir şey yazılmadı. Uygulamak için --apply.");
    return;
  }
  if (!client || !url) {
    console.error("Uygulama için DB bilgisi gerekli.");
    process.exit(1);
  }
  const host = new URL(url).hostname;
  if (!["localhost", "127.0.0.1", "0.0.0.0", "kong"].includes(host) && process.env.GEO_IMPORT_CONFIRM !== "1") {
    console.error(`\nHedef ${host} yerel değil. Backup/PITR doğruladıysanız GEO_IMPORT_CONFIRM=1 ile yeniden çalıştırın.`);
    process.exit(1);
  }
  const result = await applyImportPlan(client, plan, {
    actorId: null,
    actorLabel: "cli:geo-import",
    meta: { source: arg("source") ?? "cli-import", version: arg("version"), date: arg("date") },
    mode,
    fileName: file.split(/[\\/]/).pop() ?? null,
  });
  if (!result.ok) {
    console.error(`\nUYGULANAMADI: ${result.error}${result.versionId ? ` (sürüm ${result.versionId}; /admin/geo/surumler'den geri alınabilir)` : ""}`);
    process.exit(1);
  }
  console.log(`\nUYGULANDI. Sürüm: ${result.versionId} (/admin/geo/surumler'den geri alınabilir). Önbellek 15 dk içinde ya da bir yönetim yazımında tazelenir.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
