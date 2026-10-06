/**
 * Kontör ekonomisi grafik modelleri (saf hesap). Ölçekler gerçek orandır; sahte değer yok.
 * Toptan maliyet bilinmiyorsa marj akışı üretilmez (null).
 */

export type OfficeUsage = { tenantId: string; units: number };
export type OfficeBar = { tenantId: string; label: string; value: number; pct: number };

/** En çok harcayan `limit` ofis; en büyük = %100 (ortak ölçek), değer 0 olan ofis çizilmez. */
export function officeUsageBars(offices: readonly OfficeUsage[], names: Record<string, string>, limit = 15): OfficeBar[] {
  const top = [...offices]
    .filter((o) => Number.isFinite(o.units) && o.units > 0)
    .sort((a, b) => b.units - a.units)
    .slice(0, limit);
  const max = top[0]?.units ?? 0;
  if (max <= 0) return [];
  return top.map((o) => ({
    tenantId: o.tenantId,
    label: names[o.tenantId] || "(adsız ofis)",
    value: o.units,
    pct: Math.max(2, Math.round((o.units / max) * 1000) / 10),
  }));
}

export type MarginFlowBar = { key: "revenue" | "cost" | "margin"; label: string; kurus: number; pct: number };

/** Gelir -> maliyet -> marj. Ölçek = |gelir|; gelir yoksa ya da maliyet bilinmiyorsa null (grafik çizilmez). */
export function marginFlow(econ: { revenueNetKurus: number; costKurus: number; marginKurus: number }, wholesaleUnknown: boolean): MarginFlowBar[] | null {
  if (wholesaleUnknown) return null;
  const scale = Math.max(Math.abs(econ.revenueNetKurus), Math.abs(econ.costKurus), Math.abs(econ.marginKurus));
  if (!(scale > 0)) return null;
  const pct = (v: number) => Math.min(100, Math.round((Math.abs(v) / scale) * 1000) / 10);
  return [
    { key: "revenue", label: "Net gelir", kurus: econ.revenueNetKurus, pct: pct(econ.revenueNetKurus) },
    { key: "cost", label: "Toptan maliyet", kurus: econ.costKurus, pct: pct(econ.costKurus) },
    { key: "margin", label: "Brüt marj", kurus: econ.marginKurus, pct: pct(econ.marginKurus) },
  ];
}

export type GrantSegment = { kind: string; label: string; units: number; pct: number };

/** Yığılmış çubuk dilimleri: toplam kontör içindeki pay (yüzdeler toplamı 100'e yakın). */
export function grantSegments(grants: readonly { kind: string; label: string; units: number }[]): GrantSegment[] {
  const rows = grants.filter((g) => Number.isFinite(g.units) && g.units > 0);
  const total = rows.reduce((a, g) => a + g.units, 0);
  if (total <= 0) return [];
  return rows.map((g) => ({ kind: g.kind, label: g.label, units: g.units, pct: Math.round((g.units / total) * 1000) / 10 }));
}

export type ReconStatus = "ok" | "drift" | "error";

export function reconTone(status: ReconStatus): "success" | "warn" | "danger" {
  return status === "ok" ? "success" : status === "drift" ? "warn" : "danger";
}
