import "server-only";
import { cache } from "react";
import { countInsightsByState, getInsightsForUser } from "@/lib/insights/read";
import type { Insight } from "@/lib/insights/types";
import type { HomeCtx } from "./data";

/**
 * Ana ekranın içgörü verisi: TEK okuyucu (`getInsightsForUser`) üzerinden, aynı istekte bir kez (cache).
 * Okuyucu asla fırlatmaz; tablo yok / rol içgörü almıyor / örnek veri → boş dizi → ana ekran kural tabanlı
 * geri dönüşe (SiradakiEylem) düşer. Burada içgörü ÜRETİLMEZ.
 */
export const INSIGHT_FETCH_LIMIT = 8;

export type InsightBundle = { insights: Insight[]; total: number };

export const loadInsightBundle = cache(async (ctx: HomeCtx): Promise<InsightBundle> => {
  if (!ctx.tenantId) return { insights: [], total: 0 };
  const args = { tenantId: ctx.tenantId, userId: ctx.userId, role: ctx.role };
  const [insights, counts] = await Promise.all([
    getInsightsForUser({ ...args, limit: INSIGHT_FETCH_LIMIT }),
    countInsightsByState(args),
  ]);
  return { insights, total: Math.max(insights.length, counts.new + counts.seen) };
});
