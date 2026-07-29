"use server";

import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/require-permission";
import { daysAgoIso, daysFromNowIso } from "@/lib/clock";

export type ExportResult = { error?: string; csv?: string; filename?: string };

function toCsv(rows: Record<string, unknown>[]) {
  if (rows.length === 0) return "";
  const keys = Object.keys(rows[0]!);
  const esc = (v: unknown) => {
    const s = v == null ? "" : String(v);
    return `"${s.replace(/"/g, '""')}"`;
  };
  return [keys.join(","), ...rows.map((r) => keys.map((k) => esc(r[k])).join(","))].join("\n");
}

/** supabase-js gömülü ilişkiyi obje ya da dizi tipler — tek kayda indirge. */
function relOne<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

export async function exportCustomersCsv(): Promise<ExportResult> {
  const gate = await requirePermission("customers", "view");
  if (!gate.ok) return { error: gate.error };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("customers")
    .select("full_name, phone, email, customer_types, tags, source, created_at")
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(2000);
  if (error) {
    console.error("exportCustomersCsv", error);
    return { error: "Dışa aktarma başarısız. Lütfen tekrar deneyin." };
  }
  const rows = (data ?? []).map((c) => ({
    ad: c.full_name,
    telefon: c.phone,
    email: c.email,
    tur: (c.customer_types ?? []).join("|"),
    etiketler: (c.tags ?? []).join("|"),
    kaynak: c.source,
    kayit: c.created_at,
  }));
  return { csv: toCsv(rows), filename: `musteriler-${new Date().toISOString().slice(0, 10)}.csv` };
}

export async function exportCommissionsCsv(): Promise<ExportResult> {
  const gate = await requirePermission("commissions", "view");
  if (!gate.ok) return { error: gate.error };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("commissions")
    .select("gross_amount, vat_amount, status, created_at")
    .order("created_at", { ascending: false })
    .limit(2000);
  if (error) {
    console.error("exportCommissionsCsv", error);
    return { error: "Dışa aktarma başarısız. Lütfen tekrar deneyin." };
  }
  const rows = (data ?? []).map((c) => ({
    brut: c.gross_amount,
    kdv: c.vat_amount,
    durum: c.status,
    tarih: c.created_at,
  }));
  return { csv: toCsv(rows), filename: `komisyonlar-${new Date().toISOString().slice(0, 10)}.csv` };
}

export async function exportAuditCsv(): Promise<ExportResult> {
  const gate = await requirePermission("settings", "view");
  if (!gate.ok) return { error: gate.error };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("audit_logs")
    .select("action, entity_type, entity_id, actor_id, old_value, new_value, created_at")
    .order("created_at", { ascending: false })
    .limit(2000);
  if (error) {
    console.error("exportAuditCsv", error);
    return { error: "Dışa aktarma başarısız. Lütfen tekrar deneyin." };
  }

  const actorIds = [...new Set((data ?? []).map((r) => r.actor_id).filter(Boolean))] as string[];
  const names = new Map<string, string>();
  if (actorIds.length) {
    const { data: profiles } = await supabase.from("profiles").select("id, full_name").in("id", actorIds);
    for (const p of profiles ?? []) names.set(p.id, p.full_name);
  }

  const rows = (data ?? []).map((r) => ({
    aksiyon: r.action,
    entity: r.entity_type,
    entity_id: r.entity_id,
    aktor: r.actor_id ? (names.get(r.actor_id) ?? r.actor_id.slice(0, 8)) : "",
    eski: r.old_value ? JSON.stringify(r.old_value) : "",
    yeni: r.new_value ? JSON.stringify(r.new_value) : "",
    tarih: r.created_at,
  }));
  return { csv: toCsv(rows), filename: `denetim-${new Date().toISOString().slice(0, 10)}.csv` };
}

export async function exportPropertiesCsv(): Promise<ExportResult> {
  const gate = await requirePermission("properties", "view");
  if (!gate.ok) return { error: gate.error };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("properties")
    .select(
      "property_code, title, transaction_type, property_type, status, list_price, assigned_to, created_at, province:geo_provinces(name), district:geo_districts(name)",
    )
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(2000);
  if (error) {
    console.error("exportPropertiesCsv", error);
    return { error: "Dışa aktarma başarısız. Lütfen tekrar deneyin." };
  }

  const advisorIds = [...new Set((data ?? []).map((p) => p.assigned_to).filter(Boolean))] as string[];
  const names = new Map<string, string>();
  if (advisorIds.length) {
    const { data: profiles } = await supabase.from("profiles").select("id, full_name").in("id", advisorIds);
    for (const p of profiles ?? []) names.set(p.id, p.full_name);
  }

  const rows = (data ?? []).map((p) => ({
    kod: p.property_code,
    baslik: p.title,
    islem: p.transaction_type,
    tip: p.property_type,
    durum: p.status,
    fiyat: p.list_price,
    il: relOne(p.province)?.name ?? "",
    ilce: relOne(p.district)?.name ?? "",
    danisman: p.assigned_to ? (names.get(p.assigned_to) ?? p.assigned_to.slice(0, 8)) : "",
    olusturma: p.created_at,
  }));
  return { csv: toCsv(rows), filename: `portfoyler-${new Date().toISOString().slice(0, 10)}.csv` };
}

