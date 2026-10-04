"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { requirePlatformModule } from "@/lib/platform";
import type { PlatformRole } from "@/lib/platform-access";
import { guardPlatformAction } from "@/lib/platform-guards";
import { logPlatformActivity } from "@/lib/platform-activity";
import { getBaseUrl } from "@/lib/base-url";
import { EMAIL_ERROR_MESSAGE, isValidEmail, normalizeEmail } from "@/lib/email";

const VALID_ROLES: PlatformRole[] = ["super_admin", "ops", "support", "billing"];

export type StaffActionResult = { ok?: boolean; error?: string };

/**
 * Yeni platform personeli ekle.
 * Supabase Auth'da kayıtlı bir e-posta gerektirir; kullanıcı auth.users'da varsa
 * platform_staff'a eklenir, yoksa davet linki gönderilir (auth.admin.inviteUserByEmail).
 */
export async function addPlatformStaff(fd: FormData): Promise<StaffActionResult> {
  const staff = await requirePlatformModule("personel");

  const email = normalizeEmail(fd.get("email") as string | null);
  const fullName = (fd.get("full_name") as string | null)?.trim();
  const role = (fd.get("role") as PlatformRole | null) ?? "support";
  // İsteğe bağlı geçici parola: verilirse (ve auth'da kullanıcı yoksa) davet yerine hesap parolayla açılır.
  const tempPassword = ((fd.get("temp_password") as string | null) ?? "").trim();

  if (!email || !isValidEmail(email)) {
    return { error: `${EMAIL_ERROR_MESSAGE}.` };
  }
  if (!fullName) return { error: "Ad Soyad zorunludur." };
  if (!VALID_ROLES.includes(role)) return { error: "Geçersiz rol." };
  if (tempPassword && tempPassword.length < 10) {
    return { error: "Geçici parola en az 10 karakter olmalıdır." };
  }

  const admin = createAdminClient();

  // Auth'da kullanıcı var mı?
  const { data: listData } = await admin.auth.admin.listUsers();
  const existing = listData?.users?.find((u) => u.email?.toLowerCase() === email);

  if (existing) {
    // Zaten platform_staff'ta mı?
    const { data: already } = await admin
      .from("platform_staff")
      .select("id, is_active")
      .eq("id", existing.id)
      .maybeSingle();

    if (already) {
      if (already.is_active) return { error: "Bu e-posta zaten aktif personel olarak kayıtlı." };
      // Pasif → tekrar aktif et
      await admin
        .from("platform_staff")
        .update({ is_active: true, role, full_name: fullName, updated_at: new Date().toISOString() })
        .eq("id", existing.id);
      await logPlatformActivity({
        actorId: staff.id,
        action: "platform_staff.reactivate",
        entityType: "platform_staff",
        entityId: existing.id,
        meta: { email, role },
      });
      revalidatePath("/admin/personel");
      return { ok: true };
    }

    // Auth var ama platform_staff'ta yok → ekle
    await admin.from("platform_staff").insert({
      id: existing.id,
      email,
      full_name: fullName,
      role,
      is_active: true,
    });
    await logPlatformActivity({
      actorId: staff.id,
      action: "platform_staff.add",
      entityType: "platform_staff",
      entityId: existing.id,
      meta: { email, role },
    });
    revalidatePath("/admin/personel");
    return { ok: true };
  }

  // Auth'da yok → geçici parolayla hesap aç ya da davet e-postası gönder; ardından platform_staff'a yaz
  const { data: invited, error: invErr } = tempPassword
    ? await admin.auth.admin.createUser({
        email,
        password: tempPassword,
        email_confirm: true,
        user_metadata: { full_name: fullName, must_change_password: true },
      })
    : await admin.auth.admin.inviteUserByEmail(email, {
        data: { full_name: fullName },
        redirectTo: `${getBaseUrl()}/admin`,
      });

  if (invErr || !invited.user) {
    return { error: invErr?.message ?? "Davet gönderilemedi." };
  }

  await admin.from("platform_staff").insert({
    id: invited.user.id,
    email,
    full_name: fullName,
    role,
    is_active: true,
  });

  await logPlatformActivity({
    actorId: staff.id,
    action: tempPassword ? "platform_staff.add" : "platform_staff.invite",
    entityType: "platform_staff",
    entityId: invited.user.id,
    meta: { email, role, ...(tempPassword ? { temp_password: true } : {}) },
  });
  revalidatePath("/admin/personel");
  return { ok: true };
}

