"use server";

import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/require-permission";
import { daysAgoIso, daysFromNowIso, trDayKey } from "@/lib/clock";
import {
  mapAppointment, mapAudit, mapCommission, mapContract, mapCustomer, mapDealWith, mapDemand, mapDue, mapExpense,
  mapOffer, mapPortalListing, mapProject, mapProperty, mapReferral, relOne, toCsv,
} from "@/lib/export-entities";
import { hasOfficeWideDataScope } from "@/lib/permission-data-scope";
import { getEffectivePermissions } from "@/lib/permissions-effective";
import { canSeeAllEarnings } from "@/lib/team/earnings-scope";
import { getStageLabels } from "@/lib/definitions";
import { stageLabelMap } from "@/lib/deal-stage-labels";
import { logActivity } from "@/lib/activity";
import { requestApprovalIfNeeded } from "@/lib/oversight/approval-gate";
import { filterCustomersByHeatSegment } from "@/lib/customer-heat-export";
import { applyCustomerFilters, normalizeCustomerFilters, type CustomerListFilters } from "@/lib/customer-list-filters";

export type ExportResult = {
  error?: string;
  csv?: string;
  filename?: string;
  /** Sonuç sınıra takıldı: dosyada yalnız ilk EXPORT_LIMIT kayıt var. */
  truncated?: boolean;
  rowCount?: number;
  /** Varlık anahtarı; tam akış dışa aktarma (/api/export/[entity]) bağlantısı için. */
  entity?: string;
};

/** Tek dışa aktarmada en fazla satır. Aşılırsa dosyaya uyarı satırı eklenir ve kullanıcıya bildirilir. */
const EXPORT_LIMIT = 2000;

/**
 * Dışa aktarma sonucunu üretir: sınıra takıldıysa dosyaya uyarı satırı ekler ve
 * "kim, neyi, kaç satır indirdi" izini audit_logs'a yazar (kişisel veri içermez).
 */
async function exportResult(
  gate: { tenantId: string; userId: string },
  entity: string,
  rows: Record<string, unknown>[],
  filename: string,
  omitFullDownload = false,
): Promise<ExportResult> {
  // Ofis kontrol onay kapısı (varsayılan kapalı): tüm dışa aktarmalar bu tek çıkış noktasından geçer.
  const approval = await requestApprovalIfNeeded(gate.tenantId, gate.userId, "bulk_export", {
    rows: rows.length,
    exportEntity: entity,
  });
  if (approval.status !== "not_required" && approval.status !== "approved") return { error: approval.message };

  const truncated = rows.length >= EXPORT_LIMIT;
  let csv = toCsv(rows);
  if (truncated) {
    csv += `
"UYARI: Yalnızca ilk ${EXPORT_LIMIT} kayıt dışa aktarıldı. Tamamı için filtreyi daraltın."`;
  }
  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: "export.csv",
    entityType: entity,
    newValue: { rows: rows.length, truncated, filename },
  });
  return { csv, filename, truncated, rowCount: rows.length, entity: omitFullDownload ? undefined : entity };
}

/** Müşteri CSV'si ekrandaki filtreyi uygular (ortak kurucu: src/lib/customer-list-filters.ts). */
export async function exportCustomersCsv(filters: Partial<CustomerListFilters> = {}): Promise<ExportResult> {
  const gate = await requirePermission("customers", "view");
  if (!gate.ok) return { error: gate.error };
  const supabase = await createClient();
  let q = applyCustomerFilters(
    supabase
      .from("customers")
      .select("full_name, phone, email, customer_types, tags, source, created_at")
      .eq("tenant_id", gate.tenantId)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(EXPORT_LIMIT),
    normalizeCustomerFilters(filters),
  );
  if (!hasOfficeWideDataScope(gate.role)) q = q.eq("assigned_to", gate.userId);
  let { data, error } = await q;
  const normalized = normalizeCustomerFilters(filters);
  let segmentApplied = false;
  if (!error && normalized.segment) {
    // Sıcaklık segmenti: ekranla aynı skorlama (scoreCustomerHeat + customer_heat_signals), tüm liste sınırı (EXPORT_LIMIT) içinde.
    segmentApplied = true;
    const picked = await filterCustomersByHeatSegment(supabase, gate, normalized, normalized.segment);
    if (picked.error) {
      console.error("exportCustomersCsv segment", picked.error);
      error = picked.error as unknown as typeof error;
    } else {
      data = picked.rows as unknown as typeof data;
    }
  }
  if (error) {
    console.error("exportCustomersCsv", error);
    return { error: "Dışa aktarma başarısız. Lütfen tekrar deneyin." };
  }
  const rows = (data ?? []).map((r) => mapCustomer(r));
  // Segmentli dışa aktarmada tam akış (segment bilmez) önerilmez: yalnız filtreyi daraltma uyarısı kalır.
  return exportResult(gate, "musteriler", rows, `musteriler-${trDayKey()}.csv`, segmentApplied);
}