export async function exportExpensesCsv(): Promise<ExportResult> {
  const gate = await requirePermission("expenses", "view");
  if (!gate.ok) return { error: gate.error };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("expenses")
    .select("title, amount, category, expense_date, notes, created_at")
    .eq("tenant_id", gate.tenantId)
    .order("expense_date", { ascending: false })
    .limit(2000);
  if (error) {
    console.error("exportExpensesCsv", error);
    return { error: "Dışa aktarma başarısız. Lütfen tekrar deneyin." };
  }
  const rows = (data ?? []).map((e) => ({
    baslik: e.title,
    tutar: e.amount,
    kategori: e.category,
    tarih: e.expense_date,
    not: e.notes,
    kayit: e.created_at,
  }));
  return { csv: toCsv(rows), filename: `giderler-${new Date().toISOString().slice(0, 10)}.csv` };
}

export async function exportOffersCsv(): Promise<ExportResult> {
  const gate = await requirePermission("offers", "view");
  if (!gate.ok) return { error: gate.error };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("offers")
    .select(
      "amount, counter_amount, status, created_at, property:properties(property_code, title), customer:customers(full_name)",
    )
    .order("created_at", { ascending: false })
    .limit(2000);
  if (error) {
    console.error("exportOffersCsv", error);
    return { error: "Dışa aktarma başarısız. Lütfen tekrar deneyin." };
  }
  const rows = (data ?? []).map((o) => {
    const property = relOne(o.property);
    const customer = relOne(o.customer);
    return {
      portfoy: property?.title ?? property?.property_code ?? "",
      portfoy_kodu: property?.property_code ?? "",
      musteri: customer?.full_name ?? "",
      teklif: o.amount,
      karsi_teklif: o.counter_amount,
      durum: o.status,
      tarih: o.created_at,
    };
  });
  return { csv: toCsv(rows), filename: `teklifler-${new Date().toISOString().slice(0, 10)}.csv` };
}

export async function exportPortalListingsCsv(): Promise<ExportResult> {
  const gate = await requirePermission("portals", "view");
  if (!gate.ok) return { error: gate.error };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("portal_listings")
    .select("portal_name, portal_listing_id, status, last_confirmed_at, property:properties(property_code)")
    .order("created_at", { ascending: false })
    .limit(2000);
  if (error) {
    console.error("exportPortalListingsCsv", error);
    return { error: "Dışa aktarma başarısız. Lütfen tekrar deneyin." };
  }
  const rows = (data ?? []).map((l) => ({
    portal: l.portal_name,
    ilan_no: l.portal_listing_id,
    portfoy_kodu: relOne(l.property)?.property_code ?? "",
    durum: l.status,
    son_teyit: l.last_confirmed_at,
  }));
  return { csv: toCsv(rows), filename: `portal-ilanlari-${new Date().toISOString().slice(0, 10)}.csv` };
}

const today10 = () => new Date().toISOString().slice(0, 10);

// ── Talepler (müşteri talepleri) — ekranın aktif filtresini uygular ──────────
const DEMAND_STATUS_TR: Record<string, string> = { new: "Yeni", active: "Aktif", matched: "Eşleşti", closed: "Kapalı" };
const DEMAND_URGENCY_TR: Record<string, string> = { low: "Düşük", normal: "Normal", high: "Yüksek", urgent: "Acil" };
const DEMAND_URGENCY_VALUES = Object.keys(DEMAND_URGENCY_TR);
const DEMAND_AGING_DAYS = 30;
/** Bütçe bantları — talepler sayfasıyla birebir (karar değeri coalesce(max,min), aralık (min,max]). */
const DEMAND_BANDS: Record<string, { min: number; max: number }> = {
  "2m": { min: 0, max: 2_000_000 },
  "5m": { min: 2_000_000, max: 5_000_000 },
  "10m": { min: 5_000_000, max: 10_000_000 },
  "10m+": { min: 10_000_000, max: Infinity },
};
function demandBudgetOrFilter(key: string): string {
  const band = DEMAND_BANDS[key]!;
  const lo = band.min === 0 ? "gte" : "gt";
  const hiMax = Number.isFinite(band.max) ? `,budget_max.lte.${band.max}` : "";
  const hiMin = Number.isFinite(band.max) ? `,budget_min.lte.${band.max}` : "";
  return `and(budget_max.${lo}.${band.min}${hiMax}),and(budget_max.is.null,budget_min.${lo}.${band.min}${hiMin})`;
}

