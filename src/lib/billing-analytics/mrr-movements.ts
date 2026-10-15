/**
 * MRR HAREKETLERİ + NET/BRÜT GELİR TUTMA + KAYIT KOHORTU (saf, testli; ChartMogul/Baremetrics tanımları).
 *
 * Girdi: `platform_mrr_daily` tablosunun ofis × ay sonu değerleri (`platform_mrr_month_end` RPC'si; ayın SON anlık
 * görüntüsü, bu ay için bugüne kadarki son gün). Bir ay "kapsanmış" sayılır yalnız o ay için en az bir satır varsa;
 * anlık görüntüsü olmayan ay için hareket/oran ÜRETİLMEZ (geriye dönük değer uydurulmaz, sıfır çizilmez).
 *
 * Sınıflandırma (ofis başına, ardışık iki kapsanmış ay arasında net değişime göre):
 *  - yeni:              önceki ay 0, bu ay > 0 ve pencere içinde daha önce hiç ödememiş
 *  - yeniden aktivasyon: önceki ay 0, bu ay > 0 ve pencere içinde daha önce ödemiş
 *  - genişleme:         iki ay da > 0, artış
 *  - daralma:           iki ay da > 0, azalış
 *  - kayıp (churn):     önceki ay > 0, bu ay 0
 * NRR = (başlangıçta ödeyen ofislerin bitişteki MRR'ı) / başlangıç MRR'ı (yeni ve geri dönen hariç);
 * GRR = aynı küme için min(bitiş, başlangıç) toplamı / başlangıç MRR'ı (genişleme sayılmaz, ≤ %100).
 */

export type MonthEndRow = { tenant_id: string; month: string; mrr: number | string };

export type MovementKind = "new" | "expansion" | "contraction" | "churn" | "reactivation";

export const MOVEMENT_KINDS: readonly MovementKind[] = ["new", "expansion", "reactivation", "contraction", "churn"];

export const MOVEMENT_LABEL: Record<MovementKind, string> = {
  new: "Yeni",
  expansion: "Genişleme",
  reactivation: "Geri dönen",
  contraction: "Daralma",
  churn: "Kayıp",
};

export type MonthMovement = {
  month: string;
  /** Önceki ve bu ay anlık görüntüsü varsa true; yoksa tüm tutarlar 0 ve çizimde "veri yok". */
  covered: boolean;
  startMrr: number;
  endMrr: number;
  /** Tutarlar POZİTİF yazılır; daralma ve kayıp çizimde eksi yöne gider. */
  amounts: Record<MovementKind, number>;
  counts: Record<MovementKind, number>;
  net: number;
};

const MONTH_RE = /^\d{4}-\d{2}$/;

function emptyRecord(): Record<MovementKind, number> {
  return { new: 0, expansion: 0, contraction: 0, churn: 0, reactivation: 0 };
}

