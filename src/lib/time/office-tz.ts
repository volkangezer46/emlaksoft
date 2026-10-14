/**
 * Ofis saat dilimi — TEK kaynak.
 *
 * Sunucu UTC'de çalışır; saat dilimi verilmeyen `Intl.DateTimeFormat` ve `getHours()` sunucuda
 * UTC duvar saatini verir (Türkiye'de 10:00 olan randevu uyarıda "07:00" görünürdü). Ofis
 * işlemlerinde gösterilen saat ve gün penceresi bu modülden alınır. Türkiye 2016'dan beri
 * sabit UTC+3 (yaz saati yok); gün sınırı aritmetiği `clock.ts` TR yardımcılarına dayanır.
 */

import { DAY_MS, trDayKey, trDayStartMs, trParts } from "@/lib/clock";

/** Ofisin IANA saat dilimi. */
export const OFFICE_TIME_ZONE = "Europe/Istanbul";

const timeFmt = new Intl.DateTimeFormat("tr-TR", { hour: "2-digit", minute: "2-digit", timeZone: OFFICE_TIME_ZONE });

type DateInput = string | number | Date;

/** Bir anı ofis duvar saatiyle "SS:DD" olarak biçimler (sunucu saat diliminden bağımsız). */
export function formatOfficeTime(value: DateInput): string {
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? "" : timeFmt.format(d);
}

/**
 * Bir anın ofis günü etrafındaki sorgu penceresi: ofis gününün başından `padDays` gün önce,
 * gün sonundan `padDays` gün sonra (epoch ms; üst sınır hariç).
 */
export function officeDayWindow(value: DateInput, padDays = 1): { start: Date; end: Date } {
  const dayStart = trDayStartMs(value);
  return { start: new Date(dayStart - padDays * DAY_MS), end: new Date(dayStart + (1 + padDays) * DAY_MS) };
}

/**
 * Şu andan sonraki ilk yarım saat (ofis saatiyle): 10:07 → 10:30, 10:30 → 11:00, 23:45 → ertesi gün 00:00.
 * Dönen tarih/saat `<input type="date|time">` değerleridir.
 */
export function nextHalfHourOffice(nowMs: number): { date: string; time: string } {
  const step = 30 * 60_000;
  const next = (Math.floor(nowMs / step) + 1) * step;
  const p = trParts(next);
  return { date: trDayKey(next), time: `${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}` };
}
