"use server";

import { requirePermission } from "@/lib/require-permission";
import { createClient } from "@/lib/supabase/server";
import { checkRateLimit } from "@/lib/rate-limit";
import { logActivity } from "@/lib/activity";
import { validateGeoChain } from "@/lib/geo/reader";
import { cleanGeoName } from "@/lib/geo/normalize";
import { actionErrorMessage } from "@/lib/action-errors";

export type GeoRequestResult = { error?: string; ok?: boolean };

/**
 * Ofis sahibinin "eksik / yanlış mahalle bildir" talebi. Basit kayıt (geo_change_requests, tenant RLS);
 * platform tarafı /admin/geo/bildirimler kuyruğunda onaylar/reddeder. Tablo yoksa (migration uygulanmadı)
 * "etkin değil" döner, hiçbir şey bozulmaz.
 */
export async function submitGeoChangeRequest(formData: FormData): Promise<GeoRequestResult> {
  const gate = await requirePermission("settings", "edit");
  if (!gate.ok) return { error: gate.error };

  const kind = String(formData.get("kind")) === "wrong" ? "wrong" : "missing";
  const provinceId = String(formData.get("province_id") ?? "").trim() || null;
  const districtId = String(formData.get("district_id") ?? "").trim() || null;
  const neighborhoodId = String(formData.get("neighborhood_id") ?? "").trim() || null;
  const proposedName = cleanGeoName(String(formData.get("proposed_name") ?? ""));
  const note = cleanGeoName(String(formData.get("note") ?? "")).slice(0, 1000) || null;

  if (proposedName.length < 2 || proposedName.length > 160) return { error: "Mahalle adı 2-160 karakter olmalı." };
  if (!provinceId || !districtId) return { error: "Önce il ve ilçeyi seçin." };
  if (kind === "wrong" && !neighborhoodId) return { error: "Yanlış olan mahalleyi seçin." };
  const geoError = await validateGeoChain({ province_id: provinceId, district_id: districtId, neighborhood_id: neighborhoodId }, { allowInactive: true });
  if (geoError) return { error: geoError };

  const rate = await checkRateLimit(`geo-request:${gate.tenantId}`, { limit: 10, windowSec: 3600, failurePolicy: "deny" });
  if (!rate.allowed) return { error: "Bu saat için bildirim sınırına ulaşıldı. Lütfen sonra tekrar deneyin." };

  const supabase = await createClient();
  const { error } = await supabase.from("geo_change_requests").insert({
    tenant_id: gate.tenantId,
    requested_by: gate.userId,
    kind,
    province_id: provinceId,
    district_id: districtId,
    neighborhood_id: neighborhoodId,
    proposed_name: proposedName,
    note,
  });
  if (error) {
    if (error.code === "42P01" || /does not exist|schema cache/i.test(error.message)) {
      return { error: "Bölge bildirimi bu ortamda henüz etkin değil." };
    }
    console.error("submitGeoChangeRequest", error.code);
    return { error: actionErrorMessage(error, "Bildirim kaydedilemedi.") };
  }

  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: "geo.request.submit",
    entityType: "geo_change_request",
    entityId: null,
    newValue: { kind, proposedName },
  });
  return { ok: true };
}
