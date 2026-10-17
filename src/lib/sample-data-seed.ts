import type { SupabaseClient } from "@supabase/supabase-js";
import { now } from "@/lib/clock";
import { resolveGeo } from "@/lib/geo/resolve";
import { seedModuleData } from "@/lib/sample-data/modules-seed";
import { SAMPLE_DISTRICTS, type DistrictKey } from "@/lib/sample-data/catalog";
import { buildSamplePlan, type SamplePlan } from "@/lib/sample-data/rich-pack";
import { mediaRowsForSet } from "@/lib/sample-data/demo-photo-pick";
import { seedSamplePersonas } from "@/lib/sample-data/personas";
import { createRng, iso, spreadOverMonths } from "@/lib/sample-data/timeline";
import { attachLibraryPhotosToBareListings } from "@/lib/sample-data/photo-backfill";
import { getDistrictNameMap } from "@/lib/geo/reader";

/**
 * Örnek (demo) ofis veri seti — TEK kaynak. Çağıranlar: `seedSampleData` (ofis), kayıt (`ensureSampleData`), platform
 * yönetimi (ofis açma ve Ofis 360 > Demo verisi > yeniden yükle). Burada kapı YOKTUR: çağıran yetkiyi ve KİLİDİ
 * (`sample-data/lock.ts`; DB'de `sample_seed_guard` tetikleyicisi de reddeder) kendisi doğrular.
 *
 * İçerik planı SAF `sample-data/rich-pack.ts`'tedir (30 müşteri, 22 portföy (her biri bir demo fotoğraf setinden: başlık, tür, oda, m², ilçe ve bant içi fiyat setle tutarlı), tüm aşamalarda anlaşma, teklif,
 * sözleşme, komisyon, gecikmiş kira dahil kira/tahakkuk, gider, arama, gelen kutusu, kampanya, bildirim; son 6 aya yayılmış
 * tarihler). Demo ekip (`personas.ts`, giriş yapamayan 3 profil) kayıtları paylaşır. Tüm satırlar `is_sample=true`.
 *
 * İki katman:
 *  1. ÇEKİRDEK (çağıranın istemcisi, katı): müşteri, portföy, talep, görev, randevu, açık anlaşma. Hata fırlatır.
 *  2. EKLER (`opts.extrasDb`, service_role): demo ekip, fotoğraf, kazanılmış/kayıp anlaşma + komisyon, kira + tahakkuk,
 *     teklif, sözleşme, gider, arama, mesaj, kampanya, bildirim ve modül tohumları. Bir grubun hatası diğerlerini bozmaz;
 *     `is_sample` sütunu olmayan tablo "etkin değil" diye atlanır.
 */

export const SAMPLE_DATA_COUNTS = {
  customers: 30,
  properties: 22,
  demands: 14,
  tasks: 20,
  appointments: 16,
  deals: 17,
} as const;

export type SamplePack = "konut" | "ticari" | "arsa";
export const SAMPLE_PACKS: readonly SamplePack[] = ["konut", "ticari", "arsa"];

export type SampleSeedReport = {
  counts: Record<string, number>;
  skipped: { group: string; reason: string }[];
  failed: { group: string; message: string }[];
};

/** Tablonun `is_sample` sütunu var mı? (uygulanmamış genişletme migration'ında yok.) */
async function hasSampleColumn(db: SupabaseClient, table: string, cache: Map<string, boolean>): Promise<boolean> {
  const hit = cache.get(table);
  if (hit !== undefined) return hit;
  const { error } = await db.from(table).select("is_sample").limit(0);
  const ok = !error;
  cache.set(table, ok);
  return ok;
}

type Geo = {
  provinceId: string | null;
  districts: Record<DistrictKey, string | null>;
  hoods: Map<string, string | null>;
  /** "<il>|<ilçe>" → kimlikler (fotoğraf setlerinin İstanbul dışı ilçeleri dahil). */
  places: Map<string, { provinceId: string | null; districtId: string | null }>;
};

