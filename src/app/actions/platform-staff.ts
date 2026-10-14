"use server";

import { requireStepUp } from "@/lib/platform-security/step-up";
import { fourEyesGate, readFourEyesConfig, requireStepUpOrApproved } from "@/lib/platform-security/four-eyes";
import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { requirePlatformModule, type PlatformStaff } from "@/lib/platform";
import { PLATFORM_ROLE_LABELS, platformCan, type PlatformRole } from "@/lib/platform-access";
import { guardPlatformAction } from "@/lib/platform-guards";
import { logPlatformActivity } from "@/lib/platform-activity";
import { getBaseUrl } from "@/lib/base-url";
import { EMAIL_ERROR_MESSAGE, isValidEmail, normalizeEmail } from "@/lib/email";
import { actionErrorMessage } from "@/lib/action-errors";

const VALID_ROLES: PlatformRole[] = ["super_admin", "ops", "support", "billing"];
/** Migration öncesi `custom_role_id` sütunu yok: sorgu/yazım eski biçime düşer. */
const SCHEMA_COLUMN_MISSING = new Set(["42703", "PGRST204"]);
const SUPER_ADMIN_ADD_QUEUE_ONLY =
  "Dört göz onayı açık: süper admin doğrudan eklenemez. Personeli başka bir rolle ekleyin, rolü \"Rol değiştir\"den ikinci onaya gönderin.";

export type StaffActionResult = { ok?: boolean; error?: string; notice?: string; code?: "step_up_required" | "step_up_invalid" | "step_up_no_factor" };

/**
 * Yeni platform personeli ekle.
 * Supabase Auth'da kayıtlı bir e-posta gerektirir; kullanıcı auth.users'da varsa
 * platform_staff'a eklenir, yoksa davet linki gönderilir (auth.admin.inviteUserByEmail).
 *
 * Personel eklemek ya da pasif personeli formdaki rolle yeniden açmak ROL ATAMASIDIR: `updateStaffRole` ile aynı kapı
 * (personel modülünde "onayla"; sabit rollerde yalnız süper admin). Dört göz (rol değişikliği) açıkken bu yol kuyruğu
 * olmadığı için ikinci onayı atlayamaz: süper admin olarak yeni personel eklenemez, pasif personel farklı rolle açılamaz
 * (önce başka rolle ekle / mevcut rolüyle aç, rolü "Rol değiştir"den ikinci onaya gönder).
 */
