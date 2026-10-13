import type { SupabaseClient } from "@supabase/supabase-js";
import { getPlanDefinition } from "@/lib/billing/plan-definitions";
import { planLimitErrorMessage } from "@/lib/billing/plan-limit-error";
import { getExtraSeats } from "@/lib/billing/seat-purchase";
import { ASSIGNABLE_ROLES, type TeamRole } from "@/lib/team/assignable-roles";

/**
 * Ekip üyesi açma ÇEKİRDEĞİ (sunucu). İki çağıranı vardır ve ikisi de kapıyı KENDİSİ geçer:
 *  - `createTeamMember` (actions/team.ts): oturumlu yönetici, requirePermission("team","edit") + rol sınırı;
 *  - kayıt sihirbazı (`signUp`): yeni ofisin kurucusu adına "Ekip daveti" adımı (kurucu = owner).
 * Burada yetki kapısı YOKTUR; yalnız veri doğrulaması (şube aynı ofiste mi, koltuk var mı) ve atomik yazma:
 * auth kullanıcısı → profil; profil yazılamazsa auth kullanıcısı silinir (sahipsiz hesap kalmaz).
 * `admin` çağıranın elindeki service_role istemcisidir (bu modül kendi istemcisini yaratmaz).
 */

export type ProvisionMemberInput = {
  tenantId: string;
  fullName: string;
  email: string;
  /** Saklama biçiminde telefon (parsePhoneStrict.stored) ya da boş. */
  phone: string;
  password: string;
  role: TeamRole;
  branchId: string;
};

export type ProvisionMemberResult = { ok: true; id: string } | { ok: false; error: string };

type Admin = Pick<SupabaseClient, "from" | "auth"> & Partial<Pick<SupabaseClient, "rpc">>;

/**
 * DB'nin etkin koltuk limiti (`effective_seat_limit`: plan limiti ofise özel istisnayla çözülür + satın alınmış ek).
 * Kapasite tetikleyicisiyle AYNI sayı; RPC yoksa/hata verirse null (çağıran plan + ek hesabına düşer).
 */
async function readDbSeatLimit(admin: Admin, tenantId: string): Promise<number | null> {
  try {
    if (typeof admin.rpc !== "function") return null;
    const { data, error } = await admin.rpc("effective_seat_limit", { p_tenant_id: tenantId });
    const n = Number(data);
    return !error && data != null && Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
  } catch {
    return null;
  }
}

export async function ensureBranchBelongsToTenant(
  admin: Admin,
  branchId: string,
  tenantId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!branchId) return { ok: true };
  const { data: branch, error } = await admin
    .from("branches")
    .select("id")
    .eq("id", branchId)
    .eq("tenant_id", tenantId)
    .eq("is_active", true)
    .maybeSingle();
  if (error || !branch) {
    return { ok: false, error: "Seçilen şube bu ofise ait değil veya aktif değil." };
  }
  return { ok: true };
}

export async function ensureSeatAvailable(
  admin: Admin,
  tenantId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const [{ data: tenant, error: tenantError }, { count, error: countError }] = await Promise.all([
    admin.from("tenants").select("plan, status").eq("id", tenantId).maybeSingle(),
    admin.from("profiles").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).eq("is_active", true),
  ]);
  if (tenantError || countError || !tenant) {
    return { ok: false, error: "Paket ve ekip kapasitesi doğrulanamadı." };
  }
  if (tenant.status === "suspended" || tenant.status === "cancelled") {
    return { ok: false, error: "Askıdaki veya iptal edilmiş ofise üye eklenemez." };
  }

  // Etkin limit = plan limiti + satın alınmış ek kullanıcı (sütun yoksa ek = 0, eski davranış) + ofise özel limit
  // istisnası (Ofis 360 > Abonelik). İstisna payı DB'den okunur (effective_seat_limit; tetikleyiciyle aynı sayı).
  const def = await getPlanDefinition(String(tenant.plan));
  const [extraSeats, dbLimit] = await Promise.all([getExtraSeats(admin as SupabaseClient, tenantId), readDbSeatLimit(admin, tenantId)]);
  const purchased = def.limits.seats + extraSeats;
  // İstisna payı (sabit değer plan limitinin altındaysa negatif olabilir); RPC yoksa 0.
  const overrideSeats = dbLimit == null ? 0 : dbLimit - purchased;
  // Paket kullanıcı tavanı (plans.ts PLAN_USER_CAPS): dahil + ek toplamı tavanı aşamaz. Tavanı zaten aşmış
  // eski ofis kilitlenmez; yalnız YENİ ekleme engellenir. Yönetici istisnası tavanın ÜSTÜNE eklenir (bilinçli karar).
  const planCap = def.maxSeats && def.maxSeats > 0 ? Math.max(def.maxSeats, def.limits.seats) : Number.POSITIVE_INFINITY;
  const cap = planCap + Math.max(0, overrideSeats);
  const limit = Math.max(1, Math.min(purchased, planCap) + overrideSeats);
  if (Number.isFinite(cap) && (count ?? 0) >= cap) {
    return {
      ok: false,
      error: `${def.name} paketinde en fazla ${cap} kullanıcı olabilir; tavana ulaştınız. Daha fazla kullanıcı için bir üst pakete geçin (/app/abonelik#paketler) veya bir üyeyi pasife alın.`,
    };
  }
  if ((count ?? 0) >= limit) {
    return {
      ok: false,
      error: `Paketiniz en fazla ${limit} aktif kullanıcı destekliyor. Koltuk ekleyin (Abonelik > Kullanıcı ekle: /app/abonelik#koltuk), paketi yükseltin veya bir üyeyi pasife alın.`,
    };
  }
  return { ok: true };
}

export async function provisionTeamMember(admin: Admin, input: ProvisionMemberInput): Promise<ProvisionMemberResult> {
  if (!ASSIGNABLE_ROLES.includes(input.role)) return { ok: false, error: "Geçerli bir rol seçin." };
  const branch = await ensureBranchBelongsToTenant(admin, input.branchId, input.tenantId);
  if (!branch.ok) return branch;
  const seat = await ensureSeatAvailable(admin, input.tenantId);
  if (!seat.ok) return seat;

  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email: input.email,
    password: input.password,
    email_confirm: true,
    user_metadata: { full_name: input.fullName, phone: input.phone },
    app_metadata: { tenant_id: input.tenantId, role: input.role },
  });

  if (createError || !created.user) {
    return {
      ok: false,
      error: createError?.message?.includes("already") ? "Bu e-posta zaten kayıtlı." : "Kullanıcı oluşturulamadı.",
    };
  }

  const { error: profileError } = await admin.from("profiles").insert({
    id: created.user.id,
    tenant_id: input.tenantId,
    full_name: input.fullName,
    phone: input.phone || null,
    role: input.role,
    branch_id: input.branchId || null,
  });

  if (profileError) {
    const planError = planLimitErrorMessage(profileError);
    await admin.auth.admin.deleteUser(created.user.id);
    if (planError) return { ok: false, error: planError };
    return { ok: false, error: "Profil oluşturulamadı." };
  }

  return { ok: true, id: created.user.id };
}