/** Coğrafya çözücü: uygulamada `resolveGeo` (önbellekli tek merkez); Next dışı betikte çağıran doğrudan sorgu verir. */
export type SampleGeoResolver = typeof resolveGeo;

async function resolveSampleGeo(resolve: SampleGeoResolver, extraPlaces: readonly { city: string; district: string }[]): Promise<Geo> {
  const districts = {} as Record<DistrictKey, string | null>;
  let provinceId: string | null = null;
  const hoods = new Map<string, string | null>();
  const places = new Map<string, { provinceId: string | null; districtId: string | null }>();
  await Promise.all(
    [...new Map(extraPlaces.map((p) => [`${p.city}|${p.district}`, p])).values()].map(async (p) => {
      const r = await resolve({ province: p.city, district: p.district }).catch(() => null);
      places.set(`${p.city}|${p.district}`, r?.status === "ok" ? { provinceId: r.geo.provinceId, districtId: r.geo.districtId } : { provinceId: null, districtId: null });
    }),
  );
  await Promise.all(
    SAMPLE_DISTRICTS.map(async (d) => {
      const r = await resolve({ province: "İstanbul", district: d.name }).catch(() => null);
      districts[d.key] = r?.status === "ok" ? r.geo.districtId : null;
      if (r?.status === "ok") provinceId = provinceId ?? r.geo.provinceId;
      await Promise.all(
        d.neighborhoods.map(async (n) => {
          const h = await resolve({ province: "İstanbul", district: d.name, neighborhood: n }).catch(() => null);
          hoods.set(`${d.key}:${n}`, h?.status === "ok" ? h.geo.neighborhoodId : null);
        }),
      );
    }),
  );
  return { provinceId, districts, hoods, places };
}

