/**
 * PAKET LİMİTLERİ (SAF; DB yok). Admin > Ofisler > Paket limitleri ekranının görünüm modeli.
 * Kaynaklar (okuyucu `limits-read.ts`): `platform_tenant_limit_usage` (koltuk, aktif portföy, müşteri, şube; ETKİN limit
 * = paket + ofise özel istisna + ek koltuk, kapasite tetikleyicisiyle aynı sayım) ve AI kredi defteri (bu ay; paket
 * `aiCreditsMonthly`, değerleme raporu `valuationReportsMonthly`). SMS'in paket sınırı YOK (ofis kendi Netgsm hesabını
 * bağlar): ekranda ölçü olarak çizilmez, açıklaması yazılır. Sayı uydurulmaz: kaynak okunamazsa ölçü "hazır değil" kalır.
 */

export const LIMIT_METRICS = ["seats", "active_properties", "customers", "branches", "ai", "valuation"] as const;
export type LimitMetric = (typeof LIMIT_METRICS)[number];

export const LIMIT_METRIC_META: Record<LimitMetric, { label: string; unit: string }> = {
  seats: { label: "Kullanıcı (koltuk)", unit: "kullanıcı" },
  active_properties: { label: "Aktif portföy", unit: "ilan" },
  customers: { label: "Müşteri", unit: "kayıt" },
  branches: { label: "Şube", unit: "şube" },
  ai: { label: "AI kredisi (bu ay)", unit: "kredi" },
  valuation: { label: "Değerleme raporu (bu ay)", unit: "rapor" },
};

export function isLimitMetric(v: unknown): v is LimitMetric {
  return typeof v === "string" && (LIMIT_METRICS as readonly string[]).includes(v);
}

/** Eşik süzgeci (%); varsayılan 80. */
export const LIMIT_THRESHOLDS = [80, 90, 100] as const;
export type LimitThreshold = (typeof LIMIT_THRESHOLDS)[number];

export function parseThreshold(v: unknown): LimitThreshold {
  const n = Number(v);
  return (LIMIT_THRESHOLDS as readonly number[]).includes(n) ? (n as LimitThreshold) : 80;
}

export type CapUsageRow = { tenant_id: string; metric: string; used: number | string; cap: number | string };
export type QuotaUsageRow = { tenantId: string; aiUsed: number; aiQuota: number | null; valuationReports: number; valuationQuota: number | null };

export type LimitRow = { tenantId: string; metric: LimitMetric; used: number; cap: number; pct: number };

const pctOf = (used: number, cap: number) => (cap > 0 ? Math.round((used / cap) * 100) : used > 0 ? 100 : 0);

/** Eşik üstü (≥ minPct) ölçüler; en dolu en üstte, eşitlikte ölçü sırası. Limiti olmayan (cap ≤ 0 / null) ölçü girmez. */
export function buildLimitRows(caps: readonly CapUsageRow[], quotas: readonly QuotaUsageRow[], minPct: number): LimitRow[] {
  const out: LimitRow[] = [];
  for (const r of caps) {
    if (!isLimitMetric(r.metric)) continue;
    const used = Number(r.used) || 0;
    const cap = Number(r.cap) || 0;
    if (!(cap > 0)) continue;
    const pct = pctOf(used, cap);
    if (pct >= minPct) out.push({ tenantId: r.tenant_id, metric: r.metric, used, cap, pct });
  }
  for (const q of quotas) {
    if (q.aiQuota !== null && q.aiQuota > 0) {
      const pct = pctOf(q.aiUsed, q.aiQuota);
      if (pct >= minPct) out.push({ tenantId: q.tenantId, metric: "ai", used: Math.round(q.aiUsed * 100) / 100, cap: q.aiQuota, pct });
    }
    if (q.valuationQuota !== null && q.valuationQuota > 0) {
      const pct = pctOf(q.valuationReports, q.valuationQuota);
      if (pct >= minPct) out.push({ tenantId: q.tenantId, metric: "valuation", used: q.valuationReports, cap: q.valuationQuota, pct });
    }
  }
  return out.sort((a, b) => b.pct - a.pct || LIMIT_METRICS.indexOf(a.metric) - LIMIT_METRICS.indexOf(b.metric) || a.tenantId.localeCompare(b.tenantId));
}

export type LimitSummary = {
  offices: number;
  over: number;
  byMetric: Record<LimitMetric, number>;
};

export function summarizeLimits(rows: readonly LimitRow[]): LimitSummary {
  const byMetric = Object.fromEntries(LIMIT_METRICS.map((m) => [m, 0])) as Record<LimitMetric, number>;
  for (const r of rows) byMetric[r.metric] += 1;
  return { offices: new Set(rows.map((r) => r.tenantId)).size, over: rows.filter((r) => r.pct >= 100).length, byMetric };
}

/** Ofis başına satırlar (en dolu ölçüsü en üstte olan ofis önce). */
export function groupLimitRows(rows: readonly LimitRow[]): { tenantId: string; rows: LimitRow[]; top: number }[] {
  const map = new Map<string, LimitRow[]>();
  for (const r of rows) map.set(r.tenantId, [...(map.get(r.tenantId) ?? []), r]);
  return [...map.entries()]
    .map(([tenantId, list]) => ({ tenantId, rows: list, top: Math.max(...list.map((x) => x.pct)) }))
    .sort((a, b) => b.top - a.top || b.rows.length - a.rows.length || a.tenantId.localeCompare(b.tenantId));
}

export function limitTone(pct: number): "danger" | "warning" | "info" {
  return pct >= 100 ? "danger" : pct >= 90 ? "warning" : "info";
}
