import type { SupabaseClient } from "@supabase/supabase-js";
import { DAY_MS, now } from "@/lib/clock";
import { resolveGeo } from "@/lib/geo/resolve";
import { seedModuleData } from "@/lib/sample-data/modules-seed";

/**
 * Örnek (demo) ofis veri seti — TEK kaynak. İki çağıranı vardır:
 *  - `seedSampleData` (ofis tarafı, kullanıcı oturumuyla; yetki ve "ofis boş mu" kapıları orada),
 *  - platform yönetiminden ofis açma (`createTenantByAdmin`; yeni açılan boş ofise, sahibin adına).
 *
 * Burada kapı YOKTUR: yalnız sunucu kodu import eder, çağıran yetkiyi ve boşluk koşulunu kendisi doğrular.
 * Tüm kayıtlar `is_sample=true` ile işaretlenir; telefonlar kurgusaldır (0532 000 xx xx).
 *
 * İki katman:
 *  1. ÇEKİRDEK (kullanıcı client'ı, katı): müşteri, portföy, talep, görev, randevu, açık anlaşma.
 *     Hata olursa fırlatır (çağıran yakalar).
 *  2. EKLER (`opts.extrasDb`, service_role gerekir): kazanılmış anlaşma + komisyon + hakediş, satılmış/
 *     kiradaki portföy, kira + tahakkuk, teklif, gider, arama, bildirim. Bunlar çekirdek iş akışı
 *     tetikleyicileri yüzünden oturumlu kullanıcıyla yazılamaz (kazanma/komisyon/kira atomik akış ister).
 *     Ek tabloda `is_sample` sütunu yoksa (migration 20260816001600 uygulanmadı) o grup "etkin değil"
 *     diye atlanır; hata verilmez. Tek bir ek grubun hatası diğerlerini ve çekirdeği bozmaz.
 *
 * Demo DANIŞMAN profili yazılmaz: profiles.id auth.users'a bağlıdır ve demo hesap açmak gerçek kimlik
 * (giriş) yüzeyi oluşturur. Tüm demo kayıtlar kurucunun adına atanır.
 */

export const SAMPLE_DATA_COUNTS = {
  customers: 12,
  properties: 9,
  demands: 6,
  tasks: 8,
  appointments: 6,
  deals: 3,
} as const;

export type SamplePack = "konut" | "ticari" | "arsa";
export const SAMPLE_PACKS: readonly SamplePack[] = ["konut", "ticari", "arsa"];

export type SampleSeedReport = {
  /** Tablo/grup başına yazılan kayıt sayısı. */
  counts: Record<string, number>;
  /** Şemada karşılığı yok / `is_sample` yok → atlanan gruplar ("etkin değil"). */
  skipped: { group: string; reason: string }[];
  /** Denenip hata veren ek gruplar (çekirdek yine yüklüdür). */
  failed: { group: string; message: string }[];
};

/** Bugünün belirli saatine ISO damgası (ör. 14:00) — randevu/görev vadesi için. */
function todayAtIso(hour: number, minute = 0, dayOffset = 0): string {
  const d = new Date(now() + dayOffset * DAY_MS);
  d.setHours(hour, minute, 0, 0);
  return d.toISOString();
}

/** `YYYY-MM-DD` — bugünden `dayOffset` gün sonrası. */
function dateKey(dayOffset: number): string {
  return new Date(now() + dayOffset * DAY_MS).toISOString().slice(0, 10);
}

/** Bulunulan ayın başından `monthsBack` ay önceki ayın 1'i (`YYYY-MM-01`). */
function monthStartKey(monthsBack: number): string {
  const d = new Date(now());
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - monthsBack, 1)).toISOString().slice(0, 10);
}

/** Tablonun `is_sample` sütunu var mı? (uygulanmamış genişletme migration'ında yok.) */
async function hasSampleColumn(db: SupabaseClient, table: string, cache: Map<string, boolean>): Promise<boolean> {
  const hit = cache.get(table);
  if (hit !== undefined) return hit;
  const { error } = await db.from(table).select("is_sample").limit(0);
  const ok = !error;
  cache.set(table, ok);
  return ok;
}

