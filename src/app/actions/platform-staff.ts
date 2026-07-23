"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { requirePlatformModule } from "@/lib/platform";
import { PLATFORM_ROLE_LABELS, type PlatformRole } from "@/lib/platform-access";
import { logPlatformActivity } from "@/lib/platform-activity";

const VALID_ROLES: PlatformRole[] = ["super_admin", "ops", "support", "billing"];

export type StaffActionResult = { ok?: boolean; error?: string };

/**
 * Yeni platform personeli ekle.
 * Supabase Auth'da kayıtlı bir e-posta gerektirir; kullanıcı auth.users'da varsa
 * platform_staff'a eklenir, yoksa davet linki gönderilir (auth.admin.inviteUserByEmail).
 */
export async function addPlatformStaff(fd: FormData): Promise<StaffActionResult> {
  const staff = await requirePlatformModule("personel");

  const email = (fd.get("email") as string | null)?.trim().toLowerCase();
  const fullName = (fd.get("full_name") as string | null)?.trim();
  const role = (fd.get("role") as PlatformRole | null) ?? "support";

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { error: "Geçerli bir e-posta adresi girin." };
  }
  if (!fullName) return { error: "Ad Soyad zorunludur." };
  if (!VALID_ROLES.includes(role)) return { error: "Geçersiz rol." };

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

  // Auth'da yok → davet e-postası gönder, ardından platform_staff'a taslak yaz
  const { data: invited, error: invErr } = await admin.auth.admin.inviteUserByEmail(email, {
    data: { full_name: fullName },
    redirectTo: `${process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"}/admin`,
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
    action: "platform_staff.invite",
    entityType: "platform_staff",
    entityId: invited.user.id,
    meta: { email, role },
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

export { PLATFORM_ROLE_LABELS };
