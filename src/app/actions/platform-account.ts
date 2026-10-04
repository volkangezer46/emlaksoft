"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getPlatformStaff } from "@/lib/platform";
import { getRequestUser } from "@/lib/supabase/auth-cache";
import { checkRateLimit } from "@/lib/rate-limit";
import { logPlatformActivity } from "@/lib/platform-activity";

export type AccountResult = { ok?: boolean; error?: string };

/**
 * Personelin KENDİ hesabı: kimlik `getPlatformStaff` (AAL2 dahil) ile doğrulanır.
 * Hesap sahibi dışında kimse bu action'larla başka bir hesaba dokunamaz: hedef her zaman oturumdaki kullanıcıdır.
 */
async function currentStaff() {
  const [candidate, user] = await Promise.all([getPlatformStaff(), getRequestUser()]);
  if (!candidate || !user) return null;
  return { staff: candidate, user };
}

export async function updateOwnProfile(fd: FormData): Promise<AccountResult> {
  const me = await currentStaff();
  if (!me) return { error: "Oturum bulunamadı." };

  const fullName = String(fd.get("full_name") ?? "").trim();
  if (fullName.length < 2 || fullName.length > 120) return { error: "Ad soyad 2 ile 120 karakter arasında olmalıdır." };
  if (fullName === me.staff.full_name) return { ok: true };

  const { allowed } = await checkRateLimit(`platform-own-profile:${me.staff.id}`, {
    limit: 10,
    windowSec: 600,
    failurePolicy: "deny",
  });
  if (!allowed) return { error: "Çok sık işlem yapıldı. Lütfen biraz sonra tekrar deneyin." };

  const admin = createAdminClient();
  const { error } = await admin
    .from("platform_staff")
    .update({ full_name: fullName, updated_at: new Date().toISOString() })
    .eq("id", me.staff.id);
  if (error) return { error: "Ad güncellenemedi." };

  const supabase = await createClient();
  await supabase.auth.updateUser({ data: { full_name: fullName } });

  await logPlatformActivity({
    actorId: me.staff.id,
    action: "platform_staff.self_update",
    entityType: "platform_staff",
    entityId: me.staff.id,
    meta: { old: { full_name: me.staff.full_name }, new: { full_name: fullName } },
  });
  revalidatePath("/admin", "layout");
  return { ok: true };
}

/**
 * Kendi parolasını değiştir. Mevcut parola doğrulanır (hız sınırlı); başarıda `must_change_password`
 * bayrağı temizlenir ve yönetim kabuğu açılır.
 */
export async function changeOwnPassword(fd: FormData): Promise<AccountResult> {
  const me = await currentStaff();
  if (!me) return { error: "Oturum bulunamadı." };

  const current = String(fd.get("current_password") ?? "");
  const next = String(fd.get("new_password") ?? "");
  const confirm = String(fd.get("confirm_password") ?? "");

  if (!current) return { error: "Mevcut parolanızı girin." };
  if (next.length < 10) return { error: "Yeni parola en az 10 karakter olmalıdır." };
  if (next.length > 72) return { error: "Yeni parola en fazla 72 karakter olabilir." };
  if (next !== confirm) return { error: "Yeni parola ve tekrarı aynı olmalıdır." };
  if (next === current) return { error: "Yeni parola mevcut parolayla aynı olamaz." };

  const { allowed } = await checkRateLimit(`platform-own-password:${me.staff.id}`, {
    limit: 8,
    windowSec: 900,
    failurePolicy: "deny",
  });
  if (!allowed) return { error: "Çok fazla deneme yapıldı. Lütfen biraz sonra tekrar deneyin." };

  const email = me.user.email;
  if (!email) return { error: "Hesap e-postası bulunamadı." };

  const supabase = await createClient();
  const { error: verifyError } = await supabase.auth.signInWithPassword({ email, password: current });
  if (verifyError) return { error: "Mevcut parola hatalı." };

  const { error } = await supabase.auth.updateUser({
    password: next,
    data: { must_change_password: false },
  });
  if (error) return { error: error.message || "Parola değiştirilemedi." };

  await logPlatformActivity({
    actorId: me.staff.id,
    action: "platform_staff.password_change",
    entityType: "platform_staff",
    entityId: me.staff.id,
    meta: { forced: me.user.user_metadata?.must_change_password === true },
  });
  revalidatePath("/admin", "layout");
  return { ok: true };
}
