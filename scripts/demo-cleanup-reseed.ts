/**
 * DM1 TEK SEFERLİK DEMO TEMİZLİĞİ + YENİDEN TOHUM (üretim). VARSAYILAN KURU ÇALIŞTIRMA: hiçbir şey yazmaz, yalnız raporlar.
 *
 *   npx tsx scripts/demo-cleanup-reseed.ts                                   # kuru çalıştırma (rapor)
 *   npx tsx scripts/demo-cleanup-reseed.ts --apply                           # genel demo ofisi: [SAHA] temizliği + seed:demo + taban görüntüsü
 *   npx tsx scripts/demo-cleanup-reseed.ts --apply --upgrade-sample-offices  # + gerçek kaydı OLMAYAN demo modundaki ofislere yeni zengin set
 *   seçenek: --env-file .env.production (varsayılan: .env.production varsa o, yoksa .env.local)
 *
 * Adımlar (--apply):
 *  1. Genel demo ofisinde (slug demo-ofis) "[SAHA]" test kalıntıları `demo_tenant_saha_cleanup` ile silinir (gece sıfırlamasıyla
 *     aynı SQL; FK yüzünden silinemeyen yumuşak silinir).
 *  2. `scripts/seed-demo.ts` (SEED_CONFIRM=1) demo ofisi tamamlar: kütüphane fotoğrafları, eksik bölümler; sonunda
 *     `demo_tenant_capture_baseline` ile taban + tohum görüntüsü alınır (gece sıfırlaması bu görüntüye döner).
 *  3. --upgrade-sample-offices: `sample_seeded_at` dolu, gerçek kaydı (is_sample=false müşteri/portföy) OLMAYAN her ofiste
 *     eski örnekler purge v2 ile silinir, 10 dk'lık izinle yeni zengin set yüklenir, kilit kaldırılır. Gerçek kaydı olan
 *     ofise DOKUNULMAZ (DB tetikleyicisi de reddeder).
 *  4. Son koşul: demo ofiste 0 "[SAHA]" satırı (değişmez); ihlalde çıkış kodu 1.
 * Sırlar yazdırılmaz; yalnız hedef host ve sayılar.
 */
import "./lib/server-only-stub.cjs"; // `server-only` CLI'da yok: sunucu modüllerinden ÖNCE boş modüle eşlenir
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import dotenv from "dotenv";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { DEMO_TENANT_SLUG } from "../src/lib/demo-tenant";
import { findSahaRows } from "../src/lib/demo-seed-invariants";
import { insertSampleRecords, type SampleGeoResolver } from "../src/lib/sample-data-seed";
import { removeSamplePersonaIdentities } from "../src/lib/sample-data/personas";
import { personasFromRpc } from "../src/lib/sample-data/purge";

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const UPGRADE = args.includes("--upgrade-sample-offices");
const envArg = args.indexOf("--env-file");
const envFile = envArg >= 0 ? args[envArg + 1]! : existsSync(".env.production") ? ".env.production" : ".env.local";
dotenv.config({ path: resolve(process.cwd(), envFile) });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error(`NEXT_PUBLIC_SUPABASE_URL / servis anahtarı eksik (${envFile})`);
  process.exit(1);
}
const db: SupabaseClient = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
console.log(`Hedef: ${new URL(url).hostname} · env: ${envFile} · kip: ${APPLY ? "UYGULA" : "KURU ÇALIŞTIRMA (yazma yok)"}${UPGRADE ? " + ofis yükseltme" : ""}`);

const SAHA_COLUMNS: readonly [string, string][] = [
  ["customers", "full_name"], ["properties", "title"], ["tasks", "title"], ["expenses", "title"], ["notifications", "title"],
  ["campaigns", "title"], ["contracts", "title"], ["appointments", "location"], ["offers", "notes"],
];

async function sahaRows(tenantId: string): Promise<string[]> {
  const out: string[] = [];
  for (const [table, col] of SAHA_COLUMNS) {
    const base = () => db.from(table).select(`id, ${col}`).eq("tenant_id", tenantId).like(col, "[SAHA]%").limit(500);
    let { data, error } = await base().is("deleted_at", null);
    if (error) ({ data, error } = await base());
    if (error) continue;
    const rows = (data ?? []) as unknown as Record<string, unknown>[];
    out.push(...findSahaRows(rows.map((r) => ({ id: String(r.id), label: String(r[col] ?? "") }))).map((id) => `${table}:${id}`));
  }
  return out;
}

/** Next dışında coğrafya çözümü (resolveGeo'nun önbelleği yok): ad ile doğrudan sorgu, belirsizde null. */
const geoResolver: SampleGeoResolver = async (input) => {
  const empty = { provinceId: null, provinceName: null, districtId: null, districtName: null, neighborhoodId: null, neighborhoodName: null };
  const { data: prov } = await db.from("geo_provinces").select("id, name").eq("name", String(input.province ?? "")).limit(1).maybeSingle();
  if (!prov) return { status: "unmatched", reason: "il yok" };
  const { data: dist } = await db.from("geo_districts").select("id, name").eq("province_id", prov.id).eq("name", String(input.district ?? "")).limit(1).maybeSingle();
  if (!dist) return { status: "unmatched", reason: "ilçe yok" };
  let hood: { id: string; name: string } | null = null;
  if (input.neighborhood) {
    const { data } = await db.from("geo_neighborhoods").select("id, name").eq("district_id", dist.id).eq("name", String(input.neighborhood)).limit(1).maybeSingle();
    if (!data) return { status: "unmatched", reason: "mahalle yok" };
    hood = data as { id: string; name: string };
  }
  return {
    status: "ok",
    via: "exact",
    geo: { ...empty, provinceId: prov.id, provinceName: prov.name, districtId: dist.id, districtName: dist.name, neighborhoodId: hood?.id ?? null, neighborhoodName: hood?.name ?? null },
  };
};