export async function exportCommissionsCsv(): Promise<ExportResult> {
  const gate = await requirePermission("commissions", "view");
  if (!gate.ok) return { error: gate.error };
  const supabase = await createClient();
  let q = supabase
    .from("commissions")
    .select("gross_amount, vat_amount, status, created_at, deal:deals!commissions_deal_id_fkey!inner(tenant_id, assigned_to)")
    .eq("tenant_id", gate.tenantId)
    .eq("deal.tenant_id", gate.tenantId)
    .order("created_at", { ascending: false })
    .limit(EXPORT_LIMIT);
  const seeAll = canSeeAllEarnings(await getEffectivePermissions(gate.tenantId, gate.role, gate.userId));
  if (!hasOfficeWideDataScope(gate.role) || !seeAll) q = q.eq("deal.assigned_to", gate.userId);
  const { data, error } = await q;
  if (error) {
    console.error("exportCommissionsCsv", error);
    return { error: "Dışa aktarma başarısız. Lütfen tekrar deneyin." };
  }
  const rows = (data ?? []).map((r) => mapCommission(r));
  return exportResult(gate, "komisyonlar", rows, `komisyonlar-${trDayKey()}.csv`);
}

export async function exportAuditCsv(): Promise<ExportResult> {
  const gate = await requirePermission("settings", "view");
  if (!gate.ok) return { error: gate.error };
  const supabase = await createClient();
  let q = supabase
    .from("audit_logs")
    .select("action, entity_type, entity_id, actor_id, old_value, new_value, created_at")
    .eq("tenant_id", gate.tenantId)
    .order("created_at", { ascending: false })
    .limit(EXPORT_LIMIT);
  const seeAll = canSeeAllEarnings(await getEffectivePermissions(gate.tenantId, gate.role, gate.userId));
  if (!hasOfficeWideDataScope(gate.role) || !seeAll) q = q.eq("actor_id", gate.userId);
  const { data, error } = await q;
  if (error) {
    console.error("exportAuditCsv", error);
    return { error: "Dışa aktarma başarısız. Lütfen tekrar deneyin." };
  }

  const actorIds = [...new Set((data ?? []).map((r) => r.actor_id).filter(Boolean))] as string[];
  const names = new Map<string, string>();
  if (actorIds.length) {
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, full_name")
      .eq("tenant_id", gate.tenantId)
      .in("id", actorIds);
    for (const p of profiles ?? []) names.set(p.id, p.full_name);
  }

  const rows = (data ?? []).map((r) => mapAudit(r, names));
  return exportResult(gate, "denetim", rows, `denetim-${trDayKey()}.csv`);
}

