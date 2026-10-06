import { buildDedupeKey, dayPeriod } from "@/lib/insights/dedupe";
import type { InsightDraft, InsightKind, InsightSeverity } from "@/lib/insights/types";
import { dayMs } from "@/lib/insights/rules/common";

/**
 * Kural: digest — kullanıcının AÇIK içgörülerinin günlük sentezi (kural metni; LLM anlatımı opsiyonel ve ayrı,
 * bkz. lib/ai/insight-narrative.ts). Diğer kurallar çalıştıktan SONRA, kullanıcı başına bir kez üretilir.
 *
 * Eşik: en az MIN_ITEMS içgörü yoksa üretilmez (tek maddelik "özet" boş vaattir).
 */

export const DIGEST_RULE_ID = "digest@1";
export const DIGEST_MIN_ITEMS = 3;

const KIND_TR: Record<InsightKind, string> = {
  call_priority: "aranacak müşteri",
  deal_risk: "riskli anlaşma",
  price_action: "fiyat gözden geçirme",
  match_suggestion: "eşleşme önerisi",
  anomaly: "anormallik gözlemi",
  forecast: "tahmin",
  compliance: "uyum uyarısı",
  deadline: "yaklaşan son tarih",
  digest: "özet",
};

export type DigestInputItem = { kind: InsightKind; severity: InsightSeverity };

export function buildDigestDraft(args: { userId: string; items: readonly DigestInputItem[]; nowMs: number }): InsightDraft | null {
  const items = args.items.filter((i) => i.kind !== "digest");
  if (items.length < DIGEST_MIN_ITEMS) return null;

  const high = items.filter((i) => i.severity === "yuksek").length;
  const mid = items.filter((i) => i.severity === "orta").length;
  const byKind = new Map<InsightKind, number>();
  for (const i of items) byKind.set(i.kind, (byKind.get(i.kind) ?? 0) + 1);
  const kinds = [...byKind.entries()].sort((a, b) => b[1] - a[1]);
  const kindText = kinds.map(([k, n]) => `${n} ${KIND_TR[k]}`).join(", ");

  const sevParts: string[] = [];
  if (high) sevParts.push(`${high} yüksek`);
  if (mid) sevParts.push(`${mid} orta`);
  const sevText = sevParts.length ? ` (${sevParts.join(", ")} öncelikli)` : "";

  return {
    kind: "digest",
    ruleId: DIGEST_RULE_ID,
    severity: "bilgi",
    title: `Bugün sizin için ${items.length} öneri var`,
    why: `${kindText}${sevText}. Üstteki maddelerden başlayın; her madde kendi kanıtını gösterir.`,
    evidence: kinds.map(([k, n]) => ({ label: KIND_TR[k], value: String(n) })),
    href: "/app",
    entityType: null,
    entityId: null,
    isForecast: false,
    confidence: null,
    dedupeKey: buildDedupeKey("digest", "gun", dayPeriod(args.nowMs)),
    validUntilMs: args.nowMs + dayMs(1),
    audience: { type: "user", userId: args.userId },
    urgencyDays: null,
    impact: 0,
  };
}
