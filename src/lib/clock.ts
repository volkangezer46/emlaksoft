/**
 * Zaman okumaları — tek kaynak.
 *
 * Neden ayrı modül: `Date.now()` bir bileşen gövdesinde doğrudan çağrıldığında
 * React Compiler'ın saflık kuralı (react-hooks/purity) uyarır. Uyarı client
 * tarafında haklıdır — her render farklı değer üretir. Server Component'lerde
 * ise istek başına bir kez değerlendiği için doğru kullanımdır.
 *
 * Bu niyeti 15 ayrı `eslint-disable` yorumuyla bastırmak yerine, zaman
 * okumasını adlandırılmış yardımcılara topladık. Kazanç iki yönlü:
 *  - Çağrı yerleri ne sorduklarını söylüyor: `isPast(x)`, `daysAgoIso(90)`.
 *  - `new Date(Date.now() - N * 86_400_000).toISOString()` gibi tekrarlayan
 *    aritmetik tek yerde kaldı.
 *
 * Yuvarlama bilinçli olarak çağrı yerinde bırakıldı (`Math.ceil` / `Math.floor`
 * kullanımları arasında fark var); bu modül ham milisaniye döndürür.
 */

export const DAY_MS = 86_400_000;

type DateInput = string | number | Date;

function ms(value: DateInput): number {
  return value instanceof Date ? value.getTime() : new Date(value).getTime();
}

/** Şu anın epoch milisaniyesi. */
export function now(): number {
  return Date.now();
}

/** `days` gün öncesinin ISO karşılığı — Supabase `gte`/`lte` filtreleri için. */
export function daysAgoIso(days: number): string {
  return new Date(Date.now() - days * DAY_MS).toISOString();
}

/** `days` gün sonrasının ISO karşılığı — vade/pencere hesapları için. */
export function daysFromNowIso(days: number): string {
  return new Date(Date.now() + days * DAY_MS).toISOString();
}

/** Verilen andan bu yana geçen milisaniye (geçmiş için pozitif). */
export function msSince(value: DateInput): number {
  return Date.now() - ms(value);
}

/** Verilen ana kalan milisaniye (gelecek için pozitif). */
export function msUntil(value: DateInput): number {
  return ms(value) - Date.now();
}

/** Verilen an geçmişte mi. Geçersiz/boş değer `false` sayılır. */
export function isPast(value: DateInput | null | undefined): boolean {
  if (value === null || value === undefined || value === "") return false;
  const t = ms(value);
  return Number.isNaN(t) ? false : t < Date.now();
}

// ---------------------------------------------------------------------------
// Türkiye (Europe/Istanbul, UTC+3, DST yok) duvar saati yardımcıları.
//
// Sunucu (Vercel) UTC'de çalışır; `new Date().getDate()` gece 00:00–03:00 TRT
// arasında bir önceki günü verir. İstemci ise tarayıcı saat dilimini kullanır,
// bu da SSR/hidrasyon uyuşmazlığına (React #418) yol açar. Gün sınırı
// gerektiren her yer bu yardımcıları kullanmalıdır; hepsi saat diliminden
// bağımsızdır (saf epoch aritmetiği, Intl'e dayanmaz).
// ---------------------------------------------------------------------------

export const TR_OFFSET_MS = 3 * 3_600_000;

/**
 * `<input type="datetime-local">` değeri ("YYYY-MM-DDTHH:mm[:ss]") saat dilimi taşımaz. Sunucu (Vercel) UTC'de
 * çalıştığı için `new Date(ham)` bunu UTC sayar ve Türkiye'de girilen 14:00 kayıtta 17:00 görünür.
 * Bu yardımcı saat dilimsiz değeri Türkiye saati (+03:00) olarak yorumlar; saat dilimi taşıyan girdi (Z / ±hh:mm)
 * aynen kullanılır. Geçersizse null.
 */
