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

export async function exportCustomersCsv(): Promise<ExportResult> {
  const gate = await requirePermission("customers", "view");
  if (!gate.ok) return { error: gate.error };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("customers")
    .select("full_name, phone, email, customer_types, source, created_at")
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
