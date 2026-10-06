/**
 * EMLAKFİYATI AGREGAT VERİ HAZIRLIĞI (SAF; DIŞ AKTARIM YOK). Kaynak: `control_market_signals_v` (yalnız service_role).
 * Çıktıda ilan kodu, adres, malik, danışman, OFİS KİMLİĞİ yoktur. Her hücrede asgari k ilan (varsayılan 5) ve isteğe
 * bağlı asgari ofis sayısı aranır; altındaki hücre ATILIR (k-anonimlik). Gerçek aktarım yalnız
 * `src/lib/integrations/emlakfiyati/adapter.ts` üzerinden, sözleşme + KVKK onayı ve ofis bazlı opt-in sonrası yapılır
 * (HAFIZA §6b/ROADMAP P2: karşı taraf şeması yok) — bu dosya aktarım YAPMAZ.
 */

export type MarketSignalRow = {
  tenantId: string;
  districtId: string | null;
  propertyType: string;
  transactionType: string;
  publishedMonth: string;
  publishedDays: number;
  priceChangeCount: number;
  priceDeltaPct: number | null;
  outcome: "sold" | "rented" | "open_or_exited";
  daysToOutcome: number | null;
};

export type MarketSignalCell = {
  districtId: string | null;
  propertyType: string;
  transactionType: string;
  publishedMonth: string;
  listings: number;
  medianPublishedDays: number;
  avgPriceChangeCount: number;
  /** Fiyat değişimi bandı dağılımı (kaldırıldığı fiyatın ilk fiyata göre sapması). */
  priceDeltaBands: Record<"down_over_10" | "down_0_10" | "flat" | "up_0_10" | "up_over_10", number>;
  closedCount: number;
  medianDaysToOutcome: number | null;
};

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
}

function band(delta: number | null): keyof MarketSignalCell["priceDeltaBands"] | null {
  if (delta === null) return null;
  if (delta <= -10) return "down_over_10";
  if (delta < -0.5) return "down_0_10";
  if (delta <= 0.5) return "flat";
  if (delta < 10) return "up_0_10";
  return "up_over_10";
}

export function aggregateMarketSignals(
  rows: readonly MarketSignalRow[],
  opts: { k?: number; minTenants?: number; optedInTenantIds?: ReadonlySet<string> } = {},
): MarketSignalCell[] {
  const k = Math.max(opts.k ?? 5, 2);
  const minTenants = Math.max(opts.minTenants ?? 1, 1);
  const groups = new Map<string, MarketSignalRow[]>();
  for (const r of rows) {
    if (opts.optedInTenantIds && !opts.optedInTenantIds.has(r.tenantId)) continue;
    const key = [r.districtId ?? "-", r.propertyType, r.transactionType, r.publishedMonth].join("|");
    const g = groups.get(key);
    if (g) g.push(r);
    else groups.set(key, [r]);
  }
  const cells: MarketSignalCell[] = [];
  for (const g of groups.values()) {
    if (g.length < k || new Set(g.map((r) => r.tenantId)).size < minTenants) continue;
    const bands: MarketSignalCell["priceDeltaBands"] = { down_over_10: 0, down_0_10: 0, flat: 0, up_0_10: 0, up_over_10: 0 };
    for (const r of g) {
      const b = band(r.priceDeltaPct);
      if (b) bands[b] += 1;
    }
    const closed = g.filter((r) => r.outcome !== "open_or_exited" && r.daysToOutcome !== null);
    cells.push({
      districtId: g[0].districtId,
      propertyType: g[0].propertyType,
      transactionType: g[0].transactionType,
      publishedMonth: g[0].publishedMonth,
      listings: g.length,
      medianPublishedDays: median(g.map((r) => r.publishedDays)),
      avgPriceChangeCount: Math.round((g.reduce((s, r) => s + r.priceChangeCount, 0) / g.length) * 10) / 10,
      priceDeltaBands: bands,
      closedCount: closed.length,
      medianDaysToOutcome: closed.length >= k ? median(closed.map((r) => r.daysToOutcome as number)) : null,
    });
  }
  return cells;
}
