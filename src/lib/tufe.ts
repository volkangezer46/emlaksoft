/**
 * TÜFE (Tüketici Fiyat Endeksi) kira artış hesaplama.
 *
 * Türkiye'de konut kira artışları, 6098 sayılı TBK m.344 uyarınca bir önceki
 * kira yılındaki **12 aylık ortalama TÜFE** oranını geçemez. (Geçici %25 tavan
 * Temmuz 2024'te sona erdi; artık 12 aylık ortalama TÜFE geçerlidir.)
 *
 * Aşağıdaki tablo TÜİK'in açıkladığı "on iki aylık ortalamalara göre değişim"
 * oranlarıdır (yaklaşık, referans amaçlı — resmi rakam için TÜİK esastır).
 * Yeni ay verileri açıklandıkça bu tabloya eklenmelidir.
 */

// Anahtar: "YYYY-MM" (sözleşme yenileme ayı) → o ay için geçerli 12 aylık ortalama TÜFE (%)
export const TUFE_12M_AVG: Record<string, number> = {
  "2024-01": 65.19,
  "2024-02": 66.68,
  "2024-03": 67.28,
  "2024-04": 67.86,
  "2024-05": 68.13,
  "2024-06": 67.59,
  "2024-07": 66.49,
  "2024-08": 65.20,
  "2024-09": 63.24,
  "2024-10": 61.06,
  "2024-11": 58.84,
  "2024-12": 56.47,
  "2025-01": 53.87,
  "2025-02": 51.06,
  "2025-03": 48.58,
  "2025-04": 46.34,
  "2025-05": 44.17,
  "2025-06": 42.15,
  "2025-07": 40.19,
  "2025-08": 38.42,
  "2025-09": 36.75,
  "2025-10": 35.20,
  "2025-11": 33.80,
  "2025-12": 32.50,
};

/**
 * Resmi TÜİK 12 aylık ort. TÜFE'si HENÜZ tabloya işlenmemiş yenileme ayları.
 * Dropdown'da seçilebilir ama otomatik oran UYGULANMAZ — kullanıcı güncel resmi
 * oranı elle girer. Yasal tavan hukuki sonuç doğurduğundan tahmini/uydurma oran
 * yazmıyoruz; resmi rakam açıklandıkça ilgili ay TUFE_12M_AVG'ye TAŞINMALI (ve
 * buradan çıkarılmalı). 2026 ayları eklendi (2025-12'den sonrası).
 */
export const TUFE_PENDING_MONTHS: readonly string[] = [
  "2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07",
];

/** Bir yenileme ayının resmi 12 aylık ort. TÜFE'si tabloda var mı. */
export function hasOfficialTufe(month: string): boolean {
  return TUFE_12M_AVG[month] !== undefined;
}

/** Tablodaki en güncel ay anahtarı (fallback için). */
export function latestTufeMonth(): string {
  return Object.keys(TUFE_12M_AVG).sort().at(-1) ?? "";
}

/** Verilen "YYYY-MM" ayına en yakın (o ay yoksa en güncel) 12 aylık ortalama TÜFE oranını döndürür. */
export function tufeRateForMonth(month: string): { rate: number; sourceMonth: string; exact: boolean } {
  if (TUFE_12M_AVG[month] !== undefined) {
    return { rate: TUFE_12M_AVG[month], sourceMonth: month, exact: true };
  }
  const latest = latestTufeMonth();
  return { rate: TUFE_12M_AVG[latest] ?? 0, sourceMonth: latest, exact: false };
}

/** Verilen "YYYY-MM" ayı için geçerli yasal tavan oranını (%) döndürür — kısa yol. */
export function getTufeRate(month: string): number {
  return tufeRateForMonth(month).rate;
}

export type LegalIncrease = {
  newRent: number;      // TÜFE tavanıyla hesaplanan yeni kira (₺, yuvarlanmış)
  appliedRate: number;  // Uygulanan oran (%) — yenileme ayının 12 aylık ort. TÜFE'si
  capped: boolean;      // Ay verisi yoksa en güncel aya düşüldü mü (fallback)
  /** Bu ay için RESMİ 12 aylık ort. TÜFE var mı. false ise appliedRate/newRent
   *  eski aya düşen TAHMİNDİR — yasal tavan olarak dayatılMAMALI ve denetim
   *  kaydına "TÜFE %X" olarak YAZILMAMALIDIR (uydurma oran). Çağıran taraf bu
   *  bayrağı kontrol etmeli. */
  official: boolean;
};

/**
 * Yasal tavanla (12 aylık ort. TÜFE) yeni kirayı hesaplar.
 * Yenileme radarı ve "artışı uygula" akışının tek hesap kaynağı.
 * `official=false` iken oran resmi değildir (fallback) — çağıran tavan dayatmamalı.
 */
export function computeLegalIncrease(currentRent: number, renewalMonth: string): LegalIncrease {
  const official = hasOfficialTufe(renewalMonth);
  const tufe = tufeRateForMonth(renewalMonth);
  const r = computeRentIncrease(currentRent, tufe.rate);
  return { newRent: r.newRent, appliedRate: r.cappedRatePct, capped: !tufe.exact, official };
}

export type RentIncreaseResult = {
  currentRent: number;
  ratePct: number;
  cappedRatePct: number;       // Yasal tavan uygulandıktan sonra
  newRent: number;
  monthlyDiff: number;
  annualDiff: number;
  capApplied: boolean;
};

/**
 * Kira artışını hesaplar.
 * @param currentRent  Mevcut aylık kira
 * @param ratePct      Uygulanacak artış oranı (%)
 * @param legalCapPct  Yasal tavan (12 aylık ort. TÜFE). Verilirse ratePct bunu aşamaz.
 */
export function computeRentIncrease(
  currentRent: number,
  ratePct: number,
  legalCapPct?: number,
): RentIncreaseResult {
  const capApplied = legalCapPct !== undefined && ratePct > legalCapPct;
  const cappedRatePct = capApplied ? legalCapPct! : ratePct;
  const newRent = Math.round(currentRent * (1 + cappedRatePct / 100));
  const monthlyDiff = newRent - currentRent;
  return {
    currentRent,
    ratePct,
    cappedRatePct,
    newRent,
    monthlyDiff,
    annualDiff: monthlyDiff * 12,
    capApplied,
  };
}
