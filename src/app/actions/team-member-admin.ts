"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { logActivity } from "@/lib/activity";
import { getBaseUrl } from "@/lib/base-url";
import { checkRateLimit } from "@/lib/rate-limit";
import { PHONE_ERROR_MESSAGE, TR_MOBILE_ERROR_MESSAGE } from "@/lib/phone";
import { parsePhoneStrict } from "@/lib/phone-rules";
import { requirePermission } from "@/lib/require-permission";
import { notifyTenant } from "@/lib/notify";
import { emailSchema } from "@/lib/validation/contact";
import { maskEmail } from "@/lib/account/email-change";
import { authorizeMemberManagement } from "@/lib/team/member-admin";

export type MemberAdminResult = { ok?: boolean; error?: string; message?: string };

function revalidateMember(id: string) {
  revalidatePath("/app/ekip");
  revalidatePath(`/app/ekip/${id}`);
}

/**
 * Üyenin ad, telefon ve unvanını düzeltir (P0-11). E-posta (auth kimliği) BU akışta değişmez:
 * yönetici başkasının e-postasını doğrudan yazamaz; bkz. requestMemberEmailChange (üyeye bildirim,
 * değişimi üye kendi hesabında parola onayı + doğrulama bağlantısıyla yapar).
 */
export async function updateMemberProfile(
  _prev: MemberAdminResult,
  formData: FormData,
): Promise<MemberAdminResult> {
  const gate = await requirePermission("team", "edit");
  if (!gate.ok) return { error: gate.error };
  const id = String(formData.get("id") ?? "").trim();
  const ctx = await authorizeMemberManagement(id);
  if (!ctx.ok) return { error: ctx.error };

  const fullName = String(formData.get("full_name") ?? "").trim();
  const title = String(formData.get("title") ?? "").trim();
  const phoneRaw = String(formData.get("phone") ?? "").trim();

  if (!fullName) return { error: "Ad soyad zorunlu." };
  if (fullName.length > 120) return { error: "Ad soyad en fazla 120 karakter olabilir." };
  if (title.length > 80) return { error: "Unvan en fazla 80 karakter olabilir." };

  // profiles.phone DB'de TR cep (05XXXXXXXXX) ister; 2FA SMS'i de yalnız TR'ye gider.
  let phone: string | null = null;
  if (phoneRaw) {
    const parsed = parsePhoneStrict(phoneRaw);
    if (!parsed.ok) return { error: parsed.error ?? PHONE_ERROR_MESSAGE };
    if (parsed.country !== "TR" || parsed.kind !== "mobile") return { error: TR_MOBILE_ERROR_MESSAGE };
    phone = parsed.stored;
  }

  const admin = createAdminClient();
  const { error } = await admin
    .from("profiles")
    .update({ full_name: fullName, phone, title: title || null })
    .eq("id", id)
    .eq("tenant_id", ctx.tenantId);
  if (error) {
    console.error("updateMemberProfile", error.message);
    return { error: "Üye bilgileri güncellenemedi." };
  }

  // Auth meta yalnız görünüm içindir (yetki profilden okunur); hata ana işlemi bozmaz.
  const { error: metaError } = await admin.auth.admin.updateUserById(id, {
    user_metadata: { full_name: fullName, phone: phone ?? "" },
  });
  if (metaError) console.error("updateMemberProfile meta", metaError.message);

  await logActivity({
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    action: "team.member_updated",
    entityType: "profile",
    entityId: id,
    oldValue: { full_name: ctx.target.full_name, title: ctx.target.title, phone_changed: (ctx.target.phone ?? null) !== phone },
    newValue: { full_name: fullName, title: title || null },
  });

  revalidateMember(id);
  return { ok: true, message: "Üye bilgileri kaydedildi." };
}

