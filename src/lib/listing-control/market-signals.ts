/**
 * EMLAKFİYATI AGREGAT VERİ HAZIRLIĞI (SAF). Kaynak: `control_market_signals_v` (yalnız service_role).
 * Çıktıda ilan kodu, adres, malik, danışman, OFİS KİMLİĞİ yoktur. Her hücrede asgari k ilan (varsayılan 5) ve isteğe
 * bağlı asgari ofis sayısı aranır; altındaki hücre ATILIR (k-anonimlik). Yalnız ofis bazlı opt-in
 * (`office.market_data.share_enabled`) açık ofislerin satırları girer. Platform yöneticisi indirilebilir CSV/JSON alır
 * (`/admin/ef-kontor/piyasa-verisi`, okuyucu `market-export.ts`); EmlakFiyati'na OTOMATİK gönderim YOK (karşı taraf şeması yok,
 * HAFIZA §6b) — bu dosya ağ çağrısı YAPMAZ.
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

/** Görünüm satırı (snake_case) → saf girdi. Bozuk satır atılır. */
export function marketSignalRowFromView(r: Record<string, unknown>): MarketSignalRow | null {
  const tenantId = typeof r.tenant_id === "string" ? r.tenant_id : null;
  const month = typeof r.published_month === "string" ? r.published_month.slice(0, 7) : null;
  const outcome = r.outcome === "sold" || r.outcome === "rented" ? r.outcome : "open_or_exited";
  if (!tenantId || !month || typeof r.property_type !== "string" || typeof r.transaction_type !== "string") return null;
  const num = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number.isFinite(Number(v)) ? Number(v) : null);
  return {
    tenantId,
    districtId: typeof r.district_id === "string" ? r.district_id : null,
    propertyType: r.property_type,
    transactionType: r.transaction_type,
    publishedMonth: month,
    publishedDays: Math.max(0, num(r.published_days) ?? 0),
    priceChangeCount: Math.max(0, num(r.price_change_count) ?? 0),
    priceDeltaPct: num(r.price_delta_pct),
    outcome,
    daysToOutcome: num(r.days_to_outcome),
  };
}

export type MarketCellPlace = { province: string | null; district: string | null };

export const MARKET_CSV_HEADER = [
  "il", "ilce", "portfoy_turu", "islem_turu", "yayin_ayi", "ilan_sayisi", "medyan_yayinda_gun", "ort_fiyat_degisim_sayisi",
  "fiyat_bandi_10_ustu_dusus", "fiyat_bandi_0_10_dusus", "fiyat_bandi_sabit", "fiyat_bandi_0_10_artis", "fiyat_bandi_10_ustu_artis",
  "kapanan_ilan", "medyan_kapanis_gun",
] as const;

function csvCell(v: string | number | null): string {
  if (v === null) return "";
  const s = String(v);
  // Formül enjeksiyonu: = + - @ ile başlayan metin hücresi tırnaklı ve ' önekli.
  const safe = /^[=+\-@]/.test(s) && typeof v === "string" ? `'${s}` : s;
  return /[",;\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** CSV (UTF-8 BOM'suz; ayraç virgül). Hücrelerde ofis/kişi bilgisi YOKTUR. */
export function marketCellsToCsv(cells: readonly MarketSignalCell[], placeOf: (districtId: string | null) => MarketCellPlace): string {
  const lines = [MARKET_CSV_HEADER.join(",")];
  for (const c of cells) {
    const place = placeOf(c.districtId);
    lines.push(
      [
        place.province, place.district, c.propertyType, c.transactionType, c.publishedMonth, c.listings, c.medianPublishedDays,
        c.avgPriceChangeCount, c.priceDeltaBands.down_over_10, c.priceDeltaBands.down_0_10, c.priceDeltaBands.flat,
        c.priceDeltaBands.up_0_10, c.priceDeltaBands.up_over_10, c.closedCount, c.medianDaysToOutcome,
      ].map(csvCell).join(","),
    );
  }
  return `${lines.join("\r\n")}\r\n`;
}
