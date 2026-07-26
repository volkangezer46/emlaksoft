import { cache } from "react";
import { unstable_cache } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { getRequestUser } from "@/lib/supabase/auth-cache";

export type DefinitionCategory =
  | "customer_type"
  | "customer_source"
  | "property_type"
  | "transaction_type"
  | "contract_type"
  | "expense_category"
  | "appointment_type"
  | "demand_urgency"
  | "ticket_category";

export type DefinitionItem = { value: string; label: string; color: string | null };

/** Tanım cache'ini tümden düşürmek için ortak etiket; tenant'a özel: `definitions:<tenantId>`. */
export const DEFINITIONS_CACHE_TAG = "definitions";
const DEFINITIONS_TTL_SECONDS = 300; // 5 dk — tanım düzenlemesi nadir, gecikme toleransı yüksek

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * RLS eşleniği sorgu: global (tenant_id null) + ofisin kendi tanımları.
 * `unstable_cache` içinde cookie/oturum okunamayacağı için admin client +
 * açık tenant filtresi kullanılır (office-score.ts'teki desenle aynı).
 */
async function loadDefinitions(
  tenantId: string | null,
  category: DefinitionCategory,
): Promise<DefinitionItem[]> {
  const admin = createAdminClient();
  let query = admin
    .from("definitions")
    .select("value, label, color, sort_order, tenant_id, is_active")
    .eq("category", category)
    .eq("is_active", true)
    .order("sort_order", { ascending: true });
  // tenantId UUID_RE'den geçmiş durumda; or() dizgesine güvenle gömülebilir.
  query = tenantId ? query.or(`tenant_id.is.null,tenant_id.eq.${tenantId}`) : query.is("tenant_id", null);

  const { data } = await query;

  const rows = data ?? [];
  // Aynı value için ofis tanımı (tenant_id dolu) global'i geçersiz kılsın
  const byValue = new Map<string, { value: string; label: string; color: string | null; sort: number; tenantScoped: boolean }>();
  for (const r of rows) {
    const existing = byValue.get(r.value);
    const tenantScoped = r.tenant_id != null;
    if (!existing || (tenantScoped && !existing.tenantScoped)) {
      byValue.set(r.value, { value: r.value, label: r.label, color: r.color ?? null, sort: r.sort_order ?? 0, tenantScoped });
    }
  }
  return [...byValue.values()]
    .sort((a, b) => a.sort - b.sort)
    .map(({ value, label, color }) => ({ value, label, color }));
}

/**
 * Navigasyonlar arası cache'li tanım listesi (tenant + kategori başına, 5 dk).
 * Cache anahtarı tenantId içerdiğinden çapraz-ofis sızıntısı yoktur.
 * Yazma tarafı invalidation: tanım action'ları `revalidateTag("definitions:<tenantId>")`
 * çağırmalı (bkz. src/app/actions/definitions.ts — nota bakın); çağırmasa bile
 * TTL dolunca kendiliğinden tazelenir.
 */
function getDefinitionsCached(tenantId: string | null, category: DefinitionCategory) {
  const scope = tenantId ?? "global";
  return unstable_cache(
    () => loadDefinitions(tenantId, category),
    ["definitions", scope, category],
    {
      revalidate: DEFINITIONS_TTL_SECONDS,
      tags: [DEFINITIONS_CACHE_TAG, `${DEFINITIONS_CACHE_TAG}:${scope}`],
    },
  )();
}

/**
 * Kategoriye göre tanımları döndürür. Ofis tanımı aynı value için global'i
 * override eder (eski RLS davranışıyla birebir). React `cache()` istek içi
 * tekrarları, `unstable_cache` istekler arası tekrarları keser.
 */
export const getDefinitions = cache(async (category: DefinitionCategory): Promise<DefinitionItem[]> => {
  const user = await getRequestUser();
  const raw = (user?.app_metadata?.tenant_id as string | undefined) ?? null;
  // UUID doğrulaması: hem PostgREST or() gramerini korur hem cache anahtarını temiz tutar.
  const tenantId = raw && UUID_RE.test(raw) ? raw : null;
  return getDefinitionsCached(tenantId, category);
});

/** Etiket eşleme haritası (value → label) — rozet/gösterim için pratik. */
export function toLabelMap(items: DefinitionItem[]): Record<string, string> {
  return Object.fromEntries(items.map((i) => [i.value, i.label]));
}
