"use server";

import { revalidatePath } from "next/cache";
import { guardPlatformAction } from "@/lib/platform-guards";
import { applyPlatformWrites } from "@/lib/settings/write";
import {
  isPortalName,
  normalizePortalBaseUrl,
} from "@/lib/integrations/portals";

export type PortalKeyResult = { ok?: boolean; error?: string };

function gateSuperAdmin() {
  return guardPlatformAction({
    module: "sistem",
    roles: ["super_admin"],
    rate: { key: "platform-portal-keys", limit: 12, windowSec: 600 },
  });
}

export async function savePortalApiKey(portal: string, formData: FormData): Promise<PortalKeyResult> {
  const gate = await gateSuperAdmin();
  if ("error" in gate) return { error: gate.error };
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

  const res = await applyPlatformWrites(
    gate.staff,
    [
      { key: `portal.${portal}.api_key`, value: apiKey },
      { key: `portal.${portal}.agency_id`, value: agencyId },
      { key: `portal.${portal}.base_url`, value: safeBaseUrl },
    ],
    { reason: `${portal} portal bilgileri kaydı`, fromBridge: true },
  );
  if (!res.ok) return { error: res.error };

  revalidatePath("/admin/sistem");
  return { ok: true };
}

export async function clearPortalApiKey(portal: string): Promise<PortalKeyResult> {
  const gate = await gateSuperAdmin();
  if ("error" in gate) return { error: gate.error };
  if (!isPortalName(portal)) return { error: "Geçersiz portal sağlayıcısı." };

  const res = await applyPlatformWrites(
    gate.staff,
    [
      { key: `portal.${portal}.api_key`, value: null },
      { key: `portal.${portal}.agency_id`, value: null },
      { key: `portal.${portal}.base_url`, value: null },
    ],
    { reason: `${portal} portal bilgileri silindi`, fromBridge: true },
  );
  if (!res.ok) return { error: res.error };

  revalidatePath("/admin/sistem");
  return { ok: true };
}
