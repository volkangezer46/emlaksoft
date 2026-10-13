/**
 * Destek SLA'sı için iş saati hesabı (SAF). Veritabanındaki `support_add_business_minutes` ile AYNI kural:
 * gün/saat `support_business_hours`, tatil `support_holidays`; saat dilimi Europe/Istanbul. Türkiye 2016'dan beri
 * yaz saati uygulamadığı için yerel saat sabit UTC+3'tür (DB tarafı yine de IANA bölgesini kullanır).
 * Bu dosya ekranda önizleme ("cuma 17:30'da açılan yüksek öncelikli bilet → pazartesi 10:30") ve testler içindir;
 * kalıcı hedef zamanı yalnız DB yazar.
 */

export const SUPPORT_TIMEZONE = "Europe/Istanbul";
const OFFSET_MINUTES = 180;
const DAY_MS = 86_400_000;

/** ISO gün (1=pazartesi … 7=pazar). Dakikalar yerel saattir. */
export type BusinessDay = { weekday: number; isOpen: boolean; openMinute: number; closeMinute: number };

export type BusinessCalendar = {
  days: readonly BusinessDay[];
  /** YYYY-MM-DD (yerel). */
  holidays: readonly string[];
};

export const WEEKDAY_LABELS: Record<number, string> = {
  1: "Pazartesi",
  2: "Salı",
  3: "Çarşamba",
  4: "Perşembe",
  5: "Cuma",
  6: "Cumartesi",
  7: "Pazar",
};

/** Varsayılan: hafta içi 09:00-18:00, hafta sonu kapalı (migration seed'i ile aynı). */
export const DEFAULT_BUSINESS_DAYS: readonly BusinessDay[] = [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({
  weekday,
  isOpen: weekday <= 5,
  openMinute: 540,
  closeMinute: 1080,
}));

export function minutesToClock(minutes: number): string {
  const m = Math.max(0, Math.min(1440, Math.round(minutes)));
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/** "09:30" → 570; geçersiz = null. "24:00" kapanış için kabul edilir. */
export function clockToMinutes(value: string): number | null {
  const match = /^([01]?\d|2[0-4]):([0-5]\d)$/.exec(value.trim());
  if (!match) return null;
  const total = Number(match[1]) * 60 + Number(match[2]);
  return total <= 1440 ? total : null;
}

function localDayKey(localMs: number): string {
  return new Date(localMs).toISOString().slice(0, 10);
}

function isoWeekday(localMs: number): number {
  const d = new Date(localMs).getUTCDay();
  return d === 0 ? 7 : d;
}

/**
 * `start` anından itibaren `minutes` iş dakikası sonrası (UTC Date). Açık gün yoksa takvim dakikasına düşer;
 * en fazla 800 gün taranır (DB ile aynı güvenlik sınırı).
 */
export function addBusinessMinutes(start: Date, minutes: number, calendar: BusinessCalendar): Date {
  if (!Number.isFinite(minutes) || minutes <= 0) return new Date(start.getTime());
  const open = calendar.days.filter((d) => d.isOpen && d.closeMinute > d.openMinute);
  if (open.length === 0) return new Date(start.getTime() + minutes * 60_000);

  const byDay = new Map(calendar.days.map((d) => [d.weekday, d]));
  const holidays = new Set(calendar.holidays);
  let local = start.getTime() + OFFSET_MINUTES * 60_000;
  let remaining = minutes;

  for (let i = 0; i < 800; i += 1) {
    const dayStart = Math.floor(local / DAY_MS) * DAY_MS;
    const hours = byDay.get(isoWeekday(dayStart));
    if (hours?.isOpen && hours.closeMinute > hours.openMinute && !holidays.has(localDayKey(dayStart))) {
      const openAt = dayStart + hours.openMinute * 60_000;
      const closeAt = dayStart + hours.closeMinute * 60_000;
      const cursor = Math.max(local, openAt);
      if (cursor < closeAt) {
        const available = (closeAt - cursor) / 60_000;
        if (available >= remaining) {
          return new Date(cursor + remaining * 60_000 - OFFSET_MINUTES * 60_000);
        }
        remaining -= available;
      }
    }
    local = dayStart + DAY_MS;
  }
  return new Date(start.getTime() + minutes * 60_000);
}

/** İki an arasındaki iş dakikası (rapor/önizleme). */
export function businessMinutesBetween(start: Date, end: Date, calendar: BusinessCalendar): number {
  if (end.getTime() <= start.getTime()) return 0;
  const byDay = new Map(calendar.days.map((d) => [d.weekday, d]));
  const holidays = new Set(calendar.holidays);
  if (!calendar.days.some((d) => d.isOpen && d.closeMinute > d.openMinute)) {
    return (end.getTime() - start.getTime()) / 60_000;
  }
  let local = start.getTime() + OFFSET_MINUTES * 60_000;
  const localEnd = end.getTime() + OFFSET_MINUTES * 60_000;
  let total = 0;
  for (let i = 0; i < 800 && local < localEnd; i += 1) {
    const dayStart = Math.floor(local / DAY_MS) * DAY_MS;
    const hours = byDay.get(isoWeekday(dayStart));
    if (hours?.isOpen && hours.closeMinute > hours.openMinute && !holidays.has(localDayKey(dayStart))) {
      const from = Math.max(local, dayStart + hours.openMinute * 60_000);
      const to = Math.min(localEnd, dayStart + hours.closeMinute * 60_000);
      if (to > from) total += (to - from) / 60_000;
    }
    local = dayStart + DAY_MS;
  }
  return total;
}
