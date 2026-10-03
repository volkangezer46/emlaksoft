import type { PillTone } from "@/components/ui/list-kit";

/** Talep listesi saf yardımcıları (sayfadan ayrıldı: test edilebilir; zaman dışarıdan verilir). */

export const DEMAND_STATUS_LABELS: Record<string, string> = {
  new: "Yeni",
  active: "Aktif",
  matched: "Eşleşti",
  closed: "Kapalı",
};

export const URGENCY_LABELS: Record<string, string> = {
  low: "Düşük",
  normal: "Normal",
  high: "Yüksek",
  urgent: "Acil",
};

export const URGENCY_VALUES = Object.keys(URGENCY_LABELS);

/** Yaşlanan talep eşiği (gün) — KPI + ?yas= filtresi. */
export const AGING_DAYS = 30;

export function demandStatusTone(status: string): PillTone {
  switch (status) {
    case "new":
      return "info";
    case "active":
      return "info";
    case "matched":
      return "success";
    default:
      return "neutral"; // closed
  }
}

export function urgencyTone(urgency: string | null): PillTone {
  if (urgency === "urgent") return "danger";
  if (urgency === "high") return "warning";
  return "neutral";
}

/** ?aciliyet= virgüllü değer listesinden yalnız bilinen değerleri bırakır. */
export function parseUrgencyParam(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((v) => v.trim())
    .filter((v) => URGENCY_VALUES.includes(v));
}

// ── Bütçe segmentasyon bantları (bütçe üst sınırı, yoksa alt sınır esas) ────
export const BUDGET_BANDS = [
  { key: "2m", label: "≤ 2 Mn ₺", min: 0, max: 2_000_000 },
  { key: "5m", label: "2–5 Mn ₺", min: 2_000_000, max: 5_000_000 },
  { key: "10m", label: "5–10 Mn ₺", min: 5_000_000, max: 10_000_000 },
  { key: "10m+", label: "10 Mn ₺ üzeri", min: 10_000_000, max: Infinity },
] as const;
export type BandKey = (typeof BUDGET_BANDS)[number]["key"];

export function bandOf(d: { budget_min: number | null; budget_max: number | null }): BandKey | null {
  const v = d.budget_max ?? d.budget_min;
  if (v == null) return null;
  const n = Number(v);
  const band = BUDGET_BANDS.find((b) => n > b.min && n <= b.max) ?? (n === 0 ? BUDGET_BANDS[0] : null);
  return band?.key ?? null;
}

/**
 * Bütçe bandını Supabase `.or()` filtresine çevirir — segment bellekte değil sunucuda kesilsin.
 * Karar değeri: `coalesce(budget_max, budget_min)`; band aralığı (min, max].
 */
export function budgetOrFilter(key: BandKey): string {
  const band = BUDGET_BANDS.find((b) => b.key === key)!;
  // İlk bant (min=0) 0 değerini de kapsar (bandOf'taki n===0 kuralı) → gte.
  const lo = band.min === 0 ? "gte" : "gt";
  const hiMax = Number.isFinite(band.max) ? `,budget_max.lte.${band.max}` : "";
  const hiMin = Number.isFinite(band.max) ? `,budget_min.lte.${band.max}` : "";
  return `and(budget_max.${lo}.${band.min}${hiMax}),and(budget_max.is.null,budget_min.${lo}.${band.min}${hiMin})`;
}

function money(value: number): string {
  return new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 0 }).format(value) + " ₺";
}

export function budgetLabel(min: number | null, max: number | null): string {
  if (min && max) return `${money(min)} – ${money(max)}`;
  if (max) return `≤ ${money(max)}`;
  if (min) return `≥ ${money(min)}`;
  return "Bütçe yok";
}

/** Talep yaşı — "kaç gündür açık" göstergesi (days: geçen tam gün). */
export function demandAgeLabel(days: number, status: string): string {
  if (status === "closed") return days <= 0 ? "Bugün açıldı" : `${days} gün önce açıldı`;
  if (days <= 0) return "Bugün açıldı";
  if (days === 1) return "1 gündür açık";
  return `${days} gündür açık`;
}

export type PoolRow = {
  status: string;
  budget_min: number | null;
  budget_max: number | null;
  province_id: string | null;
  provinceName: string | null;
};

/** Segment havuzundan bütçe bandı ve il sayaçları (kapalı talepler sayılmaz). */
export function tallyPool(rows: readonly PoolRow[]): {
  bandCounts: Record<string, number>;
  provinces: Array<{ id: string; name: string; count: number }>;
} {
  const bandCounts: Record<string, number> = {};
  const prov = new Map<string, { name: string; count: number }>();
  for (const d of rows) {
    if (d.status === "closed") continue;
    const b = bandOf(d);
    if (b) bandCounts[b] = (bandCounts[b] ?? 0) + 1;
    if (d.province_id && d.provinceName) {
      const e = prov.get(d.province_id) ?? { name: d.provinceName, count: 0 };
      e.count += 1;
      prov.set(d.province_id, e);
    }
  }
  const provinces = [...prov.entries()]
    .map(([id, v]) => ({ id, name: v.name, count: v.count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);
  return { bandCounts, provinces };
}
