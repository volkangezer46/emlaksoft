import "server-only";
import { cache } from "react";
import { now } from "@/lib/clock";
import { countInsightsByState, getInsightsForUser, roleReceivesInsights } from "@/lib/insights/read";
import { selectReadable } from "@/lib/insights/readable";
import type { Insight } from "@/lib/insights/types";
import type { HomeCtx } from "./data";
import { loadDashboardSnapshot } from "./data-batch";

/**
 * Ana ekranın içgörü verisi: aynı istekte bir kez (cache). İki kaynak, aynı okunabilirlik kuralı (`selectReadable`):
 *  1. `get_insights_snapshot` RPC'si (tek tur, migration uygulandıysa) — satırlar + durum sayaçları,
 *  2. yoksa TEK okuyucu (`getInsightsForUser` + `countInsightsByState`).
 * Okuyucu asla fırlatmaz; tablo yok / rol içgörü almıyor / örnek veri → boş dizi → ana ekran kural tabanlı
 * geri dönüşe (SiradakiEylem) düşer. Burada içgörü ÜRETİLMEZ.
 */
export const INSIGHT_FETCH_LIMIT = 8;

export type InsightBundle = { insights: Insight[]; total: number };

export const loadInsightBundle = cache(async (ctx: HomeCtx): Promise<InsightBundle> => {
  if (!ctx.tenantId) return { insights: [], total: 0 };
  // Rol kuralı okuyucuyla aynı (readonly içgörü almaz): RPC yolunda da uygulanır.
  if (!roleReceivesInsights(ctx.role)) return { insights: [], total: 0 };
  const snap = (await loadDashboardSnapshot(ctx.tenantId, ctx.userId)).insights;
  if (snap) {
    const insights = selectReadable(snap.rows, now(), INSIGHT_FETCH_LIMIT);
    return { insights, total: Math.max(insights.length, snap.counts.new + snap.counts.seen) };
  }
  const args = { tenantId: ctx.tenantId, userId: ctx.userId, role: ctx.role };
  const [insights, counts] = await Promise.all([
    getInsightsForUser({ ...args, limit: INSIGHT_FETCH_LIMIT }),
    countInsightsByState(args),
  ]);
  return { insights, total: Math.max(insights.length, counts.new + counts.seen) };
});