export type DemandExportFilters = { status?: string; aciliyet?: string; il?: string; butce?: string; yas?: string };

export async function exportDemandsCsv(filters: DemandExportFilters = {}): Promise<ExportResult> {
  const gate = await requirePermission("demands", "view");
  if (!gate.ok) return { error: gate.error };
  const supabase = await createClient();

  const aciliyet = (filters.aciliyet ?? "").split(",").map((v) => v.trim()).filter((v) => DEMAND_URGENCY_VALUES.includes(v));
  const il = (filters.il ?? "").trim();
  const butce = filters.butce && DEMAND_BANDS[filters.butce] ? filters.butce : "";
  const yas = filters.yas === String(DEMAND_AGING_DAYS);

  let q = supabase
    .from("customer_demands")
    .select(
      "transaction_type, property_type, budget_min, budget_max, rooms, min_sqm, urgency, status, created_at, customer:customers(full_name), province:geo_provinces(name)",
    );
  if (filters.status && filters.status !== "all") q = q.eq("status", filters.status);
  else if (!filters.status) q = q.in("status", ["new", "active", "matched"]);
  if (aciliyet.length > 0) q = q.in("urgency", aciliyet);
  if (il) q = q.eq("province_id", il);
  if (butce) q = q.or(demandBudgetOrFilter(butce));
  if (yas) q = q.lte("created_at", daysAgoIso(DEMAND_AGING_DAYS)).neq("status", "closed");

  const { data, error } = await q.order("created_at", { ascending: false }).limit(2000);
  if (error) {
    console.error("exportDemandsCsv", error);
    return { error: "Dışa aktarma başarısız. Lütfen tekrar deneyin." };
  }
  const rows = (data ?? []).map((d) => ({
    musteri: relOne(d.customer)?.full_name ?? "",
    islem: d.transaction_type,
    tip: d.property_type ?? "",
    butce_min: d.budget_min ?? "",
    butce_max: d.budget_max ?? "",
    oda: d.rooms ?? "",
    min_m2: d.min_sqm ?? "",
    il: relOne(d.province)?.name ?? "",
    aciliyet: d.urgency ? (DEMAND_URGENCY_TR[d.urgency] ?? d.urgency) : "",
    durum: DEMAND_STATUS_TR[d.status] ?? d.status,
    kayit: d.created_at,
  }));
  return { csv: toCsv(rows), filename: `talepler-${today10()}.csv` };
}

// ── Randevular — ekranın tip/durum/müşteri/portföy filtresini uygular ────────
const APPT_TYPE_TR: Record<string, string> = { showing: "Yer gösterme", office: "Ofis görüşmesi", valuation: "Değerleme", contract: "Sözleşme" };
const APPT_STATUS_TR: Record<string, string> = { pending: "Teyit bekliyor", confirmed: "Onaylandı", signature: "İmza eksik", completed: "Tamamlandı", cancelled: "İptal" };

export type AppointmentExportFilters = { tip?: string; durum?: string; customer?: string; property?: string };

export async function exportAppointmentsCsv(filters: AppointmentExportFilters = {}): Promise<ExportResult> {
  const gate = await requirePermission("appointments", "view");
  if (!gate.ok) return { error: gate.error };
  const supabase = await createClient();

  let q = supabase
    .from("appointments")
    .select(
      "appointment_type, scheduled_at, duration_min, location, status, customer:customers(full_name), property:properties(property_code, title)",
    )
    .neq("status", "cancelled");
  if (filters.tip && APPT_TYPE_TR[filters.tip]) q = q.eq("appointment_type", filters.tip);
  if (filters.durum) q = q.eq("status", filters.durum);
  if (filters.customer) q = q.eq("customer_id", filters.customer);
  if (filters.property) q = q.eq("property_id", filters.property);

  const { data, error } = await q.order("scheduled_at", { ascending: false }).limit(2000);
  if (error) {
    console.error("exportAppointmentsCsv", error);
    return { error: "Dışa aktarma başarısız. Lütfen tekrar deneyin." };
  }
  const rows = (data ?? []).map((a) => {
    const property = relOne(a.property);
    return {
      tur: APPT_TYPE_TR[a.appointment_type] ?? a.appointment_type,
      tarih: a.scheduled_at,
      sure_dk: a.duration_min ?? "",
      musteri: relOne(a.customer)?.full_name ?? "",
      portfoy: property?.title ?? property?.property_code ?? "",
      konum: a.location ?? "",
      durum: APPT_STATUS_TR[a.status] ?? a.status,
    };
  });
  return { csv: toCsv(rows), filename: `randevular-${today10()}.csv` };
}