async function upgradeOffices(): Promise<number> {
  const { data: offices, error } = await db.from("tenants").select("id, name, slug, sample_pack").not("sample_seeded_at", "is", null).neq("slug", DEMO_TENANT_SLUG);
  if (error) throw new Error(`Demo modundaki ofisler okunamadı: ${error.message}`);
  let upgraded = 0;
  for (const t of (offices ?? []) as { id: string; name: string; slug: string | null; sample_pack: string | null }[]) {
    const { data: real, error: rErr } = await db.rpc("tenant_real_record_count", { p_tenant_id: t.id });
    if (rErr) throw new Error("tenant_real_record_count yok: önce 20261024020000 migration'ı uygulanmalı.");
    if (Number(real ?? 0) > 0) {
      console.log(`- ${t.name}: gerçek kayıt var → atlandı`);
      continue;
    }
    const { data: owner } = await db.from("profiles").select("id").eq("tenant_id", t.id).eq("role", "owner").eq("is_sample", false).eq("is_active", true).limit(1).maybeSingle();
    if (!owner) {
      console.log(`- ${t.name}: sahip yok → atlandı`);
      continue;
    }
    if (!APPLY) {
      console.log(`· ${t.name}: yükseltilecek (eski örnekler silinir, yeni zengin set yüklenir)`);
      upgraded++;
      continue;
    }
    const { data: purged, error: pErr } = await db.rpc("purge_tenant_sample_data", { p_tenant_id: t.id });
    if (pErr) {
      console.error(`! ${t.name}: temizlik başarısız (${pErr.code}) → atlandı`);
      continue;
    }
    await removeSamplePersonaIdentities(db, personasFromRpc(purged));
    await db.from("tenants").update({ sample_seed_override_until: new Date(Date.now() + 10 * 60_000).toISOString() }).eq("id", t.id);
    try {
      const pack = t.sample_pack === "ticari" || t.sample_pack === "arsa" ? t.sample_pack : "konut";
      const rep = await insertSampleRecords(db, t.id, String((owner as { id: string }).id), { extrasDb: db, pack, resolveGeo: geoResolver });
      await db
        .from("tenants")
        .update({ sample_seeded_at: new Date().toISOString(), sample_pack: pack, sample_cleared_at: null, real_use_at: null, sample_seed_override_until: null })
        .eq("id", t.id);
      console.log(`✓ ${t.name}: ${rep.counts.customers ?? 0} müşteri, ${rep.counts.properties ?? 0} portföy${rep.failed.length ? ` · hata veren grup: ${rep.failed.map((f) => f.group).join(", ")}` : ""}`);
      upgraded++;
    } catch (e) {
      await db.from("tenants").update({ sample_seed_override_until: null }).eq("id", t.id);
      console.error(`! ${t.name}: yükleme başarısız (${e instanceof Error ? e.message : "?"}); ofis kilitli kaldı, admin panelinden yeniden denenebilir`);
    }
  }
  return upgraded;
}

async function main() {
  const { data: demo, error } = await db.from("tenants").select("id, name").eq("slug", DEMO_TENANT_SLUG).maybeSingle();
  if (error) throw new Error(`Demo ofis okunamadı: ${error.message}`);
  if (!demo) console.log("- Genel demo ofisi yok (ilk demo girişinde açılır); yalnız ofis yükseltmesi değerlendirilir.");

  if (demo) {
    const before = await sahaRows(demo.id);
    console.log(`Genel demo ofisi: ${demo.name} · [SAHA] kalıntısı: ${before.length}`);
    if (APPLY) {
      const { data: cleaned, error: cErr } = await db.rpc("demo_tenant_saha_cleanup", { p_tenant_id: demo.id, p_now: new Date().toISOString(), p_dry_run: false });
      if (cErr) throw new Error(`demo_tenant_saha_cleanup yok (${cErr.code}): önce 20261024020200 migration'ı uygulanmalı.`);
      console.log(`✓ [SAHA] temizliği: ${(cleaned as { total?: number } | null)?.total ?? 0} satır`);
      const run = spawnSync("npx", ["tsx", "--require", "./scripts/lib/server-only-stub.cjs", "scripts/seed-demo.ts"], { stdio: "inherit", env: { ...process.env, SEED_CONFIRM: "1" } });
      if (run.status !== 0) throw new Error(`seed-demo.ts çıkış kodu ${run.status}`);
    } else {
      console.log("· Uygulanırsa: [SAHA] temizliği → seed:demo (fotoğraf kütüphanesi + eksik bölümler) → taban + tohum görüntüsü");
    }
  }

  if (UPGRADE) console.log(`Ofis yükseltmesi: ${await upgradeOffices()} ofis${APPLY ? " yükseltildi" : " yükseltilecek"}`);

  if (demo && APPLY) {
    const after = await sahaRows(demo.id);
    if (after.length) {
      console.error(`! [SAHA] değişmezi İHLAL: ${after.length} satır kaldı (${after.slice(0, 5).join(", ")})`);
      process.exitCode = 1;
    } else console.log("✓ [SAHA] değişmezi: 0 satır");
  }
  if (!APPLY) console.log("Kuru çalıştırma bitti. Uygulamak için --apply ekleyin.");
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
