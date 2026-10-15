import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { readTenantSettings } from "@/lib/settings/tenant-read";
import { LEAD_ALLOWED_ORIGINS_KEY, parseLeadOriginsStored } from "@/lib/lead-origins";

/**
 * Talep formu token'ının ofisine ait `lead.allowed_origins` listesi (public uç nokta; oturum yok). Ofis kimliği yalnız
 * token'dan çözülür (`tenants.lead_capture_token`), ayar yalnız o ofisin satırından okunur. Bulunamaz/okunamazsa boş
 * liste: ek CORS izni verilmez (güvenli taraf). Çağıran token biçimini önceden doğrular.
 */
export async function loadTenantLeadOrigins(token: string): Promise<string[]> {
  try {
    const admin = createAdminClient();
    const { data: tenant, error } = await admin.from("tenants").select("id").eq("lead_capture_token", token).maybeSingle();
    if (error || !tenant?.id) return [];
    const values = await readTenantSettings(admin, String(tenant.id), [LEAD_ALLOWED_ORIGINS_KEY]);
    const raw = values[LEAD_ALLOWED_ORIGINS_KEY];
    return parseLeadOriginsStored(typeof raw === "string" ? raw : null);
  } catch {
    return [];
  }
}
