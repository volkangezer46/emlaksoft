import "server-only";
import { revalidatePath } from "next/cache";
import { actionErrorMessage } from "@/lib/action-errors";
import { planLimitErrorMessage } from "@/lib/billing/plan-limit-error";
import type { createAdminClient } from "@/lib/supabase/admin";

type AdminClient = ReturnType<typeof createAdminClient>;

/**
 * Paket/durum yazımının KAPISIZ çekirdeği (atomik `update_tenant_plan_subscription` RPC'si + önbellek tazeleme).
 * "use server" dosyasında DEĞİL: istemciden çağrılamaz. Yetki, gerekçe ve AD11 kod (step-up) kapısı çağıranındır:
 * `updateTenantPlanStatus` (doğrudan eylem), `setTenantLifecycleByAdmin`, `createTenantByAdmin` ve ofis kapatma talebi
 * (`processOfficeClosureRequestByAdmin`, kodu kendisi doğrular; ikinci kez kod istenmez).
 */
export async function applyTenantPlanStatus(
  admin: AdminClient,
  actorId: string,
  input: { id: string; plan?: string | null; status?: string | null },
): Promise<{ ok?: boolean; error?: string }> {
  const { data, error } = await admin.rpc("update_tenant_plan_subscription", {
    p_tenant_id: input.id,
    p_actor_id: actorId,
    p_plan: input.plan || null,
    p_status: input.status || null,
  });
  if (error) {
    console.error("updateTenantPlanStatus", error);
    return {
      error:
        planLimitErrorMessage(error) ??
        (error.code === "PGRST202"
          ? "Abonelik güncelleme servisi henüz hazır değil. Veritabanı migration'ını uygulayın."
          : actionErrorMessage(null, "Tenant ve abonelik güncellenemedi.")),
    };
  }

  revalidatePath("/admin");
  revalidatePath("/admin/tenants");
  revalidatePath("/admin/billing");
  revalidatePath("/vitrin/[slug]", "page");
  revalidatePath("/vitrin/[slug]/[id]", "page");
  revalidatePath("/vitrin/[slug]/degerleme", "page");
  revalidatePath("/vitrin/[slug]/favoriler", "page");
  revalidatePath("/danisman/[slug]", "page");
  revalidatePath("/sitemap.xml");
  const tenantSlug = data && typeof data === "object" && !Array.isArray(data)
    ? (data as Record<string, unknown>).tenantSlug
    : null;
  if (typeof tenantSlug === "string" && tenantSlug) {
    revalidatePath(`/vitrin/${tenantSlug}`);
  }
  return { ok: true };
}
