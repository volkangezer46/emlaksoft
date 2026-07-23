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