export async function insertSampleRecords(
  db: SupabaseClient,
  tenantId: string,
  userId: string,
  opts: { extrasDb?: SupabaseClient; pack?: SamplePack } = {},
): Promise<SampleSeedReport> {
  const report: SampleSeedReport = { counts: {}, skipped: [], failed: [] };
  // Konum çeşitliliği best-effort: İstanbul + üç ilçe bulunursa bağlanır,
  // bulunamazsa null kalır (örnek set konumsuz da anlamlı).
  let istanbulId: string | null = null;
  const geo: Record<"kadikoy" | "maltepe" | "besiktas" | "atasehir" | "sisli" | "sariyer", string | null> = {
    kadikoy: null,
    maltepe: null,
    besiktas: null,
    atasehir: null,
    sisli: null,
    sariyer: null,
  };
  const [kadikoy, maltepe, besiktas, atasehir, sisli, sariyer] = await Promise.all(
    ["Kadıköy", "Maltepe", "Beşiktaş", "Ataşehir", "Şişli", "Sarıyer"].map((district) => resolveGeo({ province: "İstanbul", district })),
  );
  if (kadikoy.status === "ok") {
    istanbulId = kadikoy.geo.provinceId;
    geo.kadikoy = kadikoy.geo.districtId;
  }
  if (maltepe.status === "ok") {
    istanbulId = istanbulId ?? maltepe.geo.provinceId;
    geo.maltepe = maltepe.geo.districtId;
  }
  if (besiktas.status === "ok") {
    istanbulId = istanbulId ?? besiktas.geo.provinceId;
    geo.besiktas = besiktas.geo.districtId;
  }
  if (atasehir.status === "ok") geo.atasehir = atasehir.geo.districtId;
  if (sisli.status === "ok") geo.sisli = sisli.geo.districtId;
  if (sariyer.status === "ok") geo.sariyer = sariyer.geo.districtId;

  // ---- 12 müşteri (tip/etiket/sıcaklık/kaynak çeşitli; telefonlar kurgusal 0532 000 xx xx) ----
  const CUSTOMERS = [
    { full_name: "Selin Aksoy", phone: "05320000101", types: ["Alıcı"], tags: ["örnek", "sıcak"], source: "web", district: geo.kadikoy, notes: "3+1 arıyor, Kadıköy çevresi. Hafta içi 18:00 sonrası müsait." },
    { full_name: "Murat Erdem", phone: "05320000102", types: ["Satıcı"], tags: ["örnek", "sıcak"], source: "referral", district: geo.maltepe, notes: "Maltepe'deki dairesini satmak istiyor, fiyat beklentisi yüksek." },
    { full_name: "Deniz Kara", phone: "05320000103", types: ["Kiracı"], tags: ["örnek"], source: "phone", district: geo.besiktas, notes: "Kurumsal kiracı — eşyalı 1+1/2+1 rezidans arıyor." },
    { full_name: "Fatma Şahin", phone: "05320000104", types: ["Mülk sahibi"], tags: ["örnek", "vip"], source: "walk_in", district: geo.kadikoy, notes: "İki dairesi var; birini kiraya vermek istiyor." },
    { full_name: "Kerem Ünal", phone: "05320000105", types: ["Yatırımcı"], tags: ["örnek", "sıcak"], source: "social", district: geo.besiktas, notes: "Getirisi yüksek küçük daire portföyü topluyor." },
    { full_name: "Aylin Demirtaş", phone: "05320000106", types: ["Alıcı", "Yatırımcı"], tags: ["örnek", "sıcak"], source: "web", district: geo.maltepe, notes: "Hem oturmak hem yatırım — sahile yakın 2+1." },
    { full_name: "Cem Yıldırım", phone: "05320000107", types: ["Alıcı"], tags: ["örnek", "soğuk"], source: "portal", district: geo.kadikoy, notes: "Portaldan yazdı, bütçesi net değil; ayda bir arayın." },
    { full_name: "Elif Tuna", phone: "05320000108", types: ["Yatırımcı"], tags: ["örnek", "vip"], source: "referral", district: geo.besiktas, notes: "Lüks segment, Boğaz manzaralı villa bakıyor. Gizlilik önemli." },
    { full_name: "Hakan Polat", phone: "05320000109", types: ["Alıcı", "Yatırımcı"], tags: ["örnek", "sıcak"], source: "portal", district: geo.maltepe, notes: "Arsa/tarla yatırımı: imarlı, ulaşımı kolay, 1000 m² üstü." },
    { full_name: "Zeynep Akın", phone: "05320000110", types: ["Kiracı"], tags: ["örnek", "soğuk"], source: "social", district: geo.kadikoy, notes: "Dükkan arıyor (butik kafe), kira bütçesi 150-200 bin." },
    { full_name: "Burak Çelik", phone: "05320000111", types: ["Satıcı", "Mülk sahibi"], tags: ["örnek"], source: "phone", district: geo.maltepe, notes: "Ofis katı satıyor, ödemeli alıcı bekliyor." },
    { full_name: "Gamze Korkmaz", phone: "05320000112", types: ["Alıcı"], tags: ["örnek"], source: "walk_in", district: geo.kadikoy, notes: "İlk ev alacak, kredi onayı bekliyor." },
  ];
  const { data: customers, error: custErr } = await db
    .from("customers")
    .insert(
      CUSTOMERS.map((c) => ({
        tenant_id: tenantId,
        full_name: c.full_name,
        phone: c.phone,
        customer_types: c.types,
        tags: c.tags,
        source: c.source,
        notes: c.notes,
        province_id: istanbulId,
        district_id: c.district,
        assigned_to: userId,
        created_by: userId,
        is_sample: true,
      })),
    )
    .select("id, full_name");
  if (custErr || !customers?.length) throw custErr ?? new Error("customers insert boş döndü");
  const custId = (name: string) => customers.find((c) => c.full_name === name)?.id ?? customers[0].id;
  report.counts.customers = customers.length;

  // ---- 9 portföy: satılık daire, kiralık, arsa, lüks villa, ticari, ofis ----
  const PROPS = [
    { code: "ORNEK-001", title: "Kadıköy'de deniz manzaralı 3+1", tx: "Satılık", type: "Daire", price: 11500000, rooms: "3+1", sqm: 140, district: geo.kadikoy, rate: 2 },
    { code: "ORNEK-002", title: "Maltepe sahile yakın 2+1", tx: "Satılık", type: "Daire", price: 6750000, rooms: "2+1", sqm: 105, district: geo.maltepe, rate: 2 },
    { code: "ORNEK-003", title: "Beşiktaş'ta kiralık eşyalı 1+1", tx: "Kiralık", type: "Daire", price: 42000, rooms: "1+1", sqm: 70, district: geo.besiktas, rate: 10 },
    { code: "ORNEK-004", title: "Kadıköy'de yatırımlık müstakil ev", tx: "Satılık", type: "Müstakil ev", price: 19500000, rooms: "4+2", sqm: 260, district: geo.kadikoy, rate: 2 },
    { code: "ORNEK-005", title: "Sarıyer'de imarlı 1.250 m² arsa", tx: "Satılık", type: "Arsa", price: 38500000, rooms: null, sqm: 1250, district: geo.sariyer, rate: 3 },
    { code: "ORNEK-006", title: "Beşiktaş'ta Boğaz manzaralı lüks villa", tx: "Satılık", type: "Villa", price: 85000000, rooms: "6+2", sqm: 520, district: geo.besiktas, rate: 2 },
    { code: "ORNEK-007", title: "Bağdat Caddesi'nde kiralık köşe dükkan", tx: "Kiralık", type: "Dükkan", price: 185000, rooms: null, sqm: 120, district: geo.kadikoy, rate: 10 },
    { code: "ORNEK-008", title: "Maltepe'de kiralık ferah 2+1", tx: "Kiralık", type: "Daire", price: 28000, rooms: "2+1", sqm: 95, district: geo.maltepe, rate: 10 },
    { code: "ORNEK-009", title: "Maltepe'de satılık plaza katı", tx: "Satılık", type: "Ofis", price: 12400000, rooms: null, sqm: 210, district: geo.maltepe, rate: 2 },
  ];
  const { data: props, error: propErr } = await db
    .from("properties")
    .insert(
      PROPS.map((p) => ({
        tenant_id: tenantId,
        property_code: p.code,
        title: p.title,
        transaction_type: p.tx,
        property_type: p.type,
        status: "live",
        // Doğrudan live doğan örnek kayıt — yayın damgası oluşturma anı
        published_at: new Date(now()).toISOString(),
        list_price: p.price,
        commission_rate: p.rate,
        province_id: istanbulId,
        district_id: p.district,
        features: p.rooms ? { rooms: p.rooms, sqm: p.sqm } : { sqm: p.sqm },
        assigned_to: userId,
        created_by: userId,
        is_sample: true,
      })),
    )
    .select("id, property_code");
  if (propErr || !props?.length) throw propErr ?? new Error("properties insert boş döndü");
  const propId = (code: string) => props.find((p) => p.property_code === code)?.id ?? null;
  report.counts.properties = props.length;

  // ---- 6 talep (sıcak/soğuk, tür çeşitli) ----
  const demandRows = [
    {
      tenant_id: tenantId, customer_id: custId("Selin Aksoy"), transaction_type: "Satılık",
      property_type: "Daire", province_id: istanbulId, district_id: geo.kadikoy,
      budget_min: 9000000, budget_max: 12500000, rooms: "3+1", min_sqm: 120,
      urgency: "yüksek", status: "active", is_sample: true,
    },
    {
      tenant_id: tenantId, customer_id: custId("Deniz Kara"), transaction_type: "Kiralık",
      property_type: "Daire", province_id: istanbulId, district_id: geo.besiktas,
      budget_min: 30000, budget_max: 45000, rooms: "1+1", min_sqm: 55,
      urgency: "orta", status: "new", is_sample: true,
    },
    {
      tenant_id: tenantId, customer_id: custId("Aylin Demirtaş"), transaction_type: "Satılık",
      property_type: "Daire", province_id: istanbulId, district_id: geo.maltepe,
      budget_min: 5500000, budget_max: 7500000, rooms: "2+1", min_sqm: 90,
      urgency: "orta", status: "matched", is_sample: true,
    },
    {
      tenant_id: tenantId, customer_id: custId("Elif Tuna"), transaction_type: "Satılık",
      property_type: "Villa", province_id: istanbulId, district_id: geo.besiktas,
      budget_min: 60000000, budget_max: 95000000, rooms: "5+1", min_sqm: 400,
      urgency: "yüksek", status: "active", is_sample: true,
    },
    {
      tenant_id: tenantId, customer_id: custId("Hakan Polat"), transaction_type: "Satılık",
      property_type: "Arsa", province_id: istanbulId, district_id: null,
      budget_min: 5000000, budget_max: 10000000, rooms: null, min_sqm: 1000,
      urgency: "orta", status: "active", is_sample: true,
    },
    {
      tenant_id: tenantId, customer_id: custId("Zeynep Akın"), transaction_type: "Kiralık",
      property_type: "Dükkan", province_id: istanbulId, district_id: geo.kadikoy,
      budget_min: 120000, budget_max: 200000, rooms: null, min_sqm: 80,
      urgency: "düşük", status: "new", is_sample: true,
    },
  ];
  const { error: demandErr } = await db.from("customer_demands").insert(demandRows);
  if (demandErr) throw demandErr;
  report.counts.demands = demandRows.length;

  // ---- 8 görev (bugün / gecikmiş / ileri karışık) ----
  const taskRows = [
    {
      tenant_id: tenantId, title: "Selin Aksoy'u ara — Kadıköy 3+1 eşleşmesi", kind: "call",
      priority: "high", status: "open", due_at: todayAtIso(14, 0),
      customer_id: custId("Selin Aksoy"), assigned_to: userId, created_by: userId, is_sample: true,
    },
    {
      tenant_id: tenantId, title: "ORNEK-002 için portal ilanını güncelle", kind: "followup",
      priority: "normal", status: "open", due_at: todayAtIso(17, 0),
      property_id: propId("ORNEK-002"),
      assigned_to: userId, created_by: userId, is_sample: true,
    },
    {
      tenant_id: tenantId, title: "Murat Erdem'den yetki belgesi imzası al", kind: "document",
      priority: "high", status: "open", due_at: todayAtIso(11, 0, -1),
      customer_id: custId("Murat Erdem"), assigned_to: userId, created_by: userId, is_sample: true,
    },
    {
      tenant_id: tenantId, title: "Fatma Şahin'in kiralık dairesi için fotoğraf çekimi planla", kind: "visit",
      priority: "normal", status: "open", due_at: todayAtIso(15, 30, -2),
      customer_id: custId("Fatma Şahin"), assigned_to: userId, created_by: userId, is_sample: true,
    },
    {
      tenant_id: tenantId, title: "Elif Tuna için Boğaz villası sunumunu hazırla", kind: "followup",
      priority: "high", status: "open", due_at: todayAtIso(12, 0, 1),
      customer_id: custId("Elif Tuna"), property_id: propId("ORNEK-006"),
      assigned_to: userId, created_by: userId, is_sample: true,
    },
    {
      tenant_id: tenantId, title: "Hakan Polat'a Sarıyer arsası için imar durumunu gönder", kind: "document",
      priority: "normal", status: "open", due_at: todayAtIso(16, 0, 2),
      customer_id: custId("Hakan Polat"), property_id: propId("ORNEK-005"),
      assigned_to: userId, created_by: userId, is_sample: true,
    },
    {
      tenant_id: tenantId, title: "Cem Yıldırım'ı soğutmadan tekrar ara", kind: "call",
      priority: "normal", status: "open", due_at: todayAtIso(10, 0, -3),
      customer_id: custId("Cem Yıldırım"), assigned_to: userId, created_by: userId, is_sample: true,
    },
    {
      tenant_id: tenantId, title: "Burak Çelik'in plaza katı için değerleme raporu iste", kind: "followup",
      priority: "normal", status: "open", due_at: todayAtIso(13, 0, 4),
      customer_id: custId("Burak Çelik"), property_id: propId("ORNEK-009"),
      assigned_to: userId, created_by: userId, is_sample: true,
    },
  ];
  const { error: taskErr } = await db.from("tasks").insert(taskRows);
  if (taskErr) throw taskErr;
  report.counts.tasks = taskRows.length;

  // ---- 6 randevu (bugün, yarın, geçmiş tamamlanan) ----
  const apptRows = [
    {
      tenant_id: tenantId, appointment_type: "showing", scheduled_at: todayAtIso(16, 30),
      duration_min: 45, location: "Kadıköy — ORNEK-001 daire önü", status: "confirmed",
      customer_id: custId("Selin Aksoy"), property_id: propId("ORNEK-001"),
      assigned_to: userId, created_by: userId, is_sample: true,
    },
    {
      tenant_id: tenantId, appointment_type: "office", scheduled_at: todayAtIso(10, 30, 1),
      duration_min: 30, location: "Ofis", status: "pending",
      customer_id: custId("Deniz Kara"), assigned_to: userId, created_by: userId, is_sample: true,
    },
    {
      tenant_id: tenantId, appointment_type: "showing", scheduled_at: todayAtIso(11, 0),
      duration_min: 60, location: "Beşiktaş — ORNEK-006 villa", status: "confirmed",
      customer_id: custId("Elif Tuna"), property_id: propId("ORNEK-006"),
      assigned_to: userId, created_by: userId, is_sample: true,
    },
    {
      tenant_id: tenantId, appointment_type: "valuation", scheduled_at: todayAtIso(14, 30, 1),
      duration_min: 60, location: "Maltepe — plaza katı", status: "pending",
      customer_id: custId("Burak Çelik"), property_id: propId("ORNEK-009"),
      assigned_to: userId, created_by: userId, is_sample: true,
    },
    {
      tenant_id: tenantId, appointment_type: "showing", scheduled_at: todayAtIso(15, 0, -1),
      duration_min: 45, location: "Maltepe — ORNEK-008 daire", status: "completed",
      customer_id: custId("Aylin Demirtaş"), property_id: propId("ORNEK-008"),
      assigned_to: userId, created_by: userId, is_sample: true,
    },
    {
      tenant_id: tenantId, appointment_type: "signing", scheduled_at: todayAtIso(13, 30, 3),
      duration_min: 90, location: "Ofis — imza masası", status: "pending",
      customer_id: custId("Aylin Demirtaş"), property_id: propId("ORNEK-002"),
      assigned_to: userId, created_by: userId, is_sample: true,
    },
  ];
  const { error: apptErr } = await db.from("appointments").insert(apptRows);
  if (apptErr) throw apptErr;
  report.counts.appointments = apptRows.length;

  // ---- 3 açık anlaşma (yeni / nitelikli / müzakere) — is_sample işaretli
  // (bkz. migration 20260726000096_sample_deals_flag.sql). Kazanılmış anlaşma EKLER katmanındadır. ----
  const dealRows = [
    {
      tenant_id: tenantId, customer_id: custId("Aylin Demirtaş"), property_id: propId("ORNEK-002"),
      deal_type: "sale", stage: "negotiation", deal_value: 6600000, probability: 60, assigned_to: userId, is_sample: true,
    },
    {
      tenant_id: tenantId, customer_id: custId("Selin Aksoy"), property_id: propId("ORNEK-001"),
      deal_type: "sale", stage: "qualified", deal_value: 11200000, probability: 40, assigned_to: userId, is_sample: true,
    },
    {
      tenant_id: tenantId, customer_id: custId("Elif Tuna"), property_id: propId("ORNEK-006"),
      deal_type: "sale", stage: "new", deal_value: 82000000, probability: 20, assigned_to: userId, is_sample: true,
    },
  ];
  const { error: dealErr } = await db.from("deals").insert(dealRows);
  if (dealErr) throw dealErr;
  report.counts.deals = dealRows.length;

  // ================= EKLER (service_role) =================
  const extras = opts.extrasDb;
  if (!extras) return report;

  const cache = new Map<string, boolean>();
  const group = async (name: string, needsColumnOn: string[], run: () => Promise<number>) => {
    for (const t of needsColumnOn) {
      if (!(await hasSampleColumn(extras, t, cache))) {
        report.skipped.push({ group: name, reason: `${t}.is_sample sütunu yok (genişletme migration'ı uygulanmamış): etkin değil` });
        return;
      }
    }
    try {
      report.counts[name] = await run();
    } catch (e) {
      console.error(`insertSampleRecords:${name}`, e);
      report.failed.push({ group: name, message: e instanceof Error ? e.message : "bilinmeyen hata" });
    }
  };
  const flag = async (table: string) => ((await hasSampleColumn(extras, table, cache)) ? { is_sample: true } : {});

  // Kazanılmış anlaşmalar + komisyon/hakediş: kazanç ekranları boş kalmasın.
  await group("won_deals", [], async () => {
    const soldProps = [
      { code: "ORNEK-010", title: "Kadıköy'de satılan 2+1 (kazanılmış)", price: 7400000, rooms: "2+1", sqm: 100, district: geo.kadikoy },
      { code: "ORNEK-011", title: "Maltepe'de satılan 3+1 (kazanılmış)", price: 8900000, rooms: "3+1", sqm: 125, district: geo.maltepe },
    ];
    const { data: sold, error: sErr } = await extras
      .from("properties")
      .insert(
        soldProps.map((p) => ({
          tenant_id: tenantId, property_code: p.code, title: p.title, transaction_type: "Satılık", property_type: "Daire",
          status: "sold", published_at: new Date(now() - 40 * DAY_MS).toISOString(), list_price: p.price, commission_rate: 2,
          province_id: istanbulId, district_id: p.district, features: { rooms: p.rooms, sqm: p.sqm },
          assigned_to: userId, created_by: userId, is_sample: true,
        })),
      )
      .select("id, property_code");
    if (sErr || !sold?.length) throw sErr ?? new Error("satılmış portföy boş döndü");

    const wonAt = [new Date(now() - 1 * DAY_MS).toISOString(), new Date(now() - 3 * DAY_MS).toISOString()];
    const wonRows = [
      { code: "ORNEK-010", customer: "Gamze Korkmaz", value: 7400000 },
      { code: "ORNEK-011", customer: "Kerem Ünal", value: 8900000 },
    ];
    const { data: won, error: wErr } = await extras
      .from("deals")
      .insert(
        wonRows.map((w, i) => ({
          tenant_id: tenantId,
          customer_id: custId(w.customer),
          property_id: sold.find((s) => s.property_code === w.code)?.id ?? null,
          deal_type: "sale", stage: "won", deal_value: w.value, probability: 100,
          closure_active: true, prev_property_status: "live",
          assigned_to: userId, is_sample: true, created_at: wonAt[i], updated_at: wonAt[i],
        })),
      )
      .select("id, deal_value");
    if (wErr || !won?.length) throw wErr ?? new Error("kazanılmış anlaşma boş döndü");

    const commissionFlag = await flag("commissions");
    const { error: cErr } = await extras.from("commissions").insert(
      won.map((d, i) => {
        const net = Math.round(Number(d.deal_value) * 0.02 * 100) / 100; // portföy oranı %2
        const advisor = Math.round(net * 0.5 * 100) / 100;
        return {
          tenant_id: tenantId, deal_id: d.id, gross_amount: net, vat_amount: Math.round(net * 0.2 * 100) / 100,
          status: i === 1 ? "paid" : "calculated",
          splits: [
            { label: "Danışman", rate: 50, amount: advisor },
            { label: "Ofis", rate: 50, amount: Math.round((net - advisor) * 100) / 100 },
          ],
          created_at: wonAt[i], ...commissionFlag,
        };
      }),
    );
    if (cErr) throw cErr;
    report.counts.commissions = won.length;

    // Kaybedilen anlaşma (kayıp nedeni analizi dolu görünsün)
    const { error: lErr } = await extras.from("deals").insert({
      tenant_id: tenantId, customer_id: custId("Cem Yıldırım"), property_id: propId("ORNEK-004"),
      deal_type: "sale", stage: "lost", deal_value: 18000000, probability: 0, loss_reason: "fiyat_yuksek",
      assigned_to: userId, is_sample: true,
    });
    if (lErr) throw lErr;
    return won.length + 1;
  });

  // Kira: kiradaki portföy + sözleşme + aylık tahakkuklar (kira/aidat ekranları)
  await group("rentals", ["rentals"], async () => {
    const { data: rented, error: rpErr } = await extras
      .from("properties")
      .insert({
        tenant_id: tenantId, property_code: "ORNEK-012", title: "Beşiktaş'ta kiradaki 2+1 (kiracılı)", transaction_type: "Kiralık",
        property_type: "Daire", status: "rented", published_at: new Date(now() - 100 * DAY_MS).toISOString(), list_price: 38000,
        commission_rate: 10, province_id: istanbulId, district_id: geo.besiktas, features: { rooms: "2+1", sqm: 90 },
        assigned_to: userId, created_by: userId, is_sample: true,
      })
      .select("id")
      .single();
    if (rpErr || !rented) throw rpErr ?? new Error("kiradaki portföy boş döndü");
    const { data: rental, error: rErr } = await extras
      .from("rentals")
      .insert({
        tenant_id: tenantId, property_id: rented.id, renter_customer_id: custId("Deniz Kara"), monthly_rent: 38000,
        due_day: 5, start_date: monthStartKey(3), end_date: dateKey(270), deposit: 76000, status: "active",
        notes: "Örnek kira sözleşmesi", created_by: userId, is_sample: true,
      })
      .select("id")
      .single();
    if (rErr || !rental) throw rErr ?? new Error("kira sözleşmesi boş döndü");
    const { error: chErr } = await extras.from("rent_charges").insert([
      { tenant_id: tenantId, rental_id: rental.id, period: monthStartKey(2), amount: 38000, status: "paid", paid_at: new Date(now() - 55 * DAY_MS).toISOString() },
      { tenant_id: tenantId, rental_id: rental.id, period: monthStartKey(1), amount: 38000, status: "paid", paid_at: new Date(now() - 25 * DAY_MS).toISOString() },
      { tenant_id: tenantId, rental_id: rental.id, period: monthStartKey(0), amount: 38000, status: "pending" },
    ]);
    if (chErr) throw chErr;
    return 1;
  });

  // Teklifler (müzakere ekranı)
  await group("offers", ["offers"], async () => {
    const rows = [
      { code: "ORNEK-001", customer: "Selin Aksoy", amount: 10800000, status: "submitted", counter: null as number | null, notes: "Peşin ödeme teklifi." },
      { code: "ORNEK-006", customer: "Elif Tuna", amount: 79000000, status: "countered", counter: 83500000, notes: "Mal sahibi karşı teklif verdi." },
      { code: "ORNEK-002", customer: "Aylin Demirtaş", amount: 6600000, status: "submitted", counter: null, notes: "Kredi onaylı alıcı." },
    ];
    const { error } = await extras.from("offers").insert(
      rows.map((r) => ({
        tenant_id: tenantId, property_id: propId(r.code), customer_id: custId(r.customer), created_by: userId,
        amount: r.amount, status: r.status, counter_amount: r.counter, valid_until: dateKey(7), notes: r.notes,
        submitted_at: new Date(now() - DAY_MS).toISOString(), is_sample: true,
      })),
    );
    if (error) throw error;
    return rows.length;
  });

  // Giderler (gider/kâr ekranları)
  await group("expenses", ["expenses"], async () => {
    const rows = [
      { category: "reklam", title: "Portal premium ilan paketi", amount: 6500, days: -3 },
      { category: "ofis", title: "Ofis kirası", amount: 32000, days: -10 },
      { category: "ulasim", title: "Yer gösterme yol/yakıt", amount: 1850, days: -2 },
      { category: "egitim", title: "Danışman eğitimi (müzakere teknikleri)", amount: 4200, days: -15 },
    ];
    const { error } = await extras.from("expenses").insert(
      rows.map((r) => ({
        tenant_id: tenantId, created_by: userId, category: r.category, title: r.title, amount: r.amount,
        expense_date: dateKey(r.days), is_sample: true,
      })),
    );
    if (error) throw error;
    return rows.length;
  });

  // Çağrı kayıtları (çağrı merkezi/aktivite ekranı) — kurgusal numaralar
  await group("calls", ["calls"], async () => {
    const rows = [
      { customer: "Selin Aksoy", direction: "outbound", phone: "05320000101", dur: 240, disp: "Randevu alındı", mins: 90 },
      { customer: "Cem Yıldırım", direction: "missed", phone: "05320000107", dur: 0, disp: null, mins: 200 },
      { customer: "Hakan Polat", direction: "inbound", phone: "05320000109", dur: 380, disp: "Bilgi verildi", mins: 400 },
    ];
    const { error } = await extras.from("calls").insert(
      rows.map((r) => ({
        tenant_id: tenantId, customer_id: custId(r.customer), direction: r.direction, phone: r.phone,
        duration_sec: r.dur, disposition: r.disp, handled_by: userId,
        started_at: new Date(now() - r.mins * 60_000).toISOString(), is_sample: true,
      })),
    );
    if (error) throw error;
    return rows.length;
  });

  // Bildirimler (zil menüsü boş kalmasın; yalnız kurucuya)
  await group("notifications", ["notifications"], async () => {
    const rows = [
      { title: "Yeni talep: Hakan Polat", body: "Sarıyer arsası için portal başvurusu geldi.", href: "/app/musteriler", kind: "info" },
      { title: "Anlaşma kazanıldı", body: "ORNEK-010 satışı tamamlandı, komisyon hesaplandı.", href: "/app/komisyon", kind: "success" },
      { title: "Geciken görev", body: "Cem Yıldırım'ı arama görevi gecikti.", href: "/app/gorevler", kind: "warning" },
    ];
    const { error } = await extras.from("notifications").insert(
      rows.map((r) => ({ tenant_id: tenantId, user_id: userId, title: r.title, body: r.body, href: r.href, kind: r.kind, is_sample: true })),
    );
    if (error) throw error;
    return rows.length;
  });

  // Son eklenen modüller (mülk yönetimi, bina/site, Lig 2.0, tapu süreci, EİDS, ilan analizi, tekrarlayan/portal gideri):
  // tek kaynak `sample-data/modules-seed.ts` (demo-ofis seed'iyle ortak). Hata çekirdeği bozmaz; rapora yazılır.
  try {
    const modules = await seedModuleData({
      db: extras,
      tenantId,
      ownerId: userId,
      advisorId: userId,
      sample: true,
      place: {
        provinceId: istanbulId,
        districtId: geo.kadikoy,
        city: "İstanbul",
        district: "Kadıköy",
        districts: { Kadıköy: geo.kadikoy, Beşiktaş: geo.besiktas, Ataşehir: geo.atasehir, Şişli: geo.sisli },
      },
      codePrefix: "ORNEK",
      authorityPropertyCodes: ["ORNEK-001", "ORNEK-002", "ORNEK-003", "ORNEK-004", "ORNEK-005", "ORNEK-006"],
      analysisPropertyCodes: ["ORNEK-001", "ORNEK-002"],
      processDeals: [
        { propertyCode: "ORNEK-010", profile: "in_transfer" },
        { propertyCode: "ORNEK-002", profile: "delayed" },
      ],
    });
    for (const [k, v] of Object.entries(modules.counts)) report.counts[k] = v;
    report.skipped.push(...modules.skipped);
    report.failed.push(...modules.failed);
  } catch (e) {
    console.error("insertSampleRecords:modules", e);
    report.failed.push({ group: "modules", message: e instanceof Error ? e.message : "bilinmeyen hata" });
  }

  // Şemada henüz is_sample taşımayan modüller: kampanya, kayıp-kaçak, anket, danışman profili.
  for (const g of ["campaigns", "leak", "surveys", "advisors"]) {
    report.skipped.push({
      group: g,
      reason:
        g === "advisors"
          ? "demo danışman hesabı açılmaz (profiles.id auth.users'a bağlı): etkin değil"
          : `${g} tablosunda is_sample yok: etkin değil`,
    });
  }
  return report;
}
