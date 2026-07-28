"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { requirePlatformModule } from "@/lib/platform";

export type ExportResult = { error?: string; csv?: string; filename?: string };

const planLabel: Record<string, string> = { advisor: "Danışman", office: "Ofis", professional: "Profesyonel", enterprise: "Kurumsal" };
const statusLabel: Record<string, string> = { trial: "Deneme", active: "Aktif", past_due: "Gecikmiş", suspended: "Askıda", cancelled: "İptal" };

function toCsv(rows: Record<string, unknown>[]) {
  if (rows.length === 0) return "";
  const keys = Object.keys(rows[0]!);
  const esc = (v: unknown) => `"${(v == null ? "" : String(v)).replace(/"/g, '""')}"`;
  // BOM + başlık satırı → Excel Türkçe uyumu
  return "\uFEFF" + [keys.join(","), ...rows.map((r) => keys.map((k) => esc(r[k])).join(","))].join("\n");
}

const stamp = () => new Date().toISOString().slice(0, 10);

export async function exportTenantsCsv(): Promise<ExportResult> {
  await requirePlatformModule("tenants");
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("tenants")
    .select("name, plan, status, created_at, trial_ends_at")
    .order("created_at", { ascending: false })
    .limit(5000);
  if (error) return { error: "Dışa aktarma başarısız." };
  const rows = (data ?? []).map((t) => ({
    ofis: t.name,
    paket: planLabel[t.plan] ?? t.plan,
    durum: statusLabel[t.status] ?? t.status,
    kayit_tarihi: t.created_at,
    deneme_bitis: t.trial_ends_at ?? "",
  }));
  return { csv: toCsv(rows), filename: `tenantlar-${stamp()}.csv` };
}

export async function exportSubscriptionsCsv(): Promise<ExportResult> {
  await requirePlatformModule("billing");
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("subscriptions")
    .select("plan, status, amount_try, billing_cycle, current_period_end, created_at, tenant:tenants(name)")
    .order("created_at", { ascending: false })
    .limit(5000);
  if (error) return { error: "Dışa aktarma başarısız." };
  const rows = (data ?? []).map((s) => {
    const t = s.tenant as { name?: string } | { name?: string }[] | null;
    const name = Array.isArray(t) ? t[0]?.name : t?.name;
    return {
      ofis: name ?? "",
      paket: planLabel[s.plan] ?? s.plan,
      durum: s.status,
      tutar_try: s.amount_try,
      donem: s.billing_cycle ?? "",
      donem_bitis: s.current_period_end ?? "",
      olusturma: s.created_at,
    };
  });
  return { csv: toCsv(rows), filename: `abonelikler-${stamp()}.csv` };
}

export async function exportDemoRequestsCsv(): Promise<ExportResult> {
  await requirePlatformModule("sales");
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("demo_requests")
    .select("full_name, phone, email, company, city, team_size, status, source, created_at")
    .order("created_at", { ascending: false })
    .limit(5000);
  if (error) return { error: "Dışa aktarma başarısız." };
  const rows = (data ?? []).map((d) => ({
    ad_soyad: d.full_name,
    telefon: d.phone ?? "",
    email: d.email ?? "",
    firma: d.company ?? "",
    sehir: d.city ?? "",
    ekip: d.team_size ?? "",
    durum: d.status,
    kaynak: d.source,
    tarih: d.created_at,
  }));
  return { csv: toCsv(rows), filename: `demo-talepleri-${stamp()}.csv` };
}

const subStatusLabel: Record<string, string> = {
  trialing: "Deneme", active: "Aktif", past_due: "Gecikmiş", cancelled: "İptal", paused: "Duraklatıldı",
};
const invoiceStatusLabel: Record<string, string> = {
  draft: "Taslak", open: "Açık", paid: "Ödendi", void: "İptal", uncollectible: "Tahsil edilemez",
};
const ticketStatusLabel: Record<string, string> = {
  open: "Açık", in_progress: "İşleniyor", waiting: "Yanıt bekliyor", resolved: "Çözüldü", closed: "Kapalı",
};
const ticketPriorityLabel: Record<string, string> = {
  low: "Düşük", normal: "Normal", high: "Yüksek", urgent: "Acil",
};
const memberRoleLabel: Record<string, string> = {
  owner: "Ofis sahibi", gm: "Genel müdür", branch_manager: "Şube müdürü", team_lead: "Takım lideri",
  advisor: "Danışman", call_center: "Çağrı merkezi", accounting: "Muhasebe", readonly: "Salt okunur",
};

