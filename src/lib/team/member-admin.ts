import { createAdminClient } from "@/lib/supabase/admin";
import { requirePermission } from "@/lib/require-permission";
import { canManageRole, MANAGER_ROLES, type TeamRole } from "@/lib/team/assignable-roles";

/**
 * Üye yönetimi ortak kapısı (ofis sahibi / GM / şube müdürü). Hedef aynı ofiste olmalı,
 * `canManageRole` tek kaynağından geçmeli; ofis sahibi ve kişinin kendisi bu akıştan düzenlenmez
 * (kendisi için /app/hesabim). Sunucuya özel — istemciden import edilmez.
 */
export type MemberTarget = {
  id: string;
  tenant_id: string;
  role: string;
  is_active: boolean;
  full_name: string;
  phone: string | null;
  title: string | null;
};

export type MemberGate =
  | { ok: true; tenantId: string; actorId: string; actorRole: string; target: MemberTarget }
  | { ok: false; error: string };

export async function authorizeMemberManagement(targetId: string): Promise<MemberGate> {
  const gate = await requirePermission("team", "edit");
  if (!gate.ok) return { ok: false, error: gate.error };
  if (gate.impersonating) return { ok: false, error: "Destek oturumunda üye düzenlenemez." };
  if (!MANAGER_ROLES.includes(gate.role as TeamRole)) {
    return { ok: false, error: "Bu işlem için yetkiniz yok." };
  }
  if (!targetId) return { ok: false, error: "Üye bulunamadı." };
  if (targetId === gate.userId) {
    return { ok: false, error: "Kendi bilgilerinizi Hesabım sayfasından düzenleyin." };
  }

  const admin = createAdminClient();
  const { data: target } = await admin
    .from("profiles")
    .select("id, tenant_id, role, is_active, full_name, phone, title")
    .eq("id", targetId)
    .eq("tenant_id", gate.tenantId)
    .maybeSingle();
  if (!target) return { ok: false, error: "Üye bu ofise ait değil." };
  if (target.role === "owner") return { ok: false, error: "Ofis sahibi bu ekrandan düzenlenemez." };
  if (!canManageRole(gate.role, target.role)) {
    return { ok: false, error: "Bu üyeyi yönetme yetkiniz yok." };
  }
  return {
    ok: true,
    tenantId: gate.tenantId,
    actorId: gate.userId,
    actorRole: gate.role,
    target: target as MemberTarget,
  };
}

export type MemberAccessInfo = {
  email: string | null;
  lastSignInAt: string | null;
  createdAt: string | null;
  neverSignedIn: boolean;
};

/** Üyenin giriş bilgisi (e-posta auth'ta tutulur). Çağıran önce yetki/kapsam kapısını geçmiş olmalıdır. */
export async function loadMemberAccess(tenantId: string, memberId: string): Promise<MemberAccessInfo | null> {
  const admin = createAdminClient();
  const { data: profile } = await admin
    .from("profiles")
    .select("id")
    .eq("id", memberId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (!profile) return null;
  const { data } = await admin.auth.admin.getUserById(memberId);
  const u = data?.user;
  if (!u) return null;
  return {
    email: u.email ?? null,
    lastSignInAt: u.last_sign_in_at ?? null,
    createdAt: u.created_at ?? null,
    neverSignedIn: !u.last_sign_in_at,
  };
}
