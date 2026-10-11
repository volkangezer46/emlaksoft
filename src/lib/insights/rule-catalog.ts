import type { SupabaseClient } from "@supabase/supabase-js";
import { DAY_MS } from "@/lib/clock";
import { fetchAllRowsKeepError } from "@/lib/supabase/fetch-all";
import { isMissingSchemaError } from "@/lib/insights/facts";
import { qualitySuppressedRules, type RuleQualityRow } from "@/lib/insights/quality";
import { isQualityReopened, isRuleMuted } from "@/lib/insights/settings";
import { ruleBase, type InsightSettings } from "@/lib/insights/types";

/**
 * Ofis ayarlarındaki "Öneriler" kartının veri katmanı (SAF çekirdek + ince okuyucu).
 * Kural adları KOPYALANMAZ: `INSIGHT_RULES` kayıt listesindeki `label` alanından gelir.
 */

export type RuleCatalogItem = { id: string; base: string; label: string };

/** Günlük özet kuralı kayıt listesinde değil (post kural); ofis ayarından yine kapatılabilir. */
export const DIGEST_CATALOG_LABEL = "Günlük özet (tüm önerileri tek kartta toplar)";

/** Kayıt listesinden Türkçe adlı kural kataloğu (dinamik import: ağır kural modülleri sayfa paketine girmez). */
export async function listInsightRuleCatalog(): Promise<RuleCatalogItem[]> {
  const { INSIGHT_RULES, DIGEST_RULE_ID } = await import("@/lib/insights/rules");
  const items = INSIGHT_RULES.map((r) => ({ id: r.id, base: ruleBase(r.id), label: r.label }));
  return [...items, { id: DIGEST_RULE_ID, base: ruleBase(DIGEST_RULE_ID), label: DIGEST_CATALOG_LABEL }];
}

/** Anahtarın durumu: açık, elle kapalı ya da yanlış alarm oranı yüzünden otomatik sessizde. */
export type RuleSwitchState = "on" | "off" | "auto";

/**
 * SAF: bir kuralın kullanıcıya görünen durumu. Elle kapatma her zaman önceliklidir; otomatik sessiz yalnız
 * sahibi "Yeniden aç" dememişse geçerlidir (engine ile AYNI kural).
 */
export function ruleSwitchState(settings: InsightSettings, autoMutedBases: ReadonlySet<string>, ruleId: string): RuleSwitchState {
  if (isRuleMuted(settings, ruleId)) return "off";
  if (autoMutedBases.has(ruleBase(ruleId)) && !isQualityReopened(settings, ruleId)) return "auto";
  return "on";
}

/** SAF: kapalı kural sayısı (elle kapalı + otomatik sessiz). */
export function countClosedRules(states: readonly RuleSwitchState[]): number {
  return states.filter((s) => s !== "on").length;
}

/** SAF: reviewed satırlarından (accepted/dismissed + neden) kural bazlı kalite satırları. */
export function aggregateRuleQuality(rows: readonly { rule_id: string; state: string; state_reason: string | null }[]): RuleQualityRow[] {
  const map = new Map<string, RuleQualityRow>();
  for (const r of rows) {
    const cur = map.get(r.rule_id) ?? { ruleId: r.rule_id, accepted: 0, dismissed: 0, dismissedWrong: 0 };
    if (r.state === "accepted") cur.accepted += 1;
    else if (r.state === "dismissed") {
      cur.dismissed += 1;
      if (r.state_reason === "yanlis") cur.dismissedWrong += 1;
    }
    map.set(r.rule_id, cur);
  }
  return [...map.values()];
}

/**
 * Otomatik sessize alınan kural taban adları. `insight_rule_quality` görünümü yalnız service_role okur; ekran RLS'li
 * oturumla çalıştığından aynı tanım (son 90 gün, kabul/yoksay) doğrudan `insights` satırlarından hesaplanır
 * (owner/gm ofisin tüm satırlarını okur). Eşik/karar `qualitySuppressedRules` ile motorla BİREBİR aynıdır.
 * Okunamazsa boş küme (kart "otomatik sessiz" rozeti göstermez; yanlış rozet yok).
 */
export async function loadAutoMutedRuleBases(client: SupabaseClient, tenantId: string, nowMs: number): Promise<Set<string>> {
  const since = new Date(nowMs - 90 * DAY_MS).toISOString();
  const { data, error } = await fetchAllRowsKeepError((from, to) =>
    client
      .from("insights")
      .select("rule_id, state, state_reason")
      .eq("tenant_id", tenantId)
      .in("state", ["accepted", "dismissed"])
      .gte("created_at", since)
      .order("id", { ascending: true })
      .range(from, to),
  );
  if (error) {
    if (!isMissingSchemaError(error)) console.error("loadAutoMutedRuleBases", error.code ?? "hata");
    return new Set();
  }
  return qualitySuppressedRules(aggregateRuleQuality(data as { rule_id: string; state: string; state_reason: string | null }[]));
}
