"use server";

import { revalidatePath } from "next/cache";
import { requirePlatformStaff } from "@/lib/platform";
import { setPlatformSetting } from "@/lib/platform-settings";

export type PortalKeyResult = { ok?: boolean; error?: string };

export async function savePortalApiKey(portal: string, formData: FormData): Promise<PortalKeyResult> {
  const staff = await requirePlatformStaff();
  if (staff.role !== "super_admin") return { error: "Yalnızca süper admin anahtar tanımlayabilir." };

  const apiKey   = String(formData.get("api_key")   ?? "").trim();
  const agencyId = String(formData.get("agency_id") ?? "").trim() || null;
  const baseUrl  = String(formData.get("base_url")  ?? "").trim() || null;

  if (!apiKey) return { error: "API anahtarı boş olamaz." };

  await Promise.all([
    setPlatformSetting(`${portal}_api_key`, apiKey, staff.id),
    agencyId ? setPlatformSetting(`${portal}_agency_id`, agencyId, staff.id) : Promise.resolve(),
    baseUrl  ? setPlatformSetting(`${portal}_base_url`,  baseUrl,  staff.id) : Promise.resolve(),
  ]);

  revalidatePath("/admin/sistem");
  return { ok: true };
}

export async function clearPortalApiKey(portal: string): Promise<PortalKeyResult> {
  const staff = await requirePlatformStaff();
  if (staff.role !== "super_admin") return { error: "Yalnızca süper admin anahtar silebilir." };

  await Promise.all([
    setPlatformSetting(`${portal}_api_key`,   null, staff.id),
    setPlatformSetting(`${portal}_agency_id`, null, staff.id),
    setPlatformSetting(`${portal}_base_url`,  null, staff.id),
  ]);

  revalidatePath("/admin/sistem");
  return { ok: true };
}
