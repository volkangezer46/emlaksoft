"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getNetgsmConfig } from "@/lib/messaging/netgsm";
import { getTenantNetgsmConfig } from "@/lib/messaging/tenant-providers";
import { TWO_FACTOR_COOKIE } from "@/lib/two-factor";
import { requireActiveTenant } from "@/lib/tenant-guard";

export type TwoFactorToggleResult = { error?: string; ok?: true };

export async function setTwoFactorSms(
  _prev: TwoFactorToggleResult,
  fd: FormData,
): Promise<TwoFactorToggleResult> {
  const enable = String(fd.get("enable") ?? "") === "1";
  const gate = await requireActiveTenant();
  if (!gate.ok) return { error: gate.error };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || user.id !== gate.userId) return { error: "Oturum bulunamadi." };

  const admin = createAdminClient();
  const { data: profile } = await admin
    .from("profiles")
    .select("phone, tenant_id, is_active")
    .eq("id", user.id)
    .maybeSingle();
  if (!profile?.is_active || profile.tenant_id !== gate.tenantId) {
    return { error: "Aktif kullanici profili dogrulanamadi." };
  }

  if (enable) {
    if (!profile.phone) {
      return { error: "Iki adimli dogrulama icin once profilinize telefon ekleyin." };
    }
    const tenantCfg = await getTenantNetgsmConfig(profile.tenant_id);
    const smsReady = tenantCfg !== null || (await getNetgsmConfig()) !== null;
    if (!smsReady) {
      return { error: "SMS servisi yapilandirilmamis. Ayarlar > Entegrasyonlar bolumunu kontrol edin." };
    }
  }

  const { error } = await admin
    .from("profiles")
    .update({ two_factor_sms: enable })
    .eq("id", user.id)
    .eq("tenant_id", gate.tenantId)
    .eq("is_active", true);
  if (error) {
    console.error("setTwoFactorSms", error);
    return { error: "Ayar kaydedilemedi. Lutfen tekrar deneyin." };
  }

  // Migration trigger'i profil 2FA surumunu artirir. Mevcut oturum otomatik
  // dogrulanmis sayilmaz; enable sonrasi yeni SMS kodu gerekir.
  (await cookies()).delete(TWO_FACTOR_COOKIE);
  revalidatePath("/app/ayarlar/guvenlik");
  return { ok: true };
}
