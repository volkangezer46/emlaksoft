"use server";

import { APPOINTMENT_TYPE_LABELS } from "@/lib/appointment-labels";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/require-permission";
import { daysAgoIso, daysFromNowIso, trDayKey, trDayStartMs } from "@/lib/clock";
import { orIlike } from "@/lib/pgrst";
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
import { applyScopeFilter, getListScope } from "@/lib/access-control";
import { customFieldCsvColumns } from "@/lib/custom-fields/load";
import { actionErrorMessage } from "@/lib/action-errors";

/**
 * Liste CSV'leri ekranla AYNI kapsamı uygular: eski rol kuralı (`hasOfficeWideDataScope`) taban, ofis bayrağı
 * açıksa kullanıcı kapsamı (kendi/takım/şube) onu yalnız daraltır (`getListScope`).
 */
async function exportScope(gate: { userId: string; tenantId: string; role: string }) {
  return getListScope({ userId: gate.userId, tenantId: gate.tenantId, role: gate.role, mineOnly: !hasOfficeWideDataScope(gate.role) });
}

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
    channel: "quick",
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
      .select("id, full_name, phone, email, customer_types, tags, source, created_at")
      .eq("tenant_id", gate.tenantId)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(EXPORT_LIMIT),
    normalizeCustomerFilters(filters),
  );
  if (!hasOfficeWideDataScope(gate.role)) q = q.eq("assigned_to", gate.userId);
  else q = applyScopeFilter(q, (await exportScope(gate)).filter, { ownerColumn: "assigned_to" });
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
    return { error: actionErrorMessage(error, "Dışa aktarma başarısız. Lütfen tekrar deneyin.") };
  }
  const custom = await customFieldCsvColumns(supabase, gate.tenantId, "customer", (data ?? []).map((r) => String((r as { id?: string }).id ?? "")));
  const rows = (data ?? []).map((r) => ({ ...mapCustomer(r), ...custom.forRecord(String((r as { id?: string }).id ?? "")) }));
  // Segmentli dışa aktarmada tam akış (segment bilmez) önerilmez: yalnız filtreyi daraltma uyarısı kalır.
  return exportResult(gate, "musteriler", rows, `musteriler-${trDayKey()}.csv`, segmentApplied);
}