export async function exportPropertiesCsv(): Promise<ExportResult> {
  const gate = await requirePermission("properties", "view");
  if (!gate.ok) return { error: gate.error };
  const supabase = await createClient();
  let q = supabase
    .from("properties")
    .select(
      "property_code, title, transaction_type, property_type, status, list_price, assigned_to, created_at, province:geo_provinces(name), district:geo_districts(name)",
    )
    .eq("tenant_id", gate.tenantId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(EXPORT_LIMIT);
  if (!hasOfficeWideDataScope(gate.role)) q = q.eq("assigned_to", gate.userId);
  const { data, error } = await q;
  if (error) {
    console.error("exportPropertiesCsv", error);
    return { error: "Dışa aktarma başarısız. Lütfen tekrar deneyin." };
  }

  const advisorIds = [...new Set((data ?? []).map((p) => p.assigned_to).filter(Boolean))] as string[];
  const names = new Map<string, string>();
  if (advisorIds.length) {
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, full_name")
      .eq("tenant_id", gate.tenantId)
      .in("id", advisorIds);
    for (const p of profiles ?? []) names.set(p.id, p.full_name);
  }

  const rows = (data ?? []).map((r) => mapProperty(r, names));
  return exportResult(gate, "portfoyler", rows, `portfoyler-${trDayKey()}.csv`);
}

export async function exportExpensesCsv(): Promise<ExportResult> {
  const gate = await requirePermission("expenses", "view");
  if (!gate.ok) return { error: gate.error };
  const supabase = await createClient();
  let q = supabase
    .from("expenses")
    .select("title, amount, category, expense_date, notes, created_at")
    .eq("tenant_id", gate.tenantId)
    .order("expense_date", { ascending: false })
    .limit(EXPORT_LIMIT);
  if (!hasOfficeWideDataScope(gate.role)) q = q.eq("created_by", gate.userId);
  const { data, error } = await q;
  if (error) {
    console.error("exportExpensesCsv", error);
    return { error: "Dışa aktarma başarısız. Lütfen tekrar deneyin." };
  }
  const rows = (data ?? []).map((r) => mapExpense(r));
  return exportResult(gate, "giderler", rows, `giderler-${trDayKey()}.csv`);
}

export async function exportOffersCsv(): Promise<ExportResult> {
  const gate = await requirePermission("offers", "view");
  if (!gate.ok) return { error: gate.error };
  const supabase = await createClient();
  let q = supabase
    .from("offers")
    .select(
      "amount, counter_amount, status, created_at, property:properties!offers_property_id_fkey(property_code, title, tenant_id), customer:customers!offers_customer_id_fkey(full_name, tenant_id)",
    )
    .eq("tenant_id", gate.tenantId)
    .eq("property.tenant_id", gate.tenantId)
    .eq("customer.tenant_id", gate.tenantId)
    .order("created_at", { ascending: false })
    .limit(EXPORT_LIMIT);
  if (!hasOfficeWideDataScope(gate.role)) q = q.eq("created_by", gate.userId);
  const { data, error } = await q;
  if (error) {
    console.error("exportOffersCsv", error);
    return { error: "Dışa aktarma başarısız. Lütfen tekrar deneyin." };
  }
  const rows = (data ?? []).map((r) => mapOffer(r));
  return exportResult(gate, "teklifler", rows, `teklifler-${trDayKey()}.csv`);
}

export async function exportPortalListingsCsv(): Promise<ExportResult> {
  const gate = await requirePermission("portals", "view");
  if (!gate.ok) return { error: gate.error };
  const supabase = await createClient();
  let q = supabase
    .from("portal_listings")
    .select(
      "portal_name, portal_listing_id, status, last_confirmed_at, property:properties!portal_listings_property_id_fkey!inner(property_code, tenant_id, assigned_to)",
    )
    .eq("tenant_id", gate.tenantId)
    .eq("property.tenant_id", gate.tenantId)
    .order("created_at", { ascending: false })
    .limit(EXPORT_LIMIT);
  if (!hasOfficeWideDataScope(gate.role)) q = q.eq("property.assigned_to", gate.userId);
  const { data, error } = await q;
  if (error) {
    console.error("exportPortalListingsCsv", error);
    return { error: "Dışa aktarma başarısız. Lütfen tekrar deneyin." };
  }
  const rows = (data ?? []).map((r) => mapPortalListing(r));
  return exportResult(gate, "portal-ilanlari", rows, `portal-ilanlari-${trDayKey()}.csv`);
}

const today10 = () => trDayKey();

// ── Talepler (müşteri talepleri) — ekranın aktif filtresini uygular ──────────
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
      "transaction_type, property_type, budget_min, budget_max, rooms, min_sqm, urgency, status, created_at, customer:customers!customer_demands_customer_id_fkey!inner(full_name, tenant_id, assigned_to), province:geo_provinces(name)",
    )
    .eq("tenant_id", gate.tenantId)
    .eq("customer.tenant_id", gate.tenantId);
  if (!hasOfficeWideDataScope(gate.role)) q = q.eq("customer.assigned_to", gate.userId);
  if (filters.status && filters.status !== "all") q = q.eq("status", filters.status);
  else if (!filters.status) q = q.in("status", ["new", "active", "matched"]);
  if (aciliyet.length > 0) q = q.in("urgency", aciliyet);
  if (il) q = q.eq("province_id", il);
  if (butce) q = q.or(demandBudgetOrFilter(butce));
  if (yas) q = q.lte("created_at", daysAgoIso(DEMAND_AGING_DAYS)).neq("status", "closed");

  const { data, error } = await q.order("created_at", { ascending: false }).limit(EXPORT_LIMIT);
  if (error) {
    console.error("exportDemandsCsv", error);
    return { error: "Dışa aktarma başarısız. Lütfen tekrar deneyin." };
  }
  const rows = (data ?? []).map((r) => mapDemand(r));
  return exportResult(gate, "talepler", rows, `talepler-${today10()}.csv`);
}

