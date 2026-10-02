"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requirePermission } from "@/lib/require-permission";
import { getDefinitionsOrDefault } from "@/lib/definitions";
import { isDefinitionCategory, isSystemDefinitionValue } from "@/lib/definition-defaults";
import { addDefinition, deleteDefinition, renameDefinition } from "@/app/actions/definitions";

const MANUAL_STATUSES = [
  "draft", "pending_docs", "pending_auth", "photo_needed", "ready", "active",
  "live", "passive", "reserved", "deposit", "in_progress", "withdrawn",
  "auth_expired", "archived",
] as const;

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
  if (!(MANUAL_STATUSES as readonly string[]).includes(newStatus)) {
    return { error: "Satıldı/kiralandı durumları yalnız anlaşma ve kiralama akışından seçilebilir." };
  }

  const admin = createAdminClient();
  const { data, error } = await admin.rpc("transition_property_status_atomic", {
    p_tenant_id: gate.tenantId,
    p_actor_id: gate.userId,
    p_property_ids: [propertyId],
    p_status: newStatus,
    p_reason: reason?.trim() || null,
  });
  if (error) return { error: "Durum güncellenemedi." };
  const outcome = String((data as { outcome?: string } | null)?.outcome ?? "");
  if (outcome === "not_found") return { error: "Portföy bulunamadı." };
  if (outcome === "terminal_requires_workflow") {
    return { error: "Satılmış veya kiralanmış portföy yalnız ilgili anlaşma/kiralama iş akışından yeniden açılabilir." };
  }
  if (outcome !== "applied" && outcome !== "replay") return { error: "Durum güncellenemedi." };

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
    .select("id, old_status, new_status, reason, created_at, changed_by:profiles!property_status_history_changed_by_fkey(full_name)")
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

/**
 * ADAPTÖR: `definitions` tablosuyla çakışan kategoriler (property_type,
 * transaction_type, ...) artık tek kaynaktan (definitions) okunur/yazılır.
 * Yalnız definitions'ta karşılığı olmayan kategoriler (heating_type vb.)
 * `lookup_values` tablosunda kalır. Çıktı şeması eski lookup şemasıyla aynıdır.
 */
export async function getLookupValues(category: string) {
  if (isDefinitionCategory(category)) {
    const defs = await getDefinitionsOrDefault(category);
    return defs.map((d, i) => ({
      value: d.value,
      label: d.label,
      sort_order: i + 1,
      is_system: isSystemDefinitionValue(category, d.value),
    }));
  }
  const supabase = await createClient();
  const { data } = await supabase
    .from("lookup_values")
    .select("value, label, sort_order, is_system")
    .eq("category", category)
    .eq("is_active", true)
    .order("sort_order", { ascending: true });

  return data ?? [];
}

async function findOwnDefinitionId(tenantId: string, category: string, value: string): Promise<string | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("definitions")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("category", category)
    .eq("value", value)
    .maybeSingle();
  return (data?.id as string | undefined) ?? null;
}

export async function upsertLookupValue(
  category: string,
  value: string,
  label: string,
  sortOrder = 0,
): Promise<PropertyActionResult> {
  const gate = await requirePermission("settings", "edit");
  if (!gate.ok) return { error: gate.error };

  if (isDefinitionCategory(category)) {
    const existing = await findOwnDefinitionId(gate.tenantId, category, value);
    if (existing) {
      const res = await renameDefinition(existing, label);
      return res.error ? { error: res.error } : { ok: true };
    }
    const fd = new FormData();
    fd.set("category", category);
    fd.set("value", value);
    fd.set("label", label);
    const res = await addDefinition({}, fd);
    return res.error ? { error: res.error } : { ok: true };
  }

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

  if (isDefinitionCategory(category)) {
    const existing = await findOwnDefinitionId(gate.tenantId, category, value);
    if (!existing) return { error: "Değer bulunamadı veya sistem değeri silinemez." };
    const res = await deleteDefinition(existing);
    return res.error ? { error: res.error } : { ok: true };
  }

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
