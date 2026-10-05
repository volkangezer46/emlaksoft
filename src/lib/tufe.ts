/**
 * TÜFE (Tüketici Fiyat Endeksi) kira artış hesaplama.
 *
 * Türkiye'de konut kira artışları, 6098 sayılı TBK m.344 uyarınca bir önceki
 * kira yılındaki **12 aylık ortalama TÜFE** oranını geçemez. (Geçici %25 tavan
 * Temmuz 2024'te sona erdi; artık 12 aylık ortalama TÜFE geçerlidir.)
 *
 * DOĞRULANMADI: Aşağıdaki gömülü tablo TÜİK bültenlerinden DOĞRULANAMADI (2025 değerleri tutarsız görünüyor,
 * 2026-08 ve sonrası yok). Bu yüzden gömülü değerlerin HİÇBİRİ "resmi" sayılmaz (official=false): yasal tavan
 * olarak dayatılmaz, ekranda "resmi TÜİK değeri teyit edilmeli" uyarısıyla gösterilir. Güncel/doğrulanmış tablo
 * `platform_settings` anahtarı `tufe.table` (JSON) ile süper admin tarafından /admin/ayarlar/tufe ekranından
 * girilir; resmi işaretli her tablo için doğrulama tarihi + kaynak zorunludur. Kaynaksız rakam koda EKLENMEZ.
 */

