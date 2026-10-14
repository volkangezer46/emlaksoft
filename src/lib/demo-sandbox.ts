import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { now } from "@/lib/clock";
import { DEMO_TENANT_SLUGS } from "@/lib/demo-tenant";

/**
 * DEMO GÖNDERİM SANDBOX'I (YD1). Demo kiracının kartları herkese açık olduğundan oradan dışarıya HİÇBİR gerçek çağrı
 * gitmez: SMS/WhatsApp (`message-log.ts` sarmalayıcıları), e-posta (`email/send.ts`), ekip daveti / erişim bağlantısı
 * (GoTrue e-postası), kampanya (aynı SMS/WhatsApp sarmalayıcısı), webhook ve API anahtarı (`integrations-api`).
 * Sağlayıcı çağrılmaz; gönderim günlüğüne "demo: gönderilmedi" satırı düşer (sahte başarı yok).
 *
 * Demo kiracı kimliği `tenants.slug` ile (bkz. `demo-tenant.ts`) çözülür ve süreç içinde kısa süre önbelleklenir
 * (her gönderimde ek sorgu yok). Okuma hatasında boş küme döner: gerçek kiracının gönderimi demo kontrolü yüzünden
 * DURMAZ; hata kayda geçer ve bir sonraki çağrı yeniden dener (hatalı sonuç önbelleğe yazılmaz).
 */

const TTL_MS = 5 * 60_000;
let cache: { ids: ReadonlySet<string>; at: number } | null = null;

/** Yalnız testler: süreç önbelleğini boşaltır. */
export function resetDemoTenantCache(): void {
  cache = null;
}

export async function loadDemoTenantIds(client?: SupabaseClient | null): Promise<ReadonlySet<string>> {
  const t = now();
  if (cache && t - cache.at < TTL_MS) return cache.ids;
  try {
    const admin = client ?? createAdminClient();
    const { data, error } = await admin.from("tenants").select("id").in("slug", [...DEMO_TENANT_SLUGS]);
    if (error) {
      console.error("[demo-sandbox] demo tenant lookup failed", { code: error.code });
      return new Set();
    }
    const ids = new Set(((data ?? []) as { id: string }[]).map((r) => String(r.id)));
    cache = { ids, at: t };
    return ids;
  } catch {
    return new Set(); // ortam eksik (test/önizleme)
  }
}

/** Kiracı demo kiracısı mı? Kimliksiz (platform hesabı) gönderim demo değildir. */
export async function isDemoTenantId(tenantId: string | null | undefined, client?: SupabaseClient | null): Promise<boolean> {
  if (!tenantId) return false;
  return (await loadDemoTenantIds(client)).has(tenantId);
}
