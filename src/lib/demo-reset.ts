import type { SupabaseClient } from "@supabase/supabase-js";
import { DEMO_TENANT_SLUGS, isDemoTenantSlug } from "@/lib/demo-tenant";
import { refreshCallCenterDemo } from "@/lib/sample-data/call-center-demo";

/**
 * DEMO KİRACI GECE SIFIRLAMASI (YD1). `operational-retention` cron'unun ayrı adımı (`demoReset`); yeni cron yok.
 * Kiracı yalnız `tenants.slug` ile bulunur (`demo-tenant.ts`) ve her satırın slug'ı yeniden doğrulanır; asıl işi yapan
 * `demo_tenant_nightly_reset` fonksiyonu (migration 20261015041000) slug'ı KENDİSİ de denetler ve demo olmayan kiracıda
 * hata verir: gerçek kiracı iki ayrı kapıdan geçemez.
 * Yapılan: dış bağlantı yüzeyleri (API anahtarı, webhook, entegrasyon) silinir; tabandan sonra eklenen iş kayıtları
 * silinir. Tohum kayıtlarındaki düzenlemeler geri alınmaz (tam dönüş `npm run seed:demo`; taban orada yenilenir).
 * İstemci ÇAĞIRANDAN gelir (cron'un tembel servis istemcisi); yeni createAdminClient kullanımı yoktur.
 */

const NOT_INSTALLED = new Set(["PGRST202", "42883", "PGRST205", "42P01"]);

export type DemoResetOutcome =
  | { skipped: "not_installed" | "no_demo_tenant" }
  | { tenants: number; results: Record<string, unknown> };

export async function runDemoNightlyReset(db: SupabaseClient, opts: { nowMs: number }): Promise<DemoResetOutcome> {
  const { data, error } = await db.from("tenants").select("id, slug").in("slug", [...DEMO_TENANT_SLUGS]);
  if (error) throw new Error(`demo tenant lookup failed: ${error.code}`);
  const targets = ((data ?? []) as { id: string; slug: string | null }[]).filter((t) => isDemoTenantSlug(t.slug));
  if (targets.length === 0) return { skipped: "no_demo_tenant" };

  const results: Record<string, unknown> = {};
  for (const t of targets) {
    const { data: result, error: rpcError } = await db.rpc("demo_tenant_nightly_reset", {
      p_tenant_id: t.id,
      p_now: new Date(opts.nowMs).toISOString(),
    });
    if (rpcError) {
      if (NOT_INSTALLED.has(rpcError.code ?? "")) return { skipped: "not_installed" };
      throw new Error(`demo reset failed: ${rpcError.code}`);
    }
    results[String(t.slug)] = result;
    // F2: sıfırlamadan HEMEN sonra çağrı merkezi kişisinin bugünü (bugün/dün aramaları, bugün vadeli görevler, sıcak müşteri)
    // sıfırlama anına göre yeniden yazılır; hata sıfırlamayı bozmaz (sonuçta ayrı anahtar).
    try {
      results[`${t.slug}:cagri-merkezi`] = await refreshCallCenterDemo(db, t.id, opts.nowMs);
    } catch (e) {
      results[`${t.slug}:cagri-merkezi`] = { error: e instanceof Error ? e.message : "bilinmeyen hata" };
    }
  }
  return { tenants: targets.length, results };
}
