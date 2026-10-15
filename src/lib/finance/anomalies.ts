/**
 * Muhasebe uyarı motoru (SAF; DB/saat yok). Genel bakış'taki "Dikkat edilmesi gerekenler" kartının hesapları:
 *  - `categorySpikes`: bu ayın kategori giderleri ↔ önceki 3 tam ayın ortalaması (oran + z-skoru). Yalnız GERÇEKLEŞEN tutar
 *    ortalamayı belirgin aşmışsa uyarı verilir. Ay sonuna oranlama (gidişat) bilinçli olarak YOK: kira, maaş gibi ayda bir
 *    ödenen kalemler ayın başında ödenince oranlama sahte "artış" üretir. Daha önce hiç harcanmamış kategoride belirgin
 *    tutar "yeni gider kalemi" sayılır.
 *  - `findDuplicatePayments`: aynı tutar + aynı karşı taraf (ya da açıklama) + aynı para birimi, birkaç gün arayla girilmiş
 *    giderler (mükerrer ödeme şüphesi).
 *  - `rankAttention`: tüm sinyalleri önem sırasına dizer (kart en çok N satır gösterir).
 * Veri yoksa sinyal yok (sahte uyarı üretilmez). Test: anomalies.test.ts.
 */

export type MonthCategoryTotals = { month: string; byCategory: Record<string, number> };

export type CategorySpike = {
  category: string;
  /** Bu ayın gerçekleşen tutarı (bugüne kadar). */
  actual: number;
  /** Önceki tam ayların ortalaması (0 = yeni kalem). */
  baseline: number;
  /** actual / baseline; yeni kalemde null. */
  ratio: number | null;
  /** (değer − ortalama) / std; std çok küçükse ortalamanın %10'u taban alınır. Yeni kalemde null. */
  z: number | null;
  basis: "actual" | "new";
  severity: Severity;
};

export type Severity = "high" | "medium" | "low";

export type SpikeOptions = {
  /** Karşılaştırma için en az kaç önceki ayda veri olmalı (varsayılan 2). */
  minHistoryMonths?: number;
  /** Uyarı için en düşük oran (varsayılan 1.5 = %50 üstü). */
  minRatio?: number;
  /** Uyarı için ortalamanın üstündeki en düşük TL farkı (varsayılan 1000). */
  minDiff?: number;
};

const round2 = (n: number) => Math.round(n * 100) / 100;
const fin = (n: unknown) => {
  const v = typeof n === "number" ? n : Number(n);
  return Number.isFinite(v) ? v : 0;
};