export async function exportCommissionsCsv(): Promise<ExportResult> {
  const gate = await requirePermission("commissions", "view");
  if (!gate.ok) return { error: gate.error };
  const supabase = await createClient();
  let q = supabase
    .from("commissions")
    .select("gross_amount, vat_amount, status, splits, created_at, deal:deals!commissions_deal_id_fkey!inner(tenant_id, assigned_to, property:properties!deals_property_id_fkey(property_code, title), advisor:profiles!deals_assigned_to_fkey(full_name, tenant_id))")
    .eq("tenant_id", gate.tenantId)
    .eq("deal.tenant_id", gate.tenantId)
    .order("created_at", { ascending: false })
    .limit(EXPORT_LIMIT);
  const seeAll = canSeeAllEarnings(await getEffectivePermissions(gate.tenantId, gate.role, gate.userId));
  if (!hasOfficeWideDataScope(gate.role) || !seeAll) q = q.eq("deal.assigned_to", gate.userId);
  const { data, error } = await q;
  if (error) {
    console.error("exportCommissionsCsv", error);
    return { error: actionErrorMessage(error, "Dışa aktarma başarısız. Lütfen tekrar deneyin.") };
  }
  // Danışman adı: ilk sorguya gömülü profil (ek sorgu yok; deals_assigned_to_fkey). Yalnız bu ofisin profili
  // kabul edilir (tenant_id kontrolü); çözülemeyen kimlik boş kalır.
  const names = new Map<string, string>();
  for (const r of data ?? []) {
    const deal = relOne(r.deal) as { assigned_to?: string | null; advisor?: unknown } | null | undefined;
    const advisor = relOne(deal?.advisor as never) as { full_name?: string | null; tenant_id?: string | null } | null | undefined;
    if (deal?.assigned_to && advisor?.full_name && advisor.tenant_id === gate.tenantId) {
      names.set(deal.assigned_to, advisor.full_name);
    }
  }
  const rows = (data ?? []).map((r) => mapCommission(r, names));
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
    return { error: actionErrorMessage(error, "Dışa aktarma başarısız. Lütfen tekrar deneyin.") };
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
      "id, property_code, title, transaction_type, property_type, status, list_price, assigned_to, created_at, province:geo_provinces(name), district:geo_districts(name)",
    )
    .eq("tenant_id", gate.tenantId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(EXPORT_LIMIT);
  if (!hasOfficeWideDataScope(gate.role)) q = q.eq("assigned_to", gate.userId);
  else q = applyScopeFilter(q, (await exportScope(gate)).filter, { ownerColumn: "assigned_to" });
  const { data, error } = await q;
  if (error) {
    console.error("exportPropertiesCsv", error);
    return { error: actionErrorMessage(error, "Dışa aktarma başarısız. Lütfen tekrar deneyin.") };
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

  const custom = await customFieldCsvColumns(supabase, gate.tenantId, "property", (data ?? []).map((r) => String(r.id)));
  const rows = (data ?? []).map((r) => ({ ...mapProperty(r, names), ...custom.forRecord(String(r.id)) }));
  return exportResult(gate, "portfoyler", rows, `portfoyler-${trDayKey()}.csv`);
}

/** `ids` verilirse yalnız seçili giderler (liste toplu işlemi). */
export async function exportExpensesCsv(ids?: string[]): Promise<ExportResult> {
  const gate = await requirePermission("expenses", "view");
  if (!gate.ok) return { error: gate.error };
  const supabase = await createClient();
  let q = supabase
    .from("expenses")
    .select("title, amount, category, expense_date, notes, receipt_url, created_at, property:properties!expenses_property_id_fkey(property_code, tenant_id)")
    .eq("tenant_id", gate.tenantId)
    .order("expense_date", { ascending: false })
    .limit(EXPORT_LIMIT);
  if (!hasOfficeWideDataScope(gate.role)) q = q.eq("created_by", gate.userId);
  const pickExp = selectedIds(ids);
  if (pickExp) q = q.in("id", pickExp);
  const { data, error } = await q;
  if (error) {
    console.error("exportExpensesCsv", error);
    return { error: actionErrorMessage(error, "Dışa aktarma başarısız. Lütfen tekrar deneyin.") };
  }
  const rows = (data ?? []).map((r) => mapExpense(r));
  return exportResult(gate, "giderler", rows, `giderler-${trDayKey()}.csv`);
}

/** `ids` verilirse yalnız seçili teklifler (liste toplu işlemi). */
export async function exportOffersCsv(ids?: string[]): Promise<ExportResult> {
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
  const pickOffers = selectedIds(ids);
  if (pickOffers) q = q.in("id", pickOffers);
  const { data, error } = await q;
  if (error) {
    console.error("exportOffersCsv", error);
    return { error: actionErrorMessage(error, "Dışa aktarma başarısız. Lütfen tekrar deneyin.") };
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
    return { error: actionErrorMessage(error, "Dışa aktarma başarısız. Lütfen tekrar deneyin.") };
  }
  const rows = (data ?? []).map((r) => mapPortalListing(r));
  return exportResult(gate, "portal-ilanlari", rows, `portal-ilanlari-${trDayKey()}.csv`);
}

const today10 = () => trDayKey();
const UUID_RX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Toplu işlem seçimi: yalnız geçerli UUID'ler, en fazla EXPORT_LIMIT; verilmemiş → null (tüm liste). */
function selectedIds(ids: unknown): string[] | null {
  if (!Array.isArray(ids) || ids.length === 0) return null;
  const rx = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const out = [...new Set(ids.map((v) => String(v)).filter((v) => rx.test(v)))].slice(0, EXPORT_LIMIT);
  // Seçim verildi ama hiçbiri geçerli değilse hiçbir satır dönmesin (tüm listeye düşmez).
  return out.length > 0 ? out : ["00000000-0000-0000-0000-000000000000"];
}

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
      "id, transaction_type, property_type, budget_min, budget_max, rooms, min_sqm, urgency, status, created_at, customer:customers!customer_demands_customer_id_fkey!inner(full_name, tenant_id, assigned_to), province:geo_provinces(name)",
    )
    .eq("tenant_id", gate.tenantId)
    .eq("customer.tenant_id", gate.tenantId);
  if (!hasOfficeWideDataScope(gate.role)) q = q.eq("customer.assigned_to", gate.userId);
  else q = applyScopeFilter(q, (await exportScope(gate)).filter, { ownerColumn: "customer.assigned_to" });
  if (filters.status && filters.status !== "all") q = q.eq("status", filters.status);
  else if (!filters.status) q = q.in("status", ["new", "active", "matched"]);
  if (aciliyet.length > 0) q = q.in("urgency", aciliyet);
  if (il) q = q.eq("province_id", il);
  if (butce) q = q.or(demandBudgetOrFilter(butce));
  if (yas) q = q.lte("created_at", daysAgoIso(DEMAND_AGING_DAYS)).neq("status", "closed");

  const { data, error } = await q.order("created_at", { ascending: false }).limit(EXPORT_LIMIT);
  if (error) {
    console.error("exportDemandsCsv", error);
    return { error: actionErrorMessage(error, "Dışa aktarma başarısız. Lütfen tekrar deneyin.") };
  }
  const custom = await customFieldCsvColumns(supabase, gate.tenantId, "demand", (data ?? []).map((r) => String(r.id)));
  const rows = (data ?? []).map((r) => ({ ...mapDemand(r), ...custom.forRecord(String(r.id)) }));
  return exportResult(gate, "talepler", rows, `talepler-${today10()}.csv`);
}

