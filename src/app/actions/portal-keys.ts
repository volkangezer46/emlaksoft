"use server";

import { revalidatePath } from "next/cache";
import { requirePlatformStaff } from "@/lib/platform";
import { setPlatformSetting } from "@/lib/platform-settings";
import {
  isPortalName,
  normalizePortalBaseUrl,
} from "@/lib/integrations/portals";

export type PortalKeyResult = { ok?: boolean; error?: string };

export async function savePortalApiKey(portal: string, formData: FormData): Promise<PortalKeyResult> {
  const staff = await requirePlatformStaff();
  if (staff.role !== "super_admin") return { error: "Yalnızca süper admin anahtar tanımlayabilir." };
  if (!isPortalName(portal)) return { error: "Geçersiz portal sağlayıcısı." };

  const apiKey   = String(formData.get("api_key")   ?? "").trim();
  const agencyId = String(formData.get("agency_id") ?? "").trim() || null;
  const baseUrl  = String(formData.get("base_url")  ?? "").trim() || null;

  if (!apiKey) return { error: "API anahtarı boş olamaz." };
  if (!baseUrl) {
    return { error: "Kurumsal portal sözleşmesinde verilen API base URL zorunludur." };
  }
  if (apiKey.length > 4096 || (agencyId?.length ?? 0) > 512) {
    return { error: "Portal kimlik bilgisi izin verilen uzunluğu aşıyor." };
  }
  const safeBaseUrl = normalizePortalBaseUrl(portal, baseUrl);
  if (!safeBaseUrl) {
    return { error: "Portal API adresi HTTPS olmalı ve izinli sağlayıcı alan adını kullanmalıdır." };
  }

  await Promise.all([
    setPlatformSetting(`${portal}_api_key`, apiKey, staff.id),
    setPlatformSetting(`${portal}_agency_id`, agencyId, staff.id),
    setPlatformSetting(`${portal}_base_url`, safeBaseUrl, staff.id),
  ]);

  revalidatePath("/admin/sistem");
  return { ok: true };
}

export async function clearPortalApiKey(portal: string): Promise<PortalKeyResult> {
  const staff = await requirePlatformStaff();
  if (staff.role !== "super_admin") return { error: "Yalnızca süper admin anahtar silebilir." };
  if (!isPortalName(portal)) return { error: "Geçersiz portal sağlayıcısı." };

  await Promise.all([
    setPlatformSetting(`${portal}_api_key`,   null, staff.id),
    setPlatformSetting(`${portal}_agency_id`, null, staff.id),
    setPlatformSetting(`${portal}_base_url`,  null, staff.id),
  ]);

  revalidatePath("/admin/sistem");
  return { ok: true };
}
