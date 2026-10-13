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
 * - Aylık tüketim kovaları (AI kredisi, değerleme raporu, EmlakFiyati analiz bakiyesi)
 * - Ofis bazlı MRR (`computeTenantMrr`; günlük anlık görüntü ve `exactMrr` aynı kural) + ay sonu MRR eğrisi
 *   (`platform_mrr_daily`; anlık görüntü öncesi aylar `null`) + dönemsel churn + dönemi bitmiş aktif abonelik
 */
import { trDayKey, trMonthKey } from "@/lib/clock";

const MONTHS_SHORT = ["Oca", "Şub", "Mar", "Nis", "May", "Haz", "Tem", "Ağu", "Eyl", "Eki", "Kas", "Ara"];

// ---- Modül benimseme ----------------------------------------------------------

/** Denetim kaydı modül anahtarı → Türkçe etiket (SQL `platform_reporting_aggregates.adoption` ile aynı anahtarlar). */
export const ADOPTION_MODULES = [
  ["customers", "Müşteriler"], ["demands", "Talepler"], ["properties", "Portföyler"],
  ["deals", "Anlaşmalar"], ["tasks", "Görevler"], ["appointments", "Randevular"],
  ["commissions", "Komisyon"], ["contracts", "Sözleşmeler"], ["rentals", "Mülk yönetimi"],
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

// ---- Ofis bazlı MRR (anlık görüntü ve canlı toplamın ORTAK kuralı) ---------------

export type TenantMrrInput = {
  /** tenants.status */
  tenantStatus: string;
  /** tenants.plan */
  tenantPlan: string | null;
  /** Ofisin abonelik satırı (yoksa null). */
  sub: { status: string; amount_try: number | string | null } | null;
};

/**
 * Tek ofisin aylık yinelenen geliri — `exactMrr` (reporting/platform) ile AYNI kural, ofis bazında:
 *  - aktif aboneliği varsa kayıtlı tutar (fatura tutarı; katalogdan yeniden hesaplanmaz),
 *  - aboneliği aktif DEĞİL ama ofis aktifse katalog fiyatı (aboneliği eksik aktif ofis),
 *  - diğer her durumda 0 (deneme, gecikmiş, askı, iptal gelir sayılmaz).
 * `prices`: plan kimliği → aylık liste fiyatı (`priceMapOf(getPlanDefinitions())`).
 */
export function computeTenantMrr(input: TenantMrrInput, prices: ReadonlyMap<string, number>): number {
  const sub = input.sub;
  if (sub && sub.status === "active") {
    const amount = Number(sub.amount_try);
    return Number.isFinite(amount) && amount > 0 ? Math.round(amount * 100) / 100 : 0;
  }
  if (input.tenantStatus === "active") return prices.get(input.tenantPlan ?? "") ?? 0;
  return 0;
}

// ---- MRR eğrisi (platform_mrr_daily ay sonu değerleri) ----------------------------

export type MrrSnapshotDay = { day: string; total: number };
export type MrrTrendPoint = { key: string; label: string; value: number | null; day: string | null };

/**
 * Son `count` TR takvim ayı (eskiden yeniye) için ayın SON anlık görüntü gününün toplamı.
 * Anlık görüntüsü olmayan ay `null` ("veri yok") — geriye dönük değer UYDURULMAZ, sıfır çizilmez.
 * `days`: gün → o günün tüm ofis MRR toplamı (çağıran `platform_mrr_daily`'den toplar).
 */
export function mrrMonthEndSeries(days: readonly MrrSnapshotDay[], nowMs: number, count = 8): MrrTrendPoint[] {
  const lastByMonth = new Map<string, MrrSnapshotDay>();
  for (const d of days) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d.day)) continue;
    const key = d.day.slice(0, 7);
    const cur = lastByMonth.get(key);
    if (!cur || d.day > cur.day) lastByMonth.set(key, d);
  }
  return Array.from({ length: count }, (_, i) => {
    const key = trMonthKey(nowMs, i - (count - 1));
    const hit = lastByMonth.get(key);
    return { key, label: monthShortOfKey(key), value: hit ? Math.round(hit.total) : null, day: hit?.day ?? null };
  });
}

/**
 * Eğri için okunacak günler: geçmiş ayların SON `window` günü + bu ayın bugüne kadarki son `window` günü
 * (TR takvimi, "YYYY-AA-GG"). Tüm satırları okumak yerine yalnız ay sonu adayları okunur (ofis × gün hacmi);
 * ayın son haftasında hiç anlık görüntü yoksa o ay "veri yok" kalır.
 */