/** Personel rolünü güncelle. */
export async function updateStaffRole(fd: FormData): Promise<StaffActionResult> {
  const staff = await requirePlatformModule("personel");

  const id = (fd.get("id") as string | null)?.trim();
  const role = (fd.get("role") as PlatformRole | null);

  if (!id) return { error: "Personel ID gerekli." };
  if (!role || !VALID_ROLES.includes(role)) return { error: "Geçersiz rol." };

  const admin = createAdminClient();

  // Kendini düzenlemeye izin ver ama son super_admin'i düşürme
  if (role !== "super_admin") {
    const { count } = await admin
      .from("platform_staff")
      .select("id", { count: "exact", head: true })
      .eq("role", "super_admin")
      .eq("is_active", true);
    if ((count ?? 0) <= 1) {
      const { data: target } = await admin
        .from("platform_staff")
        .select("role")
        .eq("id", id)
        .maybeSingle();
      if (target?.role === "super_admin") {
        return { error: "Son süper adminin rolü değiştirilemez." };
      }
    }
  }

  // Eski rolü audit için al
  const { data: prev } = await admin
    .from("platform_staff")
    .select("role, email")
    .eq("id", id)
    .maybeSingle();

  await admin
    .from("platform_staff")
    .update({ role, updated_at: new Date().toISOString() })
    .eq("id", id);

  await logPlatformActivity({
    actorId: staff.id,
    action: "platform_staff.role_change",
    entityType: "platform_staff",
    entityId: id,
    meta: { email: prev?.email, old_role: prev?.role, new_role: role },
  });

  revalidatePath("/admin/personel");
  return { ok: true };
}

/** Personeli pasif yap (soft delete). */
export async function deactivateStaff(fd: FormData): Promise<StaffActionResult> {
  const staff = await requirePlatformModule("personel");

  const id = (fd.get("id") as string | null)?.trim();
  if (!id) return { error: "Personel ID gerekli." };

  const admin = createAdminClient();

  // Son aktif super_admin'i pasif etme
  const { data: target } = await admin
    .from("platform_staff")
    .select("role, email")
    .eq("id", id)
    .maybeSingle();

  if (target?.role === "super_admin") {
    const { count } = await admin
      .from("platform_staff")
      .select("id", { count: "exact", head: true })
      .eq("role", "super_admin")
      .eq("is_active", true);
    if ((count ?? 0) <= 1) {
      return { error: "Son süper admin pasif yapılamaz." };
    }
  }

  await admin
    .from("platform_staff")
    .update({ is_active: false, updated_at: new Date().toISOString() })
    .eq("id", id);

  await logPlatformActivity({
    actorId: staff.id,
    action: "platform_staff.deactivate",
    entityType: "platform_staff",
    entityId: id,
    meta: { email: target?.email, role: target?.role },
  });

  revalidatePath("/admin/personel");
  return { ok: true };
}

