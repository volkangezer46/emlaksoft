/**
 * GA-02 takvimde sürükle-bırak — SAF hesap (DOM yok; `week-grid.tsx` kullanır, testli).
 * Kurallar: 15 dk'ya yaslama; dikey sürükleme saati, yatay sürükleme günü (hafta görünümü) değiştirir; alt kenar süreyi
 * değiştirir (en az 15 dk, en çok 12 saat). Başlangıç ızgara saatleri içinde kalır (07:00 – 21:00, bitişten 15 dk önce).
 * Saatler Türkiye saatidir (`clock.ts`); sunucu eylemi tarih/saat alanlarını +03:00 olarak yorumlar.
 */
import { DAY_MS, formatTrTime, trDayKey, trParts } from "@/lib/clock";

export const SNAP_MIN = 15;
export const MIN_DURATION = 15;
export const MAX_DURATION = 12 * 60;
export const DEFAULT_DURATION = 60;

export type GridSpec = { hourPx: number; hourStart: number; hourEnd: number };

export function snapMinutes(min: number, step = SNAP_MIN): number {
  return Math.round(min / step) * step;
}

/** Piksel kayması → yaslanmış dakika. */
export function pxToMinutes(dy: number, grid: GridSpec): number {
  return snapMinutes((dy / grid.hourPx) * 60);
}

/**
 * Taşıma sonucu: yeni başlangıç (ISO). `dxDays` gün kayması (hafta görünümünde sütun farkı). Gün içi dakika ızgara
 * aralığına kırpılır; süre değişmez.
 */
export function movedStart(startIso: string, dyPx: number, dxDays: number, grid: GridSpec, durationMin: number | null): string {
  const startMs = Date.parse(startIso);
  const p = trParts(startMs);
  const minuteOfDay = p.hour * 60 + p.minute;
  const dur = durationMin ?? DEFAULT_DURATION;
  const lo = grid.hourStart * 60;
  const hi = Math.max(lo, grid.hourEnd * 60 - Math.min(dur, SNAP_MIN));
  const target = Math.max(lo, Math.min(hi, snapMinutes(minuteOfDay + pxToMinutes(dyPx, grid))));
  return new Date(startMs + (target - minuteOfDay) * 60_000 + dxDays * DAY_MS).toISOString();
}

/** Alt kenardan süre değiştirme sonucu (dk). */
export function resizedDuration(durationMin: number | null, dyPx: number, grid: GridSpec): number {
  const base = durationMin ?? DEFAULT_DURATION;
  return Math.max(MIN_DURATION, Math.min(MAX_DURATION, snapMinutes(base + pxToMinutes(dyPx, grid))));
}

/** Klavye: Alt+↑/↓ 15 dk kaydırır (ızgara sınırında durur). */
export function nudgedStart(startIso: string, direction: -1 | 1, grid: GridSpec, durationMin: number | null): string {
  return movedStart(startIso, (direction * SNAP_MIN * grid.hourPx) / 60, 0, grid, durationMin);
}

/** Sunucu eylemi alanları: TR "YYYY-MM-DD" + "HH:mm". */
export function trDateTimeFields(iso: string): { date: string; time: string } {
  return { date: trDayKey(iso), time: formatTrTime(iso) };
}

/** Hareket gerçekten bir değişiklik mi (ör. yaslama sonrası aynı yere bırakıldı)? */
export function isSameSlot(a: { start: string; duration: number | null }, b: { start: string; duration: number | null }): boolean {
  return Date.parse(a.start) === Date.parse(b.start) && (a.duration ?? DEFAULT_DURATION) === (b.duration ?? DEFAULT_DURATION);
}