// ── Randevular — ekranın tip/durum/müşteri/portföy filtresini uygular ────────
const APPT_TYPE_TR: Record<string, string> = { showing: "Yer gösterme", office: "Ofis görüşmesi", valuation: "Değerleme", contract: "Sözleşme" };

export type AppointmentExportFilters = { tip?: string; durum?: string; customer?: string; property?: string };

export async function exportAppointmentsCsv(filters: AppointmentExportFilters = {}): Promise<ExportResult> {
  const gate = await requirePermission("appointments", "view");
  if (!gate.ok) return { error: gate.error };
  const supabase = await createClient();

  let q = supabase
    .from("appointments")
    .select(
      "appointment_type, scheduled_at, duration_min, location, status, customer:customers!appointments_customer_id_fkey(full_name, tenant_id), property:properties!appointments_property_id_fkey(property_code, title, tenant_id)",
    )
    .eq("tenant_id", gate.tenantId)
    .eq("customer.tenant_id", gate.tenantId)
    .eq("property.tenant_id", gate.tenantId)
    .neq("status", "cancelled");
  if (!hasOfficeWideDataScope(gate.role)) q = q.eq("assigned_to", gate.userId);
  if (filters.tip && APPT_TYPE_TR[filters.tip]) q = q.eq("appointment_type", filters.tip);
  if (filters.durum) q = q.eq("status", filters.durum);
  if (filters.customer) q = q.eq("customer_id", filters.customer);
  if (filters.property) q = q.eq("property_id", filters.property);

  const { data, error } = await q.order("scheduled_at", { ascending: false }).limit(EXPORT_LIMIT);
  if (error) {
    console.error("exportAppointmentsCsv", error);
    return { error: "Dışa aktarma başarısız. Lütfen tekrar deneyin." };
  }
  const rows = (data ?? []).map((r) => mapAppointment(r));
  return exportResult(gate, "randevular", rows, `randevular-${today10()}.csv`);
}

// ── Anlaşmalar (satış hattı) — tahta filtresiz; tüm anlaşmalar ────────────────

