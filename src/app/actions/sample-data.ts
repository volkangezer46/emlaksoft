"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requirePermission } from "@/lib/require-permission";
import { logActivity } from "@/lib/activity";
import { now, DAY_MS } from "@/lib/clock";

export type SampleDataResult = { error?: string; ok?: boolean };

/**
 * Örnek veri onboarding'i — yeni ofis boş panel yerine tek tıkla küçük,
 * gerçekçi bir Türkçe set görür (aktivasyon artırıcı, bkz. migration
 * 20260726000086_sample_data.sql). Tüm kayıtlar is_sample=true ile işaretlenir;
 * temizleme yalnız bu bayrağı taşıyanları KALICI siler, gerçek veriye dokunmaz.
 */

/** Bugünün belirli saatine ISO damgası (ör. 14:00) — randevu/görev vadesi için. */
function todayAtIso(hour: number, minute = 0, dayOffset = 0): string {
  const d = new Date(now() + dayOffset * DAY_MS);
  d.setHours(hour, minute, 0, 0);
  return d.toISOString();
}

export async function seedSampleData(): Promise<SampleDataResult> {
  const gate = await requirePermission("settings", "edit");
  if (!gate.ok) return { error: gate.error };
  const tenantId = gate.tenantId;
  const userId = gate.userId;

  const supabase = await createClient();

  // Kapı: yalnız GERÇEK müşterisi hiç olmayan ve daha önce hiç örnek veri
  // yüklememiş ofis. (Silinmişler dahil sayılır — kayıt girmiş bir ofis
  // "yeni" değildir; örnek veri karışıklık yaratır.)
  const [{ count: customerCount }, { data: tenantRow }] = await Promise.all([
    supabase.from("customers").select("id", { count: "exact", head: true }),
    supabase.from("tenants").select("sample_seeded_at").eq("id", tenantId).maybeSingle(),
  ]);
  if ((customerCount ?? 0) > 0) {
    return { error: "Ofiste kayıt bulunuyor — örnek veri yalnız boş ofislere yüklenebilir." };
  }
  if (tenantRow?.sample_seeded_at) {
    return { error: "Örnek veriler zaten yüklü." };
  }

  // Konum çeşitliliği best-effort: İstanbul + üç ilçe bulunursa bağlanır,
  // bulunamazsa null kalır (örnek set konumsuz da anlamlı).
  let istanbulId: string | null = null;
  const geo: Record<"kadikoy" | "maltepe" | "besiktas", string | null> = {
    kadikoy: null,
    maltepe: null,
    besiktas: null,
  };
  const { data: prov } = await supabase
    .from("geo_provinces").select("id").eq("name", "İstanbul").maybeSingle();
  if (prov) {
    istanbulId = prov.id;
    const { data: districts } = await supabase
      .from("geo_districts")
      .select("id, name")
      .eq("province_id", prov.id)
      .in("name", ["Kadıköy", "Maltepe", "Beşiktaş"]);
    for (const d of districts ?? []) {
      if (d.name === "Kadıköy") geo.kadikoy = d.id;
      else if (d.name === "Maltepe") geo.maltepe = d.id;
      else if (d.name === "Beşiktaş") geo.besiktas = d.id;
    }
  }

  try {
    // ---- 6 müşteri (tip/etiket çeşitli; telefonlar kurgusal 0532 000 xx xx) ----
    const CUSTOMERS = [
      { full_name: "Selin Aksoy", phone: "05320000101", types: ["Alıcı"], tags: ["örnek", "sıcak"], source: "web", district: geo.kadikoy, notes: "3+1 arıyor, Kadıköy çevresi. Hafta içi 18:00 sonrası müsait." },
      { full_name: "Murat Erdem", phone: "05320000102", types: ["Satıcı"], tags: ["örnek"], source: "referral", district: geo.maltepe, notes: "Maltepe'deki dairesini satmak istiyor, fiyat beklentisi yüksek." },
      { full_name: "Deniz Kara", phone: "05320000103", types: ["Kiracı"], tags: ["örnek"], source: "phone", district: geo.besiktas, notes: "Kurumsal kiracı — eşyalı 1+1/2+1 rezidans arıyor." },
      { full_name: "Fatma Şahin", phone: "05320000104", types: ["Mülk sahibi"], tags: ["örnek", "vip"], source: "walk_in", district: geo.kadikoy, notes: "İki dairesi var; birini kiraya vermek istiyor." },
      { full_name: "Kerem Ünal", phone: "05320000105", types: ["Yatırımcı"], tags: ["örnek"], source: "social", district: geo.besiktas, notes: "Getirisi yüksek küçük daire portföyü topluyor." },
      { full_name: "Aylin Demirtaş", phone: "05320000106", types: ["Alıcı", "Yatırımcı"], tags: ["örnek"], source: "web", district: geo.maltepe, notes: "Hem oturmak hem yatırım — sahile yakın 2+1." },
    ];
    const { data: customers, error: custErr } = await supabase
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

    // ---- 4 portföy (fiyat/oda/m²/konum çeşitli; biri kiralık) ----
    const PROPS = [
      { code: "ORNEK-001", title: "Kadıköy'de deniz manzaralı 3+1", tx: "Satılık", type: "Daire", price: 11500000, rooms: "3+1", sqm: 140, district: geo.kadikoy },
      { code: "ORNEK-002", title: "Maltepe sahile yakın 2+1", tx: "Satılık", type: "Daire", price: 6750000, rooms: "2+1", sqm: 105, district: geo.maltepe },
      { code: "ORNEK-003", title: "Beşiktaş'ta kiralık eşyalı 1+1", tx: "Kiralık", type: "Daire", price: 42000, rooms: "1+1", sqm: 70, district: geo.besiktas },
      { code: "ORNEK-004", title: "Kadıköy'de yatırımlık müstakil ev", tx: "Satılık", type: "Müstakil ev", price: 19500000, rooms: "4+2", sqm: 260, district: geo.kadikoy },
    ];
    const { data: props, error: propErr } = await supabase
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
          published_at: new Date().toISOString(),
          list_price: p.price,
          commission_rate: p.tx === "Satılık" ? 2 : 10,
          province_id: istanbulId,
          district_id: p.district,
          features: { rooms: p.rooms, sqm: p.sqm },
          assigned_to: userId,
          created_by: userId,
          is_sample: true,
        })),
      )
      .select("id, property_code");
    if (propErr || !props?.length) throw propErr ?? new Error("properties insert boş döndü");

    // ---- 3 talep ----
    const { error: demandErr } = await supabase.from("customer_demands").insert([
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
    ]);
    if (demandErr) throw demandErr;

    // ---- 4 görev (bugün / gecikmiş karışık) ----
    const { error: taskErr } = await supabase.from("tasks").insert([
      {
        tenant_id: tenantId, title: "Selin Aksoy'u ara — Kadıköy 3+1 eşleşmesi", kind: "call",
        priority: "high", status: "open", due_at: todayAtIso(14, 0),
        customer_id: custId("Selin Aksoy"), assigned_to: userId, created_by: userId, is_sample: true,
      },
      {
        tenant_id: tenantId, title: "ORNEK-002 için portal ilanını güncelle", kind: "followup",
        priority: "normal", status: "open", due_at: todayAtIso(17, 0),
        property_id: props.find((p) => p.property_code === "ORNEK-002")?.id ?? null,
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
    ]);
    if (taskErr) throw taskErr;

    // ---- 2 randevu (bugün + yarın) ----
    const { error: apptErr } = await supabase.from("appointments").insert([
      {
        tenant_id: tenantId, appointment_type: "showing", scheduled_at: todayAtIso(16, 30),
        duration_min: 45, location: "Kadıköy — ORNEK-001 daire önü", status: "confirmed",
        customer_id: custId("Selin Aksoy"),
        property_id: props.find((p) => p.property_code === "ORNEK-001")?.id ?? null,
        assigned_to: userId, created_by: userId, is_sample: true,
      },
      {
        tenant_id: tenantId, appointment_type: "office", scheduled_at: todayAtIso(10, 30, 1),
        duration_min: 30, location: "Ofis", status: "pending",
        customer_id: custId("Deniz Kara"), assigned_to: userId, created_by: userId, is_sample: true,
      },
    ]);
    if (apptErr) throw apptErr;

    // ---- 1 anlaşma (müzakere) — diğer tablolar gibi is_sample işaretli
    // (bkz. migration 20260726000096_sample_deals_flag.sql) ----
    const { error: dealErr } = await supabase.from("deals").insert({
      tenant_id: tenantId,
      customer_id: custId("Aylin Demirtaş"),
      property_id: props.find((p) => p.property_code === "ORNEK-002")?.id ?? null,
      deal_type: "sale",
      stage: "negotiation",
      deal_value: 6600000,
      probability: 60,
      assigned_to: userId,
      is_sample: true,
    });
    if (dealErr) throw dealErr;

    // tenants güncellemesi kullanıcı RLS'ine takılmasın diye admin client
    // (yalnız kendi tenant'ı, tek kolon — logActivity ile aynı desen)
    const admin = createAdminClient();
    const { error: markErr } = await admin
      .from("tenants")
      .update({ sample_seeded_at: new Date().toISOString() })
      .eq("id", tenantId);
    if (markErr) throw markErr;
  } catch (e) {
    console.error("seedSampleData", e);
    return { error: "Örnek veriler yüklenemedi. Lütfen tekrar deneyin." };
  }

  await logActivity({
    tenantId,
    actorId: userId,
    action: "sample_data.seed",
    entityType: "tenant",
    entityId: tenantId,
    newValue: { customers: 6, properties: 4, demands: 3, tasks: 4, appointments: 2, deals: 1 },
  });

  revalidatePath("/app");
  revalidatePath("/app/ayarlar");
  return { ok: true };
}

