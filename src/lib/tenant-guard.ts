import { createClient } from "@/lib/supabase/server";
import { getPlatformStaff } from "@/lib/platform";

export type ActiveTenantResult =
  | { ok: true; userId: string; tenantId: string }
  | { ok: false; error: string };

const BLOCKED = new Set(["suspended", "cancelled"]);

/**
 * Server actions için: askıdaki / iptal tenant yazma işlemlerini engeller.
 * Platform staff kendi ofisi askıdaysa bile ops amaçlı geçebilir.
 */
export async function requireActiveTenant(): Promise<ActiveTenantResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Oturum bulunamadı." };

  const tenantId = (user.app_metadata?.tenant_id as string | undefined) ?? null;
  if (!tenantId) return { ok: false, error: "Ofis bilgisi bulunamadı." };

  const staff = await getPlatformStaff();
  if (staff) return { ok: true, userId: user.id, tenantId };

  const { data: tenant } = await supabase
    .from("tenants")
    .select("status")
    .eq("id", tenantId)
    .maybeSingle();

  if (!tenant) return { ok: false, error: "Ofis bulunamadı." };
  if (BLOCKED.has(tenant.status)) {
    return { ok: false, error: "Hesap askıda veya iptal. Bu işlem yapılamaz." };
  }

  return { ok: true, userId: user.id, tenantId };
}