function num(v: number | string): number {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** "YYYY-AA" + k ay. */
export function addMonths(month: string, k: number): string {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const idx = y * 12 + (m - 1) + k;
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, "0")}`;
}

/** İki ay arasındaki fark (b - a, ay). */
export function monthDiff(a: string, b: string): number {
  const [ya, ma] = a.split("-").map(Number) as [number, number];
  const [yb, mb] = b.split("-").map(Number) as [number, number];
  return yb * 12 + mb - (ya * 12 + ma);
}

/** Ay → (ofis → MRR) haritası; kapsanmış aylar (en az bir satırı olan) ayrıca döner. */
export function indexMonthEnd(rows: readonly MonthEndRow[], excluded?: ReadonlySet<string>) {
  const byMonth = new Map<string, Map<string, number>>();
  for (const r of rows) {
    if (!MONTH_RE.test(r.month)) continue;
    if (excluded?.has(r.tenant_id)) continue;
    let m = byMonth.get(r.month);
    if (!m) byMonth.set(r.month, (m = new Map()));
    m.set(r.tenant_id, num(r.mrr));
  }
  return byMonth;
}

function total(m: Map<string, number> | undefined): number {
  if (!m) return 0;
  let s = 0;
  for (const v of m.values()) s += v;
  return s;
}

/**
 * `months` (eskiden yeniye, ardışık) için hareketler. İlk ay yalnız taban olarak kullanılır (hareketi dönmez):
 * çıktı `months.length - 1` satırdır.
 */
export function mrrMovements(rows: readonly MonthEndRow[], months: readonly string[], excluded?: ReadonlySet<string>): MonthMovement[] {
  const byMonth = indexMonthEnd(rows, excluded);
  const everPaid = new Set<string>();
  const out: MonthMovement[] = [];
  for (let i = 0; i < months.length; i++) {
    const cur = byMonth.get(months[i]!);
    if (i === 0) {
      for (const [t, v] of cur ?? []) if (v > 0) everPaid.add(t);
      continue;
    }
    const prev = byMonth.get(months[i - 1]!);
    const amounts = emptyRecord();
    const counts = emptyRecord();
    const covered = Boolean(prev && cur);
    if (prev && cur) {
      const tenants = new Set([...prev.keys(), ...cur.keys()]);
      for (const t of tenants) {
        const a = prev.get(t) ?? 0;
        const b = cur.get(t) ?? 0;
        let kind: MovementKind | null = null;
        let delta = 0;
        if (a === 0 && b > 0) {
          kind = everPaid.has(t) ? "reactivation" : "new";
          delta = b;
        } else if (a > 0 && b === 0) {
          kind = "churn";
          delta = a;
        } else if (a > 0 && b > a) {
          kind = "expansion";
          delta = b - a;
        } else if (a > 0 && b < a) {
          kind = "contraction";
          delta = a - b;
        }
        if (kind) {
          amounts[kind] += delta;
          counts[kind] += 1;
        }
      }
    }
    for (const [t, v] of cur ?? []) if (v > 0) everPaid.add(t);
    for (const k of MOVEMENT_KINDS) amounts[k] = Math.round(amounts[k]);
    out.push({
      month: months[i]!,
      covered,
      startMrr: Math.round(total(prev)),
      endMrr: Math.round(total(cur)),
      amounts,
      counts,
      net: amounts.new + amounts.expansion + amounts.reactivation - amounts.contraction - amounts.churn,
    });
  }
  return out;
}

export type Retention = { from: string; to: string; startMrr: number; startTenants: number; nrr: number; grr: number };

/**
 * `from` ayında ödeyen ofislerin `to` ayındaki gelir tutması. İki ay da kapsanmış ve başlangıç MRR > 0 değilse null.
 * Oranlar yüzde, tek ondalık.
 */
export function revenueRetention(rows: readonly MonthEndRow[], from: string, to: string, excluded?: ReadonlySet<string>): Retention | null {
  const byMonth = indexMonthEnd(rows, excluded);
  const a = byMonth.get(from);
  const b = byMonth.get(to);
  if (!a || !b || from >= to) return null;
  let start = 0;
  let end = 0;
  let kept = 0;
  let n = 0;
  for (const [t, v] of a) {
    if (v <= 0) continue;
    n++;
    start += v;
    const e = b.get(t) ?? 0;
    end += e;
    kept += Math.min(e, v);
  }
  if (start <= 0) return null;
  const pct = (x: number) => Math.round((x / start) * 1000) / 10;
  return { from, to, startMrr: Math.round(start), startTenants: n, nrr: pct(end), grr: pct(kept) };
}

/** Penceredeki ilk kapsanmış ay (en eski anlık görüntü), yoksa null. */
export function firstCoveredMonth(rows: readonly MonthEndRow[], months: readonly string[]): string | null {
  const covered = new Set(rows.map((r) => r.month));
  return months.find((m) => covered.has(m)) ?? null;
}

export type CohortCell = { offset: number; month: string; paying: number; pct: number; mrr: number } | null;
export type CohortRow = { cohort: string; size: number; cells: CohortCell[] };

/**
 * Kayıt kohortu ızgarası: satır = ofisin kayıt ayı (tenants.created_at, TR), sütun k = kayıttan k ay sonra.
 * Hücre = o ay sonunda ödeyen (MRR > 0) ofis oranı ve kohortun o ayki MRR'ı. Anlık görüntüsü olmayan ay ve henüz
 * gelmemiş ay `null` (boş hücre). Deneme süresiyle başlayan SaaS'ta bu eğri hem dönüşümü hem tutmayı gösterir.
 */
export function signupCohorts(
  rows: readonly MonthEndRow[],
  signups: readonly { id: string; month: string }[],
  months: readonly string[],
  opts: { maxOffset: number; excluded?: ReadonlySet<string> },
): CohortRow[] {
  const byMonth = indexMonthEnd(rows, opts.excluded);
  const last = months[months.length - 1];
  if (!last) return [];
  const inWindow = new Set(months);
  const cohorts = new Map<string, string[]>();
  for (const s of signups) {
    if (!MONTH_RE.test(s.month) || !inWindow.has(s.month) || opts.excluded?.has(s.id)) continue;
    const list = cohorts.get(s.month) ?? [];
    list.push(s.id);
    cohorts.set(s.month, list);
  }
  return months
    .filter((m) => cohorts.has(m))
    .map((cohort) => {
      const ids = cohorts.get(cohort)!;
      const cells: CohortCell[] = [];
      for (let k = 0; k <= opts.maxOffset; k++) {
        const month = addMonths(cohort, k);
        const snap = month <= last ? byMonth.get(month) : undefined;
        if (!snap) {
          cells.push(null);
          continue;
        }
        let paying = 0;
        let mrr = 0;
        for (const id of ids) {
          const v = snap.get(id) ?? 0;
          if (v > 0) {
            paying++;
            mrr += v;
          }
        }
        cells.push({ offset: k, month, paying, pct: Math.round((paying / ids.length) * 100), mrr: Math.round(mrr) });
      }
      return { cohort, size: ids.length, cells };
    })
    .reverse();
}

/** Isı haritası tonu (0..4) — renk tek başına anlam taşımaz; hücrede yüzde metni hep yazılır. */
export function cohortHeat(pct: number): 0 | 1 | 2 | 3 | 4 {
  if (pct >= 80) return 4;
  if (pct >= 60) return 3;
  if (pct >= 40) return 2;
  if (pct >= 20) return 1;
  return 0;
}
