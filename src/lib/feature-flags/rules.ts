import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { now } from "@/lib/clock";
import { isSchemaMissing } from "@/lib/platform-announcements/queue";
import type { FlagRule } from "./targeting";

/**
 * Hedefleme kuralı OKUYUCUSU (DG8): `feature_flag_rules` tek sorguda okunur, örnek başına 30 sn bellek önbelleği
 * (kural yazan eylem `resetFlagRulesCache` ile kendi örneğini hemen tazeler). Tablo yoksa ya da okunamazsa BOŞ
 * harita döner: bayraklar genel durumla çalışır (hedefleme yok, bugünkü davranış). Satır sayısı bayrak sayısıyla
 * sınırlıdır (bayrak başına tek satır; birincil anahtar), sayfalama gerekmez.
 */

const OK_TTL_MS = 30_000;
const FAIL_TTL_MS = 10_000;

type Row = {
  flag_key: string;
  tenant_ids: string[] | null;
  plans: string[] | null;
  percentage: number | null;
  starts_at: string | null;
  ends_at: string | null;
  note: string | null;
  updated_at?: string | null;
};

export type FlagRuleWithMeta = FlagRule & { updatedAt: string | null };

let cache: { at: number; ttl: number; rules: Map<string, FlagRuleWithMeta>; schemaReady: boolean } | null = null;

export function rowToFlagRule(r: Row): FlagRuleWithMeta {
  return {
    flagKey: r.flag_key,
    tenantIds: r.tenant_ids ?? [],
    plans: r.plans ?? [],
    percentage: Math.max(0, Math.min(100, Number(r.percentage ?? 0))),
    startsAt: r.starts_at,
    endsAt: r.ends_at,
    note: r.note,
    updatedAt: r.updated_at ?? null,
  };
}

/** Tüm kurallar (bayrak anahtarı → kural) + tablonun kurulu olup olmadığı. */
export async function loadFlagRules(): Promise<{ rules: Map<string, FlagRuleWithMeta>; schemaReady: boolean }> {
  const t = now();
  if (cache && t - cache.at < cache.ttl) return { rules: cache.rules, schemaReady: cache.schemaReady };
  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from("feature_flag_rules")
      .select("flag_key, tenant_ids, plans, percentage, starts_at, ends_at, note, updated_at")
      .order("flag_key");
    if (error) {
      const schemaReady = !isSchemaMissing(error);
      cache = { at: t, ttl: FAIL_TTL_MS, rules: new Map(), schemaReady };
      return { rules: cache.rules, schemaReady };
    }
    const rules = new Map(((data ?? []) as Row[]).map((r) => [r.flag_key, rowToFlagRule(r)] as const));
    cache = { at: t, ttl: OK_TTL_MS, rules, schemaReady: true };
    return { rules, schemaReady: true };
  } catch {
    cache = { at: t, ttl: FAIL_TTL_MS, rules: new Map(), schemaReady: true };
    return { rules: cache.rules, schemaReady: true };
  }
}

export function resetFlagRulesCache(): void {
  cache = null;
}

/** Kurallardaki ofis kimliklerinin adları (yönetim ekranı; kural başına en çok 500 ofis, parçalı okuma). */
export async function tenantNamesFor(ids: readonly string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const unique = [...new Set(ids)];
  if (unique.length === 0) return out;
  const admin = createAdminClient();
  for (let i = 0; i < unique.length; i += 200) {
    const { data } = await admin.from("tenants").select("id, name").in("id", unique.slice(i, i + 200));
    for (const t of (data ?? []) as { id: string; name: string }[]) out.set(t.id, t.name);
  }
  return out;
}
