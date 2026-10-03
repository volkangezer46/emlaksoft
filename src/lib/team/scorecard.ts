/**
 * Danışman karnesi (Ekip Merkezi / Kıyas) — SAF hesap. Yeni formül uydurulmaz:
 * girdiler `advisor_kpis` RPC'si (müşteri, çağrı, randevu, teklif, anlaşma, ciro),
 * atanmış yayındaki portföy sayısı ve `targets` hedefleridir. Veri yoksa değer
 * `null` döner (arayüz "—" gösterir); sahte skor ya da dolgu yoktur.
 */
export type ScorecardInput = {
  id: string;
  fullName: string;
  role: string;
  customerCount: number;
  activePropertyCount: number;
  callCount: number;
  appointCount: number;
  offerCount: number;
  dealCount: number;
  /** Tahsil edilmiş brüt komisyon (deal.assigned_to'ya göre). */
  revenue: number;
  /** Bu dönemin danışman hedefi (yoksa null). */
  target: { deals: number; revenue: number } | null;
};

export type ScorecardRow = ScorecardInput & {
  /** Teklif → anlaşma (yüzde, tam sayı); teklif yoksa null. */
  conversionPct: number | null;
  /** Hedef gerçekleşme (yüzde, tam sayı); hedef yoksa null. */
  targetPct: number | null;
  rank: number;
};

export type ScorecardSort = "donusum" | "anlasma" | "randevu" | "portfoy" | "kazanc";

export const SCORECARD_SORTS: readonly { value: ScorecardSort; label: string }[] = [
  { value: "anlasma", label: "Anlaşma" },
  { value: "donusum", label: "Dönüşüm" },
  { value: "randevu", label: "Randevu" },
  { value: "portfoy", label: "Portföy" },
  { value: "kazanc", label: "Kazanç" },
];

export function parseScorecardSort(value: string | null | undefined, allowEarnings: boolean): ScorecardSort {
  const hit = SCORECARD_SORTS.find((s) => s.value === value);
  if (!hit) return "anlasma";
  if (hit.value === "kazanc" && !allowEarnings) return "anlasma";
  return hit.value;
}

export function conversionPct(deals: number, offers: number): number | null {
  if (!offers || offers <= 0) return null;
  return Math.round((deals / offers) * 100);
}

/**
 * Hedef gerçekleşme: anlaşma ve ciro oranlarından yüksek olan (hedefler sayfasındaki
 * "ilerleme" ile aynı kural), %100'de kırpılır. `includeRevenue=false` ise ciro oranı
 * dikkate alınmaz (başkasının kazancı sızmasın).
 */
export function targetProgressPct(
  target: ScorecardInput["target"],
  actual: { deals: number; revenue: number },
  includeRevenue: boolean,
): number | null {
  if (!target) return null;
  const dealPct = target.deals > 0 ? (actual.deals / target.deals) * 100 : null;
  const revPct = includeRevenue && target.revenue > 0 ? (actual.revenue / target.revenue) * 100 : null;
  const best = Math.max(dealPct ?? -1, revPct ?? -1);
  if (best < 0) return null;
  return Math.min(100, Math.round(best));
}

function metric(row: ScorecardRow, sort: ScorecardSort): number {
  switch (sort) {
    case "donusum":
      return row.conversionPct ?? -1;
    case "anlasma":
      return row.dealCount;
    case "randevu":
      return row.appointCount;
    case "portfoy":
      return row.activePropertyCount;
    case "kazanc":
      return row.revenue;
  }
}

/**
 * Satırları seçilen ölçüte göre sıralar. Eşit değerler aynı sırayı alır
 * (yarışma sıralaması: 1, 2, 2, 4); eşitlikte ad sırası kararlılık sağlar.
 * Hiç verisi olmayan (ölçüt <= 0) satırlara sıra verilmez: rank 0.
 */
export function buildScorecard(
  inputs: readonly ScorecardInput[],
  sort: ScorecardSort,
  opts: { includeRevenueInTarget: (id: string) => boolean },
): ScorecardRow[] {
  const rows: ScorecardRow[] = inputs.map((i) => ({
    ...i,
    conversionPct: conversionPct(i.dealCount, i.offerCount),
    targetPct: targetProgressPct(
      i.target,
      { deals: i.dealCount, revenue: i.revenue },
      opts.includeRevenueInTarget(i.id),
    ),
    rank: 0,
  }));
  rows.sort(
    (a, b) => metric(b, sort) - metric(a, sort) || a.fullName.localeCompare(b.fullName, "tr"),
  );
  let prev: number | null = null;
  let prevRank = 0;
  rows.forEach((row, index) => {
    const value = metric(row, sort);
    if (value <= 0) {
      row.rank = 0;
      return;
    }
    row.rank = prev !== null && value === prev ? prevRank : index + 1;
    prev = value;
    prevRank = row.rank;
  });
  return rows;
}

const TR_OFFSET_MS = 180 * 60_000;

/** Türkiye takvimine göre içinde bulunulan ay: hedef anahtarı, RPC başlangıcı ve geçen süre yüzdesi. */
export function trMonthContext(nowMs: number): { monthKey: string; monthStartIso: string; elapsedPct: number } {
  const shifted = new Date(nowMs + TR_OFFSET_MS);
  const y = shifted.getUTCFullYear();
  const m = shifted.getUTCMonth();
  const daysInMonth = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return {
    monthKey: `${y}-${String(m + 1).padStart(2, "0")}-01`,
    monthStartIso: new Date(Date.UTC(y, m, 1) - TR_OFFSET_MS).toISOString(),
    elapsedPct: Math.round((shifted.getUTCDate() / daysInMonth) * 100),
  };
}

export type ScorecardFilter = "randevusuz" | "portfoysuz" | "hedefgeride";

export const SCORECARD_FILTERS: readonly { value: ScorecardFilter; label: string }[] = [
  { value: "randevusuz", label: "Bu ay randevusu yok" },
  { value: "portfoysuz", label: "Yayında portföyü yok" },
  { value: "hedefgeride", label: "Hedefin gerisinde" },
];

export function parseScorecardFilter(value: string | null | undefined): ScorecardFilter | null {
  return SCORECARD_FILTERS.find((f) => f.value === value)?.value ?? null;
}

/** "Hedefin gerisinde": gerçekleşme, geçen süre yüzdesinin 10 puandan fazla altında (hedefler sayfasındaki tolerans). */
export const TARGET_PACE_TOLERANCE = 10;

export function matchesScorecardFilter(row: ScorecardRow, filter: ScorecardFilter, elapsedPct: number): boolean {
  switch (filter) {
    case "randevusuz":
      return row.appointCount === 0;
    case "portfoysuz":
      return row.activePropertyCount === 0;
    case "hedefgeride":
      return row.targetPct !== null && row.targetPct < elapsedPct - TARGET_PACE_TOLERANCE;
  }
}