// ── Randevular — ekranın tip/durum/müşteri/portföy filtresini uygular ────────
const APPT_TYPE_TR = APPOINTMENT_TYPE_LABELS;

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
    return { error: actionErrorMessage(error, "Dışa aktarma başarısız. Lütfen tekrar deneyin.") };
  }
  const rows = (data ?? []).map((r) => mapAppointment(r));
  return exportResult(gate, "randevular", rows, `randevular-${today10()}.csv`);
}

// ── Anlaşmalar (satış hattı) — tahta filtresiz; tüm anlaşmalar ────────────────

/** `ids` verilirse yalnız seçili anlaşmalar (liste toplu işlemi); kapsam kuralı aynı kalır. */
export async function exportDealsCsv(ids?: string[]): Promise<ExportResult> {
  const gate = await requirePermission("commissions", "view");
  if (!gate.ok) return { error: gate.error };
  const supabase = await createClient();
  let q = supabase
    .from("deals")
    .select(
      "id, stage, deal_type, deal_value, probability, updated_at, property:properties!deals_property_id_fkey(property_code, title, tenant_id), customer:customers!deals_customer_id_fkey(full_name, tenant_id)",
    )
    .eq("tenant_id", gate.tenantId)
    .eq("property.tenant_id", gate.tenantId)
    .eq("customer.tenant_id", gate.tenantId)
    .order("updated_at", { ascending: false })
    .limit(EXPORT_LIMIT);
  if (!hasOfficeWideDataScope(gate.role)) q = q.eq("assigned_to", gate.userId);
  else q = applyScopeFilter(q, (await exportScope(gate)).filter, { ownerColumn: "assigned_to" });
  const pick = selectedIds(ids);
  if (pick) q = q.in("id", pick);
  const { data, error } = await q;
  if (error) {
    console.error("exportDealsCsv", error);
    return { error: actionErrorMessage(error, "Dışa aktarma başarısız. Lütfen tekrar deneyin.") };
  }
  const stageNames = stageLabelMap(await getStageLabels());
  const custom = await customFieldCsvColumns(supabase, gate.tenantId, "deal", (data ?? []).map((r) => String(r.id)));
  const mapDealRow = mapDealWith(stageNames);
  const rows = (data ?? []).map((r) => ({ ...mapDealRow(r), ...custom.forRecord(String(r.id)) }));
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
    return { error: actionErrorMessage(error, "Dışa aktarma başarısız. Lütfen tekrar deneyin.") };
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
    return { error: actionErrorMessage(exportError, "Dışa aktarma başarısız. Lütfen tekrar deneyin.") };
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
    return { error: actionErrorMessage(error, "Dışa aktarma başarısız. Lütfen tekrar deneyin.") };
  }
  const rows = (data ?? []).map((r) => mapDue(r));
  return exportResult(gate, "aidatlar", rows, `aidatlar-${today10()}.csv`);
}

