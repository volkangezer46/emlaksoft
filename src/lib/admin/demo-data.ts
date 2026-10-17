import type { SupabaseClient } from "@supabase/supabase-js";
import { countSampleRecords, type SampleCountRow } from "@/lib/sample-clear";
import { isDemoTenantSlug } from "@/lib/demo-tenant";
import { sampleSeedDecision, type SampleLockState } from "@/lib/sample-data/lock";

/**
 * Ofis 360 > Demo verisi ve /admin/tenants/demo okuyucusu (platform; çağıranın service_role istemcisi — yeni
 * createAdminClient yok). Mod: "demo" (örnek veri yüklü), "real" (gerçek kullanımda), "public" (genel demo ofisi),
 * "empty" (örnek veri yok ve gerçek kullanıma da geçmemiş). Kilit ve yeniden yükleme uygunluğu DB kuralıyla aynı fonksiyondan.
 */

export type DemoMode = "demo" | "real" | "public" | "empty";

export type TenantDemoState = {
  mode: DemoMode;
  slug: string | null;
  seededAt: string | null;
  pack: string | null;
  clearedAt: string | null;
  realUseAt: string | null;
  overrideUntil: string | null;
  realRecords: number;
  rows: SampleCountRow[];
  total: number;
  locked: boolean;
  /** Süper admin yeniden yükleyebilir mi (gerçek kayıt yok, genel demo değil). */
  canReseed: boolean;
};

export function demoModeOf(t: { slug: string | null; seededAt: string | null; realUseAt: string | null; total: number }): DemoMode {
  if (isDemoTenantSlug(t.slug)) return "public";
  if (t.seededAt || t.total > 0) return "demo";
  if (t.realUseAt) return "real";
  return "empty";
}

export async function loadTenantDemoState(admin: SupabaseClient, tenantId: string, nowMs: number): Promise<TenantDemoState> {
  const [{ data: t }, counts, real] = await Promise.all([
    admin
      .from("tenants")
      .select("slug, sample_seeded_at, sample_pack, sample_cleared_at, real_use_at, sample_seed_override_until")
      .eq("id", tenantId)
      .maybeSingle(),
    countSampleRecords(admin, tenantId),
    admin.rpc("tenant_real_record_count", { p_tenant_id: tenantId }),
  ]);
  const row = (t ?? {}) as Record<string, string | null>;
  const realRecords = real.error ? 0 : Number(real.data ?? 0) || 0;
  const lock: SampleLockState = {
    realUseAt: row.real_use_at ?? null,
    overrideUntil: row.sample_seed_override_until ?? null,
    realRecords,
    isDemoTenant: isDemoTenantSlug(row.slug),
  };
  const decision = sampleSeedDecision(lock, nowMs);
  return {
    mode: demoModeOf({ slug: row.slug ?? null, seededAt: row.sample_seeded_at ?? null, realUseAt: row.real_use_at ?? null, total: counts.total }),
    slug: row.slug ?? null,
    seededAt: row.sample_seeded_at ?? null,
    pack: row.sample_pack ?? null,
    clearedAt: row.sample_cleared_at ?? null,
    realUseAt: row.real_use_at ?? null,
    overrideUntil: row.sample_seed_override_until ?? null,
    realRecords,
    rows: counts.rows,
    total: counts.total,
    locked: !decision.allowed,
    canReseed: !lock.isDemoTenant && realRecords === 0,
  };
}
