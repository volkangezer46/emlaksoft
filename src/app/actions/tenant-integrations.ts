"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/require-permission";

export type TenantIntegrationResult = { ok?: boolean; error?: string };

type NetgsmCredentials = { usercode?: string; password?: string; msgheader?: string };

/**
 * Ofisin Netgsm kimlik bilgilerini kaydeder (tenant_integrations, provider='netgsm').
 * Şifre alanı boş bırakılırsa mevcut şifre korunur (maskeli formdan tekrar gönderilmez).
 */
export async function saveNetgsmCredentials(
  _prev: TenantIntegrationResult,
  fd: FormData,
): Promise<TenantIntegrationResult> {
  const gate = await requirePermission("settings", "edit");
  if (!gate.ok) return { error: gate.error };

  const usercode = String(fd.get("usercode") ?? "").trim();
  const password = String(fd.get("password") ?? "").trim();
  const msgheader = String(fd.get("msgheader") ?? "").trim();
  if (!usercode) return { error: "Kullanıcı kodu zorunludur." };
  if (!msgheader) return { error: "Onaylı başlık (gönderici adı) zorunludur." };

  const supabase = await createClient();
  const { data: existing, error: readError } = await supabase
    .from("tenant_integrations")
    .select("credentials")
    .eq("tenant_id", gate.tenantId)
    .eq("provider", "netgsm")
    .maybeSingle();
  if (readError) {
    console.error("saveNetgsmCredentials read", readError);
    return { error: "Kaydedilemedi — entegrasyon tablosu henüz hazır olmayabilir." };
  }

  const prevCreds = (existing?.credentials ?? {}) as NetgsmCredentials;
  const nextPassword = password || prevCreds.password || "";
  if (!nextPassword) return { error: "Şifre zorunludur." };

  const { error } = await supabase.from("tenant_integrations").upsert(
    {
      tenant_id: gate.tenantId,
      provider: "netgsm",
      credentials: { usercode, password: nextPassword, msgheader },
      is_active: true,
      updated_by: gate.userId,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "tenant_id,provider" },
  );
  if (error) {
    console.error("saveNetgsmCredentials", error);
    return { error: "Kaydedilemedi." };
  }
  revalidatePath("/app/ayarlar");
  return { ok: true };
}

/** Ofisin Netgsm kaydını kaldırır — gönderim platform varsayılanına (veya kapalıya) döner. */
export async function clearNetgsmCredentials(): Promise<TenantIntegrationResult> {
  const gate = await requirePermission("settings", "edit");
  if (!gate.ok) return { error: gate.error };
  const supabase = await createClient();
  const { error } = await supabase
    .from("tenant_integrations")
    .delete()
    .eq("tenant_id", gate.tenantId)
    .eq("provider", "netgsm");
  if (error) return { error: "Kaldırılamadı." };
  revalidatePath("/app/ayarlar");
  return { ok: true };
}
