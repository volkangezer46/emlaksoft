import type { SupabaseClient } from "@supabase/supabase-js";
import { DEFAULT_INSIGHT_SETTINGS, ruleBase, type InsightSettings } from "@/lib/insights/types";

/**
 * İçgörü ofis ayarları: AYRI TABLO AÇILMAZ; `oversight_settings.thresholds` jsonb'sinin `insights` alanında durur
 * (alan yoksa varsayılan: hiçbir kural sessiz değil, LLM anlatımı KAPALI). Yazma yalnız owner/gm
 * (oversight_settings RLS'i + insights action'ı).
 */

const MAX_MUTED = 40;
const RULE_TOKEN = /^[a-z0-9_]{3,40}(@\d{1,3})?$/;

/** Ham jsonb → güvenli ayar. Bozuk/eksik alan varsayılana düşer. */
export function normalizeInsightSettings(raw: unknown): InsightSettings {
  const src = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const muted = Array.isArray(src.mutedRules)
    ? [...new Set(src.mutedRules.filter((x): x is string => typeof x === "string" && RULE_TOKEN.test(x)))].slice(0, MAX_MUTED)
    : [];
  return {
    mutedRules: muted,
    narrativeEnabled: src.narrativeEnabled === true,
  };
}

/** Kural sessize alınmış mı? Hem tam kimlik ("deal_risk@1") hem taban ad ("deal_risk") eşleşir. */
export function isRuleMuted(settings: InsightSettings, ruleId: string): boolean {
  const base = ruleBase(ruleId);
  return settings.mutedRules.some((m) => m === ruleId || m === base || ruleBase(m) === base);
}

/** Ayar okuma: tablo/satır yoksa ya da hata varsa varsayılan döner (asla fırlatmaz). */
export async function loadInsightSettings(client: SupabaseClient, tenantId: string): Promise<InsightSettings> {
  try {
    const { data, error } = await client.from("oversight_settings").select("thresholds").eq("tenant_id", tenantId).maybeSingle();
    if (error || !data) return DEFAULT_INSIGHT_SETTINGS;
    const thresholds = (data as { thresholds?: unknown }).thresholds;
    const insights = thresholds && typeof thresholds === "object" ? (thresholds as Record<string, unknown>).insights : undefined;
    return normalizeInsightSettings(insights);
  } catch {
    return DEFAULT_INSIGHT_SETTINGS;
  }
}