/** `ids` verilirse yalnız seçili sözleşmeler (liste toplu işlemi). */
export async function exportContractsCsv(ids?: string[]): Promise<ExportResult> {
  const gate = await requirePermission("contracts", "view");
  if (!gate.ok) return { error: gate.error };
  const supabase = await createClient();
  let q = supabase
    .from("contracts")
    .select(
      "title, contract_type, status, created_at, signed_at, expires_at, cancelled_at, property:properties!contracts_property_id_fkey(property_code, title, tenant_id), customer:customers!contracts_customer_id_fkey(full_name, tenant_id)",
    )
    .eq("tenant_id", gate.tenantId)
    .eq("property.tenant_id", gate.tenantId)
    .eq("customer.tenant_id", gate.tenantId)
    .order("created_at", { ascending: false })
    .limit(EXPORT_LIMIT);
  if (!hasOfficeWideDataScope(gate.role)) q = q.eq("created_by", gate.userId);
  const pickContracts = selectedIds(ids);
  if (pickContracts) q = q.in("id", pickContracts);
  const { data, error } = await q;
  if (error) {
    console.error("exportContractsCsv", error);
    return { error: actionErrorMessage(error, "Dışa aktarma başarısız. Lütfen tekrar deneyin.") };
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
    return { error: actionErrorMessage(error, "Dışa aktarma başarısız. Lütfen tekrar deneyin.") };
  }
  const rows = (data ?? []).map((r) => mapReferral(r));
  return exportResult(gate, "tavsiyeler", rows, `tavsiyeler-${today10()}.csv`);
}

// ── Kampanya alıcı listesi — kampanya detayındaki ?durum= filtresi uygulanır ──
const RECIPIENT_STATUS_TR: Record<string, string> = {
  pending: "Bekliyor", sent: "Gönderildi", delivered: "Teslim edildi", failed: "Ulaşmadı", opted_out: "İzin yok (gönderilmedi)",
};

export async function exportCampaignRecipientsCsv(campaignId: string, durum = ""): Promise<ExportResult> {
  const gate = await requirePermission("campaigns", "view");
  if (!gate.ok) return { error: gate.error };
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(campaignId ?? ""))) return { error: "Kampanya bulunamadı." };
  const supabase = await createClient();
  let q = supabase
    .from("campaign_recipients")
    .select("full_name, phone, status, error_msg, sent_at, created_at, campaign:campaigns!inner(title, tenant_id)")
    .eq("campaign_id", campaignId)
    .eq("campaign.tenant_id", gate.tenantId)
    .order("full_name", { ascending: true })
    .limit(EXPORT_LIMIT);
  if (durum === "ulasan") q = q.in("status", ["sent", "delivered"]);
  else if (RECIPIENT_STATUS_TR[durum]) q = q.eq("status", durum);
  // Kampanya modülü ofis geneli bir pazarlama aracıdır; alıcı listesi kampanya kapsamındadır (aktör filtresi yok).
  const { data, error } = await q;
  if (error) {
    console.error("exportCampaignRecipientsCsv", error);
    return { error: actionErrorMessage(error, "Dışa aktarma başarısız. Lütfen tekrar deneyin.") };
  }
  const rows = (data ?? []).map((r) => ({
    ad_soyad: r.full_name ?? "",
    telefon: r.phone,
    durum: RECIPIENT_STATUS_TR[String(r.status)] ?? r.status,
    hata: r.error_msg ?? "",
    gonderim: r.sent_at ?? "",
    kayit: r.created_at,
  }));
  return exportResult(gate, "kampanya-alicilari", rows, `kampanya-alicilari-${today10()}.csv`, true);
}

// ── Onaylar — ekranın filtreleri (durum/tür/kim/talep eden/tarih) ───────────────
const APPROVAL_STATUS_TR: Record<string, string> = { bekliyor: "Bekliyor", onaylandi: "Onaylandı", reddedildi: "Reddedildi", iptal: "İptal" };
const APPROVAL_KIND_TR: Record<string, string> = {
  komisyon_indirimi: "Komisyon indirimi", gider: "Gider", fiyat_degisikligi: "Fiyat değişikliği", ozel_izin: "Özel izin", diger: "Diğer",
};
export type ApprovalExportFilters = { durum?: string; tur?: string; kim?: string; talepEden?: string; bas?: string; bit?: string };

