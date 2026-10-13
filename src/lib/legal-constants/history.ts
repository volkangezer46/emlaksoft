import { LEGAL_CONSTANTS, type LegalKey } from "./index";

/**
 * MEVZUAT SABİTİ GEÇERLİLİK GEÇMİŞİ — SAF (G/Ç ve saat yok; tarih çağırandan gelir).
 *
 * `legal_constants` (migration 20261013005100) satırları: anahtar + değer + geçerlilik başlangıcı (YYYY-MM-DD, TR günü).
 * Çözüm kuralı: verilen günde, `valid_from <= gün` olan EN YENİ satır geçerlidir; hiçbiri yoksa koddaki değer
 * (`LEGAL_CONSTANTS`). Geleceğe tarihli kayıt o güne kadar UYGULANMAZ (eski değer sürer). Aynı gün iki kayıt olamaz
 * (DB tekil kısıtı). Bilinmeyen anahtar yok sayılır.
 */
export type LegalConstantRecord = {
  key: string;
  value: number;
  validFrom: string;
  note?: string | null;
  source?: string | null;
  createdAt?: string;
};

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isLegalKey(k: string): k is LegalKey {
  return Object.prototype.hasOwnProperty.call(LEGAL_CONSTANTS, k);
}

export function isDayKey(v: string): boolean {
  if (!DAY_RE.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

/** `day` (YYYY-MM-DD) gününde geçerli kayıt; yoksa null (kod değeri geçerli). */
export function activeRecord(key: string, records: readonly LegalConstantRecord[], day: string): LegalConstantRecord | null {
  let best: LegalConstantRecord | null = null;
  for (const r of records) {
    if (r.key !== key || !isDayKey(r.validFrom) || !Number.isFinite(r.value)) continue;
    if (r.validFrom > day) continue; // geleceğe tarihli: henüz yürürlükte değil
    if (!best || r.validFrom > best.validFrom) best = r;
  }
  return best;
}

/** `day` gününde geçerli değer: kayıt > kod değeri. */
export function resolveLegalValue(key: LegalKey, records: readonly LegalConstantRecord[], day: string): number {
  return activeRecord(key, records, day)?.value ?? LEGAL_CONSTANTS[key].value;
}

/** Bir sonraki (geleceğe tarihli) kayıt; yoksa null. Admin ekranında "şu tarihte değişecek" satırı için. */
export function nextScheduled(key: string, records: readonly LegalConstantRecord[], day: string): LegalConstantRecord | null {
  let best: LegalConstantRecord | null = null;
  for (const r of records) {
    if (r.key !== key || !isDayKey(r.validFrom) || r.validFrom <= day) continue;
    if (!best || r.validFrom < best.validFrom) best = r;
  }
  return best;
}

/** Tüm sabitlerin `day` günündeki değeri (kayıtsız anahtar kod değeriyle). */
export function resolveAllLegalValues(records: readonly LegalConstantRecord[], day: string): Record<LegalKey, number> {
  const out = {} as Record<LegalKey, number>;
  for (const k of Object.keys(LEGAL_CONSTANTS) as LegalKey[]) out[k] = resolveLegalValue(k, records, day);
  return out;
}
