"use server";

import { revalidatePath } from "next/cache";
import { requirePlatformStaff } from "@/lib/platform";
import { setPlatformSetting } from "@/lib/platform-settings";
import { logPlatformActivity } from "@/lib/platform-activity";
import {
  normalizeProviderBaseUrl,
  providerAllowedHosts,
} from "@/lib/integrations/provider-url";

export type IntegrationKeyResult = { ok?: boolean; error?: string };

function validatedBaseUrl(
  raw: string | null,
  defaultUrl: string,
  extraHosts?: string,
): string | null | undefined {
  if (!raw) return null;
  return normalizeProviderBaseUrl(
    raw,
    providerAllowedHosts([new URL(defaultUrl).hostname], extraHosts),
  ) ?? undefined;
}

// ---------------------------------------------------------------------------
// Endeksa
// ---------------------------------------------------------------------------

export async function saveEndeksaKeys(formData: FormData): Promise<IntegrationKeyResult> {
  const staff = await requirePlatformStaff();
  if (staff.role !== "super_admin") return { error: "Yalnızca süper admin anahtar tanımlayabilir." };

  const clientId = String(formData.get("clientId") ?? "").trim();
  const clientSecret = String(formData.get("clientSecret") ?? "").trim();
  const baseUrl = String(formData.get("baseUrl") ?? "").trim() || null;

  if (!clientId) return { error: "Client ID boş olamaz." };
  if (!clientSecret) return { error: "Client Secret boş olamaz." };
  if (clientId.length > 512 || clientSecret.length > 4096) {
    return { error: "Endeksa kimlik bilgisi izin verilen uzunluğu aşıyor." };
  }
  const safeBaseUrl = validatedBaseUrl(
    baseUrl,
    "https://api.endeksa.com",
    process.env.ENDEKSA_ALLOWED_HOSTS,
  );
  if (safeBaseUrl === undefined) {
    return { error: "Endeksa API adresi HTTPS olmalı ve izinli sağlayıcı alan adını kullanmalıdır." };
  }

  await Promise.all([
    setPlatformSetting("endeksa_client_id", clientId, staff.id),
    setPlatformSetting("endeksa_client_secret", clientSecret, staff.id),
    setPlatformSetting("endeksa_base_url", safeBaseUrl, staff.id),
  ]);

  await logPlatformActivity({
    actorId: staff.id,
    action: "integration.endeksa.save",
    entityType: "integration",
    meta: { has_base_url: !!baseUrl },
  });

  revalidatePath("/admin/sistem");
  return { ok: true };
}

export async function clearEndeksaKeys(): Promise<IntegrationKeyResult> {
  const staff = await requirePlatformStaff();
  if (staff.role !== "super_admin") return { error: "Yalnızca süper admin anahtar silebilir." };

  await Promise.all([
    setPlatformSetting("endeksa_client_id", null, staff.id),
    setPlatformSetting("endeksa_client_secret", null, staff.id),
    setPlatformSetting("endeksa_base_url", null, staff.id),
  ]);

  await logPlatformActivity({
    actorId: staff.id,
    action: "integration.endeksa.clear",
    entityType: "integration",
  });

  revalidatePath("/admin/sistem");
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Tapusor
// ---------------------------------------------------------------------------

export async function saveTapusorKeys(formData: FormData): Promise<IntegrationKeyResult> {
  const staff = await requirePlatformStaff();
  if (staff.role !== "super_admin") return { error: "Yalnızca süper admin anahtar tanımlayabilir." };

  const apiKey = String(formData.get("apiKey") ?? "").trim();
  const baseUrl = String(formData.get("baseUrl") ?? "").trim() || null;

  if (!apiKey) return { error: "API anahtarı boş olamaz." };
  if (apiKey.length > 4096) return { error: "Tapusor API anahtarı izin verilen uzunluğu aşıyor." };
  const safeBaseUrl = validatedBaseUrl(
    baseUrl,
    "https://api.tapusor.com",
    process.env.TAPUSOR_ALLOWED_HOSTS,
  );
  if (safeBaseUrl === undefined) {
    return { error: "Tapusor API adresi HTTPS olmalı ve izinli sağlayıcı alan adını kullanmalıdır." };
  }

  await Promise.all([
    setPlatformSetting("tapusor_api_key", apiKey, staff.id),
    setPlatformSetting("tapusor_base_url", safeBaseUrl, staff.id),
  ]);

  await logPlatformActivity({
    actorId: staff.id,
    action: "integration.tapusor.save",
    entityType: "integration",
    meta: { has_base_url: !!baseUrl },
  });

  revalidatePath("/admin/sistem");
  return { ok: true };
}

export async function clearTapusorKeys(): Promise<IntegrationKeyResult> {
  const staff = await requirePlatformStaff();
  if (staff.role !== "super_admin") return { error: "Yalnızca süper admin anahtar silebilir." };

  await Promise.all([
    setPlatformSetting("tapusor_api_key", null, staff.id),
    setPlatformSetting("tapusor_base_url", null, staff.id),
  ]);

  await logPlatformActivity({
    actorId: staff.id,
    action: "integration.tapusor.clear",
    entityType: "integration",
  });

  revalidatePath("/admin/sistem");
  return { ok: true };
}
