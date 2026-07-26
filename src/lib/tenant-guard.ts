import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { getRequestUser } from "@/lib/supabase/auth-cache";
import { getPlatformStaff } from "@/lib/platform";
import { TWO_FACTOR_COOKIE, isTwoFactorCookieValid } from "@/lib/two-factor";

export type ActiveTenantResult =
  | { ok: true; userId: string; tenantId: string }
  | { ok: false; error: string };

const BLOCKED = new Set(["suspended", "cancelled"]);

/**
 * SMS 2FA kapısı — middleware yalnız sayfa gezinmelerini korur; server action
 * ve API route'ları doğrudan POST edilebildiğinden aynı kontrol burada da
 * zorunlu. Çerez geçerliyse DB'ye hiç gidilmez; çerez yok/geçersizken profil
 * sorgusu hata verirse fail-closed (signIn'deki kararla tutarlı).
 */
export async function twoFactorSatisfied(userId: string): Promise<boolean> {
  const jar = await cookies();
  const value = jar.get(TWO_FACTOR_COOKIE)?.value;
  if (await isTwoFactorCookieValid(value, userId)) return true;

  const supabase = await createClient();
  const { data: profile, error } = await supabase
    .from("profiles")
    .select("two_factor_sms")
    .eq("id", userId)
    .maybeSingle();
  if (error) return false;
  return !profile?.two_factor_sms;
}

/**
 * Server actions için: askıdaki / iptal tenant yazma işlemlerini engeller.
 * Platform staff kendi ofisi askıdaysa bile ops amaçlı geçebilir.
 */
export async function requireActiveTenant(): Promise<ActiveTenantResult> {
  const user = await getRequestUser();
  if (!user) return { ok: false, error: "Oturum bulunamadı." };

  if (!(await twoFactorSatisfied(user.id))) {
    return { ok: false, error: "İki adımlı doğrulama tamamlanmadı. Giriş doğrulamasını tamamlayın." };
  }

  const tenantId = (user.app_metadata?.tenant_id as string | undefined) ?? null;
  if (!tenantId) return { ok: false, error: "Ofis bilgisi bulunamadı." };

  const staff = await getPlatformStaff();
  if (staff) return { ok: true, userId: user.id, tenantId };

  const supabase = await createClient();
  const { data: tenant } = await supabase
    .from("tenants")
    .select("status")
    .eq("id", tenantId)
    .maybeSingle();

  if (!tenant) return { ok: false, error: "Ofis bulunamadı." };
  if (BLOCKED.has(tenant.status)) {
    return { ok: false, error: "Hesap askıda veya iptal. Bu işlem yapılamaz." };
  }

  return { ok: true, userId: user.id, tenantId };
}
