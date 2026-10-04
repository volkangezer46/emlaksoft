"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { guardPlatformAction } from "@/lib/platform-guards";
import { logPlatformActivity } from "@/lib/platform-activity";
import { ASSIGNABLE_ROLES, type TeamRole } from "@/lib/team/assignable-roles";
import { getPlan } from "@/lib/billing/plans";
import { getBaseUrl } from "@/lib/base-url";
import { PHONE_ERROR_MESSAGE } from "@/lib/phone";
import { parsePhoneStrict } from "@/lib/phone-rules";

export type MemberActionResult = { ok?: boolean; error?: string; link?: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RATE = { key: "platform-members", limit: 30, windowSec: 600 } as const;

type Target = { id: string; tenant_id: string; role: string; full_name: string; is_active: boolean };

async function loadTarget(admin: ReturnType<typeof createAdminClient>, id: string): Promise<Target | null> {
  if (!UUID_RE.test(id)) return null;
  const { data } = await admin
    .from("profiles")
    .select("id, tenant_id, role, full_name, is_active")
    .eq("id", id)
    .maybeSingle();
  return (data as Target | null) ?? null;
}

/** Ad ve telefon düzenleme: üyeler modülüne erişen her personel (destek dahil). */
export async function updateMemberProfile(fd: FormData): Promise<MemberActionResult> {
  const gate = await guardPlatformAction({ module: "members", rate: RATE });
  if ("error" in gate) return { error: gate.error };

  const id = String(fd.get("id") ?? "").trim();
  const fullName = String(fd.get("full_name") ?? "").trim();
  const phoneRaw = String(fd.get("phone") ?? "").trim();

  if (fullName.length < 2 || fullName.length > 120) return { error: "Ad soyad 2 ile 120 karakter arasında olmalıdır." };
  let phone: string | null = null;
  if (phoneRaw) {
    const parsed = parsePhoneStrict(phoneRaw);
    if (!parsed.ok) return { error: parsed.error ?? PHONE_ERROR_MESSAGE };
    phone = parsed.stored;
  }

  const admin = createAdminClient();
  const target = await loadTarget(admin, id);
  if (!target) return { error: "Üye bulunamadı." };

  const { data: prev } = await admin
    .from("profiles")
    .select("full_name, phone")
    .eq("id", id)
    .eq("tenant_id", target.tenant_id)
    .maybeSingle();

  const { error } = await admin
    .from("profiles")
    .update({ full_name: fullName, phone })
    .eq("id", id)
    .eq("tenant_id", target.tenant_id);
  if (error) return { error: "Üye bilgileri güncellenemedi." };

  await logPlatformActivity({
    actorId: gate.staff.id,
    action: "platform_member.update",
    entityType: "profile",
    entityId: id,
    meta: {
      tenant_id: target.tenant_id,
      old: { full_name: prev?.full_name ?? null, phone: prev?.phone ?? null },
      new: { full_name: fullName, phone },
    },
  });

  revalidatePath(`/admin/members/${id}`);
  revalidatePath("/admin/members");
  return { ok: true };
}

/** Rol değiştirme: yalnız süper admin. Ofis sahibi bu ekrandan değiştirilmez/atanmaz. */
export async function setMemberRoleAsStaff(fd: FormData): Promise<MemberActionResult> {
  const gate = await guardPlatformAction({ module: "members", roles: ["super_admin"], rate: RATE });
  if ("error" in gate) return { error: gate.error };

  const id = String(fd.get("id") ?? "").trim();
  const role = String(fd.get("role") ?? "").trim() as TeamRole;
  if (!ASSIGNABLE_ROLES.includes(role)) return { error: "Geçerli bir rol seçin." };

  const admin = createAdminClient();
  const target = await loadTarget(admin, id);
  if (!target) return { error: "Üye bulunamadı." };
  if (target.role === "owner") return { error: "Ofis sahibinin rolü bu ekrandan değiştirilemez." };
  if (target.role === role) return { ok: true };

  const { data: authRecord, error: authReadError } = await admin.auth.admin.getUserById(id);
  if (authReadError || !authRecord.user) return { error: "Üyenin kimlik kaydı doğrulanamadı." };

  const { error } = await admin
    .from("profiles")
    .update({ role })
    .eq("id", id)
    .eq("tenant_id", target.tenant_id);
  if (error) return { error: "Rol güncellenemedi." };

  const currentMeta = (authRecord.user.app_metadata ?? {}) as Record<string, unknown>;
  const { error: claimError } = await admin.auth.admin.updateUserById(id, {
    app_metadata: { ...currentMeta, tenant_id: target.tenant_id, role },
  });
  if (claimError) {
    await admin.from("profiles").update({ role: target.role }).eq("id", id).eq("tenant_id", target.tenant_id);
    return { error: "Rol kimliği güncellenemedi; değişiklik geri alındı." };
  }

  await logPlatformActivity({
    actorId: gate.staff.id,
    action: "platform_member.role_change",
    entityType: "profile",
    entityId: id,
    meta: { tenant_id: target.tenant_id, old_role: target.role, new_role: role },
  });

  revalidatePath(`/admin/members/${id}`);
  revalidatePath("/admin/members");
  return { ok: true };
}

/** Pasifleştir / aktifleştir: süper admin ve operasyon. Pasifleştirmede açık oturumlar kapatılır. */
export async function setMemberActiveAsStaff(fd: FormData): Promise<MemberActionResult> {
  const gate = await guardPlatformAction({ module: "members", roles: ["super_admin", "ops"], rate: RATE });
  if ("error" in gate) return { error: gate.error };

  const id = String(fd.get("id") ?? "").trim();
  const active = String(fd.get("is_active") ?? "") === "true";

  const admin = createAdminClient();
  const target = await loadTarget(admin, id);
  if (!target) return { error: "Üye bulunamadı." };
  if (target.is_active === active) return { ok: true };

  if (!active && target.role === "owner") {
    // Ofisin tek aktif sahibi pasife alınamaz (ofis kilitlenir).
    const { count } = await admin
      .from("profiles")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", target.tenant_id)
      .eq("role", "owner")
      .eq("is_active", true);
    if ((count ?? 0) <= 1) return { error: "Ofisin tek aktif sahibi pasife alınamaz." };
  }

  if (active) {
    const [{ data: tenant }, { count }] = await Promise.all([
      admin.from("tenants").select("plan, status").eq("id", target.tenant_id).maybeSingle(),
      admin
        .from("profiles")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", target.tenant_id)
        .eq("is_active", true),
    ]);
    if (!tenant) return { error: "Ofis doğrulanamadı." };
    if (tenant.status === "suspended" || tenant.status === "cancelled") {
      return { error: "Askıdaki veya iptal edilmiş ofiste üye aktifleştirilemez." };
    }
    const limit = getPlan(String(tenant.plan)).limits.seats;
    if ((count ?? 0) >= limit) {
      return { error: `Ofisin paketi en fazla ${limit} aktif kullanıcı destekliyor.` };
    }
  }

  const { data: authRecord, error: authReadError } = await admin.auth.admin.getUserById(id);
  if (authReadError || !authRecord.user) return { error: "Üyenin kimlik kaydı doğrulanamadı." };

  const { error } = await admin
    .from("profiles")
    .update({ is_active: active })
    .eq("id", id)
    .eq("tenant_id", target.tenant_id);
  if (error) return { error: "Üye durumu güncellenemedi." };

  const currentMeta = (authRecord.user.app_metadata ?? {}) as Record<string, unknown>;
  const { error: claimError } = await admin.auth.admin.updateUserById(id, {
    app_metadata: {
      ...currentMeta,
      tenant_id: target.tenant_id,
      role: target.role,
      account_active: active,
      deactivated_at: active ? null : new Date().toISOString(),
    },
    ban_duration: active ? ("none" as const) : "876000h",
  });
  if (claimError) {
    await admin.from("profiles").update({ is_active: target.is_active }).eq("id", id).eq("tenant_id", target.tenant_id);
    return { error: "Kimlik durumu güncellenemedi; değişiklik geri alındı." };
  }

  if (!active) {
    const { error: revokeError } = await admin.rpc("revoke_team_member_sessions", {
      p_user_id: id,
      p_tenant_id: target.tenant_id,
    });
    if (revokeError) console.error("platform member session revoke", { id, error: revokeError.message });
  }

  await logPlatformActivity({
    actorId: gate.staff.id,
    action: active ? "platform_member.activate" : "platform_member.deactivate",
    entityType: "profile",
    entityId: id,
    meta: { tenant_id: target.tenant_id, role: target.role },
  });

  revalidatePath(`/admin/members/${id}`);
  revalidatePath("/admin/members");
  return { ok: true };
}

/** Tüm açık oturumları kapat (parola/cihaz kaybı): süper admin ve operasyon. */
export async function signOutMemberSessions(fd: FormData): Promise<MemberActionResult> {
  const gate = await guardPlatformAction({ module: "members", roles: ["super_admin", "ops"], rate: RATE });
  if ("error" in gate) return { error: gate.error };

  const id = String(fd.get("id") ?? "").trim();
  const admin = createAdminClient();
  const target = await loadTarget(admin, id);
  if (!target) return { error: "Üye bulunamadı." };

  // revoke_team_member_sessions yalnız pasif üyede çalışır; aktif hesap için platform_revoke_user_sessions (migration 20260816010200).
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
    action: "platform_member.sessions_revoke",
    entityType: "profile",
    entityId: id,
    meta: { tenant_id: target.tenant_id },
  });
  revalidatePath(`/admin/members/${id}`);
  return { ok: true };
}