export function monthEndCandidateDays(nowMs: number, count = 8, window = 7): string[] {
  const today = trDayKey(nowMs);
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    const key = trMonthKey(nowMs, i - (count - 1));
    const [y, m] = key.split("-").map(Number) as [number, number];
    const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
    for (let d = Math.max(1, lastDay - window + 1); d <= lastDay; d++) {
      const day = `${key}-${String(d).padStart(2, "0")}`;
      if (day <= today) out.push(day);
    }
    if (key === today.slice(0, 7)) {
      const td = Number(today.slice(8, 10));
      for (let d = Math.max(1, td - window + 1); d <= td; d++) {
        const day = `${key}-${String(d).padStart(2, "0")}`;
        if (!out.includes(day)) out.push(day);
      }
    }
  }
  return out.sort();
}

/** `platform_mrr_daily` satırlarını güne göre toplar (eğri girdisi). */
export function sumSnapshotDays(rows: readonly { day: string; mrr_try: number | string }[]): MrrSnapshotDay[] {
  const totals = new Map<string, number>();
  for (const r of rows) {
    const v = Number(r.mrr_try);
    totals.set(r.day, (totals.get(r.day) ?? 0) + (Number.isFinite(v) ? v : 0));
  }
  return [...totals.entries()].map(([day, total]) => ({ day, total })).sort((a, b) => a.day.localeCompare(b.day));
}

// ---- Dönemsel churn -------------------------------------------------------------

export type ChurnSubRow = { tenant_id: string; status: string; created_at: string; cancelled_at: string | null };
export type PeriodChurn = { cancelled: number; base: number; rate: number | null };

/** Deneme dışı abonelik durumları: dönem başında "aktif ofis" sayılabilir. */
const PAYING_STATUSES = new Set(["active", "past_due", "paused", "cancelled"]);

/**
 * Dönemsel müşteri kaybı: son `days` günde iptal edilen ofis / `days` gün önce aktif olan ofis.
 * "Dönem başında aktif" = aboneliği o tarihten ÖNCE açılmış, o tarihte iptal edilmemiş ve bugün deneme
 * aşamasında olmayan ofis. Dönem içinde açılıp kapanan ofis paya da paydaya da girmez (oran %100'ü aşmaz).
 * Payda 0 ise oran `null` ("veri yok"; sıfır yüzde uydurulmaz).
 */
export function periodChurn(rows: readonly ChurnSubRow[], nowMs: number, days = 30): PeriodChurn {
  const start = nowMs - days * 86_400_000;
  const base = new Set<string>();
  const cancelled = new Set<string>();
  for (const r of rows) {
    if (!PAYING_STATUSES.has(r.status)) continue;
    const created = Date.parse(r.created_at);
    if (!Number.isFinite(created) || created > start) continue;
    const cancelledAt = r.cancelled_at ? Date.parse(r.cancelled_at) : Number.NaN;
    if (Number.isFinite(cancelledAt) && cancelledAt <= start) continue;
    base.add(r.tenant_id);
    if (r.status === "cancelled" && Number.isFinite(cancelledAt) && cancelledAt <= nowMs) cancelled.add(r.tenant_id);
  }
  return {
    cancelled: cancelled.size,
    base: base.size,
    rate: base.size > 0 ? Math.round((cancelled.size / base.size) * 1000) / 10 : null,
  };
}

// ---- Dönemi bitmiş aktif abonelik -------------------------------------------------

/**
 * Abonelik "aktif" ama ödenmiş dönemi geçmiş mi. TEK aday tanımı (otomatik adım runExpireActiveToPastDue ile aynı):
 * status='active' AND current_period_end < now AND pause_started_at IS NULL AND cancel_at_period_end = false.
 * Duraklatılmış abonelikte dönem sonu devamda uzatılır; dönem sonu iptali bekleyeni kendi adımı kapatır — ikisi de
 * kuyruğa/eylemlere girmez. Sorgular aynı dört koşulu tekrarlar.
 */
export type ExpiredActiveSub = {
  status: string;
  current_period_end: string | null;
  pause_started_at: string | null;
  cancel_at_period_end: boolean | null;
};

export function isExpiredActive(sub: ExpiredActiveSub | null, nowMs: number): boolean {
  if (!sub || sub.status !== "active" || !sub.current_period_end) return false;
  if (sub.pause_started_at || sub.cancel_at_period_end) return false;
  const end = Date.parse(sub.current_period_end);
  return Number.isFinite(end) && end < nowMs;
}

