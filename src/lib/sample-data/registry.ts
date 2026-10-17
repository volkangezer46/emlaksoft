/**
 * ÖRNEK VERİ KAYIT DEFTERİ — TEK KAYNAK (sahip kuralı, 2026-10-24: "her yeni modül/sayfa/varlık AYNI değişiklikte demo
 * verisiyle gelir"). `is_sample` taşıyan her tenant tablosu burada; her satır iki şeyi beyan eder:
 *  - `seed`: örnek veriyi nerede ürettiği (dosya + grup). Tohum yoksa satır `derived` (tetikleyici/kaskat türetir, nedeni
 *    yazılı) ya da geçici `KNOWN_SEED_GAPS` listesindedir (yalnız KÜÇÜLEBİLİR).
 *  - `purge`: "Gerçek kullanıma geç" (purge_tenant_sample_data, son sürüm) onu nasıl kaldırıyor.
 * Sözleşme testi (`registry-contract.test.ts`) migration'ları tarar: `is_sample` sütunu olan ama burada olmayan tablo,
 * tohum dosyasında adı geçmeyen `seed`, RPC gövdesinde olmayan `purge` → test KIRILIR. Ayrıca kesim sürümünden sonra
 * açılan her tenant tablosu ya `is_sample` taşır ve burada yer alır ya da `SAMPLE_EXEMPT`'te gerekçesiyle durur.
 * Adımlar: docs/design/DEMO_VERISI.md "Yeni modül eklerken demo verisi".
 */

export type SampleSeedRef =
  | { kind: "file"; file: string; group: string }
  /** Tohumlanan bir satırdan tetikleyici/kaskatla türer (kendi tohumu gerekmez). */
  | { kind: "derived"; from: string; reason: string };

export type SamplePurgeRef =
  /** RPC çekirdek DELETE'i (`delete from public.<t> where is_sample = true and tenant_id = p_tenant_id`). */
  | { kind: "rpc" }
  /** RPC isteğe bağlı listesi (`v_optional`, tablo yoksa atlanır). */
  | { kind: "rpc-optional" }
  /** Ebeveyn silinince ON DELETE CASCADE ile gider. */
  | { kind: "cascade"; parent: string }
  /** Demo ekip: RPC pasifleştirir + bağsızsa siler; kimlik personas.ts'te silinir. */
  | { kind: "personas" };

export type SampleEntity = { table: string; label: string; seed: SampleSeedRef; purge: SamplePurgeRef };

const CORE = "src/lib/sample-data-seed.ts";
const MODULES = "src/lib/sample-data/modules-seed.ts";
const POOL = "src/lib/sample-data/pool-seed.ts";
const PERSONAS = "src/lib/sample-data/personas.ts";
const PRESENCE = "src/lib/sample-data/presence-seed.ts";