/** Pasif personeli tekrar aktif yap. */
export async function reactivateStaff(fd: FormData): Promise<StaffActionResult> {
  const staff = await requirePlatformModule("personel");

  const id = (fd.get("id") as string | null)?.trim();
  if (!id) return { error: "Personel ID gerekli." };

  const admin = createAdminClient();

  const { data: target } = await admin
    .from("platform_staff")
    .select("email, role")
    .eq("id", id)
    .maybeSingle();

  await admin
    .from("platform_staff")
    .update({ is_active: true, updated_at: new Date().toISOString() })
    .eq("id", id);

  await logPlatformActivity({
    actorId: staff.id,
    action: "platform_staff.reactivate",
    entityType: "platform_staff",
    entityId: id,
    meta: { email: target?.email, role: target?.role },
  });

  revalidatePath("/admin/personel");
  return { ok: true };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STAFF_RATE = { key: "platform-staff-sec", limit: 15, windowSec: 600 } as const;

export type StaffLinkResult = StaffActionResult & { link?: string };

/** Personelin adını ve giriş e-postasını düzenle (yalnız süper admin). */
export async function updateStaffProfile(fd: FormData): Promise<StaffActionResult> {
  const gate = await guardPlatformAction({ module: "personel", roles: ["super_admin"], rate: STAFF_RATE });
  if ("error" in gate) return { error: gate.error };

  const id = (fd.get("id") as string | null)?.trim() ?? "";
  const fullName = ((fd.get("full_name") as string | null) ?? "").trim();
  const email = normalizeEmail(fd.get("email") as string | null);
  if (!UUID_RE.test(id)) return { error: "Personel ID gerekli." };
  if (fullName.length < 2 || fullName.length > 120) return { error: "Ad soyad 2 ile 120 karakter arasında olmalıdır." };
  if (!email || !isValidEmail(email)) return { error: `${EMAIL_ERROR_MESSAGE}.` };

  const admin = createAdminClient();
  const { data: prev } = await admin
    .from("platform_staff")
    .select("email, full_name")
    .eq("id", id)
    .maybeSingle();
  if (!prev) return { error: "Personel bulunamadı." };

  if (prev.email.toLowerCase() !== email) {
    const { data: clash } = await admin.from("platform_staff").select("id").eq("email", email).neq("id", id).maybeSingle();
    if (clash) return { error: "Bu e-posta başka bir personelde kayıtlı." };
    const { error: authError } = await admin.auth.admin.updateUserById(id, { email, email_confirm: true });
    if (authError) return { error: authError.message || "Giriş e-postası güncellenemedi." };
  }

  const { error } = await admin
    .from("platform_staff")
    .update({ full_name: fullName, email, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return { error: "Personel bilgileri güncellenemedi." };

  await logPlatformActivity({
    actorId: gate.staff.id,
    action: "platform_staff.update",
    entityType: "platform_staff",
    entityId: id,
    meta: { old: { email: prev.email, full_name: prev.full_name }, new: { email, full_name: fullName } },
  });
  revalidatePath("/admin/personel");
  revalidatePath(`/admin/personel/${id}`);
  return { ok: true };
}

/**
 * Personel için parola sıfırlama bağlantısı üret (süper admin). Bağlantı yalnız yanıtta döner,
 * denetim kaydına yazılmaz. Daveti yinelemek için de bu bağlantı kullanılır.
 */
export async function generateStaffResetLink(fd: FormData): Promise<StaffLinkResult> {
  const gate = await guardPlatformAction({ module: "personel", roles: ["super_admin"], rate: STAFF_RATE });
  if ("error" in gate) return { error: gate.error };

  const id = (fd.get("id") as string | null)?.trim() ?? "";
  if (!UUID_RE.test(id)) return { error: "Personel ID gerekli." };

  const admin = createAdminClient();
  const { data: target } = await admin.from("platform_staff").select("email").eq("id", id).maybeSingle();
  if (!target) return { error: "Personel bulunamadı." };

  const { data, error } = await admin.auth.admin.generateLink({
    type: "recovery",
    email: target.email,
    options: { redirectTo: `${getBaseUrl()}/admin/hesabim` },
  });
  const link = data?.properties?.action_link;
  if (error || !link) return { error: "Sıfırlama bağlantısı üretilemedi." };

  await logPlatformActivity({
    actorId: gate.staff.id,
    action: "platform_staff.reset_link",
    entityType: "platform_staff",
    entityId: id,
    meta: { email: target.email },
  });
  return { ok: true, link };
}

/**
 * Personelin parolasını geçici bir parolaya sıfırla (süper admin). Personel bir sonraki girişte
 * parolayı değiştirmeye zorlanır (`must_change_password`; yönetim kabuğu parola değişene dek engeller).
 */
export async function resetStaffPassword(fd: FormData): Promise<StaffActionResult> {
  const gate = await guardPlatformAction({ module: "personel", roles: ["super_admin"], rate: STAFF_RATE });
  if ("error" in gate) return { error: gate.error };

  const id = (fd.get("id") as string | null)?.trim() ?? "";
  const tempPassword = ((fd.get("temp_password") as string | null) ?? "").trim();
  if (!UUID_RE.test(id)) return { error: "Personel ID gerekli." };
  if (tempPassword.length < 10 || tempPassword.length > 72) {
    return { error: "Geçici parola 10 ile 72 karakter arasında olmalıdır." };
  }

  const admin = createAdminClient();
  const { data: target } = await admin.from("platform_staff").select("email").eq("id", id).maybeSingle();
  if (!target) return { error: "Personel bulunamadı." };

  const { data: authRecord, error: readError } = await admin.auth.admin.getUserById(id);
  if (readError || !authRecord.user) return { error: "Personelin kimlik kaydı bulunamadı." };

  const { error } = await admin.auth.admin.updateUserById(id, {
    password: tempPassword,
    user_metadata: { ...(authRecord.user.user_metadata ?? {}), must_change_password: true },
  });
  if (error) return { error: error.message || "Parola sıfırlanamadı." };

  // Eski oturumlar eski parolayla sürmesin (fonksiyon henüz uygulanmamışsa sessizce atlanır).
  await admin.rpc("platform_revoke_user_sessions", { p_user_id: id });

  await logPlatformActivity({
    actorId: gate.staff.id,
    action: "platform_staff.password_reset",
    entityType: "platform_staff",
    entityId: id,
    meta: { email: target.email, must_change_password: true },
  });
  revalidatePath(`/admin/personel/${id}`);
  return { ok: true };
}

/** Personelin tüm açık oturumlarını kapat (süper admin). Kendi oturumunu bu yolla kapatamaz. */
export async function signOutStaffSessions(fd: FormData): Promise<StaffActionResult> {
  const gate = await guardPlatformAction({ module: "personel", roles: ["super_admin"], rate: STAFF_RATE });
  if ("error" in gate) return { error: gate.error };

  const id = (fd.get("id") as string | null)?.trim() ?? "";
  if (!UUID_RE.test(id)) return { error: "Personel ID gerekli." };
  if (id === gate.staff.id) return { error: "Kendi oturumunuzu bu ekrandan kapatamazsınız; çıkış yapın." };

  const admin = createAdminClient();
  const { data: target } = await admin.from("platform_staff").select("email").eq("id", id).maybeSingle();
  if (!target) return { error: "Personel bulunamadı." };

  const { error } = await admin.rpc("platform_revoke_user_sessions", { p_user_id: id });
  if (error) {
    return {
      error: /could not find|schema cache|PGRST202/i.test(error.message + (error.code ?? ""))
        ? "Oturum kapatma veritabanı fonksiyonu henüz uygulanmamış (migration 20260816010200)."
        : "Oturumlar kapatılamadı.",
    };
  }

  await logPlatformActivity({
    actorId: gate.staff.id,
    action: "platform_staff.sessions_revoke",
    entityType: "platform_staff",
    entityId: id,
    meta: { email: target.email },
  });
  revalidatePath(`/admin/personel/${id}`);
  return { ok: true };
}