async function sendAccessMail(
  formData: FormData,
  kind: "reset" | "invite",
): Promise<MemberAdminResult> {
  const id = String(formData.get("id") ?? "").trim();
  const ctx = await authorizeMemberManagement(id);
  if (!ctx.ok) return { error: ctx.error };
  if (!ctx.target.is_active) return { error: "Pasif üyeye bağlantı gönderilemez; önce aktifleştirin." };

  // Hız sınırı: yönetici başına saatte 20, hedef başına saatte 3 (e-posta bombardımanı koruması).
  const [byActor, byTarget] = await Promise.all([
    checkRateLimit(`member-access:actor:${ctx.actorId}`, { limit: 20, windowSec: 3600, failurePolicy: "deny" }),
    checkRateLimit(`member-access:target:${id}`, { limit: 3, windowSec: 3600, failurePolicy: "deny" }),
  ]);
  if (!byActor.allowed || !byTarget.allowed) {
    return { error: "Çok fazla bağlantı gönderildi. Lütfen bir süre sonra tekrar deneyin." };
  }

  const admin = createAdminClient();
  const { data: authUser } = await admin.auth.admin.getUserById(id);
  const email = authUser?.user?.email;
  if (!email) return { error: "Üyenin e-posta adresi bulunamadı." };
  if (kind === "invite" && authUser.user?.last_sign_in_at) {
    return { error: "Üye zaten giriş yapmış; parola sıfırlama bağlantısı gönderin." };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${getBaseUrl()}/sifre-yenile`,
  });
  if (error) {
    console.error("sendAccessMail", error.message);
    return { error: "Bağlantı gönderilemedi. Biraz sonra tekrar deneyin." };
  }

  await logActivity({
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    action: kind === "reset" ? "team.password_reset_sent" : "team.invite_resent",
    entityType: "profile",
    entityId: id,
    newValue: { member: ctx.target.full_name },
  });
  revalidateMember(id);
  return {
    ok: true,
    message:
      kind === "reset"
        ? `Parola sıfırlama bağlantısı ${email} adresine gönderildi.`
        : `Davet bağlantısı ${email} adresine yeniden gönderildi.`,
  };
}

/** Parola sıfırlama bağlantısı gönderir (yalnız yetkili yönetici rolü; parolayı yönetici görmez). */
export async function sendMemberPasswordReset(
  _prev: MemberAdminResult,
  formData: FormData,
): Promise<MemberAdminResult> {
  const gate = await requirePermission("team", "edit");
  if (!gate.ok) return { error: gate.error };
  return sendAccessMail(formData, "reset");
}

/** Hiç giriş yapmamış üyeye davet bağlantısını sonucu görünür şekilde yeniden gönderir. */
export async function resendMemberInvite(
  _prev: MemberAdminResult,
  formData: FormData,
): Promise<MemberAdminResult> {
  const gate = await requirePermission("team", "edit");
  if (!gate.ok) return { error: gate.error };
  return sendAccessMail(formData, "invite");
}

/**
 * Yöneticinin başka bir üye için e-posta değişikliği İSTEMESİ. E-posta burada YAZILMAZ: üyeye uygulama içi
 * bildirim gider; üye Hesabım > Profil > "E-posta adresini değiştir" ile parola onayı ve yeni adrese
 * doğrulama bağlantısıyla değiştirir (onaylanana kadar eski adres geçerli). Platformda işlemsel e-posta
 * altyapısı olmadığından yeni adrese yönetici adına doğrulama gönderilemez.
 * Kapı: team.edit + yönetici rolü + canManageRole (authorizeMemberManagement); ofis sahibi hedef olamaz.
 */
export async function requestMemberEmailChange(
  _prev: MemberAdminResult,
  formData: FormData,
): Promise<MemberAdminResult> {
  const gate = await requirePermission("team", "edit");
  if (!gate.ok) return { error: gate.error };
  const id = String(formData.get("id") ?? "").trim();
  const ctx = await authorizeMemberManagement(id);
  if (!ctx.ok) return { error: ctx.error };
  if (!ctx.target.is_active) return { error: "Pasif üyeye istek gönderilemez; önce aktifleştirin." };

  const parsed = emailSchema.safeParse(formData.get("new_email"));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Geçerli bir e-posta adresi girin" };
  const newEmail = parsed.data;

  const [byActor, byTarget] = await Promise.all([
    checkRateLimit(`member-email-change:actor:${ctx.actorId}`, { limit: 20, windowSec: 3600, failurePolicy: "deny" }),
    checkRateLimit(`member-email-change:target:${id}`, { limit: 2, windowSec: 86400, failurePolicy: "deny" }),
  ]);
  if (!byActor.allowed || !byTarget.allowed) {
    return { error: "Bu üye için çok fazla istek gönderildi. Lütfen daha sonra tekrar deneyin." };
  }

  try {
    await notifyTenant({
      tenantId: ctx.tenantId,
      userId: id,
      title: "E-posta adresinizi güncellemeniz istendi",
      body: `Yöneticiniz giriş e-postanızı ${newEmail} olarak değiştirmenizi istiyor. Hesabım sayfasından parolanızı doğrulayıp yeni adresi onaylayın.`,
      href: "/app/hesabim",
      kind: "warning",
    });
  } catch (e) {
    console.error("requestMemberEmailChange", e);
    return { error: "İstek üyeye iletilemedi. Lütfen tekrar deneyin." };
  }

  await logActivity({
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    action: "team.member_email_change_requested",
    entityType: "profile",
    entityId: id,
    newValue: { member: ctx.target.full_name, requested_email_masked: maskEmail(newEmail) },
  });
  revalidateMember(id);
  return {
    ok: true,
    message: "Üyeye bildirim gönderildi. E-posta, üye kendi hesabında doğrulama bağlantısını onaylayınca değişir.",
  };
}
