"use server";

import { requireStepUp } from "@/lib/platform-security/step-up";
import { sensitiveBulkBlocked, sensitiveFourEyesGate } from "@/lib/platform-security/four-eyes";
import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { guardPlatformAction } from "@/lib/platform-guards";
import { logPlatformActivity } from "@/lib/platform-activity";
import { ASSIGNABLE_ROLES, type TeamRole } from "@/lib/team/assignable-roles";
import { readEffectiveSeatLimit } from "@/lib/billing/seat-purchase";
import { getBaseUrl } from "@/lib/base-url";
import { PHONE_ERROR_MESSAGE } from "@/lib/phone";
import { parsePhoneStrict } from "@/lib/phone-rules";
import { actionErrorMessage } from "@/lib/action-errors";
import { now } from "@/lib/clock";

export type MemberActionResult = { ok?: boolean; error?: string; link?: string; notice?: string };

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
  if (error) return { error: actionErrorMessage(error, "Üye bilgileri güncellenemedi.") };

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
  // AD11: rol değişikliği doğrulayıcı kodu ister.
  const stepUp = await requireStepUp(fd, "member_role", gate.staff.id);
  if (!stepUp.ok) return { error: stepUp.error };

  const { data: authRecord, error: authReadError } = await admin.auth.admin.getUserById(id);
  if (authReadError || !authRecord.user) return { error: actionErrorMessage(authReadError, "Üyenin kimlik kaydı doğrulanamadı.") };

  const { error } = await admin
    .from("profiles")
    .update({ role })
    .eq("id", id)
    .eq("tenant_id", target.tenant_id);
  if (error) return { error: actionErrorMessage(error, "Rol güncellenemedi.") };

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

/**
 * Tek üyenin aktif/pasif geçişi (kapı çağıranda). Tek aktif sahip, koltuk sınırı ve askıdaki ofis kuralları burada;
 * pasifleştirmede açık oturumlar kapatılır. Tekil düğme, devir sihirbazı ve toplu pasifleştirme AYNI yolu kullanır.
 */
async function applyMemberActive(
  admin: ReturnType<typeof createAdminClient>,
  target: Target,
  active: boolean,
  staffId: string,
  via: "single" | "bulk" | "handoff" = "single",
): Promise<MemberActionResult> {
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
    if (!tenant) return { error: actionErrorMessage(null, "Ofis doğrulanamadı.") };
    if (tenant.status === "suspended" || tenant.status === "cancelled") {
      return { error: "Askıdaki veya iptal edilmiş ofiste üye aktifleştirilemez." };
    }
    const limit = await readEffectiveSeatLimit(admin, target.tenant_id, String(tenant.plan));
    if ((count ?? 0) >= limit) {
      return { error: `Ofisin paketi en fazla ${limit} aktif kullanıcı destekliyor.` };
    }
  }

  const { data: authRecord, error: authReadError } = await admin.auth.admin.getUserById(target.id);
  if (authReadError || !authRecord.user) return { error: actionErrorMessage(authReadError, "Üyenin kimlik kaydı doğrulanamadı.") };

  const { error } = await admin
    .from("profiles")
    .update({ is_active: active })
    .eq("id", target.id)
    .eq("tenant_id", target.tenant_id);
  if (error) return { error: actionErrorMessage(error, "Üye durumu güncellenemedi.") };

  const currentMeta = (authRecord.user.app_metadata ?? {}) as Record<string, unknown>;
  const { error: claimError } = await admin.auth.admin.updateUserById(target.id, {
    app_metadata: {
      ...currentMeta,
      tenant_id: target.tenant_id,
      role: target.role,
      account_active: active,
      deactivated_at: active ? null : new Date(now()).toISOString(),
    },
    ban_duration: active ? ("none" as const) : "876000h",
  });
  if (claimError) {
    await admin.from("profiles").update({ is_active: target.is_active }).eq("id", target.id).eq("tenant_id", target.tenant_id);
    return { error: "Kimlik durumu güncellenemedi; değişiklik geri alındı." };
  }

  if (!active) {
    const { error: revokeError } = await admin.rpc("revoke_team_member_sessions", {
      p_user_id: target.id,
      p_tenant_id: target.tenant_id,
    });
    if (revokeError) console.error("platform member session revoke", { id: target.id, error: revokeError.message });
  }

  await logPlatformActivity({
    actorId: staffId,
    action: active ? "platform_member.activate" : "platform_member.deactivate",
    entityType: "profile",
    entityId: target.id,
    meta: { tenant_id: target.tenant_id, role: target.role, ...(via !== "single" ? { via } : {}) },
  });
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
  const res = await applyMemberActive(admin, target, active, gate.staff.id, String(fd.get("via") ?? "") === "handoff" ? "handoff" : "single");
  if (res.error) return res;

  revalidatePath(`/admin/members/${id}`);
  revalidatePath("/admin/members");
  return { ok: true };
}

