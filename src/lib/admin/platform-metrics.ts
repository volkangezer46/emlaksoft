/**
 * /admin kontrol paneli — büyüme/gelir metriklerinin SAF mantığı (yan etkisiz, testli).
 * Sayfa yalnız sorgular ve çizer; hesap burada. İlke: veri yoksa `null`/boş döner,
 * sahte sayı veya "0 ile doldurulmuş" eğri ÜRETİLMEZ.
 *
 * - Modül benimseme (son 30 gün, en az bir işlem yapan ofis oranı; /admin/raporlar ile ortak)
 * - Aktivasyon hunisi (kayıt → ilk portföy → ilk anlaşma; ardışık alt küme)
 * - Gerçek deneme → ücretli dönüşüm (denemesi biten ofislerden ücretli aktif aboneliğe geçen)
 * - ARPA serisi (aktif ofis başına aylık gelir)
 * - MRR tahmini (doğrusal eğilim; ETİKETLİ tahmin, en az 3 ay gerçek veri)
 * - Churn nedenleri (abonelik iptal nedeni serbest metni; normalize edilip gruplanır)
 * - Aylık tüketim kovaları (AI kredisi, değerleme raporu, EmlakFiyati kontörü)
 */
import { trMonthKey } from "@/lib/clock";

const MONTHS_SHORT = ["Oca", "Şub", "Mar", "Nis", "May", "Haz", "Tem", "Ağu", "Eyl", "Eki", "Kas", "Ara"];

// ---- Modül benimseme ----------------------------------------------------------

/** Denetim kaydı modül anahtarı → Türkçe etiket (SQL `platform_reporting_aggregates.adoption` ile aynı anahtarlar). */
export const ADOPTION_MODULES = [
  ["customers", "Müşteriler"], ["demands", "Talepler"], ["properties", "Portföyler"],
  ["deals", "Anlaşmalar"], ["tasks", "Görevler"], ["appointments", "Randevular"],
  ["commissions", "Komisyon"], ["contracts", "Sözleşmeler"], ["rentals", "Kiralama"],
  ["campaigns", "Kampanyalar"], ["automations", "Otomasyon"], ["valuations", "Değerleme"],
  ["projects", "Projeler"], ["network", "Ofis ağı"],
] as const;

export type ModuleAdoptionRow = { id: string; label: string; offices: number; pct: number };

/** Her modül için ofis sayısı ve oranı (payda en az 1); çok kullanılandan aza sıralı. */
export function moduleAdoption(
  adoption: readonly { module: string; offices: number | string }[],
  tenantDenom: number,
): ModuleAdoptionRow[] {
  const denom = Math.max(1, Math.round(tenantDenom));
  return ADOPTION_MODULES.map(([id, label]) => {
    const offices = Number(adoption.find((row) => row.module === id)?.offices ?? 0);
    return { id, label, offices, pct: Math.round((offices / denom) * 100) };
  }).sort((a, b) => b.offices - a.offices || a.label.localeCompare(b.label, "tr"));
}

// ---- Aktivasyon hunisi -------------------------------------------------------

export type ActivationRow = { properties: number; deals: number };
export type ActivationFunnel = { registered: number; withProperty: number; withDeal: number };

/**
 * Ardışık huni: her aşama bir öncekinin alt kümesidir (ilk anlaşma = portföyü OLAN ve
 * anlaşması olan ofis). Sayımlar örnek veri hariç (çağıran `is_sample=false` süzer).
 */
export function activationFunnel(rows: readonly ActivationRow[]): ActivationFunnel {
  let withProperty = 0;
  let withDeal = 0;
  for (const r of rows) {
    if (r.properties > 0) {
      withProperty += 1;
      if (r.deals > 0) withDeal += 1;
    }
  }
  return { registered: rows.length, withProperty, withDeal };
}

/** PostgREST gömülü sayım (`tablo(count)`) satırından sayı: `[{ count: 3 }]` → 3. */
export function embeddedCount(value: unknown): number {
  if (Array.isArray(value)) return Number((value[0] as { count?: number } | undefined)?.count ?? 0) || 0;
  if (value && typeof value === "object" && "count" in value) return Number((value as { count: number }).count) || 0;
  return 0;
}

// ---- Deneme → ücretli dönüşüm -------------------------------------------------

export type TrialRow = { id: string; status: string; trial_ends_at: string | null };
export type TrialConversion = { ended: number; converted: number; rate: number | null };

/**
 * Son `days` gün içinde denemesi BİTEN ofislerden kaçının bugün ücretli aktif aboneliği var.
 * Payda 0 ise oran `null` (yüzde uydurulmaz). "Aktif ofis / toplam ofis" oranı DEĞİLDİR.
 */
export function trialConversion(
  rows: readonly TrialRow[],
  payingTenantIds: ReadonlySet<string>,
  nowMs: number,
  days: number,
): TrialConversion {
  const from = nowMs - days * 86_400_000;
  let ended = 0;
  let converted = 0;
  for (const r of rows) {
    if (!r.trial_ends_at) continue;
    const t = new Date(r.trial_ends_at).getTime();
    if (!Number.isFinite(t) || t < from || t > nowMs) continue;
    ended += 1;
    if (r.status === "active" && payingTenantIds.has(r.id)) converted += 1;
  }
  return { ended, converted, rate: ended > 0 ? Math.round((converted / ended) * 100) : null };
}

