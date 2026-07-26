"use server";

import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/require-permission";

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
