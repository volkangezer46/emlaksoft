"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getNetgsmConfig } from "@/lib/messaging/netgsm";
import { getTenantNetgsmConfig } from "@/app/imza/_lib/sms";
import { TWO_FACTOR_COOKIE, twoFactorCookieOptions, twoFactorCookieValue } from "@/lib/two-factor";

export type TwoFactorToggleResult = { error?: string; ok?: true };

/**
 * SMS 2FA'yı açar/kapatır. Açmak için profilde telefon VE çalışan bir SMS
 * yapılandırması (tenant Netgsm kaydı veya platform varsayılanı) şarttır.
 */
export async function setTwoFactorSms(
  _prev: TwoFactorToggleResult,
  fd: FormData,
): Promise<TwoFactorToggleResult> {
  const enable = String(fd.get("enable") ?? "") === "1";

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Oturum bulunamadı." };

  const admin = createAdminClient();
  const { data: profile } = await admin
    .from("profiles")
    .select("phone, tenant_id")
    .eq("id", user.id)
    .maybeSingle();

  if (enable) {
    if (!profile?.phone) {
      return { error: "İki adımlı doğrulama için önce profilinize telefon numarası eklenmeli." };
    }
    const tenantCfg = profile.tenant_id ? await getTenantNetgsmConfig(profile.tenant_id) : null;
    const smsReady = tenantCfg !== null || (await getNetgsmConfig()) !== null;
    if (!smsReady) {
      return { error: "SMS servisi (Netgsm) yapılandırılmamış. Ayarlar → Entegrasyonlar bölümünden ekleyin." };
    }
  }

  const { error } = await admin
    .from("profiles")
    .update({ two_factor_sms: enable })
    .eq("id", user.id);
  if (error) {
    console.error("setTwoFactorSms", error);
    return { error: "Ayar kaydedilemedi. Lütfen tekrar deneyin." };
  }

  if (enable) {
    // Bu oturum şifreyle zaten açılmış — mevcut oturumu doğrulanmış say,
    // aksi halde kullanıcı bir sonraki tıklamada doğrulama sayfasına düşer.
    (await cookies()).set(TWO_FACTOR_COOKIE, await twoFactorCookieValue(user.id), twoFactorCookieOptions());
  }

  revalidatePath("/app/ayarlar/guvenlik");
  return { ok: true };
}