export async function exportDealsCsv(): Promise<ExportResult> {
  const gate = await requirePermission("commissions", "view");
  if (!gate.ok) return { error: gate.error };
  const supabase = await createClient();
  let q = supabase
    .from("deals")
    .select(
      "stage, deal_type, deal_value, probability, updated_at, property:properties!deals_property_id_fkey(property_code, title, tenant_id), customer:customers!deals_customer_id_fkey(full_name, tenant_id)",
    )
    .eq("tenant_id", gate.tenantId)
    .eq("property.tenant_id", gate.tenantId)
    .eq("customer.tenant_id", gate.tenantId)
    .order("updated_at", { ascending: false })
    .limit(EXPORT_LIMIT);
  if (!hasOfficeWideDataScope(gate.role)) q = q.eq("assigned_to", gate.userId);
  const { data, error } = await q;
  if (error) {
    console.error("exportDealsCsv", error);
    return { error: "Dışa aktarma başarısız. Lütfen tekrar deneyin." };
  }
  const stageNames = stageLabelMap(await getStageLabels());
  const rows = (data ?? []).map(mapDealWith(stageNames));
  return exportResult(gate, "anlasmalar", rows, `anlasmalar-${today10()}.csv`);
}

// ── Projeler — ekranın durum filtresini uygular ──────────────────────────────
const PROJECT_STATUS_TR: Record<string, string> = { planning: "Planlama", selling: "Satışta", delivered: "Teslim edildi" };

export async function exportProjectsCsv(filters: { durum?: string } = {}): Promise<ExportResult> {
  const gate = await requirePermission("projects", "view");
  if (!gate.ok) return { error: gate.error };
  const supabase = await createClient();
  let q = supabase
    .from("projects")
    .select("name, developer_name, location, status, delivery_date, created_at, units:project_units!project_units_project_id_fkey(status)")
    .eq("tenant_id", gate.tenantId)
    .eq("units.tenant_id", gate.tenantId);
  if (!hasOfficeWideDataScope(gate.role)) q = q.eq("created_by", gate.userId);
  const durum = filters.durum ?? "";
  if (durum === "aktif") q = q.neq("status", "delivered");
  else if (durum && PROJECT_STATUS_TR[durum]) q = q.eq("status", durum);

  const { data, error } = await q.order("created_at", { ascending: false }).limit(EXPORT_LIMIT);
  if (error) {
    console.error("exportProjectsCsv", error);
    return { error: "Dışa aktarma başarısız. Lütfen tekrar deneyin." };
  }
  const rows = (data ?? []).map((r) => mapProject(r));
  return exportResult(gate, "projeler", rows, `projeler-${today10()}.csv`);
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

  let rentalQuery = supabase
    .from("rentals")
    .select(
      "id, monthly_rent, due_day, start_date, end_date, status, created_at, property:properties!rentals_property_id_fkey!inner(property_code, title, tenant_id), renter:customers!rentals_renter_customer_id_fkey!inner(full_name, tenant_id)",
    )
    .eq("tenant_id", gate.tenantId)
    .eq("property.tenant_id", gate.tenantId)
    .eq("renter.tenant_id", gate.tenantId)
    .order("created_at", { ascending: false })
    .limit(EXPORT_LIMIT);
  let chargeQuery = supabase
    .from("rent_charges")
    .select("rental_id, period, amount, status, rental:rentals!rent_charges_rental_id_fkey!inner(tenant_id, created_by)")
    .eq("tenant_id", gate.tenantId)
    .eq("rental.tenant_id", gate.tenantId)
    .order("period", { ascending: false })
    .limit(5000);
  let maintenanceQuery = supabase
    .from("maintenance_requests")
    .select("rental_id, status, rental:rentals!maintenance_requests_rental_id_fkey!inner(tenant_id, created_by)")
    .eq("tenant_id", gate.tenantId)
    .eq("rental.tenant_id", gate.tenantId)
    .limit(EXPORT_LIMIT);

  if (!hasOfficeWideDataScope(gate.role)) {
    rentalQuery = rentalQuery.eq("created_by", gate.userId);
    chargeQuery = chargeQuery.eq("rental.created_by", gate.userId);
    maintenanceQuery = maintenanceQuery.eq("rental.created_by", gate.userId);
  }

  const [
    { data: rentalData, error: rentalError },
    { data: chargeData, error: chargeError },
    { data: maintData, error: maintError },
  ] = await Promise.all([rentalQuery, chargeQuery, maintenanceQuery]);
  const exportError = rentalError ?? chargeError ?? maintError;
  if (exportError) {
    console.error("exportRentalsCsv", exportError);
    return { error: "Dışa aktarma başarısız. Lütfen tekrar deneyin." };
  }

  const rentals = rentalData ?? [];
  const today = trDayKey();
  const curMonth = today.slice(0, 7);
  const curPeriodPrefix = `${curMonth}-01`;
  const in30 = trDayKey(daysFromNowIso(30));
  const in60 = trDayKey(daysFromNowIso(60));
  const yeni90 = trDayKey(daysAgoIso(90));

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
  return exportResult(gate, "kiralama", rows, `kiralama-${today10()}.csv`);
}

