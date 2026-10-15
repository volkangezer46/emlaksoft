"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/require-permission";
import { logActivity } from "@/lib/activity";
import { actionErrorMessage } from "@/lib/action-errors";
import { validateNearbyInput, type NearbyPlace } from "@/lib/vitrin/nearby";

export type NearbyPlacesResult = { ok?: boolean; error?: string; places?: NearbyPlace[] };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MISSING_COLUMN = new Set(["42703", "PGRST204"]);

/**
 * Portföyün "Çevrede neler var" noktalarını kaydeder (PUB-8): kategori + ad + mesafe (m). Vitrin ilan detayında
 * gösterilir. Yetki: properties.edit (RLS kapsamı ayrıca geçerli). Liste bütün olarak yazılır (boş liste = bölüm gizli).
 */
export async function saveNearbyPlaces(
  propertyId: string,
  rows: readonly { c?: unknown; n?: unknown; m?: unknown }[],
): Promise<NearbyPlacesResult> {
  const gate = await requirePermission("properties", "edit");
  if (!gate.ok) return { error: gate.error };
  const id = String(propertyId ?? "").trim();
  if (!UUID_RE.test(id)) return { error: "Portföy bulunamadı." };
  if (!Array.isArray(rows) || rows.length > 60) return { error: "Liste geçersiz." };
  const parsed = validateNearbyInput(rows);
  if (!parsed.ok) return { error: parsed.error };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("properties")
    .update({ nearby_places: parsed.places })
    .eq("id", id)
    .eq("tenant_id", gate.tenantId)
    .is("deleted_at", null)
    .select("id")
    .maybeSingle();
  if (error) {
    if (MISSING_COLUMN.has(String(error.code ?? ""))) return { error: "Bu özellik için veritabanı güncellemesi bekleniyor." };
    console.error("saveNearbyPlaces", error.code);
    return { error: actionErrorMessage(error, "Çevre bilgisi kaydedilemedi. Lütfen tekrar deneyin.") };
  }
  if (!data) return { error: "Portföy bulunamadı ya da düzenleme yetkiniz yok." };

  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: "property.nearby_places_updated",
    entityType: "property",
    entityId: id,
    newValue: { count: parsed.places.length },
  });
  revalidatePath(`/app/portfoyler/${id}`);
  revalidatePath("/vitrin/[slug]/[ilan]", "page");
  return { ok: true, places: parsed.places };
}