export const SAMPLE_ENTITIES: readonly SampleEntity[] = [
  { table: "customers", label: "Müşteri", seed: { kind: "file", file: CORE, group: "core" }, purge: { kind: "rpc" } },
  { table: "properties", label: "Portföy", seed: { kind: "file", file: CORE, group: "core + closed_properties" }, purge: { kind: "rpc" } },
  { table: "property_media", label: "Portföy fotoğrafı", seed: { kind: "file", file: CORE, group: "photos" }, purge: { kind: "cascade", parent: "properties" } },
  { table: "customer_demands", label: "Talep", seed: { kind: "file", file: CORE, group: "core" }, purge: { kind: "rpc" } },
  { table: "tasks", label: "Görev", seed: { kind: "file", file: CORE, group: "core" }, purge: { kind: "rpc" } },
  { table: "appointments", label: "Randevu", seed: { kind: "file", file: CORE, group: "core" }, purge: { kind: "rpc" } },
  { table: "deals", label: "Anlaşma", seed: { kind: "file", file: CORE, group: "core + won_deals" }, purge: { kind: "rpc" } },
  { table: "commissions", label: "Komisyon", seed: { kind: "file", file: CORE, group: "won_deals" }, purge: { kind: "rpc" } },
  { table: "offers", label: "Teklif", seed: { kind: "file", file: CORE, group: "offers" }, purge: { kind: "rpc" } },
  { table: "contracts", label: "Sözleşme", seed: { kind: "file", file: CORE, group: "contracts" }, purge: { kind: "rpc" } },
  { table: "rentals", label: "Kira sözleşmesi", seed: { kind: "file", file: CORE, group: "rentals" }, purge: { kind: "rpc" } },
  { table: "calls", label: "Arama", seed: { kind: "file", file: CORE, group: "calls" }, purge: { kind: "rpc" } },
  { table: "expenses", label: "Gider", seed: { kind: "file", file: CORE, group: "expenses" }, purge: { kind: "rpc" } },
  { table: "notifications", label: "Bildirim", seed: { kind: "file", file: CORE, group: "notifications" }, purge: { kind: "rpc" } },
  { table: "campaigns", label: "Kampanya", seed: { kind: "file", file: CORE, group: "campaigns" }, purge: { kind: "rpc" } },
  { table: "communications", label: "Mesaj (gelen kutusu)", seed: { kind: "file", file: CORE, group: "messages" }, purge: { kind: "rpc" } },
  { table: "fsbo_leads", label: "Sahibinden ilan adayı", seed: { kind: "file", file: CORE, group: "fsbo_leads" }, purge: { kind: "rpc-optional" } },
  { table: "profiles", label: "Demo ekip üyesi", seed: { kind: "file", file: PERSONAS, group: "seedSamplePersonas" }, purge: { kind: "personas" } },
  // Demo ekip durumu: örnek kişiye bağlı (user_id → profiles ON DELETE CASCADE); profil pasifleşirse tetik satırı siler.
  { table: "user_presence", label: "Ekip durumu", seed: { kind: "file", file: PRESENCE, group: "presence" }, purge: { kind: "cascade", parent: "profiles" } },
  { table: "advisor_specialties", label: "Danışman uzmanlığı", seed: { kind: "file", file: POOL, group: "pool" }, purge: { kind: "rpc-optional" } },
  { table: "advisor_regions", label: "Danışman bölgesi", seed: { kind: "file", file: POOL, group: "pool" }, purge: { kind: "rpc-optional" } },
  { table: "cash_entries", label: "Kasa/banka hareketi", seed: { kind: "file", file: MODULES, group: "finance" }, purge: { kind: "rpc-optional" } },
  { table: "recurring_rules", label: "Düzenli ödeme kuralı", seed: { kind: "file", file: MODULES, group: "finance" }, purge: { kind: "rpc-optional" } },
  { table: "finance_accounts", label: "Kasa/banka hesabı", seed: { kind: "file", file: MODULES, group: "finance" }, purge: { kind: "rpc-optional" } },
  { table: "expense_budgets", label: "Gider bütçesi", seed: { kind: "file", file: MODULES, group: "finance" }, purge: { kind: "rpc-optional" } },
  {
    table: "finance_parties",
    label: "Cari",
    seed: { kind: "derived", from: "commissions / rentals", reason: "finans tahakkuk tetikleyicileri örnek komisyon ve kiradan cari açar" },
    purge: { kind: "rpc-optional" },
  },
  {
    table: "finance_open_items",
    label: "Açık kalem",
    seed: { kind: "derived", from: "commissions / rent_charges", reason: "tahakkuk tetikleyicileri örnek komisyon ve kira tahakkukundan açık kalem üretir" },
    purge: { kind: "rpc-optional" },
  },
  {
    table: "deal_stage_events",
    label: "Anlaşma aşama geçmişi",
    seed: { kind: "derived", from: "deals", reason: "aşama geçmişi tetikleyicisi örnek anlaşmadan olay yazar" },
    purge: { kind: "rpc-optional" },
  },
  // Bilinen tohum eksikleri (KNOWN_SEED_GAPS): purge kapsamında, tohum sonraki pakette.
  { table: "property_control_state", label: "İlan kontrol durumu", seed: { kind: "derived", from: "properties", reason: "ilan kontrol motoru örnek portföyden türetir" }, purge: { kind: "rpc" } },
  { table: "finance_budgets", label: "Finans bütçesi", seed: { kind: "file", file: MODULES, group: "GAP" }, purge: { kind: "rpc-optional" } },
  { table: "document_requests", label: "Evrak talebi", seed: { kind: "file", file: CORE, group: "GAP" }, purge: { kind: "rpc-optional" } },
  { table: "document_request_files", label: "Evrak dosyası", seed: { kind: "file", file: CORE, group: "GAP" }, purge: { kind: "rpc-optional" } },
  { table: "rental_application_links", label: "Kiracı başvuru bağlantısı", seed: { kind: "file", file: CORE, group: "GAP" }, purge: { kind: "rpc-optional" } },
  { table: "rental_applications", label: "Kiracı başvurusu", seed: { kind: "file", file: CORE, group: "GAP" }, purge: { kind: "rpc-optional" } },
  { table: "rental_inspections", label: "Teslim/tahliye tutanağı", seed: { kind: "file", file: CORE, group: "GAP" }, purge: { kind: "rpc-optional" } },
];

/**
 * Tohumu henüz yazılmamış tablolar (DONDURULMUŞ — yalnız küçülebilir; yeni tablo buraya EKLENEMEZ, sözleşme testi bu
 * listenin tam olarak bu tablolar veya alt kümesi olduğunu denetler). Kapanınca satırın `group`u gerçek grup adı olur.
 */
export const KNOWN_SEED_GAPS: readonly string[] = [
  "finance_budgets",
  "document_requests",
  "document_request_files",
  "rental_application_links",
  "rental_applications",
  "rental_inspections",
];

/**
 * `is_sample` sütunu olup BİLEREK örnek veri almayan / purge edilmeyen tablolar (gerekçeli). Ayrıca kesim sürümünden sonra
 * açılan, örnek veri gerektirmeyen tenant tabloları (ayar, sayaç, günlük...) buraya gerekçeyle yazılır.
 */
export const SAMPLE_EXEMPT: Readonly<Record<string, string>> = {
  compliance_ledger_entries: "Yasal kayıt defteri append-only (silme tetikleyicisi reddeder); örnek tohum bu deftere hiç yazmaz.",
  demo_reset_snapshots: "Genel demo ofisinin sıfırlama görüntüsü (iş verisi değil; yalnız demo-ofis).",
};

/**
 * Yeni tenant tabloları kuralının kesim sürümü: bu sürümden SONRAKİ migration'larda `create table` edilen ve `tenant_id`
 * taşıyan her tablo ya `is_sample` taşıyıp SAMPLE_ENTITIES'te yer alır ya da SAMPLE_EXEMPT'te gerekçelidir.
 */
export const NEW_TABLE_RULE_AFTER = "20261024020100";

export function sampleEntity(table: string): SampleEntity | undefined {
  return SAMPLE_ENTITIES.find((e) => e.table === table);
}