export async function exportApprovalsCsv(filters: ApprovalExportFilters = {}): Promise<ExportResult> {
  const gate = await requirePermission("commissions", "view");
  if (!gate.ok) return { error: gate.error };
  const supabase = await createClient();
  let q = supabase
    .from("approval_requests")
    .select("kind, title, status, current_value, requested_value, requested_by, decided_by, decided_at, decision_note, created_at")
    .eq("tenant_id", gate.tenantId)
    .order("created_at", { ascending: false })
    .limit(EXPORT_LIMIT);
  if (!hasOfficeWideDataScope(gate.role)) q = q.eq("requested_by", gate.userId);
  if (filters.durum && APPROVAL_STATUS_TR[filters.durum]) q = q.eq("status", filters.durum);
  if (filters.tur && APPROVAL_KIND_TR[filters.tur]) q = q.eq("kind", filters.tur);
  if (filters.kim === "benim") q = q.eq("requested_by", gate.userId);
  else if (filters.kim === "bana") q = q.neq("requested_by", gate.userId);
  if (filters.talepEden && UUID_RX.test(filters.talepEden)) q = q.eq("requested_by", filters.talepEden);
  if (filters.bas && /^\d{4}-\d{2}-\d{2}$/.test(filters.bas)) q = q.gte("created_at", new Date(Date.parse(`${filters.bas}T00:00:00+03:00`)).toISOString());
  if (filters.bit && /^\d{4}-\d{2}-\d{2}$/.test(filters.bit)) q = q.lt("created_at", new Date(Date.parse(`${filters.bit}T00:00:00+03:00`) + 86_400_000).toISOString());
  const { data, error } = await q;
  if (error) {
    console.error("exportApprovalsCsv", error);
    return { error: actionErrorMessage(error, "Dışa aktarma başarısız. Lütfen tekrar deneyin.") };
  }
  const ids = [...new Set((data ?? []).flatMap((r) => [r.requested_by, r.decided_by]).filter(Boolean) as string[])];
  const names = new Map<string, string>();
  if (ids.length) {
    const { data: people } = await supabase.from("profiles").select("id, full_name").eq("tenant_id", gate.tenantId).in("id", ids);
    for (const p of people ?? []) names.set(p.id as string, (p.full_name as string | null) ?? "");
  }
  const rows = (data ?? []).map((r) => ({
    tur: APPROVAL_KIND_TR[String(r.kind)] ?? r.kind,
    baslik: r.title,
    durum: APPROVAL_STATUS_TR[String(r.status)] ?? r.status,
    mevcut_deger: r.current_value ?? "",
    talep_edilen: r.requested_value ?? "",
    talep_eden: r.requested_by ? (names.get(r.requested_by) ?? "") : "",
    karar_veren: r.decided_by ? (names.get(r.decided_by) ?? "") : "",
    karar_tarihi: r.decided_at ?? "",
    karar_notu: r.decision_note ?? "",
    talep_tarihi: r.created_at,
  }));
  return exportResult(gate, "onaylar", rows, `onaylar-${today10()}.csv`, true);
}

// ── Görevler — ekranın filtrelerini (zaman/tür/atanan/arama/gün/zincir) uygular ─────
const TASK_KIND_TR: Record<string, string> = { followup: "Takip", call: "Arama", visit: "Ziyaret", document: "Evrak", other: "Diğer" };
const TASK_STATUS_TR: Record<string, string> = { open: "Açık", done: "Tamamlandı", cancelled: "İptal" };
const TASK_PRIORITY_TR: Record<string, string> = { low: "Düşük", normal: "Normal", high: "Yüksek" };
const TASK_RECURRENCE_TR: Record<string, string> = { daily: "Her gün", weekly: "Her hafta", biweekly: "İki haftada bir", monthly: "Her ay" };