/** İlişkili `tenants(name)` alanı PostgREST'ten tekil ya da dizi gelebilir. */
function relName(v: unknown): string {
  if (!v) return "";
  const o = Array.isArray(v) ? v[0] : v;
  return (o as { name?: string } | undefined)?.name ?? "";
}

export async function exportInvoicesCsv(): Promise<ExportResult> {
  await requirePlatformModule("billing");
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("invoices")
    .select("invoice_no, status, total_try, due_at, paid_at, reminder_count, created_at, tenant:tenants(name)")
    .order("created_at", { ascending: false })
    .limit(5000);
  if (error) return { error: "Dışa aktarma başarısız." };
  const rows = (data ?? []).map((i) => ({
    fatura_no: i.invoice_no ?? "",
    ofis: relName(i.tenant),
    durum: invoiceStatusLabel[i.status] ?? i.status,
    tutar_try: i.total_try,
    vade: i.due_at ?? "",
    odeme_tarihi: i.paid_at ?? "",
    hatirlatma_sayisi: i.reminder_count ?? 0,
    olusturma: i.created_at,
  }));
  return { csv: toCsv(rows), filename: `faturalar-${stamp()}.csv` };
}

export async function exportMembersCsv(): Promise<ExportResult> {
  await requirePlatformModule("members");
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("profiles")
    .select("full_name, phone, role, is_active, created_at, tenant:tenants(name)")
    .order("created_at", { ascending: false })
    .limit(5000);
  if (error) return { error: "Dışa aktarma başarısız." };
  const rows = (data ?? []).map((m) => ({
    ad_soyad: m.full_name,
    telefon: m.phone ?? "",
    ofis: relName(m.tenant),
    rol: memberRoleLabel[m.role] ?? m.role,
    durum: m.is_active ? "Aktif" : "Pasif",
    kayit_tarihi: m.created_at,
  }));
  return { csv: toCsv(rows), filename: `kullanicilar-${stamp()}.csv` };
}

export async function exportTicketsCsv(): Promise<ExportResult> {
  await requirePlatformModule("tickets");
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("support_tickets")
    .select("subject, category, status, priority, created_at, tenant:tenants(name)")
    .order("created_at", { ascending: false })
    .limit(5000);
  if (error) return { error: "Dışa aktarma başarısız." };
  const rows = (data ?? []).map((t) => ({
    konu: t.subject,
    ofis: relName(t.tenant),
    kategori: t.category,
    durum: ticketStatusLabel[t.status] ?? t.status,
    oncelik: ticketPriorityLabel[t.priority] ?? t.priority,
    acilis: t.created_at,
  }));
  return { csv: toCsv(rows), filename: `destek-talepleri-${stamp()}.csv` };
}

/**
 * Rapor özeti: ofis × plan × durum × abonelik tutarı tek tabloda.
 * Grafiklerin altındaki ham veri — muhasebe tarafı Excel'de kendi pivotunu kurar.
 */
export async function exportPlatformReportCsv(): Promise<ExportResult> {
  await requirePlatformModule("reports");
  const admin = createAdminClient();
  const [{ data: tenants, error }, { data: subs }] = await Promise.all([
    admin.from("tenants").select("id, name, plan, status, created_at").order("created_at", { ascending: false }).limit(5000),
    admin.from("subscriptions").select("tenant_id, status, amount_try, billing_cycle").limit(5000),
  ]);
  if (error) return { error: "Dışa aktarma başarısız." };
  const subByTenant = new Map((subs ?? []).map((s) => [s.tenant_id as string, s]));
  const rows = (tenants ?? []).map((t) => {
    const s = subByTenant.get(t.id);
    return {
      ofis: t.name,
      paket: planLabel[t.plan] ?? t.plan,
      ofis_durumu: statusLabel[t.status] ?? t.status,
      abonelik_durumu: s ? (subStatusLabel[s.status] ?? s.status) : "Abonelik yok",
      aylik_tutar_try: s?.amount_try ?? 0,
      donem: s?.billing_cycle ?? "",
      kayit_tarihi: t.created_at,
    };
  });
  return { csv: toCsv(rows), filename: `platform-raporu-${stamp()}.csv` };
}