// ── Anlaşmalar (satış hattı) — tahta filtresiz; tüm anlaşmalar ────────────────
const DEAL_STAGE_TR: Record<string, string> = { new: "Yeni", qualified: "Nitelikli", negotiation: "Müzakere", won: "Kazanıldı", lost: "Kaybedildi" };

export async function exportDealsCsv(): Promise<ExportResult> {
  const gate = await requirePermission("commissions", "view");
  if (!gate.ok) return { error: gate.error };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("deals")
    .select(
      "stage, deal_type, deal_value, probability, updated_at, property:properties(property_code, title), customer:customers(full_name)",
    )
    .order("updated_at", { ascending: false })
    .limit(2000);
  if (error) {
    console.error("exportDealsCsv", error);
    return { error: "Dışa aktarma başarısız. Lütfen tekrar deneyin." };
  }
  const rows = (data ?? []).map((d) => {
    const property = relOne(d.property);
    return {
      asama: DEAL_STAGE_TR[d.stage] ?? d.stage,
      tur: d.deal_type ?? "",
      deger: d.deal_value ?? "",
      olasilik: d.probability ?? "",
      musteri: relOne(d.customer)?.full_name ?? "",
      portfoy: property?.title ?? property?.property_code ?? "",
      portfoy_kodu: property?.property_code ?? "",
      guncelleme: d.updated_at,
    };
  });
  return { csv: toCsv(rows), filename: `anlasmalar-${today10()}.csv` };
}

// ── Projeler — ekranın durum filtresini uygular ──────────────────────────────
const PROJECT_STATUS_TR: Record<string, string> = { planning: "Planlama", selling: "Satışta", delivered: "Teslim edildi" };

export async function exportProjectsCsv(filters: { durum?: string } = {}): Promise<ExportResult> {
  const gate = await requirePermission("projects", "view");
  if (!gate.ok) return { error: gate.error };
  const supabase = await createClient();
  let q = supabase
    .from("projects")
    .select("name, developer_name, location, status, delivery_date, created_at, units:project_units(status)");
  const durum = filters.durum ?? "";
  if (durum === "aktif") q = q.neq("status", "delivered");
  else if (durum && PROJECT_STATUS_TR[durum]) q = q.eq("status", durum);

  const { data, error } = await q.order("created_at", { ascending: false }).limit(2000);
  if (error) {
    console.error("exportProjectsCsv", error);
    return { error: "Dışa aktarma başarısız. Lütfen tekrar deneyin." };
  }
  const rows = (data ?? []).map((p) => {
    const units = (p.units ?? []) as { status: string }[];
    const satilan = units.filter((u) => u.status === "sold").length;
    const rezerve = units.filter((u) => u.status === "reserved" || u.status === "deposit").length;
    return {
      proje: p.name,
      muteahhit: p.developer_name ?? "",
      konum: p.location ?? "",
      durum: PROJECT_STATUS_TR[p.status] ?? p.status,
      teslim: p.delivery_date ?? "",
      toplam_daire: units.length,
      satilan,
      rezerve,
      kayit: p.created_at,
    };
  });
  return { csv: toCsv(rows), filename: `projeler-${today10()}.csv` };
}

// ── Kiralama — ekranın evre/durum/arıza filtresini uygular (sayfayla birebir) ─
/** start_date'in bugünden sonraki ilk yıldönümü — kiralama sayfasıyla birebir. */
function rentalNextAnniversary(startDate: string, todayStr: string): string | null {
  const mm = startDate.slice(5, 7);
  const dd = mm === "02" && startDate.slice(8, 10) === "29" ? "28" : startDate.slice(8, 10);
  const y = Number(todayStr.slice(0, 4));
  let cand = `${y}-${mm}-${dd}`;
  if (cand < todayStr) cand = `${y + 1}-${mm}-${dd}`;
  return cand > startDate ? cand : null;
}
const RENTAL_EVRELER = ["yeni", "devam", "yenileme", "bitiyor", "bitti"];