/**
 * Tüm açık oturumları kapat (parola/cihaz kaybı, şüpheli giriş): süper admin ve operasyon + kritik işlem doğrulaması
 * (TOTP). Üye ayrıntısı ve Güvenlik & veri > Giriş güvenliği aynı eylemi kullanır; `reason` isteğe bağlı denetim notu.
 */
export async function signOutMemberSessions(fd: FormData): Promise<MemberActionResult> {
  const gate = await guardPlatformAction({ module: "members", roles: ["super_admin", "ops"], rate: RATE });
  if ("error" in gate) return { error: gate.error };
  const step = await requireStepUp(fd, "session_revoke", gate.staff.id);
  if (!step.ok) return { error: step.error };

  const id = String(fd.get("id") ?? "").trim();
  const reason = String(fd.get("reason") ?? "").trim().slice(0, 300) || null;
  const admin = createAdminClient();
  const target = await loadTarget(admin, id);
  if (!target) return { error: "Üye bulunamadı." };

  // Hassas işlem dört göz onayı (ayar açıksa): başka bir süper adminin onayı bu kullanıcı için bir kez tüketilir.
  const fourEyes = await sensitiveFourEyesGate({
    kind: "session_revoke",
    staffId: gate.staff.id,
    entityType: "profile",
    entityId: id,
    binding: { id },
    summary: `Tüm oturumları kapat: ${target.full_name}${reason ? ` · ${reason}` : ""}`,
  });
  if (!fourEyes.proceed) return "queued" in fourEyes ? { notice: fourEyes.notice } : { error: fourEyes.error };

  // revoke_team_member_sessions yalnız pasif üyede çalışır; aktif hesap için platform_revoke_user_sessions (migration 20260816010200).
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
    action: "platform_member.sessions_revoke",
    entityType: "profile",
    entityId: id,
    meta: {
      tenant_id: target.tenant_id,
      reason,
      via: String(fd.get("via") ?? "") === "giris-guvenligi" ? "giris_guvenligi" : "uye",
      ...(fourEyes.approvalId ? { four_eyes_approval_id: fourEyes.approvalId } : {}),
    },
  });
  revalidatePath(`/admin/members/${id}`);
  revalidatePath("/admin/giris-guvenligi");
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

  // Ofis 360 > Ekip "daveti yenile" aynı bağlantıyı üretir (hiç giriş yapmamış üye parolasını bununla belirler).
  const invite = String(fd.get("purpose") ?? "") === "invite";
  await logPlatformActivity({
    actorId: gate.staff.id,
    action: invite ? "platform_member.invite_renew" : "platform_member.reset_link",
    entityType: "profile",
    entityId: id,
    meta: { tenant_id: target.tenant_id },
  });
  return { ok: true, link };
}

// ---------------------------------------------------------------------------
// Toplu işlemler (liste sayfası seçimi): pasifleştirme ve oturum kapatma
// ---------------------------------------------------------------------------

export type BulkMemberResult = {
  ok?: boolean;
  error?: string;
  done?: number;
  failed?: { id: string; name: string; error: string }[];
};

/** Tek istekte en çok bu kadar üye (sayfa boyu 50; iki sayfa birlikte seçilebilir). */
const BULK_MAX = 100;
const BULK_RATE = { key: "platform-members-bulk", limit: 10, windowSec: 600 } as const;

function parseBulkIds(fd: FormData): string[] | { error: string } {
  const ids = Array.from(new Set(fd.getAll("ids").map((v) => String(v).trim()).filter(Boolean)));
  if (ids.length === 0) return { error: "En az bir üye seçin." };
  if (ids.length > BULK_MAX) return { error: `Tek işlemde en fazla ${BULK_MAX} üye seçilebilir.` };
  if (ids.some((id) => !UUID_RE.test(id))) return { error: "Seçimde geçersiz kimlik var." };
  return ids;
}

/** Sınırlı eşzamanlılık: auth yönetim uçlarını boğmadan 50 üyeyi birkaç saniyede bitirir. */
async function runPool<T>(items: T[], size: number, fn: (item: T) => Promise<void>): Promise<void> {
  let i = 0;
  const workers = Array.from({ length: Math.min(size, items.length) }, async () => {
    while (i < items.length) {
      const item = items[i++];
      await fn(item);
    }
  });
  await Promise.all(workers);
}