// Anahtar: "YYYY-MM" (sözleşme yenileme ayı) → o ay için 12 aylık ortalama TÜFE (%). DOĞRULANMADI (bkz. üst not).
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
 * Gömülü tabloda olmayan yenileme ayları (dropdown'da seçilebilir; oran elle girilir). Resmi rakam
 * /admin/ayarlar/tufe ekranından tabloya işlenince bu liste kullanılmaz (ay doğrudan tablodan gelir).
 */
export const TUFE_PENDING_MONTHS: readonly string[] = [
  "2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07",
];

export type LegalIncrease = {
  newRent: number;      // TÜFE tavanıyla hesaplanan yeni kira (₺, yuvarlanmış)
  appliedRate: number;  // Uygulanan oran (%) — yenileme ayının 12 aylık ort. TÜFE'si
  capped: boolean;      // Ay verisi yoksa en güncel aya düşüldü mü (fallback)
  /** Bu ay için RESMİ 12 aylık ort. TÜFE var mı. false ise appliedRate/newRent
   *  TAHMİNDİR — yasal tavan olarak dayatılMAMALI ve denetim kaydına "TÜFE %X"
   *  olarak YAZILMAMALIDIR (uydurma oran). Çağıran taraf bu bayrağı kontrol etmeli. */
  official: boolean;
};

// ---------------------------------------------------------------------------
// Tablo tabanlı API (ayardan düzenlenebilir). Saf: veri okuma tufe-server.ts'te.
// ---------------------------------------------------------------------------

/** platform_settings anahtarı (JSON). */
export const TUFE_SETTING_KEY = "tufe.table";
/** Ekranda gösterilen sabit uyarı (resmi doğrulanmamış değerler için). */
export const TUFE_UNVERIFIED_NOTICE = "Resmi TÜİK değeri teyit edilmeli.";

export type TufeEntry = { rate: number; official: boolean };

export type TufeTable = {
  entries: Record<string, TufeEntry>;
  /** Son doğrulama tarihi (YYYY-MM-DD) — resmi işaretli satır varsa zorunlu. */
  verifiedAt: string | null;
  /** Doğrulama kaynağı (ör. bülten adı/tarihi). */
  source: string | null;
  /** true: ayardan geldi; false: gömülü doğrulanmamış tablo. */
  fromSettings: boolean;
};

/** Gömülü tablo: HİÇBİR satırı resmi değil (kaynak doğrulanamadı). */
export function builtinTufeTable(): TufeTable {
  const entries: Record<string, TufeEntry> = {};
  for (const [month, rate] of Object.entries(TUFE_12M_AVG)) entries[month] = { rate, official: false };
  return { entries, verifiedAt: null, source: null, fromSettings: false };
}

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export type TufeValidation = { ok: true; table: TufeTable } | { ok: false; error: string };

/** Yönetici girdisini doğrular (ay biçimi, oran aralığı, resmi satır için tarih+kaynak). */
export function validateTufeTable(input: {
  entries: Record<string, { rate: unknown; official: unknown }>;
  verifiedAt?: unknown;
  source?: unknown;
}): TufeValidation {
  const entries: Record<string, TufeEntry> = {};
  const months = Object.keys(input.entries ?? {});
  if (months.length === 0) return { ok: false, error: "En az bir ay girilmeli." };
  if (months.length > 240) return { ok: false, error: "En çok 240 ay girilebilir." };
  for (const month of months) {
    if (!MONTH_RE.test(month)) return { ok: false, error: `Geçersiz ay: ${month} (YYYY-AA olmalı).` };
    const raw = input.entries[month]!;
    const rate = typeof raw.rate === "number" ? raw.rate : Number(String(raw.rate ?? "").replace(",", "."));
    if (!Number.isFinite(rate) || rate <= 0 || rate > 500) return { ok: false, error: `${month}: oran 0-500 arasında olmalı.` };
    entries[month] = { rate: Math.round(rate * 100) / 100, official: raw.official === true };
  }
  const verifiedAt = String(input.verifiedAt ?? "").trim();
  const source = String(input.source ?? "").trim();
  if (verifiedAt && !DATE_RE.test(verifiedAt)) return { ok: false, error: "Doğrulama tarihi geçersiz." };
  if (source.length > 300) return { ok: false, error: "Kaynak en çok 300 karakter olabilir." };
  const anyOfficial = Object.values(entries).some((e) => e.official);
  if (anyOfficial && (!verifiedAt || !source)) {
    return { ok: false, error: "Resmi işaretli satır için doğrulama tarihi ve kaynak zorunlu." };
  }
  return { ok: true, table: { entries, verifiedAt: verifiedAt || null, source: source || null, fromSettings: true } };
}

/** Ayardaki JSON'u çözer; yok/bozuksa gömülü (doğrulanmamış) tabloya düşer. */
export function parseTufeTable(raw: string | null | undefined): TufeTable {
  if (!raw || !raw.trim()) return builtinTufeTable();
  try {
    const parsed = JSON.parse(raw) as {
      entries?: Record<string, { rate: unknown; official: unknown }>;
      verifiedAt?: unknown;
      source?: unknown;
    };
    const v = validateTufeTable({ entries: parsed.entries ?? {}, verifiedAt: parsed.verifiedAt, source: parsed.source });
    return v.ok ? v.table : builtinTufeTable();
  } catch {
    return builtinTufeTable();
  }
}

export function serializeTufeTable(table: TufeTable): string {
  return JSON.stringify({ entries: table.entries, verifiedAt: table.verifiedAt, source: table.source });
}

/** Tablodaki aylar (eskiden yeniye). */
export function tufeMonths(table: TufeTable): string[] {
  return Object.keys(table.entries).sort();
}

/** O ay için RESMİ (official=true) satır var mı. */
export function hasOfficialTufeIn(table: TufeTable, month: string): boolean {
  return table.entries[month]?.official === true;
}

/** Tablodaki en güncel ay anahtarı (yoksa ""). */
export function latestTufeMonthIn(table: TufeTable): string {
  return tufeMonths(table).at(-1) ?? "";
}

/** Resmi satırı olan en güncel ay ("" = hiç resmi değer yok). */
export function latestOfficialTufeMonthIn(table: TufeTable): string {
  return tufeMonths(table).filter((m) => table.entries[m]!.official).at(-1) ?? "";
}

export function tufeRateForMonthIn(
  table: TufeTable,
  month: string,
): { rate: number; sourceMonth: string; exact: boolean; official: boolean } {
  const hit = table.entries[month];
  if (hit) return { rate: hit.rate, sourceMonth: month, exact: true, official: hit.official };
  const latest = latestTufeMonthIn(table);
  const e = table.entries[latest];
  return { rate: e?.rate ?? 0, sourceMonth: latest, exact: false, official: false };
}

/**
 * Hesaplayıcı/ekran uyarısı: o yenileme ayı için resmi oran yoksa açık uyarı metni, varsa null.
 * Güncel oran yoksa kullanıcı yanıltılmaz: tahmini/yedek oran yasal tavan gibi sunulmaz.
 */
export function tufeWarningFor(table: TufeTable, month: string): string | null {
  if (hasOfficialTufeIn(table, month)) return null;
  if (table.entries[month]) return `Bu ay için tabloda oran var ama resmi olarak doğrulanmadı. ${TUFE_UNVERIFIED_NOTICE}`;
  return `Bu yenileme ayı için güncel TÜFE oranı tabloda yok. Resmi 12 aylık ortalama TÜFE oranını elle girin. ${TUFE_UNVERIFIED_NOTICE}`;
}

export function computeLegalIncreaseIn(table: TufeTable, currentRent: number, renewalMonth: string): LegalIncrease {
  const tufe = tufeRateForMonthIn(table, renewalMonth);
  const r = computeRentIncrease(currentRent, tufe.rate);
  return { newRent: r.newRent, appliedRate: r.cappedRatePct, capped: !tufe.exact, official: tufe.exact && tufe.official };
}

// ---------------------------------------------------------------------------
// Eski eşzamanlı API (gömülü tablo; hepsi official=false). Geriye dönük uyumluluk.
// ---------------------------------------------------------------------------

/** Gömülü tabloda RESMİ satır yoktur (kaynak doğrulanamadı) → her zaman false. */
export function hasOfficialTufe(month: string): boolean {
  return hasOfficialTufeIn(builtinTufeTable(), month);
}

/** Tablodaki en güncel ay anahtarı (yedek için). */
export function latestTufeMonth(): string {
  return Object.keys(TUFE_12M_AVG).sort().at(-1) ?? "";
}

/** Verilen "YYYY-MM" ayına en yakın (o ay yoksa en güncel) 12 aylık ortalama TÜFE oranını döndürür. */
export function tufeRateForMonth(month: string): { rate: number; sourceMonth: string; exact: boolean } {
  const { rate, sourceMonth, exact } = tufeRateForMonthIn(builtinTufeTable(), month);
  return { rate, sourceMonth, exact };
}

/** Verilen "YYYY-MM" ayı için gömülü (DOĞRULANMAMIŞ) oranı döndürür — projeksiyon amaçlı; yasal tavan DEĞİL. */
export function getTufeRate(month: string): number {
  return tufeRateForMonth(month).rate;
}

/**
 * Yasal tavanla (12 aylık ort. TÜFE) yeni kirayı hesaplar. Gömülü tabloyla `official` HER ZAMAN false'tur;
 * ayardan gelen tablo için `computeLegalIncreaseIn` kullanın.
 */
export function computeLegalIncrease(currentRent: number, renewalMonth: string): LegalIncrease {
  return computeLegalIncreaseIn(builtinTufeTable(), currentRent, renewalMonth);
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