export type RentalExportFilters = { durum?: string; ariza?: string; evre?: string };

export async function exportRentalsCsv(filters: RentalExportFilters = {}): Promise<ExportResult> {
  const gate = await requirePermission("rentals", "view");
  if (!gate.ok) return { error: gate.error };
  const supabase = await createClient();

  const [{ data: rentalData, error }, { data: chargeData }, { data: maintData }] = await Promise.all([
    supabase
      .from("rentals")
      .select(
        "id, monthly_rent, due_day, start_date, end_date, status, created_at, property:properties(property_code, title), renter:customers(full_name)",
      )
      .order("created_at", { ascending: false })
      .limit(2000),
    supabase.from("rent_charges").select("rental_id, period, amount, status").order("period", { ascending: false }).limit(5000),
    supabase.from("maintenance_requests").select("rental_id, status").limit(2000),
  ]);
  if (error) {
    console.error("exportRentalsCsv", error);
    return { error: "Dışa aktarma başarısız. Lütfen tekrar deneyin." };
  }

  const rentals = rentalData ?? [];
  const today = daysAgoIso(0).slice(0, 10);
  const curMonth = today.slice(0, 7);
  const curPeriodPrefix = `${curMonth}-01`;
  const in30 = daysFromNowIso(30).slice(0, 10);
  const in60 = daysFromNowIso(60).slice(0, 10);
  const yeni90 = daysAgoIso(90).slice(0, 10);

  const curMonthByRental = new Map<string, string>();
  const overdueRentals = new Set<string>();
  for (const c of chargeData ?? []) {
    const period = String(c.period).slice(0, 10);
    if (period === curPeriodPrefix) curMonthByRental.set(c.rental_id as string, c.status as string);
    if (c.status === "overdue") overdueRentals.add(c.rental_id as string);
  }
  const openMaintRentals = new Set<string>();
  for (const m of maintData ?? []) if (m.status !== "done") openMaintRentals.add(m.rental_id as string);

  // Yenileme penceresi (60 gün) — yıldönümü ya da sözleşme bitişi.
  const renewalIds = new Set<string>();
  for (const r of rentals) {
    if (r.status !== "active") continue;
    const ann = rentalNextAnniversary(String(r.start_date), today);
    const annDue = ann && ann <= in60 ? ann : null;
    const endDue = r.end_date && r.end_date >= today && r.end_date <= in60 ? String(r.end_date) : null;
    if (annDue || endDue) renewalIds.add(String(r.id));
  }
  const evreOf = (r: (typeof rentals)[number]): string => {
    if (r.status !== "active") return "bitti";
    if (r.end_date && r.end_date >= today && r.end_date <= in30) return "bitiyor";
    if (renewalIds.has(String(r.id))) return "yenileme";
    if (String(r.start_date) >= yeni90) return "yeni";
    return "devam";
  };

  const durumF = ["paid", "pending", "overdue"].includes(filters.durum ?? "") ? filters.durum : "";
  const arizaF = filters.ariza === "acik";
  const evreF = RENTAL_EVRELER.includes(filters.evre ?? "") ? filters.evre : "";

  const filtered = rentals.filter((r) => {
    if (evreF && evreOf(r) !== evreF) return false;
    if (arizaF && !openMaintRentals.has(r.id as string)) return false;
    if (durumF === "overdue") return overdueRentals.has(r.id as string);
    if (durumF === "paid") return curMonthByRental.get(r.id as string) === "paid";
    if (durumF === "pending") return curMonthByRental.get(r.id as string) === "pending";
    return true;
  });

  const EVRE_TR: Record<string, string> = { yeni: "Yeni", devam: "Devam eden", yenileme: "Yenileme", bitiyor: "Bitmek üzere", bitti: "Sona ermiş" };
  const rows = filtered.map((r) => {
    const prop = relOne(r.property);
    return {
      portfoy: prop?.title ?? prop?.property_code ?? "",
      kiraci: relOne(r.renter)?.full_name ?? "",
      aylik_kira: r.monthly_rent,
      vade_gunu: r.due_day,
      baslangic: r.start_date,
      bitis: r.end_date ?? "",
      durum: r.status === "active" ? "Aktif" : "Bitti",
      evre: EVRE_TR[evreOf(r)] ?? "",
      gecikme: overdueRentals.has(r.id as string) ? "Evet" : "Hayır",
      acik_ariza: openMaintRentals.has(r.id as string) ? "Evet" : "Hayır",
    };
  });
  return { csv: toCsv(rows), filename: `kiralama-${today10()}.csv` };
}
