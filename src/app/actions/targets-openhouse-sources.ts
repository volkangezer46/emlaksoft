"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/require-permission";

export type TargetResult = { ok?: boolean; error?: string; id?: string };

export async function upsertTarget(
  _prev: TargetResult,
  fd: FormData,
): Promise<TargetResult> {
  const gate = await requirePermission("reports", "create");
  if (!gate.ok) return { error: gate.error };

  const profileId     = String(fd.get("profile_id")     ?? "").trim() || null;
  const period        = String(fd.get("period")         ?? "monthly").trim();
  const periodStart   = String(fd.get("period_start")   ?? "").trim();
  const targetDeals   = parseInt(String(fd.get("target_deals")   ?? "0"));
  const targetRevenue = parseFloat(String(fd.get("target_revenue") ?? "0"));

  if (!periodStart) return { error: "Dönem başlangıcı zorunludur." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("targets")
    .upsert(
      {
        tenant_id:      gate.tenantId,
        profile_id:     profileId,
        period,
        period_start:   periodStart,
        target_deals:   isNaN(targetDeals)   ? 0 : targetDeals,
        target_revenue: isNaN(targetRevenue) ? 0 : targetRevenue,
        updated_at:     new Date().toISOString(),
      },
      { onConflict: "tenant_id,profile_id,period,period_start" },
    )
    .select("id")
    .single();

  if (error || !data) return { error: "Hedef kaydedilemedi." };

  revalidatePath("/app/hedefler");
  return { ok: true, id: data.id };
}

export async function listTargets(period?: string) {
  const gate = await requirePermission("reports", "view");
  if (!gate.ok) return [];

  const supabase = await createClient();
  let query = supabase
    .from("targets")
    .select("id, period, period_start, target_deals, target_revenue, actual_deals, actual_revenue, profile:profiles(id, full_name)")
    .eq("tenant_id", gate.tenantId)
    .order("period_start", { ascending: false })
    .limit(50);

  if (period) query = query.eq("period", period);

  const { data } = await query;
  return data ?? [];
}

// ============================================================
// 9. Açık ev
// ============================================================

export type OpenHouseResult = { ok?: boolean; error?: string; id?: string };

export async function createOpenHouse(
  _prev: OpenHouseResult,
  fd: FormData,
): Promise<OpenHouseResult> {
  const gate = await requirePermission("appointments", "create");
  if (!gate.ok) return { error: gate.error };

  const propertyId   = String(fd.get("property_id")   ?? "").trim();
  const scheduledAt  = String(fd.get("scheduled_at")  ?? "").trim();
  const durationMin  = parseInt(String(fd.get("duration_min") ?? "120"));
  const location     = String(fd.get("location")      ?? "").trim() || null;
  const notes        = String(fd.get("notes")         ?? "").trim() || null;
  const maxVisitors  = parseInt(String(fd.get("max_visitors") ?? "0")) || null;

  if (!propertyId)  return { error: "Portföy seçimi zorunludur." };
  if (!scheduledAt) return { error: "Tarih/saat zorunludur." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("open_houses")
    .insert({
      tenant_id:    gate.tenantId,
      property_id:  propertyId,
      created_by:   gate.userId,
      scheduled_at: new Date(scheduledAt).toISOString(),
      duration_min: isNaN(durationMin) ? 120 : durationMin,
      location,
      notes,
      max_visitors: maxVisitors,
      status:       "planned",
    })
    .select("id")
    .single();

  if (error || !data) return { error: "Açık ev oluşturulamadı." };

  revalidatePath("/app/acik-ev");
  return { ok: true, id: data.id };
}

export async function registerOpenHouseVisitor(
  openHouseId: string,
  visitor: { full_name: string; phone?: string; email?: string; notes?: string },
): Promise<OpenHouseResult> {
  const gate = await requirePermission("appointments", "create");
  if (!gate.ok) return { error: gate.error };

  const supabase = await createClient();

  await supabase.from("open_house_visitors").insert({
    open_house_id: openHouseId,
    full_name:     visitor.full_name,
    phone:         visitor.phone ?? null,
    email:         visitor.email ?? null,
    notes:         visitor.notes ?? null,
  });

  // Ziyaretçi sayısını artır
  await supabase.rpc("increment_visitor_count", { open_house_id: openHouseId }).maybeSingle();

  revalidatePath("/app/acik-ev");
  return { ok: true };
}

export async function listOpenHouses() {
  const gate = await requirePermission("appointments", "view");
  if (!gate.ok) return [];

  const supabase = await createClient();
  const { data } = await supabase
    .from("open_houses")
    .select("id, scheduled_at, duration_min, location, status, visitor_count, max_visitors, notes, property:properties(property_code, title)")
    .eq("tenant_id", gate.tenantId)
    .order("scheduled_at", { ascending: false })
    .limit(50);

  return data ?? [];
}

// ============================================================
// 10. Kaynak takibi — müşteriye lead_source kaydet
// ============================================================

export type LeadSourceResult = { ok?: boolean; error?: string };

export async function updateCustomerLeadSource(
  customerId: string,
  leadSource: string,
  leadSourceDetail?: string,
): Promise<LeadSourceResult> {
  const gate = await requirePermission("customers", "edit");
  if (!gate.ok) return { error: gate.error };

  const supabase = await createClient();
  await supabase
    .from("customers")
    .update({
      lead_source:        leadSource || null,
      lead_source_detail: leadSourceDetail || null,
    })
    .eq("id", customerId)
    .eq("tenant_id", gate.tenantId);

  revalidatePath(`/app/musteriler/${customerId}`);
  revalidatePath("/app/musteriler");
  return { ok: true };
}

export async function getLeadSourceStats() {
  const gate = await requirePermission("reports", "view");
  if (!gate.ok) return [];

  const supabase = await createClient();
  const { data } = await supabase
    .from("customers")
    .select("lead_source")
    .eq("tenant_id", gate.tenantId)
    .not("lead_source", "is", null);

  const counts = new Map<string, number>();
  for (const row of data ?? []) {
    const src = row.lead_source ?? "diger";
    counts.set(src, (counts.get(src) ?? 0) + 1);
  }

  return [...counts.entries()]
    .map(([source, count]) => ({ source, count }))
    .sort((a, b) => b.count - a.count);
}
