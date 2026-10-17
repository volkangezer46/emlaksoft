import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { getPlatformUsage } from "@/lib/ai/credits/usage";
import { buildLimitRows, type CapUsageRow, type LimitRow } from "./limits";

/**
 * Paket limitleri okuyucusu (SUNUCU, service_role; sayfa `requirePlatformModule("tenants")` kapısından SONRA çağrılır).
 * Ofisin müşteri/portföy verisi okunmaz, yalnız SAYI ve etkin limit döner. Kaynak okunamazsa ilgili bölüm `ready: false`.
 */

export type LimitsData = {
  capsReady: boolean;
  quotasReady: boolean;
  rows: LimitRow[];
  names: Map<string, { name: string; plan: string | null }>;
  monthKey: string;
  quotasTruncated: boolean;
};

const NAME_CHUNK = 200;

export async function loadLimits(minPct: number): Promise<LimitsData> {
  const admin = createAdminClient();
  const [caps, usage] = await Promise.all([
    admin.rpc("platform_tenant_limit_usage", { p_tenant_ids: null, p_min_ratio: Math.max(0, minPct) / 100 }),
    getPlatformUsage(),
  ]);
  const capRows = caps.error ? [] : ((caps.data ?? []) as CapUsageRow[]);
  const rows = buildLimitRows(capRows, usage.enabled ? usage.rows : [], minPct);

  const ids = [...new Set(rows.map((r) => r.tenantId))];
  const names = new Map<string, { name: string; plan: string | null }>();
  for (let i = 0; i < ids.length; i += NAME_CHUNK) {
    const { data } = await admin.from("tenants").select("id, name, plan").in("id", ids.slice(i, i + NAME_CHUNK));
    for (const t of (data ?? []) as { id: string; name: string | null; plan: string | null }[]) names.set(t.id, { name: t.name ?? "Ofis", plan: t.plan });
  }
  return { capsReady: !caps.error, quotasReady: usage.enabled, rows, names, monthKey: usage.monthKey, quotasTruncated: usage.truncated };
}