export async function exportDuesCsv(): Promise<ExportResult> {
  const gate = await requirePermission("expenses", "view");
  if (!gate.ok) return { error: gate.error };
  const supabase = await createClient();
  let q = supabase
    .from("property_dues")
    .select("title, amount, period, due_date, status, paid_at, property:properties!property_dues_property_id_fkey(property_code, title, tenant_id)")
    .eq("tenant_id", gate.tenantId)
    .eq("property.tenant_id", gate.tenantId)
    .order("period", { ascending: false })
    .limit(EXPORT_LIMIT);
  if (!hasOfficeWideDataScope(gate.role)) q = q.eq("created_by", gate.userId);
  const { data, error } = await q;
  if (error) {
    console.error("exportDuesCsv", error);
    return { error: "Dışa aktarma başarısız. Lütfen tekrar deneyin." };
  }
  const rows = (data ?? []).map((r) => mapDue(r));
  return exportResult(gate, "aidatlar", rows, `aidatlar-${today10()}.csv`);
}

export async function exportContractsCsv(): Promise<ExportResult> {
  const gate = await requirePermission("contracts", "view");
  if (!gate.ok) return { error: gate.error };
  const supabase = await createClient();
  let q = supabase
    .from("contracts")
    .select(
      "title, contract_type, status, created_at, signed_at, expires_at, property:properties!contracts_property_id_fkey(property_code, title, tenant_id), customer:customers!contracts_customer_id_fkey(full_name, tenant_id)",
    )
    .eq("tenant_id", gate.tenantId)
    .eq("property.tenant_id", gate.tenantId)
    .eq("customer.tenant_id", gate.tenantId)
    .order("created_at", { ascending: false })
    .limit(EXPORT_LIMIT);
  if (!hasOfficeWideDataScope(gate.role)) q = q.eq("created_by", gate.userId);
  const { data, error } = await q;
  if (error) {
    console.error("exportContractsCsv", error);
    return { error: "Dışa aktarma başarısız. Lütfen tekrar deneyin." };
  }
  const rows = (data ?? []).map((r) => mapContract(r));
  return exportResult(gate, "sozlesmeler", rows, `sozlesmeler-${today10()}.csv`);
}

export async function exportReferralsCsv(): Promise<ExportResult> {
  const gate = await requirePermission("customers", "view");
  if (!gate.ok) return { error: gate.error };
  const supabase = await createClient();
  let q = supabase
    .from("referrals")
    .select(
      "referred_name, referred_phone, referred_note, staff_note, status, created_at, referrer:customers!referrals_referrer_customer_id_fkey(full_name, tenant_id)",
    )
    .eq("tenant_id", gate.tenantId)
    .eq("referrer.tenant_id", gate.tenantId)
    .order("created_at", { ascending: false })
    .limit(EXPORT_LIMIT);
  if (!hasOfficeWideDataScope(gate.role)) q = q.eq("handled_by", gate.userId);
  const { data, error } = await q;
  if (error) {
    console.error("exportReferralsCsv", error);
    return { error: "Dışa aktarma başarısız. Lütfen tekrar deneyin." };
  }
  const rows = (data ?? []).map((r) => mapReferral(r));
  return exportResult(gate, "tavsiyeler", rows, `tavsiyeler-${today10()}.csv`);
}