export type TaskExportFilters = {
  filter?: string; tur?: string; mine?: string; danisman?: string; q?: string; tekrar?: string; gun?: string; zincir?: string; anlasma?: string;
};

export async function exportTasksCsv(filters: TaskExportFilters = {}): Promise<ExportResult> {
  const gate = await requirePermission("tasks", "view");
  if (!gate.ok) return { error: gate.error };
  const supabase = await createClient();
  let q = supabase
    .from("tasks")
    .select(
      "title, kind, priority, status, due_at, completed_at, recurrence, recurrence_parent_id, created_at, assignee:profiles!tasks_assigned_to_fkey(full_name), customer:customers!tasks_customer_id_fkey(full_name), deal_id",
    )
    .eq("tenant_id", gate.tenantId)
    .order("due_at", { ascending: true, nullsFirst: false })
    .limit(EXPORT_LIMIT);
  if (!hasOfficeWideDataScope(gate.role)) q = q.eq("assigned_to", gate.userId);
  else q = applyScopeFilter(q, (await exportScope(gate)).filter, { ownerColumn: "assigned_to" });
  const nowIso = new Date().toISOString();
  const dayStart = trDayStartMs();
  if (filters.filter === "done") q = q.eq("status", "done");
  else if (filters.filter === "overdue") q = q.eq("status", "open").lt("due_at", nowIso);
  else if (filters.filter === "yaklasan") q = q.eq("status", "open").gte("due_at", nowIso).lte("due_at", daysFromNowIso(7));
  else if (filters.filter === "today") {
    q = q.eq("status", "open").gte("due_at", new Date(dayStart).toISOString()).lte("due_at", new Date(dayStart + 86_400_000 - 1).toISOString());
  } else if (filters.filter !== "all") q = q.eq("status", "open");
  if (filters.tur && TASK_KIND_TR[filters.tur]) q = q.eq("kind", filters.tur);
  if (filters.mine === "1") q = q.eq("assigned_to", gate.userId);
  if (filters.danisman && UUID_RX.test(filters.danisman)) q = q.eq("assigned_to", filters.danisman);
  if (filters.tekrar === "1") q = q.not("recurrence", "is", null);
  if (filters.zincir && UUID_RX.test(filters.zincir)) q = q.or(`id.eq.${filters.zincir},recurrence_parent_id.eq.${filters.zincir}`);
  if (filters.anlasma && UUID_RX.test(filters.anlasma)) q = q.eq("deal_id", filters.anlasma);
  if (filters.gun && /^\d{4}-\d{2}-\d{2}$/.test(filters.gun)) {
    const start = Date.parse(`${filters.gun}T00:00:00+03:00`);
    if (Number.isFinite(start)) q = q.gte("due_at", new Date(start).toISOString()).lt("due_at", new Date(start + 86_400_000).toISOString());
  }
  const term = (filters.q ?? "").trim().slice(0, 80);
  if (term) q = q.or(orIlike(["title", "notes"], term));
  const { data, error } = await q;
  if (error) {
    console.error("exportTasksCsv", error);
    return { error: actionErrorMessage(error, "Dışa aktarma başarısız. Lütfen tekrar deneyin.") };
  }
  const rows = (data ?? []).map((t) => ({
    baslik: t.title,
    tur: TASK_KIND_TR[String(t.kind)] ?? t.kind,
    oncelik: TASK_PRIORITY_TR[String(t.priority)] ?? t.priority,
    durum: TASK_STATUS_TR[String(t.status)] ?? t.status,
    vade: t.due_at ?? "",
    tamamlanma: t.completed_at ?? "",
    tekrar: t.recurrence ? (TASK_RECURRENCE_TR[String(t.recurrence)] ?? t.recurrence) : "",
    zincir_kopyasi: t.recurrence_parent_id ? "Evet" : "",
    atanan: relOne(t.assignee as { full_name?: string } | { full_name?: string }[] | null)?.full_name ?? "",
    musteri: relOne(t.customer as { full_name?: string } | { full_name?: string }[] | null)?.full_name ?? "",
    anlasma_bagli: t.deal_id ? "Evet" : "",
    kayit: t.created_at,
  }));
  return exportResult(gate, "gorevler", rows, `gorevler-${today10()}.csv`, true);
}