// ---- ARPA ---------------------------------------------------------------------

export type ArpaPoint = { label: string; mrr: number; offices: number; arpa: number | null };

/** Aktif ofis başına aylık gelir; aktif ofis yoksa o ay `null` (sıfır gibi çizilmez). */
export function arpaSeries(points: readonly { label: string; mrr: number; offices: number }[]): ArpaPoint[] {
  return points.map((p) => ({ ...p, arpa: p.offices > 0 ? Math.round(p.mrr / p.offices) : null }));
}

// ---- MRR tahmini --------------------------------------------------------------

export type LinearForecast = { values: number[]; slope: number; basis: number };

/**
 * Doğrusal eğilim (en küçük kareler) ile `horizon` ay ileri tahmin. Yalnız son `window`
 * ay kullanılır; ilk sıfırdan farklı aydan önceki sıfırlar (henüz gelir yokken) atılır.
 * En az 3 gerçek ay yoksa `null` (tahmin yok). Değerler 0'ın altına inmez. ETİKETLİ gösterilir.
 */
export function linearForecast(series: readonly number[], horizon = 3, window = 6): LinearForecast | null {
  const clean = series.filter((n) => Number.isFinite(n));
  const firstNonZero = clean.findIndex((n) => n > 0);
  if (firstNonZero < 0) return null;
  const used = clean.slice(firstNonZero).slice(-window);
  if (used.length < 3) return null;
  const n = used.length;
  const xs = used.map((_, i) => i);
  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const meanY = used.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i]! - meanX) * (used[i]! - meanY);
    den += (xs[i]! - meanX) ** 2;
  }
  const slope = den === 0 ? 0 : num / den;
  const intercept = meanY - slope * meanX;
  const values = Array.from({ length: horizon }, (_, k) => Math.max(0, Math.round(intercept + slope * (n + k))));
  return { values, slope: Math.round(slope), basis: n };
}

/** Gelecek ayların kısa etiketleri (TR takvimi): `nextMonthLabels(now, 3)` → ["Kas", "Ara", "Oca"]. */
export function nextMonthLabels(nowMs: number, count: number): string[] {
  return Array.from({ length: count }, (_, i) => monthShortOfKey(trMonthKey(nowMs, i + 1)));
}

/** "2026-10" → "Eki". */
export function monthShortOfKey(key: string): string {
  const m = Number(key.split("-")[1]);
  return MONTHS_SHORT[m - 1] ?? key;
}

// ---- Churn nedenleri ----------------------------------------------------------

export type ChurnReason = { reason: string; count: number };

/**
 * İptal nedeni serbest metnini gruplar: kırpılır, boşluklar teke iner, büyük/küçük harf
 * (tr-TR) yok sayılır; görünen ad ilk karşılaşılan yazımdır. Boş neden "Neden belirtilmedi".
 * Çoktan aza, en çok `limit` grup.
 */
export function churnReasons(rows: readonly { cancel_reason: string | null }[], limit = 5): ChurnReason[] {
  const groups = new Map<string, ChurnReason>();
  for (const r of rows) {
    const shown = (r.cancel_reason ?? "").trim().replace(/\s+/g, " ");
    const display = shown || "Neden belirtilmedi";
    const key = display.toLocaleLowerCase("tr-TR");
    const g = groups.get(key);
    if (g) g.count += 1;
    else groups.set(key, { reason: display, count: 1 });
  }
  return [...groups.values()].sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason, "tr")).slice(0, limit);
}

// ---- Aylık tüketim ------------------------------------------------------------

export type LedgerPoint = { unit: string; amount: number | string; available_at: string };
export type MonthlyUsage = { months: { key: string; label: string }[]; byUnit: Record<string, number[]>; total: number };

/**
 * Son `count` TR takvim ayı (eskiden yeniye) için birim başına harcama toplamı
 * (|amount|, harcama kayıtları). Pencere dışı ve bilinmeyen birim atlanır.
 */
export function monthlyUsage(rows: readonly LedgerPoint[], units: readonly string[], nowMs: number, count = 6): MonthlyUsage {
  const months = Array.from({ length: count }, (_, i) => {
    const key = trMonthKey(nowMs, i - (count - 1));
    return { key, label: monthShortOfKey(key) };
  });
  const index = new Map(months.map((m, i) => [m.key, i]));
  const byUnit: Record<string, number[]> = Object.fromEntries(units.map((u) => [u, months.map(() => 0)]));
  let total = 0;
  for (const r of rows) {
    const bucket = byUnit[r.unit];
    if (!bucket) continue;
    const i = index.get(trMonthKey(r.available_at));
    if (i === undefined) continue;
    const v = Math.abs(Number(r.amount));
    if (!Number.isFinite(v)) continue;
    bucket[i] = Math.round((bucket[i]! + v) * 100) / 100;
    total += v;
  }
  return { months, byUnit, total: Math.round(total * 100) / 100 };
}
