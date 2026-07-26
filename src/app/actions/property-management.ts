"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/require-permission";

export type PropertyActionResult = { ok?: boolean; error?: string };

// ---------------------------------------------------------------------------
// P1-3: Portföy durum geçmişi
// ---------------------------------------------------------------------------

export async function changePropertyStatus(
  propertyId: string,
  newStatus: string,
  reason?: string,
): Promise<PropertyActionResult> {
  const gate = await requirePermission("properties", "edit");
  if (!gate.ok) return { error: gate.error };

  const supabase = await createClient();

  // Mevcut durumu al
  const { data: prop } = await supabase
    .from("properties")
    .select("status, published_at")
    .eq("id", propertyId)
    .eq("tenant_id", gate.tenantId)
    .maybeSingle();

  if (!prop) return { error: "Portföy bulunamadı." };

  // Durumu güncelle — İLK live geçişinde published_at damgalanır; zaten
  // doluysa DOKUNMA (yeniden yayına almada orijinal yayın tarihi korunur).
  const patch: Record<string, unknown> = { status: newStatus, updated_at: new Date().toISOString() };
  if (newStatus === "live" && prop.published_at == null) patch.published_at = new Date().toISOString();
  const { error } = await supabase
    .from("properties")
    .update(patch)
    .eq("id", propertyId)
    .eq("tenant_id", gate.tenantId);

  if (error) return { error: "Durum güncellenemedi." };

  // Geçmiş kaydı yaz
  await supabase.from("property_status_history").insert({
    property_id: propertyId,
    tenant_id:   gate.tenantId,
    old_status:  prop.status ?? null,
    new_status:  newStatus,
    reason:      reason?.trim() || null,
    changed_by:  gate.userId,
  });

  revalidatePath(`/app/portfoyler/${propertyId}`);
  revalidatePath("/app/portfoyler");
  return { ok: true };
}

export async function getPropertyStatusHistory(propertyId: string) {
  const gate = await requirePermission("properties", "view");
  if (!gate.ok) return [];

  const supabase = await createClient();
  const { data } = await supabase
    .from("property_status_history")
    .select("id, old_status, new_status, reason, created_at, changed_by:profiles(full_name)")
    .eq("property_id", propertyId)
    .eq("tenant_id", gate.tenantId)
    .order("created_at", { ascending: false })
    .limit(50);

  return data ?? [];
}

// ---------------------------------------------------------------------------
// P1-5: Yetki belgesi güncelleme
// ---------------------------------------------------------------------------

export async function updatePropertyAuthorization(
  propertyId: string,
  data: {
    authStart?: string;
    authEnd?: string;
    authType?: string;
    authNotes?: string;
  },
): Promise<PropertyActionResult> {
  const gate = await requirePermission("properties", "edit");
  if (!gate.ok) return { error: gate.error };

  const supabase = await createClient();
  const { error } = await supabase
    .from("properties")
    .update({
      authorization_start: data.authStart || null,
      authorization_end:   data.authEnd   || null,
      authorization_type:  data.authType  || null,
      authorization_notes: data.authNotes || null,
      updated_at:          new Date().toISOString(),
    })
    .eq("id", propertyId)
    .eq("tenant_id", gate.tenantId);

  if (error) return { error: "Yetki belgesi güncellenemedi." };

  revalidatePath(`/app/portfoyler/${propertyId}`);
  return { ok: true };
}

// Yetki süresi dolacak portföyleri getir (cron + dashboard için)
export async function getExpiringAuthorizations(daysAhead = 15) {
  const gate = await requirePermission("properties", "view");
  if (!gate.ok) return [];

  const supabase = await createClient();
  const future = new Date(Date.now() + daysAhead * 86_400_000).toISOString().slice(0, 10);
  const today  = new Date().toISOString().slice(0, 10);

  const { data } = await supabase
    .from("properties")
    .select("id, property_code, title, authorization_end, status")
    .eq("tenant_id", gate.tenantId)
    .gte("authorization_end", today)
    .lte("authorization_end", future)
    .is("deleted_at", null)
    .order("authorization_end", { ascending: true });

  return data ?? [];
}

// ---------------------------------------------------------------------------
// P1-6: Lookup değerleri
// ---------------------------------------------------------------------------

export async function getLookupValues(category: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("lookup_values")
    .select("value, label, sort_order, is_system")
    .eq("category", category)
    .eq("is_active", true)
    .order("sort_order", { ascending: true });

  return data ?? [];
}

export async function upsertLookupValue(
  category: string,
  value: string,
  label: string,
  sortOrder = 0,
): Promise<PropertyActionResult> {
  const gate = await requirePermission("settings", "edit");
  if (!gate.ok) return { error: gate.error };

  const supabase = await createClient();
  const { error } = await supabase
    .from("lookup_values")
    .upsert(
      {
        tenant_id:  gate.tenantId,
        category,
        value,
        label,
        sort_order: sortOrder,
        is_active:  true,
        is_system:  false,
      },
      { onConflict: "tenant_id,category,value" },
    );

  if (error) return { error: "Değer kaydedilemedi." };
  return { ok: true };
}

export async function deleteLookupValue(
  category: string,
  value: string,
): Promise<PropertyActionResult> {
  const gate = await requirePermission("settings", "delete");
  if (!gate.ok) return { error: gate.error };

  const supabase = await createClient();
  const { error } = await supabase
    .from("lookup_values")
    .delete()
    .eq("tenant_id", gate.tenantId)
    .eq("category", category)
    .eq("value", value)
    .eq("is_system", false);

  if (error) return { error: "Değer silinemedi." };
  return { ok: true };
}
