"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requirePermission } from "@/lib/require-permission";
import { getBaseUrl } from "@/lib/base-url";
import { randomInt } from "node:crypto";
import { revalidatePath } from "next/cache";
import { logActivity } from "@/lib/activity";
import { now, trDayKey } from "@/lib/clock";
import { PHONE_ERROR_MESSAGE } from "@/lib/phone";
import { parsePhoneStrict } from "@/lib/phone-rules";
import { EMAIL_ERROR_MESSAGE, isValidEmail, normalizeEmail } from "@/lib/email";
import { createTeamMember } from "@/app/actions/team";
import { canManageRole } from "@/lib/team/assignable-roles";
import { INVITE_MODES, type InviteMode } from "./yeni/advisor-tabs";

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

  const appUrl = getBaseUrl();
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

export type CreateAdvisorResult = {
  ok?: boolean;
  error?: string;
  id?: string;
  /** Yalnız "geçici parola" modunda, bir kez döner (saklanmaz, denetim kaydına yazılmaz). */
  tempPassword?: string;
  /** "E-posta daveti" modunda erişim bağlantısı gönderildi mi. */
  emailSent?: boolean;
  /** Hesap açıldı ama bazı ek adımlar (unvan/hedef/davet) tamamlanamadı. */
  warnings?: string[];
};

const TEMP_PASSWORD_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";

function generateTempPassword(): string {
  let out = "";
  for (let i = 0; i < 14; i += 1) out += TEMP_PASSWORD_CHARS[randomInt(TEMP_PASSWORD_CHARS.length)];
  return out;
}

/**
 * "Yeni danışman" sayfasının tek kayıt noktası. Hesap açma, rol/şube/koltuk doğrulaması
 * `createTeamMember` içindedir (mükerrer akış yok); burada üstüne: unvan, aylık hedef,
 * davet teslimi ve denetim kaydı eklenir.
 */
export async function createAdvisor(formData: FormData): Promise<CreateAdvisorResult> {
  const gate = await requirePermission("team", "create");
  if (!gate.ok) return { error: gate.error };

  const fullName = String(formData.get("full_name") ?? "").trim();
  const email = normalizeEmail(String(formData.get("email") ?? ""));
  const phoneRaw = String(formData.get("phone") ?? "").trim();
  const title = String(formData.get("title") ?? "").trim();
  const role = String(formData.get("role") ?? "").trim();
  const branchId = String(formData.get("branch_id") ?? "").trim();
  const modeRaw = String(formData.get("invite_mode") ?? "email").trim();
  const mode: InviteMode = (INVITE_MODES as readonly string[]).includes(modeRaw) ? (modeRaw as InviteMode) : "email";

  if (!fullName) return { error: "Ad soyad zorunlu." };
  if (fullName.length > 120) return { error: "Ad soyad en fazla 120 karakter olabilir." };
  if (!title) return { error: "Unvan zorunlu." };
  if (title.length > 80) return { error: "Unvan en fazla 80 karakter olabilir." };
  if (!email) return { error: "E-posta zorunlu." };
  if (!isValidEmail(email)) return { error: EMAIL_ERROR_MESSAGE };
  if (phoneRaw) {
    const parsed = parsePhoneStrict(phoneRaw);
    if (!parsed.ok) return { error: parsed.error ?? PHONE_ERROR_MESSAGE };
  }

  // Rol yükseltme koruması: owner atanamaz, kimse kendi seviyesinden yüksek/eşit yönetici rolü veremez.
  if (role === "owner" || !canManageRole(gate.role, role)) {
    return { error: "Bu rolü atama yetkiniz yok." };
  }

  // Hedef (isteğe bağlı): yalnız targets.create izni olan yazabilir; hesap açılmadan ÖNCE doğrulanır.
  const dealsRaw = String(formData.get("target_deals") ?? "").trim();
  const revenueRaw = String(formData.get("target_revenue") ?? "").trim().replace(",", ".");
  const targetDeals = dealsRaw ? Number(dealsRaw) : 0;
  const targetRevenue = revenueRaw ? Number(revenueRaw) : 0;
  if (!Number.isInteger(targetDeals) || targetDeals < 0 || targetDeals > 10_000) {
    return { error: "Aylık anlaşma hedefi 0-10.000 arasında tam sayı olmalı." };
  }
  if (!Number.isFinite(targetRevenue) || targetRevenue < 0 || targetRevenue > 10_000_000_000) {
    return { error: "Aylık ciro hedefi geçerli bir tutar olmalı." };
  }
  const hasTarget = targetDeals > 0 || targetRevenue > 0;
  if (hasTarget) {
    const targetGate = await requirePermission("targets", "create");
    if (!targetGate.ok) return { error: "Hedef atamak için hedefler modülünde ekleme yetkiniz olmalı." };
  }

  const tempPassword = generateTempPassword();
  const fd = new FormData();
  fd.set("full_name", fullName);
  fd.set("email", email);
  fd.set("phone", phoneRaw);
  fd.set("role", role);
  fd.set("branch_id", branchId);
  fd.set("password", tempPassword);
  const created = await createTeamMember({}, fd);
  if (!created.ok || !created.id) return { error: created.error ?? "Danışman oluşturulamadı." };

  const warnings: string[] = [];
  const admin = createAdminClient();

  const { error: titleError } = await admin
    .from("profiles")
    .update({ title })
    .eq("id", created.id)
    .eq("tenant_id", gate.tenantId);
  if (titleError) {
    console.error("createAdvisor title", titleError.message);
    warnings.push("Unvan kaydedilemedi; üye profilinden ekleyebilirsiniz.");
  }

  if (hasTarget) {
    const supabase = await createClient();
    const periodStart = `${trDayKey(now()).slice(0, 7)}-01`;
    const { error: targetError } = await supabase.from("targets").upsert(
      {
        tenant_id: gate.tenantId,
        profile_id: created.id,
        period: "monthly",
        period_start: periodStart,
        target_deals: targetDeals,
        target_revenue: targetRevenue,
      },
      { onConflict: "tenant_id,profile_id,period,period_start" },
    );
    if (targetError) {
      console.error("createAdvisor target", targetError.message);
      warnings.push("Aylık hedef kaydedilemedi; Hedefler sayfasından ekleyebilirsiniz.");
    }
  }

  let emailSent = false;
  if (mode === "email") {
    try {
      const supabase = await createClient();
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${getBaseUrl()}/sifre-yenile`,
      });
      if (error) console.error("createAdvisor invite", error.message);
      emailSent = !error;
    } catch (e) {
      console.error("createAdvisor invite", e);
    }
    if (!emailSent) warnings.push("Davet e-postası gönderilemedi; Ekip listesinden 'Daveti yinele' ile tekrar deneyin.");
  }

  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: "team.advisor_created",
    entityType: "profile",
    entityId: created.id,
    newValue: {
      full_name: fullName,
      title,
      role,
      branch_id: branchId || null,
      invite_mode: mode,
      email_sent: emailSent,
      target_deals: hasTarget ? targetDeals : null,
      target_revenue: hasTarget ? targetRevenue : null,
    },
  });

  revalidatePath("/app/ekip");
  revalidatePath("/app/hedefler");
  return {
    ok: true,
    id: created.id,
    tempPassword: mode === "password" ? tempPassword : undefined,
    emailSent: mode === "email" ? emailSent : undefined,
    warnings: warnings.length ? warnings : undefined,
  };
}