export function parseTrLocalDateTime(raw: string): Date | null {
  const value = raw.trim();
  if (!value) return null;
  const hasZone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(value);
  const iso = hasZone ? value : /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(value) ? `${value}+03:00` : value;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Bir anı `datetime-local` değerine ("YYYY-MM-DDTHH:mm") Türkiye saatiyle çevirir (tarayıcı saat diliminden bağımsız). */
export function toTrLocalInput(value: DateInput): string {
  const t = ms(value);
  if (!Number.isFinite(t)) return "";
  return new Date(t + TR_OFFSET_MS).toISOString().slice(0, 16);
}

export type TrParts = {
  year: number;
  /** 0 tabanlı ay (Date ile aynı). */
  month: number;
  day: number;
  hour: number;
  minute: number;
  /** 0=Pazar … 6=Cumartesi (Date.getDay ile aynı). */
  weekday: number;
};

/** Verilen anın Türkiye duvar saatindeki bileşenleri. */
export function trParts(value: DateInput = Date.now()): TrParts {
  const d = new Date(ms(value) + TR_OFFSET_MS);
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth(),
    day: d.getUTCDate(),
    hour: d.getUTCHours(),
    minute: d.getUTCMinutes(),
    weekday: d.getUTCDay(),
  };
}

/** Türkiye gününe göre "YYYY-MM-DD". Argümansız: bugün (TR). */
export function trDayKey(value: DateInput = Date.now()): string {
  return new Date(ms(value) + TR_OFFSET_MS).toISOString().slice(0, 10);
}

/** Verilen anın TR gün başlangıcı (gerçek an, epoch ms). */
export function trDayStartMs(value: DateInput = Date.now()): number {
  const t = ms(value) + TR_OFFSET_MS;
  return Math.floor(t / DAY_MS) * DAY_MS - TR_OFFSET_MS;
}

/** Verilen anın TR gün başlangıcının ISO karşılığı — `gte` filtreleri için. */
export function trDayStartIso(value: DateInput = Date.now()): string {
  return new Date(trDayStartMs(value)).toISOString();
}

/**
 * Takvim günü olarak kullanılan "sahte yerel" Date: TR bugününün yıl/ay/gün
 * bileşenleriyle çalışma ortamının yerel saatinde gece yarısı. Yalnız
 * getFullYear/getMonth/getDate/getDay okumak için; gerçek an DEĞİLDİR.
 */
export function trTodayCalendarDate(value: DateInput = Date.now()): Date {
  const p = trParts(value);
  return new Date(p.year, p.month, p.day);
}

/** `trTodayCalendarDate` türü takvim gününü TR gün başlangıcının gerçek anına çevirir (ISO). */
export function calendarDateToTrIso(d: Date): string {
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - TR_OFFSET_MS).toISOString();
}

/** Türkiye duvar saatiyle "SS:DD". */
export function formatTrTime(value: DateInput): string {
  const p = trParts(value);
  return `${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`;
}

/** Verilen anın TR takvim ayı anahtarı: "YYYY-MM". Argümansız: bu ay (TR). */
export function trMonthKey(value: DateInput = Date.now()): string {
  const p = trParts(value);
  return `${p.year}-${String(p.month + 1).padStart(2, "0")}`;
}

/** Verilen anın TR ay başlangıcı (gerçek an, epoch ms): ayın 1'i 00:00 TR. */
export function trMonthStartMs(value: DateInput = Date.now()): number {
  const p = trParts(value);
  return Date.UTC(p.year, p.month, 1) - TR_OFFSET_MS;
}

/** Bir sonraki TR ayının başlangıcı (epoch ms) — kota penceresi üst sınırı (hariç). */
export function trNextMonthStartMs(value: DateInput = Date.now()): number {
  const p = trParts(value);
  return Date.UTC(p.year, p.month + 1, 1) - TR_OFFSET_MS;
}

/** TR ay başlangıcının ISO karşılığı — `gte` filtreleri için. */
export function trMonthStartIso(value: DateInput = Date.now()): string {
  return new Date(trMonthStartMs(value)).toISOString();
}

/** Bir sonraki TR ayının başlangıcının ISO karşılığı — `lt` filtreleri için. */
export function trNextMonthStartIso(value: DateInput = Date.now()): string {
  return new Date(trNextMonthStartMs(value)).toISOString();
}