/**
 * Parola sıfırlama bağlantısı üretir (yalnız süper admin). Bağlantı hesabı ele geçirmeye yeter:
 * yalnız bu yanıtta döner, denetim kaydına yazılmaz; üyeye güvenli kanaldan iletilmelidir.
 */
export async function generateMemberResetLink(fd: FormData): Promise<MemberActionResult> {
  const gate = await guardPlatformAction({
    module: "members",
    roles: ["super_admin"],
    rate: { key: "platform-member-reset", limit: 10, windowSec: 600 },
  });
  if ("error" in gate) return { error: gate.error };

  const id = String(fd.get("id") ?? "").trim();
  const admin = createAdminClient();
  const target = await loadTarget(admin, id);
  if (!target) return { error: "Üye bulunamadı." };

  const { data: authRecord } = await admin.auth.admin.getUserById(id);
  const email = authRecord?.user?.email;
  if (!email) return { error: "Üyenin e-posta adresi bulunamadı." };

  const { data, error } = await admin.auth.admin.generateLink({
    type: "recovery",
    email,
    options: { redirectTo: `${getBaseUrl()}/sifre-yenile` },
  });
  const link = data?.properties?.action_link;
  if (error || !link) return { error: "Sıfırlama bağlantısı üretilemedi." };

  await logPlatformActivity({
    actorId: gate.staff.id,
    action: "platform_member.reset_link",
    entityType: "profile",
    entityId: id,
    meta: { tenant_id: target.tenant_id },
  });
  return { ok: true, link };
}