/** "YYYY-MM" ayındaki gün sayısı. */
export function daysInMonth(monthKey: string): number {
  const y = Number(monthKey.slice(0, 4));
  const m = Number(monthKey.slice(5, 7));
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

function spikeSeverity(ratio: number | null, z: number | null, basis: CategorySpike["basis"]): Severity {
  if (basis === "new") return "low";
  const r = ratio ?? 0;
  const zz = z ?? 0;
  if (r >= 2 || zz >= 3) return "high";
  if (r >= 1.75 || zz >= 2) return "medium";
  return "low";
}

/**
 * `months`: ay kovaları ("YYYY-MM" ya da "YYYY-MM-01"), `currentMonth` "YYYY-MM" (bu ay; bugüne kadar gerçekleşen).
 * Önceki ay = `currentMonth`'tan önceki en çok 3 ay (yoksa 0 sayılır, ama en az `minHistoryMonths` ayda gider olmalı).
 */
export function categorySpikes(months: readonly MonthCategoryTotals[], currentMonth: string, opts: SpikeOptions = {}): CategorySpike[] {
  const minHistory = opts.minHistoryMonths ?? 2;
  const minRatio = opts.minRatio ?? 1.5;
  const minDiff = opts.minDiff ?? 1000;
  const key = (m: string) => m.slice(0, 7);
  const current = months.find((m) => key(m.month) === currentMonth);
  const history = months
    .filter((m) => key(m.month) < currentMonth)
    .sort((a, b) => (key(a.month) < key(b.month) ? 1 : -1))
    .slice(0, 3);
  const activeHistory = history.filter((m) => Object.values(m.byCategory).some((v) => fin(v) > 0));
  if (!current || activeHistory.length < minHistory) return [];
  const n = history.length;
  const out: CategorySpike[] = [];

  for (const [category, raw] of Object.entries(current.byCategory)) {
    const actual = fin(raw);
    if (actual <= 0) continue;
    const values = history.map((m) => Math.max(0, fin(m.byCategory[category])));
    const mean = values.reduce((a, b) => a + b, 0) / n;

    if (mean <= 0) {
      // Önceki aylarda hiç yok: belirgin tutarsa "yeni gider kalemi".
      if (actual >= minDiff * 2) out.push({ category, actual: round2(actual), baseline: 0, ratio: null, z: null, basis: "new", severity: "low" });
      continue;
    }
    const variance = values.reduce((a, v) => a + (v - mean) ** 2, 0) / n;
    const std = Math.max(Math.sqrt(variance), mean * 0.1);

    if (actual < mean * minRatio || actual - mean < minDiff) continue;
    const ratio = round2(actual / mean);
    const z = round2((actual - mean) / std);
    out.push({ category, actual: round2(actual), baseline: round2(mean), ratio, z, basis: "actual", severity: spikeSeverity(ratio, z, "actual") });
  }
  const sevRank: Record<Severity, number> = { high: 0, medium: 1, low: 2 };
  return out.sort((a, b) => sevRank[a.severity] - sevRank[b.severity] || b.actual - b.baseline - (a.actual - a.baseline));
}

// ---------------------------------------------------------------------------
// Mükerrer ödeme şüphesi
// ---------------------------------------------------------------------------

export type PaymentRow = { id: string; date: string; amount: number; currency: string; title: string | null; counterparty: string | null; category: string | null };

export type DuplicateGroup = {
  /** Kullanıcıya görünen karşı taraf / açıklama (aramada kullanılır). */
  label: string;
  amount: number;
  currency: string;
  ids: string[];
  from: string;
  to: string;
  count: number;
};

/** Karşılaştırma anahtarı: küçük harf (tr), noktalama ve fazla boşluk atılmış. */
export function normalizeParty(s: string | null | undefined): string {
  return (s ?? "")
    .toLocaleLowerCase("tr-TR")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function dayDiff(a: string, b: string): number {
  return Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000;
}

/**
 * Aynı para birimi + aynı tutar (kuruş) + aynı karşı taraf (yoksa açıklama) ve en çok `windowDays` gün arayla girilmiş
 * giderleri gruplar. Tutarı `minAmount` altındaki küçük ödemeler (çay, kırtasiye…) gürültü sayılır ve atlanır.
 */
export function findDuplicatePayments(rows: readonly PaymentRow[], opts: { windowDays?: number; minAmount?: number } = {}): DuplicateGroup[] {
  const windowDays = opts.windowDays ?? 3;
  const minAmount = opts.minAmount ?? 100;
  const buckets = new Map<string, PaymentRow[]>();
  for (const r of rows) {
    const amount = fin(r.amount);
    if (amount < minAmount || !/^\d{4}-\d{2}-\d{2}/.test(r.date)) continue;
    const party = normalizeParty(r.counterparty) || normalizeParty(r.title);
    if (!party) continue;
    const k = `${r.currency || "TRY"}|${Math.round(amount * 100)}|${party}`;
    const list = buckets.get(k);
    if (list) list.push(r);
    else buckets.set(k, [r]);
  }
  const groups: DuplicateGroup[] = [];
  for (const list of buckets.values()) {
    if (list.length < 2) continue;
    const sorted = list.slice().sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.id < b.id ? -1 : 1));
    let cluster: PaymentRow[] = [sorted[0]!];
    const flush = () => {
      if (cluster.length >= 2) {
        const first = cluster[0]!;
        groups.push({
          label: (first.counterparty ?? "").trim() || (first.title ?? "").trim(),
          amount: round2(fin(first.amount)),
          currency: first.currency || "TRY",
          ids: cluster.map((c) => c.id),
          from: first.date.slice(0, 10),
          to: cluster[cluster.length - 1]!.date.slice(0, 10),
          count: cluster.length,
        });
      }
    };
    for (let i = 1; i < sorted.length; i++) {
      const r = sorted[i]!;
      if (dayDiff(r.date.slice(0, 10), cluster[cluster.length - 1]!.date.slice(0, 10)) <= windowDays) cluster.push(r);
      else {
        flush();
        cluster = [r];
      }
    }
    flush();
  }
  return groups.sort((a, b) => b.amount * b.count - a.amount * a.count);
}

/** Hareketler `q` aramasına güvenli metin (ledger-filters ile aynı temizlik; 60 karakter). */
export function searchTextFor(label: string): string {
  return label.replace(/[,()%*_\\]/g, " ").replace(/\s+/g, " ").trim().slice(0, 60);
}

// ---------------------------------------------------------------------------
// Sıralama
// ---------------------------------------------------------------------------

export type AttentionItem = { key: string; severity: Severity; title: string; text: string; href: string; amount?: number };

/** Önem (yüksek → düşük), sonra tutar (büyük → küçük); en çok `limit` satır. */
export function rankAttention(items: readonly AttentionItem[], limit = 6): AttentionItem[] {
  const rank: Record<Severity, number> = { high: 0, medium: 1, low: 2 };
  return items
    .slice()
    .sort((a, b) => rank[a.severity] - rank[b.severity] || (b.amount ?? 0) - (a.amount ?? 0) || a.key.localeCompare(b.key))
    .slice(0, Math.max(0, limit));
}
