"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requirePermission } from "@/lib/require-permission";

/**
 * "Daveti yinele" — davet edilmiş ama hiç giriş yapmamış üyeye erişim bağlantısını
 * yeniden gönderir. Ekipte davet, geçici şifreyle hesap açma üzerinden yürüdüğü için
 * yineleme = şifre belirleme (recovery) e-postası göndermektir; mevcut şifre sıfırlama
 * akışıyla aynı `/sifre-yenile` sayfasına düşer (bkz. actions/password-reset.ts).
 */
export async function resendInvite(formData: FormData): Promise<void> {
  const gate = await requirePermission("team", "edit");
  if (!gate.ok) return;

  const id = String(formData.get("id") ?? "").trim();
  if (!id) return;

  const admin = createAdminClient();

  // Hedef aynı ofiste olmalı — id başka tenant'a aitse sessizce çık.
  const { data: target } = await admin
    .from("profiles")
    .select("id, tenant_id")
    .eq("id", id)
    .maybeSingle();
  if (!target || target.tenant_id !== gate.tenantId) return;

  // profiles'ta e-posta tutulmuyor — auth kullanıcısından oku.
  const { data: authUser } = await admin.auth.admin.getUserById(id);
  const email = authUser?.user?.email;
  if (!email) return;

  const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
  try {
    const supabase = await createClient();
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${appUrl}/sifre-yenile`,
    });
    if (error) console.error("resendInvite", error.message);
  } catch (e) {
    console.error("resendInvite", e);
  }
}
