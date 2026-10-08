"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/require-permission";
import { logActivity } from "@/lib/activity";
import { now } from "@/lib/clock";
import { actionErrorMessage } from "@/lib/action-errors";
import { getDistrictOptions } from "@/lib/geo/reader";
import {
  FIELD,
  parseBrandColor,
  parseFocusSegments,
  parseOfficeType,
  parseWorkDistrictIds,
} from "@/lib/sample-data/office-profile";

export type ProfileCompleteResult = { ok?: boolean; error?: string };

/**
 * Ofis profilini tamamlama sihirbazı (/app/ayarlar/profil-tamamla) — YALNIZ mevcut action'ların karşılamadığı iki adım:
 *  - marka rengi (logo: `uploadTenantLogo`; konum/telefon/belge/vergi: `saveOfficeProfile`; ekip: `createAdvisor` yeniden kullanılır),
 *  - ofis türü + çalışma odağı + çalışılan ilçeler.
 * Her biri tek başına kaydedilir; gönderilmeyen alana dokunulmaz. Doğrulayıcılar kayıt sihirbazıyla AYNI (office-profile.ts).
 */

function revalidateProfile() {
  revalidatePath("/app/ayarlar/profil-tamamla");
  revalidatePath("/app/ayarlar");
  revalidatePath("/app");
}

export async function saveBrandColor(formData: FormData): Promise<ProfileCompleteResult> {
  const gate = await requirePermission("settings", "edit");
  if (!gate.ok) return { error: gate.error };
  const color = parseBrandColor(formData.get(FIELD.brandColor));
  if (!color) return { error: "Geçerli bir renk seçin (örn. #1d5fd6)." };

  const supabase = await createClient();
  const { error } = await supabase
    .from("tenants")
    .update({ brand_color: color, updated_at: new Date(now()).toISOString() })
    .eq("id", gate.tenantId);
  if (error) {
    console.error("saveBrandColor", error);
    return { error: actionErrorMessage(error, "Marka rengi kaydedilemedi.") };
  }
  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: "settings.update",
    entityType: "tenant",
    entityId: gate.tenantId,
    newValue: { brand_color: color, by: "profile_wizard" },
  });
  revalidateProfile();
  return { ok: true };
}

export async function saveOfficeFocus(formData: FormData): Promise<ProfileCompleteResult> {
  const gate = await requirePermission("settings", "edit");
  if (!gate.ok) return { error: gate.error };

  const officeType = parseOfficeType(formData.get(FIELD.officeType));
  const focus = parseFocusSegments(formData.getAll(FIELD.focus));
  let districtIds = parseWorkDistrictIds(formData.getAll(FIELD.workDistricts));
  if (!officeType && focus.length === 0 && districtIds.length === 0) return { error: "En az bir seçim yapın." };

  const supabase = await createClient();
  if (districtIds.length > 0) {
    // Yalnız ofisin kendi ilinin ilçeleri (istemci kurcalaması / il değişimi sonrası eski seçim ayıklanır).
    const { data: row } = await supabase.from("tenants").select("province_id").eq("id", gate.tenantId).maybeSingle();
    const provinceId = (row?.province_id as string | null) ?? null;
    if (!provinceId) return { error: "Çalışılan ilçeler için önce Konum adımında ofis ilini seçin." };
    const allowed = new Set((await getDistrictOptions(provinceId)).map((d) => d.id));
    districtIds = districtIds.filter((id) => allowed.has(id));
  }

  const patch: Record<string, unknown> = { updated_at: new Date(now()).toISOString() };
  if (officeType) patch.office_type = officeType;
  if (formData.has(FIELD.focus)) patch.focus_segments = focus;
  if (formData.has(FIELD.workDistricts)) patch.work_district_ids = districtIds;
  const { error } = await supabase.from("tenants").update(patch).eq("id", gate.tenantId);
  if (error) {
    console.error("saveOfficeFocus", error);
    return { error: actionErrorMessage(error, "Çalışma odağı kaydedilemedi.") };
  }
  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: "settings.update",
    entityType: "tenant",
    entityId: gate.tenantId,
    newValue: { office_type: officeType, focus, work_districts: districtIds.length, by: "profile_wizard" },
  });
  revalidateProfile();
  return { ok: true };
}