export async function addPlatformStaff(fd: FormData): Promise<StaffActionResult> {
  const staff = await requirePlatformModule("personel");
  if (!platformCan(staff, "personel", "approve")) {
    return { error: "Personel eklemek rol ataması sayılır; personel yönetiminde onay yetkisi ister." };
  }

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
  if (superAdminTouchDenied(staff, role)) return { error: "Süper admin rolünü yalnız süper admin verebilir." };
  if (tempPassword && tempPassword.length < 10) {
    return { error: "Geçici parola en az 10 karakter olmalıdır." };
  }

  const fourEyesStaffRole = (await readFourEyesConfig()).staffRole;
  const admin = createAdminClient();

  // Auth'da kullanıcı var mı?
  const { data: listData } = await admin.auth.admin.listUsers();
  const existing = listData?.users?.find((u) => u.email?.toLowerCase() === email);

  if (existing) {
    // Zaten platform_staff'ta mı? (custom_role_id migration öncesi yoksa eski sorguya düşülür)
    let already: { id: string; is_active: boolean; role: string; custom_role_id?: string | null } | null = null;
    const withCustom = await admin
      .from("platform_staff")
      .select("id, is_active, role, custom_role_id")
      .eq("id", existing.id)
      .maybeSingle();
    if (withCustom.error && SCHEMA_COLUMN_MISSING.has(withCustom.error.code ?? "")) {
      const legacy = await admin.from("platform_staff").select("id, is_active, role").eq("id", existing.id).maybeSingle();
      if (legacy.error) return { error: actionErrorMessage(legacy.error, "Personel kaydı okunamadı.") };
      already = legacy.data;
    } else if (withCustom.error) {
      return { error: actionErrorMessage(withCustom.error, "Personel kaydı okunamadı.") };
    } else {
      already = withCustom.data;
    }

    if (already) {
      if (already.is_active) return { error: "Bu e-posta zaten aktif personel olarak kayıtlı." };
      if (superAdminTouchDenied(staff, already.role)) return { error: "Süper admini yalnız süper admin yeniden etkinleştirebilir." };
      // Pasif → tekrar aktif et. AD11: formdaki rol (süper admin dahil) yeniden atanır = rol değişikliği; kod ister
      // (aksi halde updateStaffRole'daki kapı "pasifleştir + yeniden davet et" ile atlanırdı).
      const roleChanges = already.role !== role || Boolean(already.custom_role_id);
      if (roleChanges && fourEyesStaffRole) {
        return {
          error:
            "Dört göz onayı açık: pasif personeli farklı bir rolle açmak rol değişikliğidir. Personeli listeden mevcut rolüyle yeniden etkinleştirin, rolü \"Rol değiştir\"den ikinci onaya gönderin.",
        };
      }
      const stepUp = await requireStepUp(fd, "staff_role", staff.id);
      if (!stepUp.ok) return { error: stepUp.error, code: stepUp.code };
      const stamp = new Date().toISOString();
      // Sabit rol atanır: eski özel rol temizlenir (aksi halde yetki hâlâ özel rolden gelirdi; süper admin + özel rol
      // DB CHECK'e takılır).
      let { error: upError } = await admin
        .from("platform_staff")
        .update({ is_active: true, role, custom_role_id: null, full_name: fullName, updated_at: stamp })
        .eq("id", existing.id);
      if (upError && SCHEMA_COLUMN_MISSING.has(upError.code ?? "")) {
        ({ error: upError } = await admin
          .from("platform_staff")
          .update({ is_active: true, role, full_name: fullName, updated_at: stamp })
          .eq("id", existing.id));
      }
      if (upError) return { error: actionErrorMessage(upError, "Personel yeniden etkinleştirilemedi.") };
      await logPlatformActivity({
        actorId: staff.id,
        action: "platform_staff.reactivate",
        entityType: "platform_staff",
        entityId: existing.id,
        meta: { email, role, old_role: already.role, old_custom_role_id: already.custom_role_id ?? null },
      });
      revalidatePath("/admin/personel");
      return { ok: true };
    }

    if (role === "super_admin" && fourEyesStaffRole) return { error: SUPER_ADMIN_ADD_QUEUE_ONLY };

    // Auth var ama platform_staff'ta yok → ekle
    const { error: insError } = await admin.from("platform_staff").insert({
      id: existing.id,
      email,
      full_name: fullName,
      role,
      is_active: true,
    });
    if (insError) return { error: actionErrorMessage(insError, "Personel eklenemedi.") };
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

  if (role === "super_admin" && fourEyesStaffRole) return { error: SUPER_ADMIN_ADD_QUEUE_ONLY };

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
    return { error: actionErrorMessage(invErr, "Davet gönderilemedi.") };
  }

  const { error: insError } = await admin.from("platform_staff").insert({
    id: invited.user.id,
    email,
    full_name: fullName,
    role,
    is_active: true,
  });
  if (insError) return { error: actionErrorMessage(insError, "Personel kaydı yazılamadı.") };

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

/** Rol seçimi: sabit rol adı ya da `custom:<uuid>` (DG1 özel rol). */
function parseRoleChoice(raw: string | null | undefined): { role: PlatformRole; customId: null } | { role: null; customId: string } | null {
  const v = (raw ?? "").trim();
  if (VALID_ROLES.includes(v as PlatformRole)) return { role: v as PlatformRole, customId: null };
  const m = /^custom:([0-9a-f-]{36})$/i.exec(v);
  return m && UUID_RE.test(m[1]!) ? { role: null, customId: m[1]!.toLowerCase() } : null;
}

/** Süper admin hesabına dokunan (atama, düşürme, pasifleştirme) işlem yalnız süper admin içindir (özel rol yükseltemez). */
function superAdminTouchDenied(actor: PlatformStaff, ...roles: (string | null | undefined)[]): boolean {
  return actor.role !== "super_admin" && roles.includes("super_admin");
}

/**
 * Personel rolünü güncelle: sabit rol ya da özel rol (`custom:<id>`; taban rolü `role` sütununa yazılır).
 * Kapı: personel modülünde "onayla" (sabit rollerde yalnız süper admin) + doğrulayıcı kodu. DG1 dört göz açıksa
 * değişiklik ikinci bir yetkilinin onayıyla yürür. Özel rol yetkilisi kendi rolünü ve süper adminleri değiştiremez.
 */
export async function updateStaffRole(fd: FormData): Promise<StaffActionResult> {
  const staff = await requirePlatformModule("personel");
  if (!platformCan(staff, "personel", "approve")) return { error: "Rol değişikliği personel yönetiminde onay yetkisi ister." };

  const id = (fd.get("id") as string | null)?.trim();
  const choice = parseRoleChoice(fd.get("role") as string | null);

  if (!id) return { error: "Personel ID gerekli." };
  if (!choice) return { error: "Geçersiz rol." };
  if (id === staff.id && staff.role !== "super_admin") return { error: "Kendi rolünüzü değiştiremezsiniz." };
  // AD11: rol değişikliği doğrulayıcı kodu ister (DG1: onaylı yürütmede onaylayan kodu onay ekranında girdi).
  const stepUp = await requireStepUpOrApproved(fd, "staff_role", staff.id);
  if (!stepUp.ok) return { error: stepUp.error };

  const admin = createAdminClient();

  // Özel rol: var mı, taban rolü ne (süper admin olamaz; DB CHECK de engeller).
  let custom: { id: string; label: string; base_role: PlatformRole } | null = null;
  if (choice.customId) {
    const { data: cr, error: crError } = await admin
      .from("platform_custom_roles")
      .select("id, label, base_role")
      .eq("id", choice.customId)
      .maybeSingle();
    if (crError) return { error: "Özel roller henüz kurulmadı (veritabanı güncellemesi bekliyor)." };
    if (!cr) return { error: "Özel rol bulunamadı." };
    custom = cr as { id: string; label: string; base_role: PlatformRole };
  }
  const nextRole: PlatformRole = custom ? custom.base_role : choice.role!;

  // Eski rolü audit için al
  const { data: prev } = await admin
    .from("platform_staff")
    .select("role, email")
    .eq("id", id)
    .maybeSingle();
  if (!prev) return { error: "Personel bulunamadı." };
  if (superAdminTouchDenied(staff, prev.role, nextRole)) return { error: "Süper admin rolünü yalnız süper admin değiştirebilir." };

  // Kendini düzenlemeye izin ver ama son super_admin'i düşürme
  if (nextRole !== "super_admin" && prev.role === "super_admin") {
    const { count } = await admin
      .from("platform_staff")
      .select("id", { count: "exact", head: true })
      .eq("role", "super_admin")
      .eq("is_active", true);
    if ((count ?? 0) <= 1) return { error: "Son süper adminin rolü değiştirilemez." };
  }

  const nextLabel = custom ? custom.label : PLATFORM_ROLE_LABELS[nextRole];
  // DG1 dört göz: ayar açıksa rol değişikliği ikinci onaya düşer (eski rol geçerli kalır).
  const fourEyes = await fourEyesGate({
    kind: "staff_role",
    staffId: staff.id,
    form: fd,
    entityId: id,
    summary: `${prev.email}: ${PLATFORM_ROLE_LABELS[prev.role as PlatformRole] ?? prev.role} → ${nextLabel}`,
  });
  if (!fourEyes.proceed) return "error" in fourEyes ? { error: fourEyes.error } : { ok: true, notice: fourEyes.notice };

  const stamp = new Date().toISOString();
  let { error } = await admin
    .from("platform_staff")
    .update({ role: nextRole, custom_role_id: custom?.id ?? null, updated_at: stamp })
    .eq("id", id);
  // Migration öncesi (sütun yok): sabit rol eski yoldan yazılır; özel rol atanamaz.
  if (error && !custom && (error.code === "42703" || error.code === "PGRST204")) {
    ({ error } = await admin.from("platform_staff").update({ role: nextRole, updated_at: stamp }).eq("id", id));
  }
  if (error) return { error: actionErrorMessage(error, "Rol güncellenemedi.") };

  await logPlatformActivity({
    actorId: staff.id,
    action: "platform_staff.role_change",
    entityType: "platform_staff",
    entityId: id,
    meta: { email: prev.email, old_role: prev.role, new_role: nextRole, custom_role_id: custom?.id ?? null, custom_role: custom?.label ?? null },
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

  if (superAdminTouchDenied(staff, target?.role)) return { error: "Süper admini yalnız süper admin pasif yapabilir." };
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
  if (superAdminTouchDenied(staff, target?.role)) return { error: "Süper admini yalnız süper admin yeniden etkinleştirebilir." };

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
    if (authError) return { error: actionErrorMessage(authError, "Giriş e-postası güncellenemedi.") };
  }

  const { error } = await admin
    .from("platform_staff")
    .update({ full_name: fullName, email, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return { error: actionErrorMessage(error, "Personel bilgileri güncellenemedi.") };

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
  if (error) return { error: actionErrorMessage(error, "Parola sıfırlanamadı.") };

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
        : actionErrorMessage(null, "Oturumlar kapatılamadı."),
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
