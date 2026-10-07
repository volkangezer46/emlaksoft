"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/require-permission";
import { queueAuthorityExtensionSurvey } from "@/lib/surveys/events";
import { isMissingSchemaError } from "@/lib/property-owner/info";
import { parseEidsPropertyNo } from "@/lib/eids/property-no";
import { shortAuthorityWarning } from "@/lib/eids/authority-term";
import { now } from "@/lib/clock";
import { actionErrorMessage } from "@/lib/action-errors";

export type PropertyActionResult = { ok?: boolean; error?: string; warning?: string };

// ---------------------------------------------------------------------------
// P1-3: Portföy durum geçmişi
// ---------------------------------------------------------------------------

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
    /** EİDS Taşınmaz Kimlik Numarası; undefined = dokunma, boş metin = temizle. */
    eidsNo?: string;
  },
): Promise<PropertyActionResult> {
  const gate = await requirePermission("properties", "edit");
  if (!gate.ok) return { error: gate.error };

  const supabase = await createClient();
  // Anket modülü: yetki bitiş tarihi İLERİ alınırsa "neden devam ediyorsunuz" anketi için önceki tarih gerekir.
  const { data: before } = await supabase
    .from("properties")
    .select("authorization_end")
    .eq("id", propertyId)
    .eq("tenant_id", gate.tenantId)
    .maybeSingle();
  let eidsNo: string | null | undefined;
  if (data.eidsNo !== undefined) {
    const parsed = parseEidsPropertyNo(data.eidsNo);
    if (!parsed.ok) return { error: parsed.error };
    eidsNo = parsed.value;
  }
  const baseUpdate = {
    authorization_start: data.authStart || null,
    authorization_end:   data.authEnd   || null,
    authorization_type:  data.authType  || null,
    authorization_notes: data.authNotes || null,
    updated_at:          new Date().toISOString(),
  };
  let warning: string | undefined;
  let { error } = await supabase
    .from("properties")
    .update(eidsNo === undefined ? baseUpdate : { ...baseUpdate, eids_property_no: eidsNo })
    .eq("id", propertyId)
    .eq("tenant_id", gate.tenantId);
  // Sütun henüz yoksa (migration 20260826002950 uygulanmamış) yetki alanları yine de kaydedilir.
  if (error && eidsNo !== undefined && isMissingSchemaError(error)) {
    warning = "EİDS numarası kaydedilemedi: veritabanı güncellemesi henüz uygulanmamış. Yetki bilgileri kaydedildi.";
    ({ error } = await supabase
      .from("properties")
      .update(baseUpdate)
      .eq("id", propertyId)
      .eq("tenant_id", gate.tenantId));
  }

  if (error) return { error: actionErrorMessage(error, "Yetki belgesi güncellenemedi.") };

  // Yalnız tarih gerçekten uzatıldıysa (önceki bitiş vardı ve yenisi daha ileri). Hata asıl işlemi etkilemez.
  await queueAuthorityExtensionSurvey(supabase, gate.tenantId, propertyId, (before?.authorization_end as string | null) ?? null, data.authEnd || null);

  const shortWarning = shortAuthorityWarning(data.authStart, data.authEnd, now());
  revalidatePath(`/app/portfoyler/${propertyId}`);
  revalidatePath("/app/uyum");
  return { ok: true, warning: [warning, shortWarning].filter(Boolean).join(" ") || undefined };
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