async function loadTargets(admin: ReturnType<typeof createAdminClient>, ids: string[]): Promise<Map<string, Target>> {
  const { data } = await admin.from("profiles").select("id, tenant_id, role, full_name, is_active").in("id", ids);
  return new Map(((data ?? []) as Target[]).map((t) => [t.id, t]));
}

/** Toplu pasifleştirme: süper admin ve operasyon. Her üye tekil kuralla (tek aktif sahip vb.) işlenir; kalanlar raporlanır. */
export async function bulkDeactivateMembers(fd: FormData): Promise<BulkMemberResult> {
  const gate = await guardPlatformAction({ module: "members", roles: ["super_admin", "ops"], rate: BULK_RATE });
  if ("error" in gate) return { error: gate.error };
  const ids = parseBulkIds(fd);
  if (!Array.isArray(ids)) return { error: ids.error };

  const admin = createAdminClient();
  const targets = await loadTargets(admin, ids);
  const failed: NonNullable<BulkMemberResult["failed"]> = [];
  let done = 0;
  // Aynı ofisin sahiplerini paralel işlemek "tek aktif sahip" sayımını yarıştırır: sahipler sırayla, kalanlar havuzda.
  const owners = ids.filter((id) => targets.get(id)?.role === "owner");
  const others = ids.filter((id) => targets.get(id)?.role !== "owner");
  const one = async (id: string) => {
    const target = targets.get(id);
    if (!target) {
      failed.push({ id, name: "—", error: "Üye bulunamadı." });
      return;
    }
    const res = await applyMemberActive(admin, target, false, gate.staff.id, "bulk");
    if (res.error) failed.push({ id, name: target.full_name, error: res.error });
    else done += 1;
  };
  await runPool(others, 5, one);
  for (const id of owners) await one(id);

  await logPlatformActivity({
    actorId: gate.staff.id,
    action: "platform_member.bulk_deactivate",
    entityType: "profile",
    meta: { requested: ids.length, done, failed: failed.map((f) => f.id) },
  });
  revalidatePath("/admin/members");
  return { ok: failed.length === 0, done, failed, ...(failed.length ? { error: `${failed.length} üye pasifleştirilemedi.` } : {}) };
}

/** Toplu oturum kapatma (ör. sızıntı şüphesi): süper admin ve operasyon. Aktif ve pasif hesaplarda çalışır. */
export async function bulkSignOutMembers(fd: FormData): Promise<BulkMemberResult> {
  const gate = await guardPlatformAction({ module: "members", roles: ["super_admin", "ops"], rate: BULK_RATE });
  if ("error" in gate) return { error: gate.error };
  const ids = parseBulkIds(fd);
  if (!Array.isArray(ids)) return { error: ids.error };
  // Dört göz açıkken toplu yolun onay kuyruğu yok: tek imzayla toplu oturum kapatılamaz (kontrol bu yoldan atlanmasın).
  if (await sensitiveBulkBlocked("session_revoke")) {
    return { error: "Oturum kapatmada dört göz onayı açık: toplu kapatma yapılamaz. Her hesap için üye ayrıntısından ya da Ofis oturumları ekranından onay talebi açın." };
  }

  const admin = createAdminClient();
  const targets = await loadTargets(admin, ids);
  const failed: NonNullable<BulkMemberResult["failed"]> = [];
  let done = 0;
  let missingFn = false;
  await runPool(ids, 10, async (id) => {
    const target = targets.get(id);
    if (!target) {
      failed.push({ id, name: "—", error: "Üye bulunamadı." });
      return;
    }
    const { error } = await admin.rpc("platform_revoke_user_sessions", { p_user_id: id });
    if (error) {
      if (/could not find|schema cache|PGRST202/i.test(error.message + (error.code ?? ""))) missingFn = true;
      failed.push({ id, name: target.full_name, error: actionErrorMessage(error, "Oturumlar kapatılamadı.") });
    } else done += 1;
  });
  if (missingFn) return { error: "Oturum kapatma veritabanı fonksiyonu henüz uygulanmamış (migration 20260816010200).", done, failed };

  await logPlatformActivity({
    actorId: gate.staff.id,
    action: "platform_member.bulk_sessions_revoke",
    entityType: "profile",
    meta: {
      requested: ids.length,
      done,
      failed: failed.map((f) => f.id),
      tenants: Array.from(new Set(Array.from(targets.values()).map((t) => t.tenant_id))),
    },
  });
  revalidatePath("/admin/members");
  return { ok: failed.length === 0, done, failed, ...(failed.length ? { error: `${failed.length} üyenin oturumları kapatılamadı.` } : {}) };
}