export async function insertSampleRecords(
  db: SupabaseClient,
  tenantId: string,
  userId: string,
  opts: { extrasDb?: SupabaseClient; pack?: SamplePack; resolveGeo?: SampleGeoResolver } = {},
): Promise<SampleSeedReport> {
  const report: SampleSeedReport = { counts: {}, skipped: [], failed: [] };
  const startedAt = now();
  const extras = opts.extrasDb;

  // Demo ekip önce: kayıtlar ekip arasında dağıtılır (yoksa hepsi sahibe).
  let team: string[] = [userId];
  if (extras) {
    const personas = await seedSamplePersonas(extras, tenantId);
    team = [userId, ...personas.ids];
    report.counts.team = personas.ids.length;
    if (personas.failed) report.failed.push({ group: "team", message: personas.failed });
  }
  const member = (i: number) => team[i % team.length]!;

  const plan: SamplePlan = buildSamplePlan({ nowMs: startedAt, seed: tenantId, pack: opts.pack, teamSize: team.length });
  const geo = await resolveSampleGeo(opts.resolveGeo ?? resolveGeo, [
    ...plan.properties.map((p) => ({ city: p.city, district: p.districtName })),
    ...plan.demands.flatMap((d) => (d.districtName ? [{ city: d.city, district: d.districtName }] : [])),
  ]);
  const place = (city: string, district: string | null) => (district ? (geo.places.get(`${city}|${district}`) ?? null) : null);

  // ---- müşteriler ----
  const { data: customers, error: custErr } = await db
    .from("customers")
    .insert(
      plan.customers.map((c) => ({
        tenant_id: tenantId, full_name: c.full_name, phone: c.phone, customer_types: c.customer_types, tags: c.tags,
        source: c.source, notes: c.notes, province_id: geo.provinceId, district_id: geo.districts[c.district],
        assigned_to: member(c.assignee), created_by: userId, created_at: c.created_at, is_sample: true,
      })),
    )
    .select("id, full_name");
  if (custErr || !customers?.length) throw custErr ?? new Error("customers insert boş döndü");
  const custId = (name: string) => customers.find((c) => c.full_name === name)?.id ?? customers[0]!.id;
  report.counts.customers = customers.length;

  // ---- portföyler (çekirdek: canlı + taslak; kapanmışlar ek katmanda) ----
  const propRow = (p: SamplePlan["properties"][number]) => ({
    tenant_id: tenantId, property_code: p.code, title: p.title, transaction_type: p.tx, property_type: p.type, status: p.status,
    published_at: p.published_at, list_price: p.price, commission_rate: p.rate, province_id: place(p.city, p.districtName)?.provinceId ?? null,
    district_id: place(p.city, p.districtName)?.districtId ?? null,
    neighborhood_id: p.neighborhood ? (geo.hoods.get(`${p.district}:${p.neighborhood}`) ?? null) : null,
    features: p.features, owner_customer_id: p.ownerKey ? custId(p.ownerKey) : null, assigned_to: member(p.assignee),
    created_by: userId, created_at: p.created_at, is_sample: true,
  });
  const coreProps = plan.properties.filter((p) => p.status === "live" || p.status === "draft");
  const { data: props, error: propErr } = await db.from("properties").insert(coreProps.map(propRow)).select("id, property_code");
  if (propErr || !props?.length) throw propErr ?? new Error("properties insert boş döndü");
  const propIds = new Map<string, string>(props.map((p) => [p.property_code as string, p.id as string]));
  const propId = (code: string | null) => (code ? (propIds.get(code) ?? null) : null);
  report.counts.properties = props.length;

  // ---- talepler ----
  const { error: demandErr } = await db.from("customer_demands").insert(
    plan.demands.map((d) => ({
      tenant_id: tenantId, customer_id: custId(d.customerKey), transaction_type: d.transaction_type, property_type: d.property_type,
      province_id: place(d.city, d.districtName)?.provinceId ?? geo.provinceId, district_id: place(d.city, d.districtName)?.districtId ?? null,
      budget_min: d.budget_min, budget_max: d.budget_max,
      rooms: d.rooms, min_sqm: d.min_sqm, urgency: d.urgency, status: d.status, created_at: d.created_at, is_sample: true,
    })),
  );
  if (demandErr) throw demandErr;
  report.counts.demands = plan.demands.length;

  // ---- görevler (kapanmış portföye bağlı olanlar ek katmanda bağlanır) ----
  const { error: taskErr } = await db.from("tasks").insert(
    plan.tasks.map((t) => ({
      tenant_id: tenantId, title: t.title, kind: t.kind, priority: t.priority, status: t.status, due_at: t.due_at,
      customer_id: t.customerKey ? custId(t.customerKey) : null, property_id: propId(t.propertyCode),
      assigned_to: member(t.assignee), created_by: userId, created_at: t.created_at, is_sample: true,
    })),
  );
  if (taskErr) throw taskErr;
  report.counts.tasks = plan.tasks.length;

  // ---- randevular ----
  const { error: apptErr } = await db.from("appointments").insert(
    plan.appointments.map((a) => ({
      tenant_id: tenantId, appointment_type: a.appointment_type, scheduled_at: a.scheduled_at, duration_min: a.duration_min,
      location: a.location, status: a.status, customer_id: custId(a.customerKey), property_id: propId(a.propertyCode),
      assigned_to: member(a.assignee), created_by: userId, created_at: a.created_at, is_sample: true,
    })),
  );
  if (apptErr) throw apptErr;
  report.counts.appointments = plan.appointments.length;

  // ---- açık anlaşmalar (yeni / nitelikli / müzakere) ----
  const openDeals = plan.deals.filter((d) => d.stage === "new" || d.stage === "qualified" || d.stage === "negotiation");
  const { error: dealErr } = await db.from("deals").insert(
    openDeals.map((d) => ({
      tenant_id: tenantId, customer_id: custId(d.customerKey), property_id: propId(d.propertyCode), deal_type: d.deal_type,
      stage: d.stage, deal_value: d.deal_value, probability: d.probability, assigned_to: member(d.assignee),
      created_at: d.created_at, updated_at: d.updated_at, is_sample: true,
    })),
  );
  if (dealErr) throw dealErr;
  report.counts.deals = openDeals.length;

  // ================= EKLER (service_role) =================
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
      report.failed.push({ group: name, message: e instanceof Error ? e.message : String((e as { message?: string })?.message ?? "bilinmeyen hata") });
    }
  };
  const flag = async (table: string) => ((await hasSampleColumn(extras, table, cache)) ? { is_sample: true } : {});

  // Kapanmış portföyler (satıldı / kirada): kazanma ve kira akışlarının çapası.
  await group("closed_properties", [], async () => {
    const closed = plan.properties.filter((p) => p.status === "sold" || p.status === "rented");
    const { data, error } = await extras.from("properties").insert(closed.map(propRow)).select("id, property_code");
    if (error || !data?.length) throw error ?? new Error("kapanmış portföy boş döndü");
    for (const p of data) propIds.set(p.property_code as string, p.id as string);
    // Kapanmış portföye bağlı görevlerin bağı (çekirdekte portföy henüz yoktu).
    for (const t of plan.tasks.filter((x) => x.propertyCode && closed.some((c) => c.code === x.propertyCode))) {
      await extras.from("tasks").update({ property_id: propId(t.propertyCode) }).eq("tenant_id", tenantId).eq("is_sample", true).eq("title", t.title);
    }
    for (const a of plan.appointments.filter((x) => x.propertyCode && closed.some((c) => c.code === x.propertyCode))) {
      await extras.from("appointments").update({ property_id: propId(a.propertyCode) }).eq("tenant_id", tenantId).eq("is_sample", true).eq("scheduled_at", a.scheduled_at);
    }
    return data.length;
  });

  // Fotoğraflar: statik demo kütüphanesi (depo nesnesi yok). Kütüphane boşsa grup 0 yazar.
  await group("photos", [], async () => {
    // Her ilan kendi kütüphane setinin fotoğraflarını alır (başlık/tür/oda/m²/ilçe/fiyat zaten setten). Taslak ilan fotoğrafsız.
    const rows = plan.properties.flatMap((p) => {
      const pid = propId(p.code);
      if (!pid || !p.setId || p.status === "draft") return [];
      return mediaRowsForSet(p.setId).map((m) => ({ tenant_id: tenantId, property_id: pid, storage_path: null, uploaded_by: userId, ...m }));
    });
    if (rows.length === 0) return 0;
    const { error } = await extras.from("property_media").insert(rows);
    if (error) {
      // Oda etiketi / açıklama / boyut sütunları yoksa (eski şema) yalın satırla tekrar.
      const plain = rows.map((r) => ({
        tenant_id: r.tenant_id, property_id: r.property_id, kind: r.kind, storage_path: null, external_url: r.external_url,
        file_name: r.file_name, file_type: r.file_type, is_cover: r.is_cover, sort_order: r.sort_order, uploaded_by: r.uploaded_by,
      }));
      const { error: e2 } = await extras.from("property_media").insert(plain);
      if (e2) throw e2;
    }
    return rows.length;
  });

  // Kazanılmış ve kayıp anlaşmalar + komisyon (portföy oranı × anlaşma fiyatı; kazanma akışıyla aynı formül).
  await group("won_deals", [], async () => {
    const closedDeals = plan.deals.filter((d) => d.stage === "won" || d.stage === "lost");
    const { data: inserted, error } = await extras
      .from("deals")
      .insert(
        closedDeals.map((d) => ({
          tenant_id: tenantId, customer_id: custId(d.customerKey), property_id: propId(d.propertyCode), deal_type: d.deal_type,
          stage: d.stage, deal_value: d.deal_value, probability: d.probability, loss_reason: d.loss_reason,
          // Toplu ekleme: PostgREST anahtar birleşimini alır, eksik anahtar NULL olur (varsayılan değil) → her satırda açık değer.
          closure_active: d.stage === "won", prev_property_status: d.stage === "won" ? "live" : null,
          assigned_to: member(d.assignee), is_sample: true, created_at: d.created_at, updated_at: d.updated_at,
        })),
      )
      .select("id, stage, property_id, created_at");
    if (error || !inserted?.length) throw error ?? new Error("kapanmış anlaşma boş döndü");
    const wonIds = new Map<string, string>();
    closedDeals.forEach((d) => {
      const row = inserted.find((r) => r.property_id === propId(d.propertyCode) && r.stage === d.stage && r.created_at && Date.parse(r.created_at as string) === Date.parse(d.created_at));
      if (row) wonIds.set(d.key, row.id as string);
    });
    const commissionFlag = await flag("commissions");
    const rows = plan.commissions
      .filter((c) => wonIds.has(c.dealKey))
      .map((c) => ({ tenant_id: tenantId, deal_id: wonIds.get(c.dealKey)!, gross_amount: c.gross_amount, vat_amount: c.vat_amount, status: c.status, splits: c.splits, created_at: c.created_at, ...commissionFlag }));
    const { error: cErr } = await extras.from("commissions").insert(rows);
    if (cErr) throw cErr;
    report.counts.commissions = rows.length;
    return inserted.length;
  });

  // Kira sözleşmeleri + tahakkuklar (biri iki dönemdir gecikmede).
  await group("rentals", ["rentals"], async () => {
    let n = 0;
    for (const r of plan.rentals) {
      const { data: rental, error } = await extras
        .from("rentals")
        .insert({
          tenant_id: tenantId, property_id: propId(r.propertyCode), renter_customer_id: custId(r.renterKey), monthly_rent: r.monthly_rent,
          due_day: r.due_day, start_date: r.start_date, end_date: r.end_date, deposit: r.deposit, status: "active",
          notes: "Kira sözleşmesi ofiste imzalandı; depozito teslim alındı.", created_by: userId, created_at: r.created_at, is_sample: true,
        })
        .select("id")
        .single();
      if (error || !rental) throw error ?? new Error("kira sözleşmesi boş döndü");
      const { error: chErr } = await extras.from("rent_charges").insert(
        r.charges.map((c) => ({ tenant_id: tenantId, rental_id: rental.id, period: c.period, amount: c.amount, status: c.status, paid_at: c.paid_at })),
      );
      if (chErr) throw chErr;
      n++;
    }
    return n;
  });

  await group("offers", ["offers"], async () => {
    const { error } = await extras.from("offers").insert(
      plan.offers.map((o) => ({
        tenant_id: tenantId, property_id: propId(o.propertyCode), customer_id: custId(o.customerKey), created_by: userId, amount: o.amount,
        status: o.status, counter_amount: o.counter_amount, valid_until: o.valid_until, notes: o.notes, submitted_at: o.submitted_at,
        created_at: o.created_at, is_sample: true,
      })),
    );
    if (error) throw error;
    return plan.offers.length;
  });

  await group("contracts", ["contracts"], async () => {
    const { error } = await extras.from("contracts").insert(
      plan.contracts.map((c) => ({
        tenant_id: tenantId, created_by: userId, property_id: propId(c.propertyCode), customer_id: custId(c.customerKey), contract_type: c.contract_type,
        title: c.title, body: c.body, status: c.status, signed_at: c.signed_at, created_at: c.created_at, updated_at: c.created_at, is_sample: true,
      })),
    );
    if (error) throw error;
    return plan.contracts.length;
  });

  await group("expenses", ["expenses"], async () => {
    const { error } = await extras.from("expenses").insert(
      plan.expenses.map((e) => ({ tenant_id: tenantId, created_by: userId, category: e.category, title: e.title, amount: e.amount, expense_date: e.expense_date, is_sample: true })),
    );
    if (error) throw error;
    return plan.expenses.length;
  });

  await group("calls", ["calls"], async () => {
    const { error } = await extras.from("calls").insert(
      plan.calls.map((c) => ({
        tenant_id: tenantId, customer_id: custId(c.customerKey), direction: c.direction, phone: plan.customers.find((x) => x.key === c.customerKey)!.phone,
        duration_sec: c.duration_sec, disposition: c.disposition, handled_by: member(c.assignee), started_at: c.started_at, is_sample: true,
      })),
    );
    if (error) throw error;
    return plan.calls.length;
  });

  // Gelen kutusu: müşteri silinince kaskatlanır; `is_sample` (20261024020000) varsa ayrıca işaretlenir.
  await group("messages", [], async () => {
    const f = await flag("communications");
    const { error } = await extras.from("communications").insert(
      plan.messages.map((m) => ({
        tenant_id: tenantId, customer_id: custId(m.customerKey), created_by: member(m.assignee), channel: m.channel, direction: m.direction,
        subject: m.subject, body: m.body, created_at: m.created_at, ...f,
      })),
    );
    if (error) throw error;
    return plan.messages.length;
  });

  await group("campaigns", ["campaigns"], async () => {
    const { error } = await extras.from("campaigns").insert(
      plan.campaigns.map((c) => ({
        tenant_id: tenantId, created_by: userId, title: c.title, channel: c.channel, message: c.message, status: c.status, total_count: c.total_count,
        sent_count: c.sent_count, failed_count: c.failed_count, sent_at: c.sent_at, created_at: c.created_at, updated_at: c.created_at, is_sample: true,
        // campaigns_whatsapp_template_contract: WhatsApp kampanyası onaylı şablon adı + dili ister; diğer kanallarda ikisi de boş.
        whatsapp_template_name: c.channel === "whatsapp" ? "demo_yatirim_bulteni" : null,
        whatsapp_template_language: c.channel === "whatsapp" ? "tr" : null,
      })),
    );
    if (error) throw error;
    return plan.campaigns.length;
  });

  // Sahibinden ilan adayları (portföy avı): ad/telefon YOK (kişisel veri sahte de olsa saklanmaz). Tablo yoksa atlanır.
  await group("fsbo_leads", ["fsbo_leads"], async () => {
    const leads: [string, DistrictKey, string, number, number, string, number, number, string | null][] = [
      ["Kadıköy Göztepe'de sahibinden 3+1", "kadikoy", "3+1", 135, 0.98, "yeni", 1, 0, null],
      ["Beşiktaş Levent'te sahibinden 2+1", "besiktas", "2+1", 95, 1.02, "yeni", 3, 0, null],
      ["Ataşehir'de sahibinden 4+1", "atasehir", "4+1", 190, 1, "arandi", 9, 2, null],
      ["Maltepe Cevizli'de sahibinden 2+1", "maltepe", "2+1", 88, 0.96, "randevu", 12, 3, null],
      ["Üsküdar Kuzguncuk'ta sahibinden 3+1", "uskudar", "3+1", 120, 1.04, "yetki_alindi", 20, 4, null],
      ["Şişli Fulya'da sahibinden 1+1", "sisli", "1+1", 62, 1.08, "kayip", 34, 5, "baska_ofis"],
    ];
    const { error } = await extras.from("fsbo_leads").insert(
      leads.map(([title, d, rooms, m2, f, status, daysAgo, attempts, lost], i) => {
        const seen = new Date(startedAt - daysAgo * 86_400_000).toISOString();
        const info = SAMPLE_DISTRICTS.find((x) => x.key === d)!;
        return {
          tenant_id: tenantId, assigned_to: member(i + 1), created_by: userId, source: "manual", portal: "sahibinden", title,
          transaction_type: "sale", property_type: "Daire", rooms, gross_m2: m2, price: Math.round((info.saleM2 * m2 * f) / 50_000) * 50_000,
          province_id: geo.provinceId, district_id: geo.districts[d], location_text: `İstanbul / ${info.name}`, first_seen_at: seen,
          last_seen_at: new Date(startedAt - 86_400_000).toISOString(), listing_status: "active", status, status_changed_at: seen,
          lost_reason: lost, contact_attempts: attempts, last_contact_at: attempts > 0 ? new Date(startedAt - Math.ceil(daysAgo / 2) * 86_400_000).toISOString() : null,
          next_action_at: status === "yeni" || status === "arandi" ? new Date(startedAt + (i % 3) * 86_400_000).toISOString() : null,
          last_activity_at: new Date(startedAt - 86_400_000).toISOString(), created_at: seen, is_sample: true,
        };
      }),
    );
    if (error) throw error;
    return leads.length;
  });

  await group("notifications", ["notifications"], async () => {
    const { error } = await extras.from("notifications").insert(
      plan.notifications.map((n) => ({ tenant_id: tenantId, user_id: member(n.assignee), title: n.title, body: n.body, href: n.href, kind: n.kind, created_at: n.created_at, is_sample: true })),
    );
    if (error) throw error;
    return plan.notifications.length;
  });

  // Modül tohumları (mülk yönetimi, bina/site + aidat, Lig, tapu süreci, EİDS, ilan analizi, finans; finans bütçesi, evrak talebi,
  // kiracı başvurusu, teslim/tahliye tutanağı = records-seed): tek kaynak modules-seed.
  try {
    const dist = (k: DistrictKey) => geo.districts[k];
    const modules = await seedModuleData({
      db: extras,
      tenantId,
      ownerId: userId,
      advisorId: member(1),
      sample: true,
      place: {
        provinceId: geo.provinceId,
        districtId: dist("kadikoy"),
        city: "İstanbul",
        district: "Kadıköy",
        districts: { Kadıköy: dist("kadikoy"), Beşiktaş: dist("besiktas"), Ataşehir: dist("atasehir"), Şişli: dist("sisli") },
      },
      codePrefix: "EMS",
      authorityPropertyCodes: ["EMS-1001", "EMS-1002", "EMS-1006", "EMS-1004", "EMS-1005", "EMS-1008"],
      analysisPropertyCodes: ["EMS-1001", "EMS-1002"],
      processDeals: [
        { propertyCode: "EMS-0905", profile: "in_transfer" },
        { propertyCode: "EMS-1002", profile: "delayed" },
      ],
      poolProfileIds: team.slice(1),
    });
    for (const [k, v] of Object.entries(modules.counts)) report.counts[k] = v;
    report.skipped.push(...modules.skipped);
    report.failed.push(...modules.failed);
  } catch (e) {
    console.error("insertSampleRecords:modules", e);
    report.failed.push({ group: "modules", message: e instanceof Error ? e.message : "bilinmeyen hata" });
  }

  // Modül tohumlarının "şimdi" damgalı müşteri/portföyleri de 6 aya yayılır ("bu ay 40 yeni" görünmesin).
  await group("respread", [], async () => respreadFresh(extras, tenantId, startedAt));
  // Modül tohumlarının ilanları (mülk yönetimi, dükkân, arsa…) da kütüphaneden fotoğraf alır: demo ofiste boş kapak yok.
  await group("photo_backfill", [], async () => attachLibraryPhotosToBareListings(extras, tenantId, userId, { sampleOnly: true, districtNames: (ids) => getDistrictNameMap(ids) }));

  for (const g of ["leak", "surveys"]) {
    report.skipped.push({ group: g, reason: `${g} tablosunda is_sample yok: etkin değil (registry.ts muafiyeti)` });
  }
  return report;
}

/** Bu tohum turunda `now()` damgasıyla yazılmış örnek müşteri/portföyleri geçmişe yayar. */
async function respreadFresh(db: SupabaseClient, tenantId: string, startedAt: number): Promise<number> {
  let n = 0;
  const since = iso(startedAt - 60_000);
  for (const table of ["customers", "properties"] as const) {
    const { data, error } = await db.from(table).select("id").eq("tenant_id", tenantId).eq("is_sample", true).gte("created_at", since).limit(200);
    if (error || !data?.length) continue;
    const stamps = spreadOverMonths({ count: data.length, nowMs: startedAt, months: 6, rng: createRng(`${tenantId}:${table}:respread`) });
    for (const [i, row] of data.entries()) {
      const { error: uErr } = await db.from(table).update({ created_at: iso(stamps[i]!) }).eq("tenant_id", tenantId).eq("id", row.id as string);
      if (!uErr) n++;
    }
  }
  return n;
}