/**
 * Örnek verileri KALICI siler (soft delete değil) — yalnız is_sample=true
 * kayıtlar; gerçek kayıtlara asla dokunmaz. FK sırası gereği anlaşmalar
 * müşteri/portföyden ÖNCE silinir (hepsi doğrudan is_sample filtresiyle).
 */
export async function clearSampleData(): Promise<SampleDataResult> {
  const gate = await requirePermission("settings", "edit");
  if (!gate.ok) return { error: gate.error };
  const tenantId = gate.tenantId;

  const supabase = await createClient();

  try {
    // Tüm tablolar aynı doğrudan is_sample filtresiyle silinir; FK sırası:
    // anlaşma → görev/randevu/talep → portföy → müşteri (deals ÖNCE —
    // komisyonlar cascade, gerçek kayıtlara asla dokunulmaz)
    const del = (table: string) =>
      supabase.from(table).delete().eq("tenant_id", tenantId).eq("is_sample", true);
    const { error: dealErr } = await del("deals");
    if (dealErr) throw dealErr;
    const { error: taskErr } = await del("tasks");
    if (taskErr) throw taskErr;
    const { error: apptErr } = await del("appointments");
    if (apptErr) throw apptErr;
    const { error: demandErr } = await del("customer_demands");
    if (demandErr) throw demandErr;

    const { error: propErr } = await del("properties");
    if (propErr) throw propErr;
    const { error: custErr } = await del("customers");
    if (custErr) throw custErr;

    const admin = createAdminClient();
    const { error: markErr } = await admin
      .from("tenants")
      .update({ sample_seeded_at: null })
      .eq("id", tenantId);
    if (markErr) throw markErr;
  } catch (e) {
    console.error("clearSampleData", e);
    return { error: "Örnek veriler temizlenemedi. Lütfen tekrar deneyin." };
  }

  await logActivity({
    tenantId,
    actorId: gate.userId,
    action: "sample_data.clear",
    entityType: "tenant",
    entityId: tenantId,
  });

  revalidatePath("/app");
  revalidatePath("/app/ayarlar");
  return { ok: true };
}

/** ConfirmDialog `formAction` uyumu için void sarmalayıcı (hata logda kalır). */
export async function clearSampleDataForm(_formData: FormData): Promise<void> {
  await clearSampleData();
}
